/* global process */
// ══════════════════════════════════════════════════════════════════════════════
// opcua-service.js
// ──────────────────────────────────────────────────────────────────────────────
// OPC UA Client service that bridges the Kepware 6.x OPC UA Server (PLC) with
// the Node.js backend.  It provides:
//   1. Persistent connection to the OPC UA endpoint with automatic reconnect.
//   2. A monitored subscription that pushes PLC tag changes to Socket.io.
//   3. Write helpers for command tags (including pulse-trigger logic).
// ══════════════════════════════════════════════════════════════════════════════

import opcua from 'node-opcua';

const {
  OPCUAClient,
  MessageSecurityMode,
  SecurityPolicy,
  AttributeIds,
  DataType,
  TimestampsToReturn,
  ClientSubscription,
  ClientMonitoredItem,
} = opcua;

// ── Configuration ────────────────────────────────────────────────────────────

const OPCUA_ENDPOINT =
  process.env.OPCUA_ENDPOINT || 'opc.tcp://127.0.0.1:49320';

// Base NodeId prefix — all tags live under this namespace path in Kepware
const TAG_PREFIX = 'ns=2;s=PLC1.Cabin.';

// Reconnect tuning
const RECONNECT_INITIAL_DELAY_MS = 2000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_BACKOFF_FACTOR = 1.5;

// Subscription sampling rate (ms) — how often Kepware is polled for changes
const SAMPLING_INTERVAL_MS = 500;

// ── Tag definitions ──────────────────────────────────────────────────────────

/**
 * READ tags — monitored continuously via OPC UA subscription.
 * Each entry maps a friendly key to its full NodeId.
 */
const READ_TAGS = {
  currentStation: `${TAG_PREFIX}Current_Station`,   // INT  (1–4)
  targetStation: `${TAG_PREFIX}Target_Station`,     // INT  (1–4)
  robotStatus: `${TAG_PREFIX}Robot_Status`,       // INT  (0=Ready,1=Running,2=Error)
  cabinReady: `${TAG_PREFIX}Cabin_Ready`,         // BOOL (1=Ready, 0=Busy lifting)
  // ── E-Stop status from PLC ─────────────────────────────────────────────
  eStopStatus: `${TAG_PREFIX}E-Stop_CMD`,         // BOOL — TRUE=emergency stop engaged, FALSE=safe (normal operation)
};

/**
 * WRITE tags — written on-demand when commands arrive from the UI.
 */
const WRITE_TAGS = {
  targetStation: `${TAG_PREFIX}Target_Station`,    // INT  (1–4)
  confirmCmd: `${TAG_PREFIX}Confirm_CMD`,         // BOOL (Nút XÁC NHẬN tại trạm: Web writes TRUE, PLC auto-resets)
  confirmCmd1: `${TAG_PREFIX}Confirm_CMD1`,       // BOOL (Nút TẠO LỘ TRÌNH: Web writes TRUE, PLC auto-resets)
  confirmCmd2: `${TAG_PREFIX}Confirm_CMD2`,       // BOOL (Nút LẤY HÀNG: Web writes TRUE, PLC auto-resets)
  maintenanceMode: `${TAG_PREFIX}Maintenance_Mode`,  // BOOL (maintained)
};

// ── Module state ─────────────────────────────────────────────────────────────

let client = null;
let session = null;
let subscription = null;
let ioInstance = null;            // Socket.io server instance
let reconnectTimer = null;
let reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
let isConnecting = false;
let isShuttingDown = false;
let plcLivenessTimer = null;     // Interval for periodic PLC liveness broadcast
const pendingClearTags = new Set();

// Latest cached values from monitored tags (used for initial snapshot on
// new Socket.io connections so the UI doesn't have to wait for the next change)
const latestValues = {
  currentStation: null,
  targetStation: null,
  robotStatus: null,
  cabinReady: null,
  // E-Stop status from PLC (TRUE=emergency stop engaged, FALSE=safe)
  eStopStatus: null,
};

// Cache quality of each monitored tag to check if the PLC is communicating
const latestQualities = {
  currentStation: false,
  targetStation: false,
  robotStatus: false,
  cabinReady: false,
  eStopStatus: false,
};

let connectionActiveTime = 0;

// Timestamp of last Good-quality data received from PLC tags.
let lastGoodDataTs = 0;
const PLC_DATA_STALE_MS = 30_000; // 30s without good data = PLC offline (tags may be static)

/**
 * Returns true when backend has an active OPC UA session AND has recently
 * received at least one Good-quality tag value from Kepware/PLC.
 * 30-second window handles the case where all tags are static (no change events).
 */
function isPlcLive() {
  if (!session) return false;
  // Cho phép 6 giây đầu sau khi kết nối để nhận giá trị ban đầu từ Kepware
  if (Date.now() - connectionActiveTime < 6000) return true;
  return lastGoodDataTs > 0 && (Date.now() - lastGoodDataTs) < PLC_DATA_STALE_MS;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[OPC-UA] ${msg}`);
}

function logError(msg, err) {
  console.error(`[OPC-UA] ${msg}`, err?.message || err || '');
}

/**
 * Map the PLC integer status code to a human-readable Vietnamese string
 * that matches the existing frontend status vocabulary.
 */
function mapRobotStatus(plcValue) {
  if (plcValue === null || plcValue === undefined) return 'Chưa kết nối';
  switch (plcValue) {
    case 0: return 'Sẵn sàng';
    case 1: return 'Đang di chuyển';
    case 2: return 'Dừng khẩn cấp';
    default: return `Không rõ (${plcValue})`;
  }
}

/**
 * Map a PLC station number (1–4) to the SCADA station ID (ST-01 … ST-04).
 */
function mapStationId(plcStation) {
  if (Number.isInteger(plcStation) && plcStation >= 1) {
    return `ST-${String(plcStation).padStart(2, '0')}`;
  }
  return null;
}

// ── Connection lifecycle ─────────────────────────────────────────────────────

/**
 * Initialise the OPC UA service.
 *
 * @param {import('socket.io').Server} io  The Socket.io server instance that
 *   will be used to push PLC tag changes to all connected browser clients.
 */
export async function initOpcUa(io) {
  ioInstance = io;
  isShuttingDown = false;

  // Periodically broadcast PLC liveness so frontend updates when PLC reconnects
  // or goes offline without needing an explicit OPC UA disconnect event.
  if (plcLivenessTimer) clearInterval(plcLivenessTimer);
  plcLivenessTimer = setInterval(() => {
    if (ioInstance && session) {
      ioInstance.emit('plc:connectionStatus', {
        connected: isPlcLive(),
        ts: Date.now(),
      });
    }
  }, 3000); // Broadcast every 3s

  await connectToServer();
}

/**
 * Core connection routine.  Creates the OPC UA client, connects, creates a
 * session, subscribes to the read tags, and wires up lifecycle listeners.
 */
async function connectToServer() {
  if (isConnecting || isShuttingDown) return;
  isConnecting = true;

  log(`Connecting to ${OPCUA_ENDPOINT} …`);

  try {
    // ── 1. Create client ──────────────────────────────────────────────────
    client = OPCUAClient.create({
      applicationName: 'SCADA-NodeBackend',
      connectionStrategy: {
        initialDelay: 1000,
        maxRetry: 3,
        maxDelay: 5000,
      },
      securityMode: MessageSecurityMode.None,
      securityPolicy: SecurityPolicy.None,
      endpointMustExist: false,
      requestedSessionTimeout: 60000,
      keepSessionAlive: true,
    });

    // Wire up disconnect / reconnect hooks
    client.on('backoff', (retryCount, delay) => {
      log(`Connection attempt ${retryCount} — retrying in ${delay} ms …`);
    });

    client.on('connection_lost', () => {
      log('Connection to Kepware lost.');
      latestValues.currentStation = null;
      latestValues.robotStatus = null;
      // Reset qualities
      for (const k of Object.keys(latestQualities)) {
        latestQualities[k] = false;
      }
      emitConnectionStatus(false);
      scheduleReconnect();
    });

    client.on('connection_reestablished', () => {
      log('Connection to Kepware re-established.');
      reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
      emitConnectionStatus(true);
    });

    // ── 2. Connect ────────────────────────────────────────────────────────
    await client.connect(OPCUA_ENDPOINT);
    log('TCP connection established.');

    // ── 3. Create session ─────────────────────────────────────────────────
    session = await client.createSession();
    connectionActiveTime = Date.now();
    log('OPC UA session created.');

    // Fix for "too many publish requests" warning:
    // Explicitly limit the number of concurrent publish requests to match server
    // capabilities (Kepware usually handles ~5). This prevents the client-side
    // engine from overwhelming the server and spamming warnings.
    const publishEngine = session.getPublishEngine
      ? session.getPublishEngine()
      : session.publish_engine;

    if (publishEngine) {
      publishEngine.nbMaxPublishRequestsAcceptedByServer = 3;
    }

    // ── 4. Create subscription & monitor read tags ────────────────────────
    await setupSubscription();

    // Reset back-off on successful connect
    reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
    isConnecting = false;

    // Push the online status to all connected browsers
    emitConnectionStatus(true);

    // Clear stuck pulses if any
    for (const nodeId of pendingClearTags) {
      try {
        await writeTag(nodeId, false, DataType.Boolean);
        pendingClearTags.delete(nodeId);
        log(`Successfully cleared stuck pulse on ${nodeId} after reconnect`);
      } catch (err) {
        logError(`Failed to clear stuck pulse on ${nodeId} after reconnect`, err);
      }
    }

    // E-Stop_CMD chỉ được đọc từ PLC, Web không ghi đè — bỏ block khởi tạo.

    log('Initialisation complete — monitoring PLC tags.');
  } catch (err) {
    isConnecting = false;
    logError('Connection failed', err);
    emitConnectionStatus(false);
    scheduleReconnect();
  }
}

/**
 * Schedule a reconnect attempt with exponential back-off.
 */
function scheduleReconnect() {
  if (isShuttingDown) return;
  if (reconnectTimer) return; // one timer at a time

  log(`Scheduling reconnect in ${reconnectDelay} ms …`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    // Clean up stale handles before retrying
    await cleanupConnection();
    await connectToServer();

    // Increase delay for next attempt (capped)
    reconnectDelay = Math.min(
      reconnectDelay * RECONNECT_BACKOFF_FACTOR,
      RECONNECT_MAX_DELAY_MS,
    );
  }, reconnectDelay);
}

/**
 * Gracefully close session, subscription, and client.
 */
async function cleanupConnection() {
  try {
    if (subscription) {
      await subscription.terminate();
      subscription = null;
    }
  } catch { /* ignore */ }

  try {
    if (session) {
      await session.close();
      session = null;
    }
  } catch { /* ignore */ }

  try {
    if (client) {
      await client.disconnect();
      client = null;
    }
  } catch { /* ignore */ }
}

/**
 * Call this on server shutdown (SIGINT / SIGTERM) for a clean exit.
 */
export async function shutdownOpcUa() {
  isShuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (plcLivenessTimer) {
    clearInterval(plcLivenessTimer);
    plcLivenessTimer = null;
  }

  await cleanupConnection();
  log('Shutdown complete.');
}

// ── Subscription (READ tags) ─────────────────────────────────────────────────

/**
 * Create an OPC UA subscription and add monitored items for every read tag.
 * Whenever Kepware reports a value change the callback pushes an event over
 * Socket.io to all connected frontend clients.
 */
async function setupSubscription() {
  if (!session) throw new Error('No active session — cannot subscribe.');

  subscription = ClientSubscription.create(session, {
    requestedPublishingInterval: SAMPLING_INTERVAL_MS,
    requestedLifetimeCount: 120,
    requestedMaxKeepAliveCount: 20,
    maxNotificationsPerPublish: 50,
    publishingEnabled: true,
    priority: 10,
  });

  subscription.on('started', () => {
    log(`Subscription started — ID ${subscription.subscriptionId}`);
  });

  subscription.on('terminated', () => {
    log('Subscription terminated.');
  });

  // Monitor each read tag
  for (const [key, nodeId] of Object.entries(READ_TAGS)) {
    const monitoredItem = ClientMonitoredItem.create(
      subscription,
      { nodeId, attributeId: AttributeIds.Value },
      {
        samplingInterval: SAMPLING_INTERVAL_MS,
        discardOldest: true,
        queueSize: 1,
      },
      TimestampsToReturn.Both,
    );

    monitoredItem.on('changed', (dataValue) => {
      const value = dataValue.value?.value;
      const statusCode = dataValue.statusCode?.value;

      // Cập nhật timestamp khi nhận được dữ liệu chất lượng tốt
      const isGoodQuality = (statusCode === 0 || dataValue.statusCode?.name === 'Good');
      if (key in latestQualities) latestQualities[key] = isGoodQuality;

      if (!isGoodQuality) {
        logError(`Bad quality on ${key} (statusCode=${statusCode}), forwarding anyway...`);
      } else {
        // Good quality — cập nhật timestamp để isPlcLive() không bị timeout
        lastGoodDataTs = Date.now();
      }

      // Cache the latest value
      latestValues[key] = value;

      // Emit per-tag events to Socket.io
      switch (key) {
        case 'currentStation':
          ioInstance?.emit('plc:currentStation', {
            raw: value,
            stationId: mapStationId(value),
          });
          ioInstance?.emit('plc:stationSensors', buildStationSensors());
          log(`Current_Station → ${value} (${mapStationId(value)})`);
          break;

        case 'targetStation':
          ioInstance?.emit('plc:targetStation', {
            raw: value,
            stationId: mapStationId(value),
          });
          log(`Target_Station → ${value} (${mapStationId(value)})`);
          break;

        case 'robotStatus':
          ioInstance?.emit('plc:robotStatus', {
            raw: value,
            label: mapRobotStatus(value),
          });
          log(`Robot_Status → ${value} (${mapRobotStatus(value)})`);
          break;



        // case 'liftHigh1':
        // case 'liftHigh2':
        //   ioInstance?.emit('plc:liftSensors', {
        //     liftHigh1: Boolean(latestValues.liftHigh1),
        //     liftHigh2: Boolean(latestValues.liftHigh2),
        //   });
        //   log(`${key} → ${value}`);
        //   break;

        case 'cabinReady':
          ioInstance?.emit('plc:cabinReady', { ready: Boolean(value), ts: Date.now() });
          log(`Cabin_Ready → ${value ? 'READY' : 'BUSY'}`);
          break;

        case 'eStopStatus':
          // E-Stop_CMD: TRUE=đang dừng khẩn cấp, FALSE=bình thường (an toàn)
          // Web nhận TRUE → kích hoạt giao diện E-Stop
          ioInstance?.emit('plc:eStopStatus', { active: Boolean(value), raw: Boolean(value), ts: Date.now() });
          log(`E-Stop_CMD → ${value ? 'EMERGENCY STOP (TRUE)' : 'SAFE (FALSE)'}`);
          break;
      }

      // Also emit a consolidated snapshot so the UI can use a single listener
      ioInstance?.emit('plc:snapshot', buildSnapshot());
    });

    log(`Monitoring ${key} → ${nodeId}`);
  }
}

/**
 * Build a consolidated snapshot from the latest cached values.
 */
/**
 * Build a station-sensor state object from the latest cached I0.4–I0.7 values.
 */
function buildStationSensors() {
  const st = latestValues.currentStation;
  return {
    'ST-01': st === 1,
    'ST-02': st === 2,
    'ST-03': st === 3,
    'ST-04': st === 4,
  };
}

function buildSnapshot() {
  return {
    currentStation: latestValues.currentStation,
    stationId: mapStationId(latestValues.currentStation),
    targetStation: latestValues.targetStation,
    targetStationId: mapStationId(latestValues.targetStation),
    robotStatus: latestValues.robotStatus,
    robotStatusLabel: mapRobotStatus(latestValues.robotStatus),
    cabinReady: Boolean(latestValues.cabinReady),
    // E-Stop status từ PLC: TRUE=đang dừng khẩn cấp, FALSE=an toàn (bình thường)
    eStopActive: Boolean(latestValues.eStopStatus), // active khi PLC gửi TRUE
    // Station position sensors (I0.4–I0.7)
    stationSensors: buildStationSensors(),
    ts: Date.now(),
  };
}

/**
 * Emit the OPC UA connection status to all frontend clients.
 * connected = true when the OPC UA session with KepServer is alive.
 */
function emitConnectionStatus(connected) {
  ioInstance?.emit('plc:connectionStatus', { connected, ts: Date.now() });
}

/**
 * Push the current cached snapshot to a single socket (used when a new
 * browser tab connects so it immediately has the latest PLC state).
 */
export function emitSnapshotToSocket(socket) {
  socket.emit('plc:snapshot', buildSnapshot());
  // connected = true when the OPC UA session with KepServer is active.
  socket.emit('plc:connectionStatus', {
    connected: session !== null,
    ts: Date.now(),
  });
}

// ── Write helpers (WRITE tags) ───────────────────────────────────────────────

/**
 * Low-level helper — write a single value to an OPC UA node.
 *
 * @param {string}  nodeId    Full NodeId string (ns=2;s=…)
 * @param {*}       value     The value to write
 * @param {DataType} dataType OPC UA DataType enum member
 * @returns {Promise<void>}
 */
async function writeTag(nodeId, value, dataType) {
  const activeSession = session;
  if (!activeSession) {
    logError(`Write failed to ${nodeId}: No active session.`);
    throw new Error('OPC UA session is not active — cannot write.');
  }

  try {
    const statusCode = await activeSession.write({
      nodeId,
      attributeId: AttributeIds.Value,
      value: {
        value: { dataType, value },
      },
    });

    if (statusCode.value !== 0) {
      const errorMsg = `Write to ${nodeId} failed (statusCode=${statusCode.toString()})`;
      logError(errorMsg);
      throw new Error(errorMsg);
    }

    log(`[WRITE SUCCESS] ${nodeId} ← ${value} (Type: ${dataType})`);
  } catch (err) {
    logError(`Exception during write to ${nodeId}:`, err);
    throw err;
  }
}

// writePulse removed — spec does not require Move_Execute pulse.
// PLC starts moving when Target_Station is written.

// ── Public command API (called from server.js Socket.io handlers) ────────────

// Mutex queue to prevent concurrent OPC UA writes from interleaving and corrupting sequences
let commandQueue = Promise.resolve();

function enqueueCommand(taskFn) {
  // FIX: Separate the caller's result promise from the internal chain.
  // The chain always resolves (via internal catch) so subsequent commands can run,
  // while the caller's promise reflects the actual success/failure of their command.
  let resolve, reject;
  const callerPromise = new Promise((res, rej) => { resolve = res; reject = rej; });
  commandQueue = commandQueue.then(() => taskFn().then(resolve, reject)).catch(() => { }); // ensure chain never rejects
  return callerPromise;
}

/**
 * Send the cabin to a target station.
 *
 * Per OPC UA spec: PLC starts moving immediately when Target_Station is written.
 * No pulse trigger needed.
 *
 * @param {number}  stationNumber  PLC station number (1–4)
 * @param {boolean} isStat         True for STAT (urgent) priority
 */
export function callCabin(stationNumber, isStat = false, withConfirm = false) {
  return enqueueCommand(async () => {
    if (!Number.isInteger(stationNumber) || stationNumber < 1 || stationNumber > 4) {
      throw new Error(`Invalid stationNumber: ${stationNumber} (must be 1–4)`);
    }

    log(`callCabin → Target_Station = ${stationNumber} (STAT=${isStat})`);
    await writeTag(WRITE_TAGS.targetStation, stationNumber, DataType.UInt16);

    if (withConfirm) {
      log('callCabin → Confirm_CMD1 = TRUE after setting Target_Station');
      await writeTag(WRITE_TAGS.confirmCmd1, true, DataType.Boolean);
      await new Promise((resolve) => setTimeout(resolve, 300));
      log('callCabin → Confirm_CMD1 = FALSE (Web auto-reset)');
      await writeTag(WRITE_TAGS.confirmCmd1, false, DataType.Boolean);
    }
  });
}

export function setEStop(active) {
  return enqueueCommand(async () => {
    // Biến E-Stop chỉ được đọc từ PLC, không cho phép Web ghi đè
    log(`setEStop → Bỏ qua lệnh ghi (Biến E-Stop_CMD chỉ được đọc từ PLC)`);
  });
}

/**
 * Send a reset signal to clear the PLC error state.
 * Currently a no-op placeholder — spec does not define a reset tag.
 */
export function resetError() {
  return enqueueCommand(async () => {
    log('resetError → (no PLC reset tag defined in spec)');
  });
}

/**
 * Gửi Confirm_CMD = TRUE để xác nhận đã nhận/giao hàng tại trạm (nút XÁC NHẬN).
 *
 * Web tự động viết FALSE sau 300ms để tránh kẹt biến.
 */
export function confirmStop() {
  return enqueueCommand(async () => {
    log('confirmStop → Confirm_CMD = TRUE');
    await writeTag(WRITE_TAGS.confirmCmd, true, DataType.Boolean);
    await new Promise((resolve) => setTimeout(resolve, 300));
    log('confirmStop → Confirm_CMD = FALSE (Web auto-reset)');
    await writeTag(WRITE_TAGS.confirmCmd, false, DataType.Boolean);
  });
}

/**
 * Gửi Confirm_CMD1 = TRUE để kích hoạt lộ trình (nút TẠO LỘ TRÌNH).
 *
 * Web tự động viết FALSE sau 300ms để tránh kẹt biến.
 */
export function confirmRoute() {
  return enqueueCommand(async () => {
    log('confirmRoute → Confirm_CMD1 = TRUE');
    await writeTag(WRITE_TAGS.confirmCmd1, true, DataType.Boolean);
    await new Promise((resolve) => setTimeout(resolve, 300));
    log('confirmRoute → Confirm_CMD1 = FALSE (Web auto-reset)');
    await writeTag(WRITE_TAGS.confirmCmd1, false, DataType.Boolean);
  });
}

/**
 * Gửi Confirm_CMD2 = TRUE để lấy hàng tại trạm hiện tại (nút LẤY HÀNG).
 *
 * Web tự động viết FALSE sau 300ms để tránh kẹt biến.
 */
export function confirmPickup() {
  return enqueueCommand(async () => {
    log('confirmPickup → Confirm_CMD2 = TRUE');
    await writeTag(WRITE_TAGS.confirmCmd2, true, DataType.Boolean);
    await new Promise((resolve) => setTimeout(resolve, 300));
    log('confirmPickup → Confirm_CMD2 = FALSE (Web auto-reset)');
    await writeTag(WRITE_TAGS.confirmCmd2, false, DataType.Boolean);
  });
}

/**
 * @deprecated Dùng confirmRoute() hoặc confirmPickup() thay thế.
 * Giữ lại để tương thích ngược.
 */
export function confirmStation() {
  return confirmRoute();
}

/**
 * Activate or deactivate maintenance mode.
 * This is a maintained (latched) signal.
 *
 * @param {boolean} active  True = enter maintenance, False = exit
 */
export function setMaintenanceMode(active) {
  return enqueueCommand(async () => {
    log(`setMaintenanceMode → ${active}`);
    await writeTag(WRITE_TAGS.maintenanceMode, Boolean(active), DataType.Boolean);
  });
}
