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

// Duration for pulse triggers (Move_Execute, Reset_Cmd): 0 → 1 → 0
const PULSE_DURATION_MS = 500;

// ── Tag definitions ──────────────────────────────────────────────────────────

/**
 * READ tags — monitored continuously via OPC UA subscription.
 * Each entry maps a friendly key to its full NodeId.
 */
const READ_TAGS = {
  currentStation: `${TAG_PREFIX}Current_Station`,   // INT  (1–4)
  robotStatus:    `${TAG_PREFIX}Robot_Status`,       // INT  (0=Ready,1=Running,2=Error)
  arrivalDone:    `${TAG_PREFIX}Arrival_Done`,       // BOOL
};

/**
 * WRITE tags — written on-demand when commands arrive from the UI.
 */
const WRITE_TAGS = {
  targetStation:    `${TAG_PREFIX}Target_Station`,    // INT  (1–4)
  moveExecute:      `${TAG_PREFIX}Move_Execute`,      // BOOL (pulse)
  priorityStat:     `${TAG_PREFIX}Priority_STAT`,     // BOOL
  eStopCmd:         `${TAG_PREFIX}E_Stop_Cmd`,        // BOOL (maintained)
  resetCmd:         `${TAG_PREFIX}Reset_Cmd`,         // BOOL (pulse)
  maintenanceMode:  `${TAG_PREFIX}Maintenance_Mode`,  // BOOL (maintained)
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
const pendingClearTags = new Set();

// Latest cached values from monitored tags (used for initial snapshot on
// new Socket.io connections so the UI doesn't have to wait for the next change)
const latestValues = {
  currentStation: null,
  robotStatus: null,
  arrivalDone: null,
};

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
  switch (plcValue) {
    case 0:  return 'Sẵn sàng';
    case 1:  return 'Đang di chuyển';
    case 2:  return 'Dừng khẩn cấp';
    default: return `Không rõ (${plcValue})`;
  }
}

/**
 * Map a PLC station number (1–4) to the SCADA station ID (ST-01 … ST-04).
 */
function mapStationId(plcStation) {
  if (plcStation >= 1 && plcStation <= 4) {
    return `ST-0${plcStation}`;
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
      latestValues.arrivalDone = null;
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

      // Only process Good quality data
      if (statusCode !== 0) {
        logError(`Bad quality on ${key} (statusCode=${statusCode})`);
        return;
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
          log(`Current_Station → ${value} (${mapStationId(value)})`);
          break;

        case 'robotStatus':
          ioInstance?.emit('plc:robotStatus', {
            raw: value,
            label: mapRobotStatus(value),
          });
          log(`Robot_Status → ${value} (${mapRobotStatus(value)})`);
          break;

        case 'arrivalDone':
          ioInstance?.emit('plc:arrivalDone', { value: Boolean(value) });
          log(`Arrival_Done → ${value}`);
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
function buildSnapshot() {
  return {
    currentStation: latestValues.currentStation,
    stationId: mapStationId(latestValues.currentStation),
    robotStatus: latestValues.robotStatus,
    robotStatusLabel: mapRobotStatus(latestValues.robotStatus),
    arrivalDone: Boolean(latestValues.arrivalDone),
    ts: Date.now(),
  };
}

/**
 * Emit the OPC UA connection status to all frontend clients.
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

/**
 * Generate a rising-edge pulse: write TRUE, wait PULSE_DURATION_MS, write FALSE.
 * Used for Move_Execute and Reset_Cmd which require a 0 → 1 → 0 transition.
 *
 * @param {string} nodeId Full NodeId string
 * @returns {Promise<void>}
 */
async function writePulse(nodeId) {
  try {
    await writeTag(nodeId, true, DataType.Boolean);
    await new Promise((resolve) => setTimeout(resolve, PULSE_DURATION_MS));
  } finally {
    try {
      await writeTag(nodeId, false, DataType.Boolean);
      pendingClearTags.delete(nodeId);
    } catch (err) {
      logError(`CRITICAL: Failed to clear pulse on ${nodeId}. PLC might be stuck! Scheduling clear on reconnect.`, err);
      pendingClearTags.add(nodeId);
    }
    log(`PULSE complete on ${nodeId} (${PULSE_DURATION_MS} ms)`);
  }
}

// ── Public command API (called from server.js Socket.io handlers) ────────────

// Mutex queue to prevent concurrent OPC UA writes from interleaving and corrupting sequences
let commandQueue = Promise.resolve();

function enqueueCommand(taskFn) {
  const next = commandQueue.then(taskFn).catch((err) => { throw err; });
  commandQueue = next.catch(() => {}); // catch internally so failures don't block subsequent commands
  return next;
}

/**
 * Send the cabin to a target station.
 *
 * Sequence:
 *   1. Write Priority_STAT (true/false)
 *   2. Write Target_Station (1–4)
 *   3. Pulse Move_Execute (0 → 1 → 0 over 500 ms)
 *
 * @param {number}  stationNumber  PLC station number (1–4)
 * @param {boolean} isStat         True for STAT (urgent) priority
 */
export function callCabin(stationNumber, isStat = false) {
  return enqueueCommand(async () => {
    if (!Number.isInteger(stationNumber) || stationNumber < 1 || stationNumber > 4) {
      throw new Error(`Invalid stationNumber: ${stationNumber} (must be 1–4)`);
    }

    log(`callCabin → station=${stationNumber}, STAT=${isStat}`);

    // Step 1 — Set priority flag BEFORE sending target
    await writeTag(WRITE_TAGS.priorityStat, Boolean(isStat), DataType.Boolean);

    // Step 2 — Set the destination
    await writeTag(WRITE_TAGS.targetStation, stationNumber, DataType.Int16);

    // Step 3 — Trigger movement (pulse)
    await writePulse(WRITE_TAGS.moveExecute);
  });
}

/**
 * Activate or deactivate the E-Stop command.
 * This is a maintained (latched) signal — the PLC holds the value.
 *
 * @param {boolean} active  True = engage E-Stop, False = release
 */
export function setEStop(active) {
  return enqueueCommand(async () => {
    log(`setEStop → ${active}`);
    await writeTag(WRITE_TAGS.eStopCmd, Boolean(active), DataType.Boolean);
  });
}

/**
 * Send a reset pulse to clear the PLC error state.
 * Generates a 0 → 1 → 0 transition over 500 ms.
 */
export function resetError() {
  return enqueueCommand(async () => {
    log('resetError → pulse');
    await writePulse(WRITE_TAGS.resetCmd);
  });
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
