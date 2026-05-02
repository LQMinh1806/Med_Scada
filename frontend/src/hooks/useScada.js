import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  RAIL_POINTS,
  STATIONS,
  INITIAL_USERS,
  USER_ROLES,
  MAX_LOGS,
  MAX_SPECIMEN_HISTORY,
  SPEED_PX_PER_SEC,
  MIN_MOVE_DURATION_SEC,
  MIN_ANIMATION_DURATION_MS,
  BEZIER_SAMPLES_PER_SEG,
  PRIORITY,
} from '../constants';
import useScadaApi from './scada/useScadaApi';
import useQueueScheduler, { DIRECTION } from './scada/useQueueScheduler';
import useOpcUaSocket from './useOpcUaSocket';
import {
  clamp,
  buildOrderedPoints,
  cr2BezierSegments,
  sampleBezierPoints,
  computeCumulative,
  computePolylineLength,
  getFinalAngle,
  easeInOutCubic,
  parseMaintenanceEvent,
  parseRobotStateEvent,
} from './scada/scadaHelpers';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
const SCADA_EVENTS_URL = `${API_BASE_URL}/events`;
const SCADA_SYNC_KEY = 'scada:sync:event';
const SCADA_SYNC_CHANNEL = 'scada:sync:channel';
const SCADA_TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const QUEUE_PRIORITY = {
  ROUTINE: 'ROUTINE',
  STAT: 'STAT',
};
const ROBOT_DIRECTION = {
  UP: 'UP',
  DOWN: 'DOWN',
  IDLE: 'IDLE',
};

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
  const [scannedSpecimens, setScannedSpecimens] = useState([]);
  const [transportedSpecimens, setTransportedSpecimens] = useState([]);
  const [maintenanceMode, setMaintenanceMode] = useState({
    enabled: false,
    reason: '',
    updatedAt: null,
  });

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
      status: 'Sẵn sàng',
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
  const syncChannelRef = useRef(null);
  const lastAppliedSyncTsRef = useRef(0);
  // FIX: Track whether initial robot state hydration has been done.
  // After the first hydration, subsequent SSE/polling syncs should NOT
  // overwrite robotState.status — otherwise the user's E-STOP reset
  // action gets reverted when the server log still shows ESTOP status.
  const initialHydrationDoneRef = useRef(false);
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

  // Ref to break circular dependency: executeRobotMove ↔ processNextQueueTask
  const processQueueRef = useRef(null);

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
  useEffect(() => {
    if (!isAuthenticated) {
      lastAppliedSyncTsRef.current = 0;
    }
  }, [isAuthenticated]);

  // Build a serializable queue for cross-tab sync (strips metadata to keep payload small)
  const buildQueueSnapshot = useCallback(() => {
    return queueRef.current.map(item => ({
      id: item.id,
      stationId: item.stationId,
      type: item.type,
      priority: item.priority,
      timestamp: item.timestamp,
      // metadata can contain non-serializable objects; keep only safe parts
      metadata: item.metadata ? {
        specimenRecord: item.metadata.specimenRecord || null,
        dispatchTime: item.metadata.dispatchTime || null,
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
  }, [replaceQueue]);

  const publishSyncSnapshot = useCallback((snapshot) => {
    if (typeof window === 'undefined') return;

    const payload = {
      type: 'snapshot',
      sourceTabId: SCADA_TAB_ID,
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
    const payloadTs = Number(payload.ts);
    if (Number.isFinite(payloadTs) && payloadTs > 0) {
      if (payloadTs <= lastAppliedSyncTsRef.current) return false;
      lastAppliedSyncTsRef.current = payloadTs;
      return true;
    }

    // Fallback for malformed/no timestamp payloads: accept but advance marker.
    lastAppliedSyncTsRef.current = Date.now();
    return true;
  }, []);

  // === Logging ===
  const addLog = useCallback((event, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setSystemLogs(prev => {
      const next = [{ id: logIdRef.current, time, event, type }, ...prev];
      logIdRef.current += 1;
      if (next.length > MAX_LOGS) next.length = MAX_LOGS;
      return next;
    });

    apiRequest('/system-logs', {
      method: 'POST',
      body: JSON.stringify({ event, type }),
    }).catch(() => {
      // Ignore background persistence errors to keep the control loop responsive.
    });
  }, [apiRequest]);

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
                ? 'Bảo trì'
                : (prev.status === 'Bảo trì' ? 'Sẵn sàng' : prev.status),
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
            status: 'scanned',
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

    apiRequest('/auth/register', {
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
          return;
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
      })
      .catch((error) => {
        addLog(`Tạo tài khoản thất bại: ${error.message}`, 'error');
      });

    return true;
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

    setUsersAndSyncRef(prev =>
      prev.map(user => (user.username === username ? { ...user, role } : user))
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

  // === Specimen management (with priority support) ===
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

    const priorityLabel = record.priority === PRIORITY.STAT ? ' [STAT]' : '';
    addLog(`Đã quét mẫu ${record.barcode}${priorityLabel}`, record.priority === PRIORITY.STAT ? 'error' : 'info');

    apiRequest('/specimens/scan', {
      method: 'POST',
      body: JSON.stringify({
        barcode: record.barcode,
        patientName: record.patientName,
        testType: record.testType,
        priority: record.priority,
        scanTime: record.scanTime,
      }),
    }).catch((error) => {
      addLog(`Luu mau ${record.barcode} that bai: ${error.message}`, 'error');
    });

    return record;
  }, [addLog, apiRequest]);

  const clearCurrentSpecimen = useCallback(() => {
    setCurrentSpecimen(null);
  }, []);

  // === Animation engine ===
  const stopAnimation = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

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
      setAnimating(false);
      setMoveId((id) => id + 1);
      setRobotState((prev) => ({ ...prev, status: 'Bảo trì' }));
      addLog(
        `[MAINTENANCE] ENABLED${normalizedReason ? ` | reason=${normalizedReason}` : ''}`,
        'maintenance'
      );
      addLog(
        `[ROBOT_STATE] status=MAINTENANCE index=${robotStateRef.current.index} target=${robotStateRef.current.targetId} x=${Math.round(robotStateRef.current.x)} y=${Math.round(robotStateRef.current.y)}`,
        'state'
      );
      publishSyncSnapshot(buildSyncSnapshot({
        status: 'Bảo trì',
        maintenanceEnabled: true,
        maintenanceReason: normalizedReason,
      }));
      return;
    }

    setRobotState((prev) => ({
      ...prev,
      status: prev.status === 'Bảo trì' ? 'Sẵn sàng' : prev.status,
    }));
    addLog('[MAINTENANCE] DISABLED', 'maintenance');
    addLog(
      `[ROBOT_STATE] status=READY index=${robotStateRef.current.index} target=${robotStateRef.current.targetId} x=${Math.round(robotStateRef.current.x)} y=${Math.round(robotStateRef.current.y)}`,
      'state'
    );
    publishSyncSnapshot(buildSyncSnapshot({
      status: 'Sẵn sàng',
      maintenanceEnabled: false,
      maintenanceReason: '',
    }));
  }, [addLog, buildSyncSnapshot, publishSyncSnapshot, stopAnimation, opc]);

  const animatePoints = useCallback((sampleData, durationSec, onComplete) => {
    if (!sampleData || sampleData.points.length < 2) {
      if (onComplete) onComplete();
      return;
    }

    const { points, cumulativeLengths, total } = sampleData;
    const durationMs = Math.max(MIN_ANIMATION_DURATION_MS, durationSec * 1000);
    const start = performance.now();
    stopAnimation();

    const firstPoint = points[0];
    const secondPoint = points[1] || firstPoint;
    const startAngle = (Math.atan2(secondPoint.y - firstPoint.y, secondPoint.x - firstPoint.x) * 180) / Math.PI;
    setAnimPos({ x: firstPoint.x, y: firstPoint.y, angle: startAngle, progress: 0 });

    const step = (now) => {
      const elapsed = now - start;
      const normalizedTime = Math.min(1, elapsed / durationMs);
      const eased = easeInOutCubic(normalizedTime);
      const targetLength = eased * total;

      // Binary search for segment
      let low = 0;
      let high = cumulativeLengths.length - 1;
      let index = high;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (cumulativeLengths[mid] >= targetLength) {
          index = mid;
          high = mid - 1;
        } else {
          low = mid + 1;
        }
      }

      const previousIndex = Math.max(0, index - 1);
      const previousLength = cumulativeLengths[previousIndex];
      const segmentLength = (cumulativeLengths[index] - previousLength) || 1e-6;
      const segmentProgress = clamp((targetLength - previousLength) / segmentLength, 0, 1);

      const from = points[previousIndex];
      const to = points[index];
      const x = from.x + (to.x - from.x) * segmentProgress;
      const y = from.y + (to.y - from.y) * segmentProgress;

      const lookAhead = points[Math.min(points.length - 1, index + 2)];
      const angle = (Math.atan2(lookAhead.y - y, lookAhead.x - x) * 180) / Math.PI;

      setAnimPos({ x, y, angle, progress: eased });

      if (normalizedTime < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      rafRef.current = null;
      if (onComplete) onComplete();
    };

    rafRef.current = requestAnimationFrame(step);
  }, [stopAnimation]);

  // === Robot movement executor (internal — called by queue processor) ===
  const executeRobotMove = useCallback((action, stationId, metadata = null) => {
    if (maintenanceRef.current.enabled) {
      addLog('[MAINTENANCE] Command blocked while maintenance mode is enabled', 'maintenance');
      return false;
    }

    const target = STATIONS.find(station => station.id === stationId);
    if (!target) return false;

    const fromIndex = robotStateRef.current.index;
    const fromStation = STATIONS.find(station => station.idx === fromIndex);
    const toIndex = target.idx;

    if (fromIndex === toIndex) {
      addLog(`${target.name} - Robot đã tại vị trí`, 'info');
      // Avoid synchronous recursion when many queued tasks target the current station.
      if (processQueueRef.current) {
        setTimeout(() => {
          processQueueRef.current?.(fromIndex);
        }, 0);
      }
      return true;
    }

    const orderedPoints = buildOrderedPoints(RAIL_POINTS, fromIndex, toIndex);
    const segments = cr2BezierSegments(orderedPoints);
    const sampledPoints = sampleBezierPoints(segments, BEZIER_SAMPLES_PER_SEG);
    const sampleData = computeCumulative(sampledPoints);
    const totalLength = sampleData.total || computePolylineLength(orderedPoints);
    const durationSec = Math.max(MIN_MOVE_DURATION_SEC, totalLength / SPEED_PX_PER_SEC);

    const priorityLabel = metadata?.specimenRecord?.priority === PRIORITY.STAT ? ' [STAT]' : '';

    stopAnimation();
    setMoveId(id => id + 1);
    setAnimating(true);
    setRobotState(prev => ({ ...prev, status: 'Đang di chuyển', targetId: stationId }));
    addLog(`Lệnh [${action}]${priorityLabel} -> ${target.name}`);
    const fromPoint = RAIL_POINTS[fromIndex];

    // Extract '1' from 'ST-01' safely, avoiding index offsets if STATIONS array changes.
    const plcStationNumber = parseInt(target.id.split('-')[1], 10);
    const isStat = metadata?.specimenRecord?.priority === PRIORITY.STAT;

    opc.callCabin(plcStationNumber, isStat, target.id, action).then((res) => {
      if (!res?.ok) {
        addLog(`Lỗi gửi lệnh di chuyển tới ${target.name}: ${res?.error || 'Unknown'}`, 'error');
      }
    }).catch((err) => {
      addLog(`[PLC] callCabin lỗi kết nối: ${err?.message || 'Unknown'}`, 'error');
    });

    addLog(
      `[ROBOT_STATE] status=MOVING index=${fromIndex} target=${stationId} x=${Math.round(fromPoint.x)} y=${Math.round(fromPoint.y)}`,
      'state'
    );
    publishSyncSnapshot(buildSyncSnapshot({
      status: 'Đang di chuyển',
      index: fromIndex,
      targetId: stationId,
      x: fromPoint.x,
      y: fromPoint.y,
    }));

    animatePoints(sampleData, durationSec, () => {
      const lastPoint = orderedPoints[orderedPoints.length - 1];
      const finalAngle = getFinalAngle(sampleData.points);
      const arrivedTime = new Date().toISOString();

      const newState = {
        index: toIndex,
        x: lastPoint.x,
        y: lastPoint.y,
        status: 'Sẵn sàng',
        targetId: target.id,
      };

      setRobotState(prev => ({ ...prev, ...newState }));
      // Synchronously update ref so that processQueueRef sees the new location immediately
      robotStateRef.current = { ...robotStateRef.current, ...newState };

      setAnimPos({ x: lastPoint.x, y: lastPoint.y, angle: finalAngle, progress: 1 });
      setAnimating(false);
      addLog(`Đã đến ${target.name}`, 'success');
      addLog(
        `[ROBOT_STATE] status=READY index=${toIndex} target=${target.id} x=${Math.round(lastPoint.x)} y=${Math.round(lastPoint.y)}`,
        'state'
      );
      publishSyncSnapshot(buildSyncSnapshot({
        status: 'Sẵn sàng',
        index: toIndex,
        targetId: target.id,
        x: lastPoint.x,
        y: lastPoint.y,
      }));

      if (metadata?.specimenRecord) {
        const deliveredRecord = {
          specimenId: metadata.specimenRecord.id,
          barcode: metadata.specimenRecord.barcode,
          patientName: metadata.specimenRecord.patientName,
          testType: metadata.specimenRecord.testType,
          priority: metadata.specimenRecord.priority || PRIORITY.ROUTINE,
          scanTime: metadata.specimenRecord.scanTime,
          dispatchTime: metadata.dispatchTime,
          arrivalTime: arrivedTime,
          fromStationId: fromStation?.id || 'N/A',
          fromStationName: fromStation?.name || 'N/A',
          toStationId: target.id,
          toStationName: target.name,
          cabinId: robotStateRef.current.id,
        };

        setTransportedSpecimens(prev => {
          const next = [deliveredRecord, ...prev];
          if (next.length > MAX_SPECIMEN_HISTORY) next.length = MAX_SPECIMEN_HISTORY;
          return next;
        });

        setScannedSpecimens(prev =>
          prev.map(item =>
            item.id === metadata.specimenRecord.id
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

        addLog(`Mẫu ${metadata.specimenRecord.barcode} đã bàn giao tại ${target.name}`, 'success');

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
          addLog(`Luu van chuyen ${metadata.specimenRecord.barcode} that bai: ${error.message}`, 'error');
        });
      }

      // ── Queue integration: auto-process next task after arrival ──
      if (processQueueRef.current) processQueueRef.current(toIndex);
    });
    return true;
  }, [addLog, animatePoints, apiRequest, buildSyncSnapshot, publishSyncSnapshot, stopAnimation, opc]);

  // === Queue processor: dequeue and execute next task ===
  const processNextQueueTask = useCallback((currentStationIndex) => {
    if (maintenanceRef.current.enabled) return;
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
    const priorityTag = nextTask.priority === PRIORITY.STAT ? '[STAT] ' : '';
    addLog(
      `[QUEUE] ${priorityTag}Đang xử lý task: [${nextTask.type}] -> ${stationName} (còn ${queueRef.current.length} task trong hàng chờ)`,
      nextTask.priority === PRIORITY.STAT ? 'error' : 'info'
    );

    executeRobotMove(nextTask.type, nextTask.stationId, nextTask.metadata);
  }, [addLog, dequeueNextTask, executeRobotMove, syncDirectionRef, queueRef]);

  // Keep ref in sync so executeRobotMove always calls the latest processNextQueueTask
  useEffect(() => {
    processQueueRef.current = processNextQueueTask;
  }, [processNextQueueTask]);

  // === Trigger queue processing when a STAT task is enqueued while IDLE ===
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

  const triggerQueueIfIdle = useCallback(() => {
    if (!animatingRef.current && robotStateRef.current.status === 'Sẵn sàng' && !maintenanceRef.current.enabled) {
      processNextQueueTask(robotStateRef.current.index);
    }
  }, [processNextQueueTask]);

  // === Public robot commands (enqueue into queue) ===
  const callRobot = useCallback((stationId, priority = PRIORITY.ROUTINE) => {
    if (maintenanceRef.current.enabled) {
      addLog('[MAINTENANCE] Command blocked while maintenance mode is enabled', 'maintenance');
      return false;
    }

    const station = STATIONS.find(s => s.id === stationId);
    const stationName = station?.name || stationId;
    const priorityTag = priority === PRIORITY.STAT ? '[STAT] ' : '';

    enqueue(stationId, 'CALL', priority, null);
    addLog(
      `[QUEUE] ${priorityTag}Đã thêm lệnh CALL -> ${stationName} vào hàng chờ (vị trí #${queueRef.current.length})`,
      priority === PRIORITY.STAT ? 'error' : 'info'
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
    const priorityTag = priority === PRIORITY.STAT ? '[STAT] ' : '';

    enqueue(stationId, 'DISPATCH', priority, null);
    addLog(
      `[QUEUE] ${priorityTag}Đã thêm lệnh DISPATCH -> ${stationName} vào hàng chờ (vị trí #${queueRef.current.length})`,
      priority === PRIORITY.STAT ? 'error' : 'info'
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
    const priority = specimenRecord.priority || PRIORITY.ROUTINE;
    const station = STATIONS.find(s => s.id === stationId);
    const stationName = station?.name || stationId;
    const priorityTag = priority === PRIORITY.STAT ? '[STAT] ' : '';

    enqueue(stationId, 'DISPATCH', priority, { specimenRecord, dispatchTime });
    addLog(
      `[QUEUE] ${priorityTag}Đã thêm lệnh DISPATCH mẫu ${specimenRecord.barcode} -> ${stationName} vào hàng chờ`,
      priority === PRIORITY.STAT ? 'error' : 'info'
    );

    setCurrentSpecimen(null);
    publishQueueSync();
    triggerQueueIfIdle();
    return true;
  }, [addLog, enqueue, publishQueueSync, triggerQueueIfIdle]);

  const emergencyStop = useCallback(() => {
    stopAnimation();
    setAnimating(false);
    setMoveId(id => id + 1);
    setRobotState(prev => ({ ...prev, status: 'Dừng khẩn cấp' }));

    // --- KÍCH HOẠT LỆNH E-STOP XUỐNG PLC ---
    opc.triggerEStop().then((res) => {
      if (!res?.ok) addLog(`Lỗi gửi lệnh E-Stop xuống PLC: ${res?.error || 'Unknown'}`, 'error');
    }).catch((err) => {
      addLog(`[PLC] E-Stop lỗi kết nối: ${err?.message || 'Unknown'}`, 'error');
    });

    // Clear the queue on E-STOP to prevent stale tasks from running after recovery
    const droppedCount = queueRef.current.length;
    clearQueue();
    addLog('E-STOP được kích hoạt!', 'error');
    if (droppedCount > 0) {
      addLog(`[QUEUE] Đã hủy ${droppedCount} task trong hàng chờ do E-STOP`, 'error');
    }
    addLog(
      `[ROBOT_STATE] status=ESTOP index=${robotStateRef.current.index} target=${robotStateRef.current.targetId} x=${Math.round(robotStateRef.current.x)} y=${Math.round(robotStateRef.current.y)}`,
      'state'
    );
    publishSyncSnapshot(buildSyncSnapshot({
      status: 'Dừng khẩn cấp',
      index: robotStateRef.current.index,
      targetId: robotStateRef.current.targetId,
      x: robotStateRef.current.x,
      y: robotStateRef.current.y,
      queue: [],
      cabinDirection: DIRECTION.IDLE,
    }));
  }, [addLog, buildSyncSnapshot, clearQueue, publishSyncSnapshot, stopAnimation, queueRef, opc]);

  const acknowledgeTask = useCallback(() => {
    // FIX: Restore UI state IMMEDIATELY — don't block behind PLC socket timeouts.
    // Previously, two sequential `await opc.*()` calls (each with 5s timeout) plus
    // a 500ms setTimeout caused a ~10.5s delay before the UI recovered.
    // PLC commands are now fire-and-forget in the background.

    // ── 1. Instant UI recovery ──────────────────────────────────────────
    setRobotState(prev => ({ ...prev, status: 'Sẵn sàng' }));
    addLog('Hệ thống đã được khôi phục sau Dừng khẩn cấp', 'success');
    addLog(
      `[ROBOT_STATE] status=READY index=${robotStateRef.current.index} target=${robotStateRef.current.targetId} x=${Math.round(robotStateRef.current.x)} y=${Math.round(robotStateRef.current.y)}`,
      'state'
    );
    publishSyncSnapshot(buildSyncSnapshot({ status: 'Sẵn sàng' }));

    // ── 2. Background PLC commands (fire-and-forget) ────────────────────
    // Release E-Stop first, then send reset pulse after a short gap.
    // Failures are logged but never block the UI.
    opc.releaseEStop().then((res) => {
      if (!res?.ok) {
        addLog(`Cảnh báo PLC: Nhả E-Stop không thành công (${res?.error || 'PLC offline'})`, 'error');
      }
    }).catch((err) => {
      addLog(`Cảnh báo PLC: ${err?.message || 'Không kết nối được'}`, 'error');
    });

    // Small delay between release and reset to let PLC process the state change
    setTimeout(() => {
      opc.resetError().then((res) => {
        if (!res?.ok) {
          addLog(`Cảnh báo PLC: Reset lỗi không thành công (${res?.error || 'PLC offline'})`, 'error');
        }
      }).catch((err) => {
        addLog(`Cảnh báo PLC: ${err?.message || 'Không kết nối được'}`, 'error');
      });
    }, 300);
  }, [addLog, buildSyncSnapshot, publishSyncSnapshot, opc]);

  // === Cleanup ===
  useEffect(() => {
    return () => stopAnimation();
  }, [stopAnimation]);

  // Keep clients synchronized via backend SSE; fallback to slow polling on errors.
  useEffect(() => {
    if (!isAuthenticated) return undefined;

    let eventSource = null;
    let fallbackIntervalId = null;
    const initialSyncTimer = setTimeout(() => {
      hydratePersistedData({ syncStations: false });
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
          hydratePersistedData({ syncStations: false });
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
  }, [hydratePersistedData, isAuthenticated]);

  // ── Cross-device sync via Socket.io ────────────────────────────────
  // Attach callback refs so the socket hook can invoke our sync handlers
  // whenever another device broadcasts state or data changes.
  useEffect(() => {
    if (!isAuthenticated) {
      opc.onStateSyncRef.current = null;
      opc.onDataSyncRef.current = null;
      return;
    }

    // Handle incoming UI state snapshots from other devices
    opc.onStateSyncRef.current = (data) => {
      if (!data || typeof data !== 'object') return;
      // Ignore our own echoed messages
      if (data.sourceTabId === SCADA_TAB_ID) return;
      if (data.type === 'snapshot' && shouldApplySyncPayload(data)) {
        applySyncSnapshot(data.snapshot);
      }
    };

    // Handle incoming data change notifications from other devices/server
    opc.onDataSyncRef.current = (data) => {
      if (!data || typeof data !== 'object') return;
      if (data.type === 'sync-required') {
        hydratePersistedData({ syncStations: false });
      }
    };

    return () => {
      opc.onStateSyncRef.current = null;
      opc.onDataSyncRef.current = null;
    };
  }, [isAuthenticated, applySyncSnapshot, shouldApplySyncPayload, hydratePersistedData, opc]);

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
    scannedSpecimens,
    transportedSpecimens,
    maintenanceMode,
    registerScannedSpecimen,
    clearCurrentSpecimen,
    setMaintenanceState,
    hydratePersistedData,
    // Robot commands
    callRobot,
    dispatchRobot,
    dispatchScannedSpecimen,
    emergencyStop,
    acknowledgeTask,
    // Queue management
    queue,
    cabinDirection,
    cancelQueueItem,
    clearQueue,
    // Socket access
    getSocket: opc.getSocket,
    reconnectSocket: opc.reconnectSocket,
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
    scannedSpecimens,
    transportedSpecimens,
    maintenanceMode,
    registerScannedSpecimen,
    clearCurrentSpecimen,
    setMaintenanceState,
    hydratePersistedData,
    callRobot,
    dispatchRobot,
    dispatchScannedSpecimen,
    emergencyStop,
    acknowledgeTask,
    queue,
    cabinDirection,
    cancelQueueItem,
    clearQueue,
    opc.getSocket,
    opc.reconnectSocket,
  ]);
}
