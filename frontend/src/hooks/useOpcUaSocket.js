// ══════════════════════════════════════════════════════════════════════════════
// useOpcUaSocket.js
// ──────────────────────────────────────────────────────────────────────────────
// React custom hook that connects to the SCADA backend via Socket.io and
// provides:
//   • Real-time PLC state (station, status, arrival flag, connection status)
//   • Command functions: callCabin(), triggerEStop(), releaseEStop(),
//     resetError(), setMaintenance()
//
// The hook manages the Socket.io lifecycle (connect, reconnect, cleanup) and
// exposes a clean API that any component can consume.
// ══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';

// Backend Socket.io URL — uses the Vite proxy in dev (empty string routes to current origin)
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? '';

/**
 * @typedef {Object} PlcState
 * @property {number|null}  currentStation      PLC station number (1–4)
 * @property {string|null}  stationId           Mapped SCADA ID (ST-01 … ST-04)
 * @property {number|null}  robotStatus         Raw PLC status (0/1/2)
 * @property {string}       robotStatusLabel    Vietnamese label (Sẵn sàng / …)
 * @property {boolean}      arrivalDone         True when cabin has arrived
 * @property {boolean}      isPlcConnected      True if backend ↔ Kepware is live
 * @property {boolean}      isSocketConnected   True if browser ↔ backend is live
 */

/**
 * Custom hook — OPC UA Socket.io bridge.
 *
 * @returns {{
 *   plcState: PlcState,
 *   callCabin: (stationNumber: number, isStat?: boolean) => Promise<{ok: boolean, error?: string}>,
 *   triggerEStop: () => Promise<{ok: boolean, error?: string}>,
 *   releaseEStop: () => Promise<{ok: boolean, error?: string}>,
 *   resetError: () => Promise<{ok: boolean, error?: string}>,
 *   setMaintenance: (active: boolean) => Promise<{ok: boolean, error?: string}>,
 * }}
 */
export default function useOpcUaSocket() {
  // ── Socket.io instance (stable across renders) ─────────────────────────
  const socketRef = useRef(null);

  // ── Callback refs for cross-device sync handlers ───────────────────────
  // useScada attaches its handler functions here so the socket can invoke them
  const onStateSyncRef = useRef(null);
  const onDataSyncRef = useRef(null);
  const onCabinSensorRef = useRef(null); // ESP32 cabin sensor data
  const pendingStateSyncRef = useRef(null);
  const pendingDataSyncRef = useRef(null);

  // ── PLC state — updated by server-pushed events ────────────────────────
  const [plcState, setPlcState] = useState({
    currentStation: null,
    stationId: null,
    robotStatus: null,
    robotStatusLabel: 'Chưa kết nối',
    cabinReady: true,    // Cabin_Ready flag from PLC (true=ready, false=busy lifting)
    eStopActive: false,  // E-Stop_CMD từ PLC: true=đang dừng khẩn cấp (PLC gửi TRUE)
    isPlcConnected: false,
    isSocketConnected: false,
    // Station position sensors (I0.4–I0.7): cabin presence at each station
    stationSensors: { 'ST-01': false, 'ST-02': false, 'ST-03': false, 'ST-04': false },
    // Lift sensors
    liftSensors: { liftHigh1: false, liftHigh2: false },
    // Hardware E-Stop button (physical, I1.2)
    hwEStop: false,
  });

  // ── Connect / disconnect lifecycle ─────────────────────────────────────
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      upgrade: true,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
    });

    socketRef.current = socket;

    // ── Socket.io connection status ────────────────────────────────────
    socket.on('connect', () => {
      console.log('[OPC-UA Hook] Socket connected:', socket.id);
      setPlcState((prev) => ({ ...prev, isSocketConnected: true }));
    });

    socket.on('disconnect', (reason) => {
      console.warn('[OPC-UA Hook] Socket disconnected:', reason);
      setPlcState((prev) => ({
        ...prev,
        isSocketConnected: false,
        isPlcConnected: false,
      }));
    });

    socket.on('connect_error', (err) => {
      console.error('[OPC-UA Hook] Connection error:', err.message);
    });

    // ── PLC data events from backend ──────────────────────────────────

    /**
     * Consolidated snapshot — contains all read tags in one event.
     * This is the primary data source; individual tag events below are
     * kept for granularity if components only need one value.
     */
    socket.on('plc:snapshot', (data) => {
      if (!data || typeof data !== 'object') return;
      setPlcState((prev) => ({
        ...prev,
        currentStation: data.currentStation ?? prev.currentStation,
        stationId: data.stationId ?? prev.stationId,
        robotStatus: data.robotStatus ?? prev.robotStatus,
        robotStatusLabel: data.robotStatusLabel ?? prev.robotStatusLabel,
        cabinReady: data.cabinReady ?? prev.cabinReady,
        eStopActive: data.eStopActive ?? prev.eStopActive,
        // Station position sensors (I0.4–I0.7)
        stationSensors: data.stationSensors ?? prev.stationSensors,
        // Lift sensors
        liftSensors: data.liftSensors ?? prev.liftSensors,
        // Hardware E-Stop
        hwEStop: data.hwEStop ?? prev.hwEStop,
      }));
    });

    /**
     * Individual tag change events — useful if a component only cares
     * about one specific PLC value and wants minimal re-renders.
     */
    socket.on('plc:currentStation', (data) => {
      if (!data || typeof data !== 'object') return;
      setPlcState((prev) => ({
        ...prev,
        currentStation: data.raw,
        stationId: data.stationId,
      }));
    });

    socket.on('plc:robotStatus', (data) => {
      if (!data || typeof data !== 'object') return;
      setPlcState((prev) => ({
        ...prev,
        robotStatus: data.raw,
        robotStatusLabel: data.label,
      }));
    });

    socket.on('plc:stationSensors', (data) => {
      if (!data || typeof data !== 'object') return;
      setPlcState((prev) => ({
        ...prev,
        stationSensors: data,
      }));
    });

    socket.on('plc:liftSensors', (data) => {
      if (!data || typeof data !== 'object') return;
      setPlcState((prev) => ({
        ...prev,
        liftSensors: data,
      }));
    });

    socket.on('plc:hardwareEStop', (data) => {
      if (!data || typeof data !== 'object') return;
      setPlcState((prev) => ({
        ...prev,
        hwEStop: Boolean(data.active),
      }));
    });

    socket.on('plc:cabinReady', (data) => {
      if (!data || typeof data !== 'object') return;
      setPlcState((prev) => ({
        ...prev,
        cabinReady: Boolean(data.ready),
      }));
    });

    // Trạng thái E-Stop từ PLC (đọc biến E-Stop_CMD)
    // active=true nghĩa là PLC đang trong trạng thái dừng khẩn cấp (E-Stop_CMD=TRUE)
    socket.on('plc:eStopStatus', (data) => {
      if (!data || typeof data !== 'object') return;
      setPlcState((prev) => ({
        ...prev,
        eStopActive: Boolean(data.active),
      }));
    });

    /**
     * OPC UA connection status (backend ↔ Kepware).
     */
    socket.on('plc:connectionStatus', (data) => {
      if (!data || typeof data !== 'object') return;
      setPlcState((prev) => ({
        ...prev,
        isPlcConnected: data.connected,
      }));
    });

    // ── Cross-device state sync listeners ──────────────────────────────
    socket.on('scada:stateSync', (data) => {
      if (onStateSyncRef.current) {
        onStateSyncRef.current(data);
      } else {
        pendingStateSyncRef.current = data;
      }
    });

    socket.on('scada:dataSync', (data) => {
      if (onDataSyncRef.current) {
        onDataSyncRef.current(data);
      } else {
        pendingDataSyncRef.current = data;
      }
    });

    // ── ESP32 Cabin Sensor data ──────────────────────────────────────────
    socket.on('sensor:cabinData', (data) => {
      if (onCabinSensorRef.current) {
        onCabinSensorRef.current(data);
      }
    });

    // ── Cleanup on unmount ────────────────────────────────────────────
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ── Command helpers (emit with acknowledgement) ────────────────────────

  /**
   * Generic emit-with-ack wrapper.  Returns a promise that resolves with the
   * server's acknowledgement payload ({ ok, error? }).
   *
   * @param {string} event   Socket.io event name
   * @param {object} payload Data to send
   * @param {number} timeout Max wait time in ms (default 5 s)
   */
  const emitCommand = useCallback((event, payload = {}, timeout = 5000) => {
    return new Promise((resolve) => {
      const socket = socketRef.current;

      if (!socket?.connected) {
        resolve({ ok: false, error: 'Socket chưa kết nối với server.' });
        return;
      }

      // Timeout guard — resolve with error if server never acks
      const timer = setTimeout(() => {
        resolve({ ok: false, error: 'Hết thời gian chờ phản hồi từ PLC.' });
      }, timeout);

      socket.emit(event, payload, (ack) => {
        clearTimeout(timer);
        resolve(ack || { ok: true });
      });
    });
  }, []);

  // ── Public command API ─────────────────────────────────────────────────

  /**
   * Send the cabin to a station.
   *
   * @param {number}  stationNumber  PLC station number (1–4)
   * @param {boolean} isStat         True for STAT (urgent) priority
   */
  const callCabin = useCallback(
    (stationNumber, isStat = false, stationId = null, action = 'CALL', withConfirm = false) =>
      emitCommand('plc:callCabin', { stationNumber, isStat, stationId, action, withConfirm }),
    [emitCommand],
  );

  /**
   * Engage the E-Stop (maintained signal — stays active until released).
   */
  const triggerEStop = useCallback(
    () => emitCommand('plc:eStop', { active: true }),
    [emitCommand],
  );

  /**
   * Release the E-Stop.
   */
  const releaseEStop = useCallback(
    () => emitCommand('plc:eStop', { active: false }),
    [emitCommand],
  );

  /**
   * Send Confirm_CMD1 = TRUE to trigger route creation / lift mechanism.
   * PLC auto-resets Confirm_CMD1 to FALSE after activation.
   */
  const confirmStation = useCallback(
    () => emitCommand('plc:confirmStation'),
    [emitCommand],
  );

  /**
   * Send Confirm_CMD = TRUE to trigger route stop confirmation.
   * PLC auto-resets Confirm_CMD to FALSE after activation.
   */
  const confirmStop = useCallback(
    () => emitCommand('plc:confirmStop'),
    [emitCommand],
  );

  /**
   * Send Confirm_CMD2 = TRUE to trigger pickup at current station.
   * PLC auto-resets Confirm_CMD2 to FALSE after activation.
   */
  const confirmPickup = useCallback(
    () => emitCommand('plc:confirmPickup'),
    [emitCommand],
  );

  /**
   * Send a reset pulse to clear PLC errors.
   */
  const resetError = useCallback(
    () => emitCommand('plc:reset'),
    [emitCommand],
  );

  /**
   * Enter or exit maintenance mode.
   *
   * @param {boolean} active  True = enter maintenance, False = exit
   */
  const setMaintenance = useCallback(
    (active) => emitCommand('plc:maintenance', { active }),
    [emitCommand],
  );

  // ── Cross-device sync API ──────────────────────────────────────────────

  /**
   * Broadcast UI state snapshot to all other connected devices via Socket.io.
   * This replaces the BroadcastChannel/localStorage sync for cross-device use.
   *
   * @param {object} snapshot  The state snapshot to broadcast
   */
  const emitStateSync = useCallback((snapshot) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit('scada:stateSync', snapshot);
  }, []);

  const setOnStateSync = useCallback((cb) => {
    onStateSyncRef.current = cb;
    if (!cb) {
      pendingStateSyncRef.current = null;
      return;
    }
    if (pendingStateSyncRef.current) {
      const pending = pendingStateSyncRef.current;
      pendingStateSyncRef.current = null;
      cb(pending);
    }
  }, []);

  const setOnDataSync = useCallback((cb) => {
    onDataSyncRef.current = cb;
    if (!cb) {
      pendingDataSyncRef.current = null;
      return;
    }
    if (pendingDataSyncRef.current) {
      const pending = pendingDataSyncRef.current;
      pendingDataSyncRef.current = null;
      cb(pending);
    }
  }, []);

  const setOnCabinSensor = useCallback((cb) => {
    onCabinSensorRef.current = cb;
  }, []);

  /**
   * Broadcast data mutation notification to all other connected devices.
   *
   * @param {object} data  The data change notification
   */
  const emitDataSync = useCallback((data) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit('scada:dataSync', data);
  }, []);

  /**
   * Force socket to disconnect and reconnect.
   * This is necessary after login because the socket initially connects
   * without the auth cookie (app mounts before login). Reconnecting
   * sends the now-present cookie so the server can authenticate and
   * join the client to the scada-sync room for cross-device sync.
   */
  const reconnectSocket = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    console.log('[OPC-UA Hook] Reconnecting socket for auth refresh...');
    socket.disconnect();
    // Short delay to ensure disconnect completes before reconnecting
    setTimeout(() => socket.connect(), 100);
  }, []);

  // Expose socket ref getter for components that need direct socket access
  const getSocket = useCallback(() => socketRef.current, []);

  // ── Memoized return value ──────────────────────────────────────────────
  return useMemo(
    () => ({
      plcState,
      callCabin,
      confirmStation,
      confirmStop,
      confirmPickup,
      triggerEStop,
      releaseEStop,
      resetError,
      setMaintenance,
      // Cross-device sync
      emitStateSync,
      emitDataSync,
      onStateSyncRef,
      onDataSyncRef,
      setOnStateSync,
      setOnDataSync,
      reconnectSocket,
      getSocket,
      // ESP32 Cabin Sensor
      onCabinSensorRef,
      setOnCabinSensor,
    }),
    [plcState, callCabin, confirmStation, confirmStop, confirmPickup, triggerEStop, releaseEStop, resetError, setMaintenance, emitStateSync, emitDataSync, setOnStateSync, setOnDataSync, reconnectSocket, getSocket, setOnCabinSensor],
  );
}
