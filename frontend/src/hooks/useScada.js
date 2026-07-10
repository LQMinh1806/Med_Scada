import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  RAIL_POINTS,
  STATIONS,
  INITIAL_USERS,
  USER_ROLES,
  MAX_LOGS,
  MAX_SPECIMEN_HISTORY,
  PRIORITY,
  ROBOT_STATUS,
} from '../constants';
import useScadaApi from './scada/useScadaApi';
import useQueueScheduler, { DIRECTION, QUEUE_PRIORITY } from './scada/useQueueScheduler';
import useOpcUaSocket from './useOpcUaSocket';
import {
  parseMaintenanceEvent,
  parseRobotStateEvent,
} from './scada/scadaHelpers';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
// SIMULATION_MODE đã bị tắt — chỉ dùng dữ liệu thực từ PLC
const SCADA_EVENTS_URL = `${API_BASE_URL}/events`;
const SCADA_SYNC_KEY = 'scada:sync:event';
const SCADA_SYNC_CHANNEL = 'scada:sync:channel';
const SCADA_TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const ROUTE_STATUS = {
  MOVING: 'moving',
  WAITING_CONFIRM: 'waiting_confirm',
};

const ROUTE_STOP_STATUS = {
  PENDING: 'pending',
  MOVING: 'moving',
  WAITING_CONFIRM: 'waiting_confirm',
  CONFIRMED: 'confirmed',
};

function getStationById(stationId) {
  return STATIONS.find((station) => station.id === stationId) || null;
}

function stationDistance(aId, bId) {
  const a = getStationById(aId);
  const b = getStationById(bId);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs(a.idx - b.idx);
}

function orderDispatchDestinations(originStationId, destinationStationIds, priorityStationId = null) {
  const uniqueDestinationIds = [...new Set(
    (Array.isArray(destinationStationIds) ? destinationStationIds : [])
      .map((stationId) => String(stationId || '').trim())
      .filter((stationId) => stationId && stationId !== originStationId && getStationById(stationId))
  )];

  const ordered = [];
  let remaining = uniqueDestinationIds;
  let currentStationId = originStationId;

  if (priorityStationId && remaining.includes(priorityStationId)) {
    ordered.push(priorityStationId);
    remaining = remaining.filter((stationId) => stationId !== priorityStationId);
    currentStationId = priorityStationId;
  }

  while (remaining.length > 0) {
    remaining.sort((a, b) => {
      const distanceDelta = stationDistance(currentStationId, a) - stationDistance(currentStationId, b);
      if (distanceDelta !== 0) return distanceDelta;
      return getStationById(a).idx - getStationById(b).idx;
    });
    const nextStationId = remaining[0];
    ordered.push(nextStationId);
    currentStationId = nextStationId;
    remaining = remaining.slice(1);
  }

  return ordered.map((stationId) => getStationById(stationId)).filter(Boolean);
}

// =====================================================
// Main SCADA hook
// =====================================================

export default function useScada() {
  // === Auth state ===
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // === Domain data ===
  const [users, setUsers] = useState(INITIAL_USERS);

  const [systemLogs, setSystemLogs] = useState([]);
  const [currentSpecimen, setCurrentSpecimen] = useState(null);
  const [scanList, setScanList] = useState([]);
  const [scanFeedback, setScanFeedback] = useState(null); // 'success' | 'error' | 'duplicate' | null
  const [scannedSpecimens, setScannedSpecimens] = useState([]);
  const [transportedSpecimens, setTransportedSpecimens] = useState([]);
  const [maintenanceMode, setMaintenanceMode] = useState({
    enabled: false,
    reason: '',
    updatedAt: null,
  });
  const [activeDispatchRoute, setActiveDispatchRouteState] = useState(null);

  // === Cabin sensor state (ESP32 DHT11 + MPU6050) ===
  const [cabinSensorData, setCabinSensorData] = useState(null);
  const [sensorHistory, setSensorHistory] = useState([]);
  const SENSOR_HISTORY_MAX = 60; // 2-min window at 2s interval

  // === Robot state ===
  const [robotState, setRobotState] = useState(() => {
    const initialStation = STATIONS[0];
    const initialPoint = RAIL_POINTS[initialStation.idx];
    return {
      id: 'CABIN-01',
      index: initialStation.idx,
      x: initialPoint.x,
      y: initialPoint.y,
      targetId: initialStation.id,
      status: ROBOT_STATUS.READY,
      isOnline: true,
    };
  });

  // === Animation state ===
  const [animating, setAnimating] = useState(false);
  const [moveId, setMoveId] = useState(0);
  const [animPos, setAnimPos] = useState(() => {
    const initialPoint = RAIL_POINTS[STATIONS[0].idx];
    return { x: initialPoint.x, y: initialPoint.y, angle: 0, progress: 0 };
  });

  // === Refs for stable access in callbacks ===
  const rafRef = useRef(null);
  const usersRef = useRef(users);
  const robotStateRef = useRef(robotState);
  const currentSpecimenRef = useRef(currentSpecimen);
  const logIdRef = useRef(1000);
  const specimenIdRef = useRef(1);
  const maintenanceRef = useRef(maintenanceMode);
  const animatingRef = useRef(animating);
  const scanListRef = useRef(scanList);
  const scanFeedbackTimerRef = useRef(null);
  const syncChannelRef = useRef(null);
  const lastAppliedSyncTsRef = useRef(0);
  const authReconnectDoneRef = useRef(false);
  // FIX: Track whether initial robot state hydration has been done.
  // After the first hydration, subsequent SSE/polling syncs should NOT
  // overwrite robotState.status — otherwise the user's E-STOP reset
  // action gets reverted when the server log still shows ESTOP status.
  const initialHydrationDoneRef = useRef(false);
  // FIX [M5]: Track acknowledgeTask timer for cleanup on unmount
  const ackResetTimerRef = useRef(null);
  // FIX [H1]: Debounce timer for hydration calls
  const hydrateDebounceRef = useRef(null);
  // FIX [H3]: Debounce timer for log API calls
  const logFlushTimerRef = useRef(null);
  const logBatchRef = useRef([]);
  const apiRequest = useScadaApi({ setCurrentUser, setIsAuthenticated });

  // === Queue scheduler ===
  const scheduler = useQueueScheduler();
  const {
    queue,
    cabinDirection,
    queueRef,
    directionRef,
    enqueue,
    cancelQueueItem: _cancelQueueItem,
    clearQueue,
    replaceQueue,
    dequeueNextTask,
    syncDirectionRef,
  } = scheduler;

  // === OPC UA Socket connection ===
  const opc = useOpcUaSocket();
  const socketReconnect = opc.reconnectSocket;

  // Ref to break circular dependency: executeRobotMove ↔ processNextQueueTask
  const processQueueRef = useRef(null);
  const executingTaskRef = useRef(null);
  const activeDispatchRouteRef = useRef(activeDispatchRoute);

  const setActiveDispatchRoute = useCallback((updater) => {
    const nextRoute = typeof updater === 'function'
      ? updater(activeDispatchRouteRef.current)
      : updater;
    activeDispatchRouteRef.current = nextRoute;
    setActiveDispatchRouteState(nextRoute);
    return nextRoute;
  }, []);

  // === Wire sensor:cabinData socket event ===
  useEffect(() => {
    opc.setOnCabinSensor((data) => {
      if (!data || typeof data !== 'object') return;
      setCabinSensorData(data);
      setSensorHistory((prev) => {
        const next = [...prev, data];
        if (next.length > SENSOR_HISTORY_MAX) next.shift();
        return next;
      });
    });
  }, [opc]);

  // Hardware E-Stop logic moved to bottom

  // === Fallback HTTP polling for encoder data (khi Socket.io không hoạt động qua domain) ===
  // FIX [BUG-01]: Chỉ chạy khi đã đăng nhập và tự dừng khi đăng xuất.
  useEffect(() => {
    if (!isAuthenticated) return;

    let active = true;

    const pollEncoder = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/sensors/cabin/latest`, {
          credentials: 'include',
        });
        if (res.ok && active) {
          const data = await res.json();
          if (data && typeof data === 'object' && data.positionPct != null) {
            setCabinSensorData(data);
          }
        }
      } catch {
        // Bỏ qua lỗi mạng, thử lại lần sau
      }
    };

    // Poll mỗi 300ms để cập nhật vị trí encoder liên tục (ESP32 gửi ngay khi xung thay đổi)
    const interval = setInterval(pollEncoder, 300);
    // Lần đầu tiên: poll ngay lập tức
    pollEncoder();

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isAuthenticated]); // FIX [BUG-01]: dừng polling khi logout

  const toDateTimeText = useCallback((value) => {
    if (!value) return new Date().toLocaleString();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString();
  }, []);

  // === Ref sync effects ===
  useEffect(() => { usersRef.current = users; }, [users]);
  useEffect(() => { robotStateRef.current = robotState; }, [robotState]);
  useEffect(() => { currentSpecimenRef.current = currentSpecimen; }, [currentSpecimen]);
  useEffect(() => { maintenanceRef.current = maintenanceMode; }, [maintenanceMode]);
  useEffect(() => { animatingRef.current = animating; }, [animating]);
  useEffect(() => { scanListRef.current = scanList; }, [scanList]);
  useEffect(() => {
    if (!isAuthenticated) {
      lastAppliedSyncTsRef.current = 0;
      authReconnectDoneRef.current = false;
      // FIX [BUG-09]: Reset dedup Set khi đăng xuất để tránh bỏ sót sync payload
      // sau khi đăng nhập lại (server có thể replay cùng msgId sau restart)
      recentSyncIdsRef.current = new Set();
    }
  }, [isAuthenticated]);

  // Build a serializable queue for cross-tab/device sync.
  // Keep route metadata so another account can continue/observe the same route.
  const buildQueueSnapshot = useCallback(() => {
    return queueRef.current.map(item => ({
      id: item.id,
      stationId: item.stationId,
      type: item.type,
      priority: item.priority,
      timestamp: item.timestamp,
      metadata: item.metadata ? {
        specimenRecord: item.metadata.specimenRecord || null,
        specimenRecords: Array.isArray(item.metadata.specimenRecords)
          ? item.metadata.specimenRecords
          : null,
        dispatchTime: item.metadata.dispatchTime || null,
        routeDelivery: Boolean(item.metadata.routeDelivery),
        routeId: item.metadata.routeId || null,
        stopIndex: Number.isInteger(item.metadata.stopIndex) ? item.metadata.stopIndex : null,
        stopCount: Number.isInteger(item.metadata.stopCount) ? item.metadata.stopCount : null,
        fromStationId: item.metadata.fromStationId || null,
        stationId: item.metadata.stationId || null,
        priorityStationId: item.metadata.priorityStationId || null,
        isPriorityStop: Boolean(item.metadata.isPriorityStop),
        isBatch: Boolean(item.metadata.isBatch),
        batchCount: Number.isInteger(item.metadata.batchCount) ? item.metadata.batchCount : null,
      } : null,
    }));
  }, [queueRef]);

  const buildSyncSnapshot = useCallback((overrides = {}) => {
    const robot = robotStateRef.current;
    const maintenance = maintenanceRef.current;
    return {
      status: overrides.status ?? robot.status,
      index: overrides.index ?? robot.index,
      x: overrides.x ?? robot.x,
      y: overrides.y ?? robot.y,
      targetId: overrides.targetId ?? robot.targetId,
      maintenanceEnabled: overrides.maintenanceEnabled ?? maintenance.enabled,
      maintenanceReason: overrides.maintenanceReason ?? maintenance.reason,
      // Queue sync data
      queue: overrides.queue ?? buildQueueSnapshot(),
      cabinDirection: overrides.cabinDirection ?? directionRef.current,
      activeDispatchRoute: overrides.activeDispatchRoute !== undefined
        ? overrides.activeDispatchRoute
        : activeDispatchRouteRef.current,
    };
  }, [buildQueueSnapshot, directionRef]);

  const applySyncSnapshot = useCallback((snapshot) => {
    if (!snapshot || typeof snapshot !== 'object') return;

    setMaintenanceMode((prev) => ({
      ...prev,
      enabled: Boolean(snapshot.maintenanceEnabled),
      reason: snapshot.maintenanceEnabled ? String(snapshot.maintenanceReason || '').trim() : '',
      updatedAt: new Date().toLocaleString(),
    }));

    if (!animatingRef.current) {
      setRobotState((prev) => {
        const nextIndex = Number.isInteger(snapshot.index) ? snapshot.index : prev.index;
        const point = RAIL_POINTS[nextIndex] || RAIL_POINTS[prev.index] || { x: prev.x, y: prev.y };
        const nextX = typeof snapshot.x === 'number' ? snapshot.x : point.x;
        const nextY = typeof snapshot.y === 'number' ? snapshot.y : point.y;
        return {
          ...prev,
          index: nextIndex,
          x: nextX,
          y: nextY,
          targetId: snapshot.targetId || prev.targetId,
          status: snapshot.status || prev.status,
        };
      });
    }

    // --- Queue sync: apply remote queue state ---
    if (Array.isArray(snapshot.queue)) {
      replaceQueue(snapshot.queue, snapshot.cabinDirection);
    }

    if (Object.prototype.hasOwnProperty.call(snapshot, 'activeDispatchRoute')) {
      const nextRoute = snapshot.activeDispatchRoute && typeof snapshot.activeDispatchRoute === 'object'
        ? snapshot.activeDispatchRoute
        : null;
      setActiveDispatchRoute(nextRoute);
    }
  }, [replaceQueue, setActiveDispatchRoute]);

  const recentSyncIdsRef = useRef(new Set());

  const publishSyncSnapshot = useCallback((snapshot) => {
    if (typeof window === 'undefined') return;

    const payload = {
      type: 'snapshot',
      sourceTabId: SCADA_TAB_ID,
      msgId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ts: Date.now(),
      snapshot,
    };

    // Primary: broadcast via Socket.io to all devices on the network
    opc.emitStateSync(payload);

    // Secondary: BroadcastChannel for same-browser tab sync (faster for local tabs)
    try {
      if (syncChannelRef.current) {
        syncChannelRef.current.postMessage(payload);
      }
    } catch {
      // Ignore BroadcastChannel failures.
    }

    try {
      localStorage.setItem(SCADA_SYNC_KEY, JSON.stringify(payload));
    } catch {
      // Ignore localStorage unavailability.
    }
  }, [opc]);

  const shouldApplySyncPayload = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') return false;
    
    // Deduplicate exact payloads by msgId
    const msgId = payload.msgId;
    if (msgId) {
      if (recentSyncIdsRef.current.has(msgId)) return false;
      recentSyncIdsRef.current.add(msgId);
      if (recentSyncIdsRef.current.size > 100) {
        const arr = Array.from(recentSyncIdsRef.current);
        recentSyncIdsRef.current = new Set(arr.slice(arr.length - 50));
      }
    }

    const payloadTs = Number(payload.ts);
    if (Number.isFinite(payloadTs) && payloadTs > 0) {
      if (payloadTs < lastAppliedSyncTsRef.current - 5000) return false;
      lastAppliedSyncTsRef.current = Math.max(lastAppliedSyncTsRef.current, payloadTs);
      return true;
    }

    // Fallback for malformed/no timestamp payloads: accept but advance marker.
    lastAppliedSyncTsRef.current = Date.now();
    return true;
  }, []);

  // === Logging ===
  // FIX [H3]: Batch log API writes. Logs are buffered and flushed
  // every 500ms to avoid request storms during rapid operations.
  const LOG_FLUSH_INTERVAL_MS = 500;

  const flushLogBatch = useCallback(() => {
    const batch = logBatchRef.current;
    if (batch.length === 0) return;
    logBatchRef.current = [];
    // Fire individual API calls but without triggering separate sync events
    // (backend debounces broadcastSyncRequired already)
    for (const log of batch) {
      apiRequest('/system-logs', {
        method: 'POST',
        body: JSON.stringify(log),
      }).catch(() => {
        // Ignore background persistence errors to keep the control loop responsive.
      });
    }
  }, [apiRequest]);

  const addLog = useCallback((event, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setSystemLogs(prev => {
      const next = [{ id: logIdRef.current, time, event, type }, ...prev];
      logIdRef.current += 1;
      if (next.length > MAX_LOGS) next.length = MAX_LOGS;
      return next;
    });

    // Buffer the API call instead of firing immediately
    logBatchRef.current.push({ event, type });
    if (!logFlushTimerRef.current) {
      logFlushTimerRef.current = setTimeout(() => {
        logFlushTimerRef.current = null;
        flushLogBatch();
      }, LOG_FLUSH_INTERVAL_MS);
    }
  }, [flushLogBatch]);

  const hydratePersistedData = useCallback(async ({ syncStations = true } = {}) => {
    try {
      if (syncStations) {
        await apiRequest('/stations/sync', {
          method: 'POST',
          body: JSON.stringify({
            stations: STATIONS.map((station) => ({
              id: station.id,
              name: station.name,
              locationIndex: station.idx,
            })),
          }),
        });
      }

      const data = await apiRequest('/bootstrap');

      if (Array.isArray(data?.users) && data.users.length > 0) {
        const mappedUsers = data.users.map((user) => ({
          id: user.id,
          username: user.username,
          fullname: user.fullname,
          role: user.role,
          active: Boolean(user.active),
          fingerprintId: user.fingerprintId ?? null,
          stationId: user.stationId ?? null,
          password: '',
        }));
        usersRef.current = mappedUsers;
        setUsers(mappedUsers);
      }

      if (Array.isArray(data?.systemLogs)) {
        const logs = data.systemLogs.map((log) => ({
          id: log.id,
          time: toDateTimeText(log.createdAt),
          event: log.event,
          type: log.type || 'info',
        }));
        setSystemLogs(logs);

        // FIX: Only hydrate robot state from server logs on INITIAL bootstrap.
        // Subsequent SSE/polling syncs must NOT overwrite robotState.status,
        // because the user's local actions (e.g. E-STOP reset) are the source
        // of truth — server logs may lag behind and cause state reversion.
        const isInitialHydration = !initialHydrationDoneRef.current;

        const latestMaintenanceLog = logs.find((log) => log.type === 'maintenance');
        const maintenanceFromLog = parseMaintenanceEvent(latestMaintenanceLog?.event);
        if (maintenanceFromLog) {
          setMaintenanceMode((prev) => {
            if (prev.enabled === maintenanceFromLog.enabled && prev.reason === maintenanceFromLog.reason) {
              return prev;
            }
            return {
              enabled: maintenanceFromLog.enabled,
              reason: maintenanceFromLog.reason,
              updatedAt: latestMaintenanceLog?.time || new Date().toLocaleString(),
            };
          });

          if (isInitialHydration) {
            setRobotState((prev) => ({
              ...prev,
              status: maintenanceFromLog.enabled
                ? ROBOT_STATUS.MAINTENANCE
                : (prev.status === ROBOT_STATUS.MAINTENANCE ? ROBOT_STATUS.READY : prev.status),
            }));
          }
        }

        if (isInitialHydration) {
          const latestRobotStateLog = logs.find((log) => log.type === 'state' || String(log.event || '').startsWith('[ROBOT_STATE]'));
          const robotFromLog = parseRobotStateEvent(latestRobotStateLog?.event);
          if (robotFromLog && !animatingRef.current) {
            setRobotState((prev) => {
              const nextIndex = robotFromLog.index ?? prev.index;
              const point = RAIL_POINTS[nextIndex] || RAIL_POINTS[prev.index] || { x: prev.x, y: prev.y };
              const nextX = robotFromLog.x ?? point.x;
              const nextY = robotFromLog.y ?? point.y;

              return {
                ...prev,
                status: robotFromLog.status,
                index: nextIndex,
                x: nextX,
                y: nextY,
                targetId: robotFromLog.targetId || prev.targetId,
              };
            });
          }
          initialHydrationDoneRef.current = true;
        }
      }

      if (Array.isArray(data?.scannedSpecimens)) {
        setScannedSpecimens(
          data.scannedSpecimens.map((item) => ({
            id: item.id,
            barcode: item.barcode,
            patientName: item.patientName,
            testType: item.testType,
            priority: item.priority || PRIORITY.ROUTINE,
            scanTime: toDateTimeText(item.scanTime),
            status: item.status || 'pending',
            destinationStationId: item.destinationStationId || null,
            destinationStationName: item.destinationStationName || null,
          }))
        );
      }

      if (Array.isArray(data?.transportedSpecimens)) {
        setTransportedSpecimens(
          data.transportedSpecimens.map((item) => ({
            specimenId: item.specimenId,
            barcode: item.barcode,
            patientName: item.patientName,
            testType: item.testType,
            priority: item.priority || PRIORITY.ROUTINE,
            scanTime: toDateTimeText(item.scanTime),
            dispatchTime: toDateTimeText(item.dispatchTime),
            arrivalTime: toDateTimeText(item.arrivalTime),
            fromStationId: item.fromStationId,
            fromStationName: item.fromStationName,
            toStationId: item.toStationId,
            toStationName: item.toStationName,
            cabinId: item.cabinId,
          }))
        );
      }
    } catch {
      // Keep local simulation available even when backend cannot hydrate.
    }
  }, [apiRequest, toDateTimeText]);

  // === User management ===
  const setUsersAndSyncRef = useCallback((updater) => {
    setUsers(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      usersRef.current = next;
      return next;
    });
  }, []);

  const addUser = useCallback(({ username, password, fullname, role, stationId = null }) => {
    const normalizedUsername = (username || '').trim();
    const normalizedFullname = (fullname || '').trim();
    const normalizedRole = role || USER_ROLES.OPERATOR;

    if (!normalizedUsername || !password || !normalizedFullname || !normalizedRole) {
      addLog('Thiếu thông tin tạo tài khoản', 'error');
      return false;
    }

    if (![USER_ROLES.TECH, USER_ROLES.OPERATOR].includes(normalizedRole)) {
      addLog(`Vai trò ${normalizedRole} không hợp lệ`, 'error');
      return false;
    }

    if (usersRef.current.some(u => u.username === normalizedUsername)) {
      addLog(`Tài khoản ${normalizedUsername} đã tồn tại`, 'error');
      return false;
    }

    // FIX: Return the promise so callers can await the actual backend result
    // instead of always returning true before the API responds.
    return apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: normalizedUsername,
        password,
        fullname: normalizedFullname,
        role: normalizedRole,
        stationId: normalizedRole === USER_ROLES.OPERATOR ? stationId : null,
      }),
    })
      .then((result) => {
        if (!result?.user) {
          addLog('Tạo tài khoản thất bại từ backend', 'error');
          return false;
        }

        const created = result.user;
        setUsersAndSyncRef(prev => [
          {
            id: created.id,
            username: created.username,
            fullname: created.fullname,
            role: created.role,
            active: Boolean(created.active),
            password: '',
          },
          ...prev.filter((user) => user.username !== created.username),
        ]);
        addLog(`Đã tạo tài khoản ${normalizedUsername}`, 'success');
        return true;
      })
      .catch((error) => {
        addLog(`Tạo tài khoản thất bại: ${error.message}`, 'error');
        return false;
      });
  }, [addLog, apiRequest, setUsersAndSyncRef]);

  const toggleUserActive = useCallback((username) => {
    const target = usersRef.current.find((user) => user.username === username);
    if (!target) return;

    const nextActive = !target.active;
    setUsersAndSyncRef(prev =>
      prev.map(user => (user.username === username ? { ...user, active: nextActive } : user))
    );

    apiRequest(`/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: nextActive }),
    }).catch((error) => {
      setUsersAndSyncRef(prev =>
        prev.map(user => (user.username === username ? { ...user, active: target.active } : user))
      );
      addLog(`Lưu trạng thái ${username} thất bại: ${error.message}`, 'error');
    });

    addLog(`Đã thay đổi trạng thái ${username}`, 'info');
  }, [addLog, apiRequest, setUsersAndSyncRef]);

  const updateUserRole = useCallback((username, role) => {
    if (![USER_ROLES.TECH, USER_ROLES.OPERATOR].includes(role)) {
      addLog(`Vai trò ${role} không hợp lệ`, 'error');
      return;
    }

    // FIX: Clear stationId when switching to TECH (matches backend behavior)
    setUsersAndSyncRef(prev =>
      prev.map(user => (user.username === username
        ? { ...user, role, stationId: role === USER_ROLES.TECH ? null : user.stationId }
        : user))
    );

    apiRequest(`/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }).catch((error) => {
      addLog(`Lưu vai trò ${username} thất bại: ${error.message}`, 'error');
    });

    addLog(`Đã cập nhật vai trò ${username} -> ${role}`, 'info');
  }, [addLog, apiRequest, setUsersAndSyncRef]);

  const updateUserStation = useCallback((username, stationId) => {
    setUsersAndSyncRef(prev =>
      prev.map(user => (user.username === username ? { ...user, stationId: stationId || null } : user))
    );

    apiRequest(`/users/${encodeURIComponent(username)}`, {
      method: 'PATCH',
      body: JSON.stringify({ stationId: stationId || '' }),
    }).catch((error) => {
      addLog(`Lưu trạm cho ${username} thất bại: ${error.message}`, 'error');
    });

    addLog(`Đã cập nhật trạm của ${username} -> ${stationId || 'Tất cả'}`, 'info');
  }, [addLog, apiRequest, setUsersAndSyncRef]);

  const removeUser = useCallback((username) => {
    // FIX: Capture only the specific user being deleted, not the entire array.
    // Restoring the full stale snapshot on failure would overwrite concurrent updates.
    const deletedUser = usersRef.current.find(user => user.username === username);
    setUsersAndSyncRef(prev => prev.filter(user => user.username !== username));

    apiRequest(`/users/${encodeURIComponent(username)}`, {
      method: 'DELETE',
    }).catch((error) => {
      // FIX: Re-insert only the deleted user instead of reverting to stale snapshot
      if (deletedUser) {
        setUsersAndSyncRef(prev => {
          // Avoid double-insert if user somehow reappeared
          if (prev.some(u => u.username === deletedUser.username)) return prev;
          return [deletedUser, ...prev];
        });
      }
      addLog(`Xóa tài khoản ${username} thất bại: ${error.message}`, 'error');
    });

    addLog(`Đã xóa tài khoản ${username}`, 'info');
  }, [addLog, apiRequest, setUsersAndSyncRef]);

  const updateUserFingerprintId = useCallback((userId, fingerprintId) => {
    setUsersAndSyncRef(prev =>
      prev.map(user => (user.id === userId ? { ...user, fingerprintId } : user))
    );
  }, [setUsersAndSyncRef]);

  // === Specimen management — Batch scanning with barcode lookup ===
  const clearScanFeedback = useCallback(() => {
    if (scanFeedbackTimerRef.current) clearTimeout(scanFeedbackTimerRef.current);
    scanFeedbackTimerRef.current = setTimeout(() => {
      setScanFeedback(null);
      scanFeedbackTimerRef.current = null;
    }, 2000);
  }, []);

  const lookupBarcode = useCallback(async (barcode) => {
    const normalizedBarcode = String(barcode || '').trim().toUpperCase();
    if (!normalizedBarcode) return null;

    // Check for duplicates in current scan list
    if (scanListRef.current.some((s) => s.barcode === normalizedBarcode)) {
      setScanFeedback('duplicate');
      clearScanFeedback();
      addLog(`Mẫu ${normalizedBarcode} đã có trong danh sách`, 'info');
      return null;
    }

    try {
      const result = await apiRequest(`/specimens/lookup/${encodeURIComponent(normalizedBarcode)}`);
      if (!result?.specimen) {
        setScanFeedback('error');
        clearScanFeedback();
        addLog(`Không tìm thấy mẫu ${normalizedBarcode}`, 'error');
        return null;
      }

      const specimen = result.specimen;
      const record = {
        id: specimen.id,
        barcode: specimen.barcode,
        patientName: specimen.patientName,
        testType: specimen.testType,
        priority: specimen.priority || PRIORITY.ROUTINE,
        destinationStationId: specimen.destinationStationId || null,
        destinationStationName: specimen.destinationStationName || null,
        status: specimen.status || 'pending',
        scanTime: new Date().toISOString(),
      };

      const nextScanList = [...scanListRef.current, record];
      scanListRef.current = nextScanList;
      setScanList(nextScanList);
      // Also set as currentSpecimen for backward compatibility
      setCurrentSpecimen(record);

      setScanFeedback('success');
      clearScanFeedback();

      addLog(`Đã quét mẫu ${record.barcode} — ${record.patientName}`, 'info');

      // Mark as scanned in backend
      apiRequest('/specimens/scan', {
        method: 'POST',
        body: JSON.stringify({
          barcode: record.barcode,
          patientName: record.patientName,
          testType: record.testType,
          priority: record.priority,
          destinationStationId: record.destinationStationId,
          scanTime: record.scanTime,
        }),
      }).catch((error) => {
        addLog(`Lưu mẫu ${record.barcode} thất bại: ${error.message}`, 'error');
      });

      return record;
    } catch {
      setScanFeedback('error');
      clearScanFeedback();
      addLog(`Không tìm thấy mẫu ${normalizedBarcode} trong hệ thống`, 'error');
      return null;
    }
  }, [addLog, apiRequest, clearScanFeedback]);

  const removeFromScanList = useCallback((barcode) => {
    const nextScanList = scanListRef.current.filter((s) => s.barcode !== barcode);
    scanListRef.current = nextScanList;
    setScanList(nextScanList);
    addLog(`Đã xóa mẫu ${barcode} khỏi danh sách quét`, 'info');
  }, [addLog]);

  const clearScanList = useCallback(() => {
    const count = scanListRef.current.length;
    scanListRef.current = [];
    setScanList([]);
    setCurrentSpecimen(null);
    if (count > 0) addLog(`Đã xóa ${count} mẫu khỏi danh sách quét`, 'info');
  }, [addLog]);

  const updateScanListDestination = useCallback((barcode, stationId) => {
    const normalizedBarcode = String(barcode || '').trim().toUpperCase();
    const destinationStation = getStationById(stationId);
    if (!normalizedBarcode || !destinationStation) {
      addLog('Không thể cập nhật trạm đích cho mẫu', 'error');
      return false;
    }

    let updatedRecord = null;
    const nextScanList = scanListRef.current.map((item) => {
      if (item.barcode !== normalizedBarcode) return item;
      updatedRecord = {
        ...item,
        destinationStationId: destinationStation.id,
        destinationStationName: destinationStation.name,
      };
      return updatedRecord;
    });

    if (!updatedRecord) {
      addLog(`Không tìm thấy mẫu ${normalizedBarcode} trong danh sách quét`, 'error');
      return false;
    }

    scanListRef.current = nextScanList;
    setScanList(nextScanList);
    setCurrentSpecimen((prev) => (
      prev?.barcode === normalizedBarcode ? updatedRecord : prev
    ));
    setScannedSpecimens((prev) =>
      prev.map((item) => (
        item.barcode === normalizedBarcode
          ? {
            ...item,
            destinationStationId: destinationStation.id,
            destinationStationName: destinationStation.name,
          }
          : item
      ))
    );

    apiRequest('/specimens/scan', {
      method: 'POST',
      body: JSON.stringify({
        barcode: updatedRecord.barcode,
        patientName: updatedRecord.patientName,
        testType: updatedRecord.testType,
        priority: updatedRecord.priority,
        destinationStationId: destinationStation.id,
        scanTime: updatedRecord.scanTime,
      }),
    }).catch((error) => {
      addLog(`Lưu trạm đích ${updatedRecord.barcode} thất bại: ${error.message}`, 'error');
    });

    addLog(`Đã đặt trạm đích mẫu ${updatedRecord.barcode} -> ${destinationStation.name}`, 'info');
    return true;
  }, [addLog, apiRequest]);

  // Legacy single-specimen support (kept for backward compatibility)
  const registerScannedSpecimen = useCallback((specimen) => {
    if (!specimen || !specimen.barcode || !specimen.patientName || !specimen.testType) {
      addLog('Dữ liệu mẫu bệnh phẩm không hợp lệ', 'error');
      return null;
    }

    const parsedScanTime = new Date(specimen.scanTime || Date.now());
    const scanTimeIso = Number.isNaN(parsedScanTime.getTime())
      ? new Date().toISOString()
      : parsedScanTime.toISOString();

    const record = {
      id: specimenIdRef.current,
      barcode: String(specimen.barcode || '').toUpperCase(),
      patientName: specimen.patientName,
      testType: specimen.testType,
      priority: specimen.priority || PRIORITY.ROUTINE,
      destinationStationId: specimen.destinationStationId || null,
      destinationStationName: specimen.destinationStationName || null,
      scanTime: scanTimeIso,
      status: 'scanned',
    };
    specimenIdRef.current += 1;

    setCurrentSpecimen(record);
    setScannedSpecimens(prev => {
      const next = [record, ...prev];
      if (next.length > MAX_SPECIMEN_HISTORY) next.length = MAX_SPECIMEN_HISTORY;
      return next;
    });

    addLog(`Đã quét mẫu ${record.barcode}`, 'info');

    apiRequest('/specimens/scan', {
      method: 'POST',
      body: JSON.stringify({
        barcode: record.barcode,
        patientName: record.patientName,
        testType: record.testType,
        priority: record.priority,
        destinationStationId: record.destinationStationId,
        scanTime: record.scanTime,
      }),
    }).catch((error) => {
      addLog(`Lưu mẫu ${record.barcode} thất bại: ${error.message}`, 'error');
    });

    return record;
  }, [addLog, apiRequest]);

  const clearCurrentSpecimen = useCallback(() => {
    setCurrentSpecimen(null);
  }, []);

  // === Animation engine (DEPRECATED) ===
  const stopAnimation = useCallback(() => {}, []);

  const setMaintenanceState = useCallback((enabled, reason = '') => {
    const normalizedReason = String(reason || '').trim();
    setMaintenanceMode({
      enabled,
      reason: enabled ? normalizedReason : '',
      updatedAt: new Date().toLocaleString(),
    });

    // --- KÍCH HOẠT LỆNH BẢO TRÌ XUỐNG PLC ---
    opc.setMaintenance(enabled).then((res) => {
      if (!res?.ok) addLog(`Lỗi lệnh bảo trì xuống PLC: ${res?.error || 'Unknown'}`, 'error');
    }).catch((err) => {
      addLog(`[PLC] Maintenance lỗi kết nối: ${err?.message || 'Unknown'}`, 'error');
    });

    if (enabled) {
      stopAnimation();
      setMoveId((id) => id + 1);
      setRobotState((prev) => ({ ...prev, status: ROBOT_STATUS.MAINTENANCE }));
      addLog(
        `[MAINTENANCE] ENABLED${normalizedReason ? ` | reason=${normalizedReason}` : ''}`,
        'maintenance'
      );
      addLog(
        `[ROBOT_STATE] status=MAINTENANCE index=${robotStateRef.current.index} target=${robotStateRef.current.targetId} x=${Math.round(robotStateRef.current.x)} y=${Math.round(robotStateRef.current.y)}`,
        'state'
      );
      publishSyncSnapshot(buildSyncSnapshot({
        status: ROBOT_STATUS.MAINTENANCE,
        maintenanceEnabled: true,
        maintenanceReason: normalizedReason,
      }));
      return;
    }

    setRobotState((prev) => ({
      ...prev,
      status: prev.status === ROBOT_STATUS.MAINTENANCE ? ROBOT_STATUS.READY : prev.status,
    }));
    addLog('[MAINTENANCE] DISABLED', 'maintenance');
    addLog(
      `[ROBOT_STATE] status=READY index=${robotStateRef.current.index} target=${robotStateRef.current.targetId} x=${Math.round(robotStateRef.current.x)} y=${Math.round(robotStateRef.current.y)}`,
      'state'
    );
    publishSyncSnapshot(buildSyncSnapshot({
      status: ROBOT_STATUS.READY,
      maintenanceEnabled: false,
      maintenanceReason: '',
    }));
  }, [addLog, buildSyncSnapshot, publishSyncSnapshot, stopAnimation, opc]);
  const animatePoints = useCallback((sampleData, durationSec, onComplete) => {
    if (onComplete) onComplete();
  }, []);

  const previewDispatchRoute = useCallback((originStationId, destinationStationIds, priorityStationId = null) => (
    orderDispatchDestinations(originStationId, destinationStationIds, priorityStationId)
  ), []);

  const buildRouteMoveMetadata = useCallback((route, stopIndex) => {
    const stop = route.stops[stopIndex];
    const fromStationId = stopIndex === 0
      ? route.originStationId
      : route.stops[stopIndex - 1]?.stationId;

    return {
      routeDelivery: true,
      routeId: route.id,
      stopIndex,
      stopCount: route.stops.length,
      fromStationId,
      specimenRecord: route.specimenRecords[0],
      specimenRecords: route.specimenRecords,
      dispatchTime: route.dispatchTime,
      isBatch: route.specimenRecords.length > 1,
      batchCount: route.specimenRecords.length,
      priorityStationId: route.priorityStationId,
      isPriorityStop: route.priorityStationId === stop.stationId,
      stationId: stop.stationId,
    };
  }, []);

  const enqueueRouteStop = useCallback((route, stopIndex) => {
    const stop = route.stops[stopIndex];
    if (!stop) return false;

    const metadata = buildRouteMoveMetadata(route, stopIndex);
    const priority = metadata.isPriorityStop ? QUEUE_PRIORITY.STATION : PRIORITY.ROUTINE;
    enqueue(stop.stationId, 'DISPATCH', priority, metadata);
    addLog(
      `[ROUTE] Chặng ${stopIndex + 1}/${route.stops.length}: điều cabin đến ${stop.stationName}${metadata.isPriorityStop ? ' (trạm ưu tiên)' : ''}`,
      'info'
    );
    return true;
  }, [addLog, buildRouteMoveMetadata, enqueue]);

  const persistRouteStopDelivery = useCallback((route, stop, confirmedAt) => {
    const allSpecimens = Array.isArray(route?.specimenRecords) ? route.specimenRecords : [];
    const stopSpecimens = allSpecimens.filter((spec) => spec.destinationStationId === stop?.stationId);
    if (!route || !stop || stopSpecimens.length === 0) {
      addLog(`[ROUTE] Không có mẫu nào cần giao tại ${stop?.stationName || stop?.stationId || 'trạm này'}`, 'info');
      return;
    }

    const toStation = getStationById(stop.stationId);
    const resolveSourceStation = (spec) => (
      getStationById(spec.fromStationId) ||
      getStationById(stop.fromStationId || route.originStationId) ||
      getStationById(route.originStationId)
    );

    const deliveredRecords = stopSpecimens.map((spec) => {
      const sourceStation = resolveSourceStation(spec);
      return {
        specimenId: spec.id,
        barcode: spec.barcode,
        patientName: spec.patientName,
        testType: spec.testType,
        priority: spec.priority || PRIORITY.ROUTINE,
        scanTime: spec.scanTime,
        dispatchTime: route.dispatchTime,
        arrivalTime: confirmedAt,
        fromStationId: sourceStation?.id || route.originStationId,
        fromStationName: sourceStation?.name || route.originStationName,
        toStationId: stop.stationId,
        toStationName: stop.stationName || toStation?.name || stop.stationId,
        cabinId: robotStateRef.current.id,
      };
    });

    setTransportedSpecimens((prev) => {
      const next = [...deliveredRecords, ...prev];
      if (next.length > MAX_SPECIMEN_HISTORY) next.length = MAX_SPECIMEN_HISTORY;
      return next;
    });

    const specimenIds = stopSpecimens.map((spec) => spec.id);
    setScannedSpecimens((prev) =>
      prev.map((item) =>
        specimenIds.includes(item.id)
          ? {
            ...item,
            status: 'transported',
            dispatchTime: route.dispatchTime,
            arrivalTime: confirmedAt,
            toStationId: stop.stationId,
            toStationName: stop.stationName || toStation?.name || stop.stationId,
          }
          : item
      )
    );

    const batchLabel = stopSpecimens.length > 1 ? `${stopSpecimens.length} mẫu` : `mẫu ${stopSpecimens[0].barcode}`;
    addLog(`[ROUTE] Đã xác nhận gửi hàng ${batchLabel} tại ${stop.stationName}`, 'success');

    const groupsBySource = new Map();
    stopSpecimens.forEach((spec) => {
      const sourceStation = resolveSourceStation(spec);
      const key = sourceStation?.id || route.originStationId;
      if (!groupsBySource.has(key)) {
        groupsBySource.set(key, {
          sourceStation,
          specimens: [],
        });
      }
      groupsBySource.get(key).specimens.push(spec);
    });

    groupsBySource.forEach(({ sourceStation, specimens }) => {
      if (specimens.length > 1) {
        apiRequest('/transports/batch-complete', {
          method: 'POST',
          body: JSON.stringify({
            cabinId: robotStateRef.current.id,
            status: 'arrived',
            barcodes: specimens.map((spec) => spec.barcode),
            dispatchTime: route.dispatchTime,
            arrivalTime: confirmedAt,
            fromStationId: sourceStation?.id || route.originStationId,
            toStationId: stop.stationId,
          }),
        }).catch((error) => {
          addLog(`Lưu xác nhận lộ trình thất bại: ${error.message}`, 'error');
        });
        return;
      }

      const specimen = specimens[0];
      apiRequest('/transports/complete', {
        method: 'POST',
        body: JSON.stringify({
          cabinId: robotStateRef.current.id,
          status: 'arrived',
          barcode: specimen.barcode,
          patientName: specimen.patientName,
          testType: specimen.testType,
          priority: specimen.priority || PRIORITY.ROUTINE,
          scanTime: specimen.scanTime,
          dispatchTime: route.dispatchTime,
          arrivalTime: confirmedAt,
          fromStationId: sourceStation?.id || route.originStationId,
          toStationId: stop.stationId,
        }),
      }).catch((error) => {
        addLog(`Lưu xác nhận ${specimen.barcode} thất bại: ${error.message}`, 'error');
      });
    });
  }, [addLog, apiRequest]);

  const markRouteStopArrived = useCallback((metadata, target, arrivedTime) => {
    const route = activeDispatchRouteRef.current;
    if (!route || route.id !== metadata?.routeId) return false;

    // FIX [BUG-02]: Guard chống race condition — nếu stop này đã được mark
    // WAITING_CONFIRM (từ PLC sync effect hoặc route monitor effect), bỏ qua.
    const currentStop = route.stops[metadata?.stopIndex];
    if (currentStop?.status === ROUTE_STOP_STATUS.WAITING_CONFIRM) {
      return false; // đã xử lý rồi, không mark lại
    }

    const cleanedQueue = queueRef.current.filter((item) => !(
      item.metadata?.routeDelivery &&
      item.metadata.routeId === route.id &&
      item.metadata.stopIndex === metadata.stopIndex
    ));
    if (cleanedQueue.length !== queueRef.current.length) {
      replaceQueue(cleanedQueue, directionRef.current);
    }

    const nextRoute = {
      ...route,
      status: ROUTE_STATUS.WAITING_CONFIRM,
      currentStopIndex: metadata.stopIndex,
      updatedAt: arrivedTime,
      stops: route.stops.map((stop, index) => {
        if (index !== metadata.stopIndex) return stop;
        return {
          ...stop,
          status: ROUTE_STOP_STATUS.WAITING_CONFIRM,
          fromStationId: metadata.fromStationId,
          arrivalTime: arrivedTime,
        };
      }),
    };

    setActiveDispatchRoute(nextRoute);
    addLog(`[ROUTE] Cabin đã đến ${target.name}. Chờ xác nhận đã gửi hàng.`, 'success');
    publishSyncSnapshot(buildSyncSnapshot({
      activeDispatchRoute: nextRoute,
      queue: cleanedQueue,
      cabinDirection: directionRef.current,
    }));
    return true;
  }, [addLog, buildSyncSnapshot, directionRef, publishSyncSnapshot, queueRef, replaceQueue, setActiveDispatchRoute]);

  const startDispatchRoute = useCallback((originStationId, priorityStationId = null) => {
    const originStation = getStationById(originStationId);
    const specimens = [...scanListRef.current];

    if (!originStation || specimens.length === 0) {
      addLog('Không thể tạo lộ trình: thiếu trạm nguồn, trạm đích hoặc mẫu bệnh phẩm', 'error');
      return null;
    }

    const missingDestination = specimens.filter((spec) => !getStationById(spec.destinationStationId));
    if (missingDestination.length > 0) {
      addLog(`Không thể tạo lộ trình: ${missingDestination.length} mẫu chưa có trạm đích`, 'error');
      return null;
    }

    const specimenDestinationIds = [...new Set(specimens.map((spec) => spec.destinationStationId))];
    const routeStations = orderDispatchDestinations(originStationId, specimenDestinationIds, priorityStationId);

    if (routeStations.length === 0) {
      addLog('Không thể tạo lộ trình: trạm đích không hợp lệ hoặc trùng trạm nguồn', 'error');
      return null;
    }

    if (maintenanceRef.current.enabled) {
      addLog('[MAINTENANCE] Không thể tạo lộ trình khi đang bảo trì', 'maintenance');
      return null;
    }

    if (activeDispatchRouteRef.current) {
      addLog('Đang có lộ trình vận chuyển chưa hoàn tất', 'error');
      return null;
    }

    if (queueRef.current.length > 0 || animatingRef.current || robotStateRef.current.status !== ROBOT_STATUS.READY) {
      addLog('Cabin chưa sẵn sàng hoặc hàng chờ chưa trống', 'error');
      return null;
    }

    if (robotStateRef.current.index !== originStation.idx) {
      addLog(`Cabin chưa ở ${originStation.name}. Hãy gọi cabin về trạm trước khi tạo lộ trình.`, 'error');
      return null;
    }

    const now = Date.now();
    const route = {
      id: `R-${now}`,
      originStationId: originStation.id,
      originStationName: originStation.name,
      priorityStationId: priorityStationId && routeStations.some((station) => station.id === priorityStationId)
        ? priorityStationId
        : null,
      status: ROUTE_STATUS.MOVING,
      currentStopIndex: 0,
      dispatchTime: new Date(now).toISOString(),
      specimenRecords: specimens,
      stops: routeStations.map((station, index) => ({
        stationId: station.id,
        stationName: station.name,
        specimenCount: specimens.filter((spec) => spec.destinationStationId === station.id).length,
        specimenBarcodes: specimens
          .filter((spec) => spec.destinationStationId === station.id)
          .map((spec) => spec.barcode),
        status: index === 0 ? ROUTE_STOP_STATUS.MOVING : ROUTE_STOP_STATUS.PENDING,
        fromStationId: index === 0 ? originStation.id : routeStations[index - 1]?.id,
      })),
      createdAt: now,
      updatedAt: now,
    };

    setActiveDispatchRoute(route);
    currentSpecimenRef.current = null;
    scanListRef.current = [];
    setCurrentSpecimen(null);
    setScanList([]);

    const routeText = [originStation.name, ...route.stops.map((stop) => stop.stationName)].join(' -> ');
    addLog(`[ROUTE] Tạo lộ trình ${specimens.length} mẫu: ${routeText}`, 'info');

    // Ghi Target_Station trước, sau đó gửi Confirm_CMD1 = TRUE ngay lập tức
    const firstStationNumber = parseInt(routeStations[0].id.split('-')[1], 10);
    const isStat = Boolean(priorityStationId === routeStations[0].id);
    console.log(`[SCADA] startDispatchRoute → callCabin(${firstStationNumber}) + confirmStation()`);

    // Bước 1: Ghi Target_Station
    opc.callCabin(firstStationNumber, isStat, routeStations[0].id, 'DISPATCH', false)
      .then((callRes) => {
        if (!callRes?.ok) {
          addLog(`[PLC] Lỗi ghi Target_Station: ${callRes?.error || 'Unknown'}`, 'error');
          // FIX [BUG-07]: Không gửi Confirm_CMD1 nếu Target_Station chưa được ghi thành công.
          // PLC sẽ nhận Confirm_CMD1=TRUE mà không biết đích đến — hành vi không xác định.
          return Promise.resolve({ ok: false, skipped: true });
        }
        addLog(`[PLC] Đã ghi Target_Station = ${firstStationNumber}`, 'info');
        // Bước 2: Ghi Target_Station thành công mới gửi Confirm_CMD1 = TRUE
        return opc.confirmStation();
      })
      .then((confirmRes) => {
        if (confirmRes?.skipped) return; // target thất bại, đã log rồi
        if (!confirmRes?.ok) {
          addLog(`[PLC] Lỗi gửi Confirm_CMD1: ${confirmRes?.error || 'Unknown'}`, 'error');
        } else {
          addLog('[PLC] Đã gửi Confirm_CMD1 = TRUE (Tạo lộ trình)', 'info');
        }
      })
      .catch((err) => {
        addLog(`[PLC] Lỗi kết nối: ${err?.message || 'Unknown'}`, 'error');
      });

    if (!enqueueRouteStop(route, 0)) return null;
    publishSyncSnapshot(buildSyncSnapshot({ activeDispatchRoute: route }));

    setTimeout(() => {
      processQueueRef.current?.(robotStateRef.current.index);
    }, 0);

    return route;
  }, [addLog, buildSyncSnapshot, enqueueRouteStop, publishSyncSnapshot, queueRef, setActiveDispatchRoute, opc]);

  const confirmRouteStop = useCallback((stationId, overridePriorityStationId = null) => {
    const route = activeDispatchRouteRef.current;
    if (!route || route.status !== ROUTE_STATUS.WAITING_CONFIRM) return false;

    const stopIndex = route.currentStopIndex;
    const stop = route.stops[stopIndex];
    if (!stop || stop.stationId !== stationId) return false;

    const currentRole = String(currentUser?.role || '').toLowerCase();
    const hasConfirmPermission = currentRole === USER_ROLES.TECH || currentUser?.stationId === stationId;
    if (!hasConfirmPermission) {
      const stationName = getStationById(stationId)?.name || stationId;
      addLog(`Tài khoản hiện tại không có quyền xác nhận tại ${stationName}`, 'error');
      return false;
    }

    const handoffCandidates = [...scanListRef.current];
    if (handoffCandidates.length > 0) {
      const routeBarcodes = new Set(
        (route.specimenRecords || []).map((spec) => String(spec.barcode || '').trim().toUpperCase())
      );
      const duplicateInRoute = handoffCandidates.find((spec) =>
        routeBarcodes.has(String(spec.barcode || '').trim().toUpperCase())
      );
      if (duplicateInRoute) {
        addLog(`Mẫu ${duplicateInRoute.barcode} đang nằm trong lộ trình hiện tại, không thể ghép lại cùng tuyến`, 'error');
        return false;
      }

      const missingDestination = handoffCandidates.filter((spec) => !getStationById(spec.destinationStationId));
      if (missingDestination.length > 0) {
        addLog(`Không thể xác nhận: ${missingDestination.length} mẫu mới chưa có trạm đích`, 'error');
        return false;
      }

      const sameStationDestination = handoffCandidates.filter((spec) => spec.destinationStationId === stationId);
      if (sameStationDestination.length > 0) {
        addLog(`Không thể gửi ${sameStationDestination.length} mẫu mới về chính trạm hiện tại`, 'error');
        return false;
      }
    }

    const handoffSpecimens = handoffCandidates.map((specimen) => ({
      ...specimen,
      fromStationId: stationId,
      fromStationName: stop.stationName || getStationById(stationId)?.name || stationId,
      handoffAt: new Date().toISOString(),
    }));

    const confirmedAt = new Date().toISOString();
    const confirmedStop = {
      ...stop,
      status: ROUTE_STOP_STATUS.CONFIRMED,
      confirmedAt,
    };

    const confirmedRoute = {
      ...route,
      specimenRecords: [
        ...(Array.isArray(route.specimenRecords) ? route.specimenRecords : []),
        ...handoffSpecimens,
      ],
      updatedAt: Date.now(),
      stops: route.stops.map((item, index) => (index === stopIndex ? confirmedStop : item)),
    };

    persistRouteStopDelivery(confirmedRoute, confirmedStop, confirmedAt);

    // Confirm_CMD1 will be sent below depending on whether the route continues or ends

    if (handoffSpecimens.length > 0) {
      scanListRef.current = [];
      setScanList([]);
      setCurrentSpecimen(null);
      addLog(`[ROUTE] Đã ghép ${handoffSpecimens.length} mẫu mới tại ${confirmedStop.stationName} vào tuyến hiện tại`, 'success');
    }

    const nextStopIndex = stopIndex + 1;
    const remainingStationIds = confirmedRoute.stops
      .slice(nextStopIndex)
      .filter((item) => item.status !== ROUTE_STOP_STATUS.CONFIRMED)
      .map((item) => item.stationId);
    const handoffDestinationIds = handoffSpecimens.map((specimen) => specimen.destinationStationId);
    const futureStationIds = [...new Set([...remainingStationIds, ...handoffDestinationIds])]
      .filter((futureStationId) => futureStationId && futureStationId !== stationId);
    const effectivePriorityStationId = overridePriorityStationId ?? confirmedRoute.priorityStationId;
    const orderedFutureStations = orderDispatchDestinations(
      stationId,
      futureStationIds,
      effectivePriorityStationId
    );

    if (orderedFutureStations.length === 0) {
      addLog(`[ROUTE] Hoàn tất lộ trình từ ${confirmedRoute.originStationName}`, 'success');
      setActiveDispatchRoute(null);
      syncDirectionRef(DIRECTION.IDLE);

      // Chỉ gửi Confirm_CMD khi đang ở trạm 1 hoặc 4 (ST-01, ST-04)
      const isConfirmStation = stationId === 'ST-01' || stationId === 'ST-04';
      if (isConfirmStation) {
        opc.confirmStop().then((res) => {
          if (!res?.ok) addLog(`[PLC] Lỗi gửi Confirm_CMD khi hoàn tất: ${res?.error || 'Unknown'}`, 'error');
          else addLog('[PLC] Đã gửi Confirm_CMD = TRUE (Hoàn tất lộ trình)', 'info');
        }).catch((err) => {
          addLog(`[PLC] Confirm_CMD lỗi kết nối: ${err?.message || 'Unknown'}`, 'error');
        });
      }

      publishSyncSnapshot(buildSyncSnapshot({
        activeDispatchRoute: null,
        cabinDirection: DIRECTION.IDLE,
      }));
      setTimeout(() => {
        processQueueRef.current?.(robotStateRef.current.index);
      }, 0);
      return true;
    }

    // Ghi Target_Station cho trạm tiếp theo, sau đó gửi Confirm_CMD (chỉ khi ở ST-01 hoặc ST-04)
    const nextStationNumber = parseInt(orderedFutureStations[0].id.split('-')[1], 10);
    const isStat = Boolean(effectivePriorityStationId === orderedFutureStations[0].id);
    const shouldSendConfirmCmd = stationId === 'ST-01' || stationId === 'ST-04';
    console.log(`[SCADA] confirmRouteStop → callCabin(${nextStationNumber})${ shouldSendConfirmCmd ? ' + confirmStop()' : ''}${ handoffSpecimens.length > 0 ? ' + confirmStation()' : ''}`);

    opc.callCabin(nextStationNumber, isStat, orderedFutureStations[0].id, 'DISPATCH', false)
      .then((callRes) => {
        if (!callRes?.ok) {
          addLog(`[PLC] Lỗi ghi Target_Station: ${callRes?.error || 'Unknown'}`, 'error');
        }
        // Confirm_CMD chỉ bắt đầu từ trạm 1 và 4
        if (shouldSendConfirmCmd) return opc.confirmStop();
        return Promise.resolve({ ok: true });
      })
      .then((confirmRes) => {
        if (confirmRes && !confirmRes.ok) {
          addLog(`[PLC] Lỗi gửi Confirm_CMD: ${confirmRes?.error || 'Unknown'}`, 'error');
        } else if (shouldSendConfirmCmd) {
          addLog('[PLC] Đã gửi Target_Station và Confirm_CMD = TRUE (Đi tiếp)', 'info');
        } else {
          addLog(`[PLC] Đã ghi Target_Station = ${nextStationNumber} (không gửi Confirm_CMD vì không phải trạm 1/4)`, 'info');
        }
        // Nếu ghép mẫu, kích thêm Confirm_CMD1 để báo PLC có tải mới
        if (handoffSpecimens.length > 0) {
          return opc.confirmStation();
        }
        return Promise.resolve({ ok: true });
      })
      .then((cmd1Res) => {
        if (handoffSpecimens.length > 0) {
          if (!cmd1Res?.ok) addLog(`[PLC] Lỗi gửi Confirm_CMD1 khi ghép mẫu: ${cmd1Res?.error || 'Unknown'}`, 'error');
          else addLog('[PLC] Đã gửi Confirm_CMD1 = TRUE (Ghép mẫu vào tuyến)', 'info');
        }
      })
      .catch((err) => {
        addLog(`[PLC] Lỗi kết nối: ${err?.message || 'Unknown'}`, 'error');
      });

    const confirmedStops = confirmedRoute.stops.slice(0, nextStopIndex);
    const nextStops = orderedFutureStations.map((station, index) => {
      const stopSpecimens = confirmedRoute.specimenRecords.filter((spec) => spec.destinationStationId === station.id);
      return {
        stationId: station.id,
        stationName: station.name,
        specimenCount: stopSpecimens.length,
        specimenBarcodes: stopSpecimens.map((spec) => spec.barcode),
        status: index === 0 ? ROUTE_STOP_STATUS.MOVING : ROUTE_STOP_STATUS.PENDING,
        fromStationId: index === 0 ? stationId : orderedFutureStations[index - 1]?.id,
      };
    });

    const movingRoute = {
      ...confirmedRoute,
      status: ROUTE_STATUS.MOVING,
      currentStopIndex: confirmedStops.length,
      stops: [...confirmedStops, ...nextStops],
      priorityStationId: effectivePriorityStationId && orderedFutureStations.some((s) => s.id === effectivePriorityStationId)
        ? effectivePriorityStationId
        : null,
    };

    setActiveDispatchRoute(movingRoute);
    enqueueRouteStop(movingRoute, nextStopIndex);
    publishSyncSnapshot(buildSyncSnapshot({ activeDispatchRoute: movingRoute }));
    setTimeout(() => {
      processQueueRef.current?.(robotStateRef.current.index);
    }, 0);
    return true;
  }, [addLog, buildSyncSnapshot, currentUser, enqueueRouteStop, persistRouteStopDelivery, publishSyncSnapshot, setActiveDispatchRoute, syncDirectionRef, opc]);

  useEffect(() => {
    if (!activeDispatchRoute || activeDispatchRoute.status !== ROUTE_STATUS.MOVING) return;
    if (animating || robotState.status === ROBOT_STATUS.MOVING) return;

    const stopIndex = activeDispatchRoute.currentStopIndex;
    const stop = activeDispatchRoute.stops?.[stopIndex];
    const targetStation = getStationById(stop?.stationId);
    if (!stop || !targetStation) return;
    if (stop.status === ROUTE_STOP_STATUS.WAITING_CONFIRM || stop.status === ROUTE_STOP_STATUS.CONFIRMED) return;
    if (robotState.index !== targetStation.idx) return;

    markRouteStopArrived(
      {
        routeId: activeDispatchRoute.id,
        stopIndex,
        fromStationId: stop.fromStationId || (
          stopIndex === 0
            ? activeDispatchRoute.originStationId
            : activeDispatchRoute.stops?.[stopIndex - 1]?.stationId
        ),
      },
      targetStation,
      new Date().toISOString()
    );
  }, [activeDispatchRoute, animating, markRouteStopArrived, robotState.index, robotState.status]);

  // === Specimen arrival processor ===
  const processSpecimenArrival = useCallback((target, metadata, arrivedTime) => {
    if (!metadata || !metadata.specimenRecord) return;
    
    const fromStation = STATIONS.find(station => station.id === metadata.fromStationId);

    // Batch dispatch: handle multiple specimens
    const allSpecimens = metadata.isBatch && Array.isArray(metadata.specimenRecords)
      ? metadata.specimenRecords
      : [metadata.specimenRecord];

    const deliveredRecords = allSpecimens.map((spec) => ({
      specimenId: spec.id,
      barcode: spec.barcode,
      patientName: spec.patientName,
      testType: spec.testType,
      priority: spec.priority || PRIORITY.ROUTINE,
      scanTime: spec.scanTime,
      dispatchTime: metadata.dispatchTime,
      arrivalTime: arrivedTime,
      fromStationId: fromStation?.id || 'N/A',
      fromStationName: fromStation?.name || 'N/A',
      toStationId: target.id,
      toStationName: target.name,
      cabinId: robotStateRef.current.id,
    }));

    setTransportedSpecimens(prev => {
      const next = [...deliveredRecords, ...prev];
      if (next.length > MAX_SPECIMEN_HISTORY) next.length = MAX_SPECIMEN_HISTORY;
      return next;
    });

    const specimenIds = allSpecimens.map((s) => s.id);
    setScannedSpecimens(prev =>
      prev.map(item =>
        specimenIds.includes(item.id)
          ? {
            ...item,
            status: 'transported',
            dispatchTime: metadata.dispatchTime,
            arrivalTime: arrivedTime,
            toStationId: target.id,
            toStationName: target.name,
          }
          : item
      )
    );

    const batchLabel = allSpecimens.length > 1 ? ` (${allSpecimens.length} mẫu)` : '';
    addLog(`Mẫu ${metadata.specimenRecord.barcode}${batchLabel} đã bàn giao tại ${target.name}`, 'success');

    if (metadata.isBatch && allSpecimens.length > 1) {
      apiRequest('/transports/batch-complete', {
        method: 'POST',
        body: JSON.stringify({
          cabinId: robotStateRef.current.id,
          status: 'arrived',
          barcodes: allSpecimens.map((s) => s.barcode),
          dispatchTime: metadata.dispatchTime,
          arrivalTime: arrivedTime,
          fromStationId: fromStation?.id,
          toStationId: target.id,
        }),
      }).catch((error) => {
        addLog(`Lưu batch vận chuyển thất bại: ${error.message}`, 'error');
      });
    } else {
      apiRequest('/transports/complete', {
        method: 'POST',
        body: JSON.stringify({
          cabinId: robotStateRef.current.id,
          status: 'arrived',
          barcode: metadata.specimenRecord.barcode,
          patientName: metadata.specimenRecord.patientName,
          testType: metadata.specimenRecord.testType,
          priority: metadata.specimenRecord.priority || PRIORITY.ROUTINE,
          scanTime: metadata.specimenRecord.scanTime,
          dispatchTime: metadata.dispatchTime,
          arrivalTime: arrivedTime,
          fromStationId: fromStation?.id,
          toStationId: target.id,
        }),
      }).catch((error) => {
        addLog(`Lưu vận chuyển ${metadata.specimenRecord.barcode} thất bại: ${error.message}`, 'error');
      });
    }
  }, [addLog, apiRequest]);

  // === Robot movement executor (internal — called by queue processor) ===
  const executeRobotMove = useCallback((action, stationId, metadata = null) => {
    if (maintenanceRef.current.enabled) {
      addLog('[MAINTENANCE] Command blocked while maintenance mode is enabled', 'maintenance');
      return false;
    }

    const target = STATIONS.find(station => station.id === stationId);
    if (!target) return false;

    const fromIndex = robotStateRef.current.index;
    const toIndex = target.idx;

    // Lưu task đang thực thi để PLC sync xử lý khi đến nơi
    executingTaskRef.current = { action, target, metadata };

    if (fromIndex === toIndex) {
      addLog(`${target.name} - Robot đã tại vị trí`, 'info');
      const arrivedTime = new Date().toISOString();
      if (metadata?.routeDelivery) {
        markRouteStopArrived(metadata, target, arrivedTime);
      } else if (metadata?.specimenRecord) {
        processSpecimenArrival(target, metadata, arrivedTime);
      }
      
      executingTaskRef.current = null;

      if (processQueueRef.current) {
        setTimeout(() => {
          processQueueRef.current?.(fromIndex);
        }, 0);
      }
      return true;
    }

    const priorityLabel = metadata?.isPriorityStop ? ' [ƯU TIÊN TRẠM]' : '';
    const plcStationNumber = parseInt(target.id.split('-')[1], 10);
    const isStat = Boolean(metadata?.isPriorityStop);

    const sendPlcMoveCommand = () => {
      const isDispatch = action === 'DISPATCH';
      if (isDispatch) {
        return Promise.resolve({ ok: true });
      }
      return opc.callCabin(plcStationNumber, isStat, target.id, action, false);
    };

    const runMovement = () => {
      setRobotState(prev => ({ ...prev, status: ROBOT_STATUS.MOVING, targetId: stationId }));
      addLog(`Lệnh [${action}]${priorityLabel} -> ${target.name}`);

      publishSyncSnapshot(buildSyncSnapshot({
        status: ROBOT_STATUS.MOVING,
        index: fromIndex,
        targetId: stationId,
      }));
    };

    sendPlcMoveCommand().then((res) => {
      if (!res?.ok) {
        addLog(`Lỗi gửi lệnh di chuyển tới ${target.name}: ${res?.error || 'Unknown'}`, 'error');
        syncDirectionRef(DIRECTION.IDLE);
        return;
      }
      runMovement();
    }).catch((err) => {
      addLog(`[PLC] callCabin lỗi kết nối: ${err?.message || 'Unknown'}`, 'error');
      syncDirectionRef(DIRECTION.IDLE);
    });
    return true;
  }, [addLog, buildSyncSnapshot, markRouteStopArrived, processSpecimenArrival, publishSyncSnapshot, syncDirectionRef, opc]);

  // === Queue processor: dequeue and execute next task ===
  const processNextQueueTask = useCallback((currentStationIndex) => {
    if (maintenanceRef.current.enabled) return;
    // OPC UA spec: only pop queue when Cabin_Ready = TRUE (PLC not busy lifting)
    if (!opc.plcState.cabinReady) {
      addLog('[QUEUE] Cabin đang bận (nâng/hạ), chờ Cabin_Ready...', 'info');
      return;
    }
    if (queueRef.current.length === 0) {
      syncDirectionRef(DIRECTION.IDLE);
      return;
    }

    const nextTask = dequeueNextTask(currentStationIndex);
    if (!nextTask) {
      syncDirectionRef(DIRECTION.IDLE);
      return;
    }

    const stationName = STATIONS.find(s => s.id === nextTask.stationId)?.name || nextTask.stationId;
    const priorityTag = nextTask.metadata?.isPriorityStop
      || nextTask.priority === QUEUE_PRIORITY.STATION
      ? '[ƯU TIÊN TRẠM] '
      : nextTask.priority === QUEUE_PRIORITY.SPECIMEN
        ? '[ƯU TIÊN] '
        : '';
    addLog(
      `[QUEUE] ${priorityTag}Đang xử lý task: [${nextTask.type}] -> ${stationName} (còn ${queueRef.current.length} task trong hàng chờ)`,
      'info'
    );

    executeRobotMove(nextTask.type, nextTask.stationId, nextTask.metadata);
  }, [addLog, dequeueNextTask, executeRobotMove, syncDirectionRef, queueRef, opc.plcState.cabinReady]);

  // Keep ref in sync so executeRobotMove always calls the latest processNextQueueTask
  useEffect(() => {
    processQueueRef.current = processNextQueueTask;
  }, [processNextQueueTask]);

  // === Trigger queue processing when a new task is enqueued while IDLE ===
  const triggerQueueIfIdle = useCallback(() => {
    if (robotStateRef.current.status === ROBOT_STATUS.READY && processQueueRef.current) {
      processQueueRef.current(robotStateRef.current.index);
    }
  }, []);

  // === Helper: publish queue-only sync to other tabs ===
  const publishQueueSync = useCallback(() => {
    publishSyncSnapshot(buildSyncSnapshot());
  }, [buildSyncSnapshot, publishSyncSnapshot]);

  // === Wrap cancelQueueItem to publish sync afterwards ===
  const cancelQueueItem = useCallback((taskId) => {
    _cancelQueueItem(taskId);
    // Publish after microtask so queueRef is updated
    queueMicrotask(() => publishSyncSnapshot(buildSyncSnapshot()));
  }, [_cancelQueueItem, buildSyncSnapshot, publishSyncSnapshot]);

  // === Sync PLC currentStation → robotState.index ===
  const plcCurrentStationArrivalRef = useRef(null);
  useEffect(() => {
    const plcStation = opc.plcState.currentStation;
    if (plcStation == null) return;

    // Map PLC station number (1-4) to station ID (ST-01..ST-04)
    const plcStationId = `ST-${String(plcStation).padStart(2, '0')}`;
    const matchedStation = STATIONS.find((s) => s.id === plcStationId);
    if (!matchedStation) return;

    const plcIndex = matchedStation.idx;
    const prevPlcStation = plcCurrentStationArrivalRef.current;
    plcCurrentStationArrivalRef.current = plcStation;

    // 1. Nếu UI đang ở trạng thái MOVING và cập bến trạm đích
    const currentStatus = robotStateRef.current.status;
    const currentTarget = robotStateRef.current.targetId;

    if (currentStatus === ROBOT_STATUS.MOVING && currentTarget === matchedStation.id && prevPlcStation !== plcStation) {
      console.log(`[PLC SYNC] PLC xác nhận cabin đến ${matchedStation.name} → hoàn thành di chuyển`);

      const point = RAIL_POINTS[plcIndex];
      const arrivedTime = new Date().toISOString();

      const newState = {
        index: plcIndex,
        x: point?.x ?? robotStateRef.current.x,
        y: point?.y ?? robotStateRef.current.y,
        status: ROBOT_STATUS.READY,
        targetId: matchedStation.id,
      };
      setRobotState((prev) => ({ ...prev, ...newState }));
      robotStateRef.current = { ...robotStateRef.current, ...newState };
      addLog(`[PLC] Cabin đã đến ${matchedStation.name} (PLC xác nhận)`, 'success');

      publishSyncSnapshot(buildSyncSnapshot({
        status: ROBOT_STATUS.READY,
        index: plcIndex,
        targetId: matchedStation.id,
        x: newState.x,
        y: newState.y,
      }));

      // Xử lý task vừa hoàn thành
      const task = executingTaskRef.current;
      if (task && task.target.id === matchedStation.id) {
        if (task.metadata?.routeDelivery) {
          markRouteStopArrived(task.metadata, matchedStation, arrivedTime);
        } else if (task.metadata?.specimenRecord) {
          processSpecimenArrival(matchedStation, task.metadata, arrivedTime);
        }
        executingTaskRef.current = null;
      }

      // Xử lý queue thông thường (nếu không phải route delivery vì route delivery tự gọi processQueue)
      if (!task?.metadata?.routeDelivery && processQueueRef.current) {
        processQueueRef.current(plcIndex);
      }
      return;
    }

    // 2. Không di chuyển theo lệnh (bị kéo tay hoặc cập nhật lần đầu): chỉ cập nhật vị trí UI
    if (robotStateRef.current.index === plcIndex) return;

    const point = RAIL_POINTS[plcIndex];
    if (!point) return;

    setRobotState((prev) => ({
      ...prev,
      index: plcIndex,
      x: point.x,
      y: point.y,
      targetId: matchedStation.id,
    }));

    addLog(`[PLC SYNC] Cabin tại trạm ${matchedStation.name} (PLC station=${plcStation})`, 'info');

    // Nếu không animating mà queue vẫn còn task, xử lý ngay
    if (queueRef.current.length > 0) {
      setTimeout(() => {
        if (!animatingRef.current && processQueueRef.current) {
          processQueueRef.current(plcIndex);
        }
      }, 0);
    }
  }, [opc.plcState.currentStation, addLog, stopAnimation, markRouteStopArrived, queueRef]);

  // === Public robot commands (enqueue into queue) ===
  const callRobot = useCallback((stationId, priority = PRIORITY.ROUTINE) => {
    if (maintenanceRef.current.enabled) {
      addLog('[MAINTENANCE] Command blocked while maintenance mode is enabled', 'maintenance');
      return false;
    }

    const station = STATIONS.find(s => s.id === stationId);
    const stationName = station?.name || stationId;
    const priorityTag = priority === PRIORITY.STAT ? '[ƯU TIÊN] ' : '';

    enqueue(stationId, 'CALL', priority, null);
    addLog(
      `[QUEUE] ${priorityTag}Đã thêm lệnh CALL -> ${stationName} vào hàng chờ (vị trí #${queueRef.current.length})`,
      'info'
    );

    // Sync queue to other tabs
    publishQueueSync();

    // If cabin is idle, start processing immediately
    triggerQueueIfIdle();
    return true;
  }, [addLog, enqueue, publishQueueSync, triggerQueueIfIdle, queueRef]);

  const dispatchRobot = useCallback((stationId, priority = PRIORITY.ROUTINE) => {
    if (maintenanceRef.current.enabled) {
      addLog('[MAINTENANCE] Command blocked while maintenance mode is enabled', 'maintenance');
      return false;
    }

    const station = STATIONS.find(s => s.id === stationId);
    const stationName = station?.name || stationId;
    const priorityTag = priority === PRIORITY.STAT ? '[ƯU TIÊN] ' : '';

    enqueue(stationId, 'DISPATCH', priority, null);
    addLog(
      `[QUEUE] ${priorityTag}Đã thêm lệnh DISPATCH -> ${stationName} vào hàng chờ (vị trí #${queueRef.current.length})`,
      'info'
    );

    publishQueueSync();
    triggerQueueIfIdle();
    return true;
  }, [addLog, enqueue, publishQueueSync, triggerQueueIfIdle, queueRef]);

  const dispatchScannedSpecimen = useCallback((stationId) => {
    const specimenRecord = currentSpecimenRef.current;
    if (!specimenRecord) {
      addLog('Không thể dispatch: chưa có mẫu bệnh phẩm được quét', 'error');
      return false;
    }
    // Immediately clear ref to prevent double-dispatch on rapid clicks
    currentSpecimenRef.current = null;

    if (maintenanceRef.current.enabled) {
      addLog('[MAINTENANCE] Command blocked while maintenance mode is enabled', 'maintenance');
      currentSpecimenRef.current = specimenRecord; // restore on block
      return false;
    }

    const dispatchTime = new Date().toISOString();
    const station = STATIONS.find(s => s.id === stationId);
    const stationName = station?.name || stationId;

    enqueue(stationId, 'DISPATCH', PRIORITY.ROUTINE, { specimenRecord, dispatchTime });
    addLog(
      `[QUEUE] Đã thêm lệnh DISPATCH mẫu ${specimenRecord.barcode} -> ${stationName} vào hàng chờ`,
      'info'
    );

    setCurrentSpecimen(null);
    scanListRef.current = [];
    setScanList([]);
    publishQueueSync();
    triggerQueueIfIdle();
    return true;
  }, [addLog, enqueue, publishQueueSync, triggerQueueIfIdle]);

  // === Batch dispatch — dispatch all specimens in scanList ===
  const dispatchBatchSpecimens = useCallback((stationId) => {
    const specimens = scanListRef.current;
    if (!specimens || specimens.length === 0) {
      addLog('Không thể dispatch: danh sách quét trống', 'error');
      return false;
    }

    if (maintenanceRef.current.enabled) {
      addLog('[MAINTENANCE] Command blocked while maintenance mode is enabled', 'maintenance');
      return false;
    }

    const dispatchTime = new Date().toISOString();
    const station = STATIONS.find((s) => s.id === stationId);
    const stationName = station?.name || stationId;

    // Create a combined metadata for the batch
    const batchMetadata = {
      specimenRecord: specimens[0], // Primary specimen for display
      specimenRecords: specimens, // Full batch
      dispatchTime,
      isBatch: true,
      batchCount: specimens.length,
    };

    enqueue(stationId, 'DISPATCH', PRIORITY.ROUTINE, batchMetadata);
    addLog(
      `[QUEUE] Đã thêm lệnh DISPATCH ${specimens.length} mẫu -> ${stationName}`,
      'info'
    );

    // Clear scan list and current specimen
    scanListRef.current = [];
    setScanList([]);
    setCurrentSpecimen(null);

    publishQueueSync();
    triggerQueueIfIdle();
    return true;
  }, [addLog, enqueue, publishQueueSync, triggerQueueIfIdle]);

  const emergencyStop = useCallback(() => {
    stopAnimation();
    setAnimating(false);
    setMoveId(id => id + 1);
    setRobotState(prev => ({ ...prev, status: ROBOT_STATUS.ESTOP }));

    // --- KÍCH HOẠT LỆNH E-STOP XUỐNG PLC ---
    opc.triggerEStop().then((res) => {
      if (!res?.ok) addLog(`Lỗi gửi lệnh E-Stop xuống PLC: ${res?.error || 'Unknown'}`, 'error');
    }).catch((err) => {
      addLog(`[PLC] E-Stop lỗi kết nối: ${err?.message || 'Unknown'}`, 'error');
    });

    // Đóng băng UI: GIỮ NGUYÊN route và queue, chỉ thay đổi status
    // Khi giải phóng E-Stop, mọi hoạt động sẽ tiếp tục như cũ
    addLog('E-STOP được kích hoạt! Hệ thống đang đóng băng — lộ trình được giữ lại.', 'error');
    addLog(
      `[ROBOT_STATE] status=ESTOP index=${robotStateRef.current.index} target=${robotStateRef.current.targetId} x=${Math.round(robotStateRef.current.x)} y=${Math.round(robotStateRef.current.y)}`,
      'state'
    );
    // Sync snapshot giữ lại activeDispatchRoute và queue hiện tại
    publishSyncSnapshot(buildSyncSnapshot({
      status: ROBOT_STATUS.ESTOP,
      index: robotStateRef.current.index,
      targetId: robotStateRef.current.targetId,
      x: robotStateRef.current.x,
      y: robotStateRef.current.y,
    }));
  }, [addLog, buildSyncSnapshot, publishSyncSnapshot, stopAnimation, opc]);

  // FIX [BUG-03/06]: Destructure các callback PLC ổn định từ opc trước khi dùng
  // trong useCallback. Điều này ngăn opc (thay đổi mỗi khi plcState thay đổi)
  // làm cho acknowledgeTask bị recreate không cần thiết.
  const { releaseEStop: opcReleaseEStop, resetError: opcResetError } = opc;

  const acknowledgeTask = useCallback(() => {
    if (currentUser?.role !== USER_ROLES.TECH) {
      addLog('Chỉ kỹ thuật viên được nhả E-Stop và reset lỗi hệ thống', 'error');
      return;
    }

    // FIX: Restore UI state IMMEDIATELY — don't block behind PLC socket timeouts.
    // ── 1. Instant UI recovery ──────────────────────────────────────────────────────
    setRobotState(prev => ({ ...prev, status: ROBOT_STATUS.READY }));
    addLog('Hệ thống đã được khôi phục sau Dừng khẩn cấp', 'success');
    addLog(
      `[ROBOT_STATE] status=READY index=${robotStateRef.current.index} target=${robotStateRef.current.targetId} x=${Math.round(robotStateRef.current.x)} y=${Math.round(robotStateRef.current.y)}`,
      'state'
    );
    publishSyncSnapshot(buildSyncSnapshot({ status: ROBOT_STATUS.READY }));

    // ── 2. Tiếp tục lộ trình nếu còn tồn tại ────────────────────────────────
    // Trigger queue processing để tiếp tục các task đang bị đóng băng
    setTimeout(() => {
      if (processQueueRef.current && (queueRef.current.length > 0 || activeDispatchRouteRef.current)) {
        addLog('[QUEUE] Tiếp tục xử lý lộ trình sau khi giải phóng E-Stop...', 'info');
        processQueueRef.current(robotStateRef.current.index);
      }
    }, 300);

    // ── 3. Background PLC commands (fire-and-forget) ──────────────────────
    opcReleaseEStop().then((res) => {
      if (!res?.ok) {
        addLog(`Cảnh báo PLC: Nhả E-Stop không thành công (${res?.error || 'PLC offline'})`, 'error');
      }
    }).catch((err) => {
      addLog(`Cảnh báo PLC: ${err?.message || 'Không kết nối được'}`, 'error');
    });

    // Small delay between release and reset to let PLC process the state change
    // FIX [M5]: Track timer for cleanup on unmount
    ackResetTimerRef.current = setTimeout(() => {
      ackResetTimerRef.current = null;
      opcResetError().then((res) => {
        if (!res?.ok) {
          addLog(`Cảnh báo PLC: Reset lỗi không thành công (${res?.error || 'PLC offline'})`, 'error');
        }
      }).catch((err) => {
        addLog(`Cảnh báo PLC: ${err?.message || 'Không kết nối được'}`, 'error');
      });
    }, 300);
  }, [addLog, buildSyncSnapshot, currentUser, publishSyncSnapshot, opcReleaseEStop, opcResetError]);

  // === Cleanup ===
  useEffect(() => {
    return () => {
      stopAnimation();
      // FIX [M5]: Clear pending timers on unmount
      if (ackResetTimerRef.current) {
        clearTimeout(ackResetTimerRef.current);
        ackResetTimerRef.current = null;
      }
      // FIX [H1]: Clear hydration debounce
      if (hydrateDebounceRef.current) {
        clearTimeout(hydrateDebounceRef.current);
        hydrateDebounceRef.current = null;
      }
      // FIX [H3]: Flush pending logs and clear timer
      if (logFlushTimerRef.current) {
        clearTimeout(logFlushTimerRef.current);
        logFlushTimerRef.current = null;
      }
      // FIX [BUG-14]: Clear scanFeedback timer để tránh setState trên unmounted component
      if (scanFeedbackTimerRef.current) {
        clearTimeout(scanFeedbackTimerRef.current);
        scanFeedbackTimerRef.current = null;
      }
    };
  }, [stopAnimation]);

  // FIX [H1]: Debounced hydration wrapper to prevent double-hydration storm.
  // Both SSE and Socket.io dataSync fire for the same mutation;
  // this collapses them into a single /api/bootstrap call.
  const debouncedHydrate = useCallback((opts) => {
    if (hydrateDebounceRef.current) clearTimeout(hydrateDebounceRef.current);
    hydrateDebounceRef.current = setTimeout(() => {
      hydrateDebounceRef.current = null;
      hydratePersistedData(opts);
    }, 300);
  }, [hydratePersistedData]);

  // Keep clients synchronized via backend SSE; fallback to slow polling on errors.
  useEffect(() => {
    if (!isAuthenticated) return undefined;

    let eventSource = null;
    let fallbackIntervalId = null;
    const initialSyncTimer = setTimeout(() => {
      debouncedHydrate({ syncStations: false });
    }, 0);

    const startFallbackPolling = () => {
      if (fallbackIntervalId) return;
      fallbackIntervalId = setInterval(() => {
        hydratePersistedData({ syncStations: false });
      }, 10000);
    };

    const stopFallbackPolling = () => {
      if (!fallbackIntervalId) return;
      clearInterval(fallbackIntervalId);
      fallbackIntervalId = null;
    };

    const handleSyncEvent = (event) => {
      try {
        const payload = JSON.parse(String(event?.data || '{}'));
        if (payload?.type === 'sync-required') {
          // FIX [H1]: Use debounced hydration to avoid double-calls
          debouncedHydrate({ syncStations: false });
        }
      } catch {
        // Ignore malformed SSE payloads.
      }
    };

    if (typeof window !== 'undefined' && typeof EventSource !== 'undefined') {
      eventSource = new EventSource(SCADA_EVENTS_URL, { withCredentials: true });
      eventSource.onmessage = handleSyncEvent;
      eventSource.onopen = () => {
        stopFallbackPolling();
      };
      eventSource.onerror = () => {
        startFallbackPolling();
      };
    } else {
      startFallbackPolling();
    }

    return () => {
      clearTimeout(initialSyncTimer);
      stopFallbackPolling();
      if (eventSource) {
        eventSource.close();
      }
      // Reset so next login re-hydrates robot state from server logs
      initialHydrationDoneRef.current = false;
    };
  }, [debouncedHydrate, isAuthenticated, hydratePersistedData]);

  // ── Cross-device sync via Socket.io ────────────────────────────────
  // Attach callback refs so the socket hook can invoke our sync handlers
  // whenever another device broadcasts state or data changes.
  useEffect(() => {
    if (!isAuthenticated) {
      if (opc.setOnStateSync) opc.setOnStateSync(null);
      if (opc.setOnDataSync) opc.setOnDataSync(null);
      return;
    }

    // Handle incoming UI state snapshots from other devices
    if (opc.setOnStateSync) opc.setOnStateSync((data) => {
      if (!data || typeof data !== 'object') return;
      // Ignore our own echoed messages
      if (data.sourceTabId === SCADA_TAB_ID) return;
      if (data.type === 'snapshot' && shouldApplySyncPayload(data)) {
        applySyncSnapshot(data.snapshot);
      }
    });

    // Handle incoming data change notifications from other devices/server
    if (opc.setOnDataSync) opc.setOnDataSync((data) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'sync-required') {
        // FIX [H1]: Use debounced hydration to avoid double-calls
        debouncedHydrate({ syncStations: false });
      }
    });

    return () => {
      if (opc.setOnStateSync) opc.setOnStateSync(null);
      if (opc.setOnDataSync) opc.setOnDataSync(null);
    };
  }, [isAuthenticated, applySyncSnapshot, shouldApplySyncPayload, debouncedHydrate, opc]);

  useEffect(() => {
    if (!isAuthenticated || authReconnectDoneRef.current || typeof socketReconnect !== 'function') {
      return undefined;
    }

    const timer = setTimeout(() => {
      if (authReconnectDoneRef.current) return;
      authReconnectDoneRef.current = true;
      socketReconnect();
    }, 150);

    return () => clearTimeout(timer);
  }, [isAuthenticated, socketReconnect]);

  // Keep tabs synced instantly in the same browser session.
  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
      return undefined;
    }

    const channel = new BroadcastChannel(SCADA_SYNC_CHANNEL);
    syncChannelRef.current = channel;

    channel.onmessage = (event) => {
      const payload = event?.data;
      if (!payload || payload.sourceTabId === SCADA_TAB_ID) return;
      if (payload.type === 'snapshot' && shouldApplySyncPayload(payload)) {
        applySyncSnapshot(payload.snapshot);
      }
    };

    return () => {
      channel.close();
      if (syncChannelRef.current === channel) {
        syncChannelRef.current = null;
      }
    };
  }, [applySyncSnapshot, isAuthenticated, shouldApplySyncPayload]);

  // Fallback sync path via localStorage for environments without BroadcastChannel.
  useEffect(() => {
    if (!isAuthenticated || typeof window === 'undefined') return undefined;

    const onStorage = (event) => {
      if (event.key !== SCADA_SYNC_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue);
        if (!payload || payload.sourceTabId === SCADA_TAB_ID) return;
        if (payload.type === 'snapshot' && shouldApplySyncPayload(payload)) {
          applySyncSnapshot(payload.snapshot);
        }
      } catch {
        // Ignore parse failures.
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [applySyncSnapshot, isAuthenticated, shouldApplySyncPayload]);

  // === React to hardware E-Stop button (I1.2) from PLC ===
  // Khi nút E-Stop phần cứng được bấm, chỉ đóng băng UI — KHÔNG xóa lộ trình.
  const prevHwEStopRef = useRef(null);
  useEffect(() => {
    const hwActive = opc.plcState.hwEStop;
    const prev = prevHwEStopRef.current;
    prevHwEStopRef.current = hwActive;

    // Only trigger on rising edge (false→true), skip initial null→false
    if (prev === false && hwActive === true) {
      // Only trigger if not already in E-Stop state
      if (robotStateRef.current.status !== ROBOT_STATUS.ESTOP) {
        console.log('[SCADA] Hardware E-Stop button pressed (I1.2) → đóng băng UI');
        stopAnimation();
        setAnimating(false);
        setMoveId(id => id + 1);
        setRobotState(prev => ({ ...prev, status: ROBOT_STATUS.ESTOP }));
        // GIỮ LẠI route và queue — chỉ đóng băng UI
        addLog('[HW] E-STOP phần cứng được kích hoạt (I1.2)! Đang đóng băng hệ thống.', 'error');
        addLog(
          `[ROBOT_STATE] status=ESTOP index=${robotStateRef.current.index} target=${robotStateRef.current.targetId} x=${Math.round(robotStateRef.current.x)} y=${Math.round(robotStateRef.current.y)}`,
          'state'
        );
        publishSyncSnapshot(buildSyncSnapshot({
          status: ROBOT_STATUS.ESTOP,
          index: robotStateRef.current.index,
          targetId: robotStateRef.current.targetId,
          x: robotStateRef.current.x,
          y: robotStateRef.current.y,
        }));
      }
    }
  }, [opc.plcState.hwEStop, addLog, buildSyncSnapshot, publishSyncSnapshot, stopAnimation]);

  // === React to E-Stop_CMD = TRUE from PLC (biến đọc từ PLC báo dừng khẩn cấp) ===
  // Khi đọc được TRUE từ biến này thì bật giao diện dừng khẩn cấp trên UI web.
  // eStopActive=true có nghĩa PLC đang trong trạng thái khẩn cấp (E-Stop_CMD=TRUE)
  // Chỉ đóng băng UI — KHÔNG xóa lộ trình hay queue.
  const prevEStopActiveRef = useRef(null);
  useEffect(() => {
    const eStopActive = opc.plcState.eStopActive;
    const prev = prevEStopActiveRef.current;
    prevEStopActiveRef.current = eStopActive;

    // Chỉ xử lý khi trạng thái thay đổi (rising edge: false→true)
    if (prev === false && eStopActive === true) {
      if (robotStateRef.current.status !== ROBOT_STATUS.ESTOP) {
        console.log('[SCADA] PLC E-Stop_CMD = TRUE → đóng băng UI E-Stop');
        stopAnimation();
        setAnimating(false);
        setMoveId((id) => id + 1);
        setRobotState((prev) => ({ ...prev, status: ROBOT_STATUS.ESTOP }));
        // GIỮ LẠI route và queue — chỉ đóng băng, không reset
        addLog('[PLC] Dừng khẩn cấp từ PLC (E-Stop_CMD=TRUE)! Đang đóng băng hệ thống.', 'error');
        publishSyncSnapshot(buildSyncSnapshot({
          status: ROBOT_STATUS.ESTOP,
          index: robotStateRef.current.index,
          targetId: robotStateRef.current.targetId,
          x: robotStateRef.current.x,
          y: robotStateRef.current.y,
        }));
      }
    }
  }, [opc.plcState.eStopActive, addLog, buildSyncSnapshot, publishSyncSnapshot, stopAnimation]);

  // === Memoized return value ===
  return useMemo(() => ({
    // Auth
    isAuthenticated,
    setIsAuthenticated,
    currentUser,
    setCurrentUser,
    // Robot
    robotState,
    stations: STATIONS,
    systemLogs,
    // Users
    users,
    addUser,
    toggleUserActive,
    updateUserRole,
    updateUserStation,
    removeUser,
    updateUserFingerprintId,
    // Map data
    railPoints: RAIL_POINTS,
    animating,
    animPos,
    moveId,
    // Specimens
    currentSpecimen,
    scanList,
    scanFeedback,
    scannedSpecimens,
    transportedSpecimens,
    maintenanceMode,
    activeDispatchRoute,
    registerScannedSpecimen,
    lookupBarcode,
    removeFromScanList,
    updateScanListDestination,
    clearScanList,
    clearCurrentSpecimen,
    setMaintenanceState,
    hydratePersistedData,
    // Robot commands
    callRobot,
    dispatchRobot,
    dispatchScannedSpecimen,
    dispatchBatchSpecimens,
    previewDispatchRoute,
    startDispatchRoute,
    confirmRouteStop,
    emergencyStop,
    acknowledgeTask,
    // PLC commands trực tiếp
    confirmPickup: opc.confirmPickup,
    // Queue management
    queue,
    cabinDirection,
    cancelQueueItem,
    clearQueue,
    // Socket access
    getSocket: opc.getSocket,
    reconnectSocket: opc.reconnectSocket,
    // ESP32 Cabin Sensor
    cabinSensorData,
    sensorHistory,
    // PLC state (station sensors, lift sensors, hardware E-Stop)
    plcState: opc.plcState,
  }), [
    isAuthenticated,
    currentUser,
    robotState,
    systemLogs,
    users,
    addUser,
    toggleUserActive,
    updateUserRole,
    updateUserStation,
    removeUser,
    updateUserFingerprintId,
    animating,
    animPos,
    moveId,
    currentSpecimen,
    scanList,
    scanFeedback,
    scannedSpecimens,
    transportedSpecimens,
    maintenanceMode,
    activeDispatchRoute,
    registerScannedSpecimen,
    lookupBarcode,
    removeFromScanList,
    updateScanListDestination,
    clearScanList,
    clearCurrentSpecimen,
    setMaintenanceState,
    hydratePersistedData,
    callRobot,
    dispatchRobot,
    dispatchScannedSpecimen,
    dispatchBatchSpecimens,
    previewDispatchRoute,
    startDispatchRoute,
    confirmRouteStop,
    emergencyStop,
    acknowledgeTask,
    queue,
    cabinDirection,
    cancelQueueItem,
    clearQueue,
    opc.getSocket,
    opc.reconnectSocket,
    opc.confirmPickup,
    cabinSensorData,
    sensorHistory,
    opc.plcState,
  ]);
}
