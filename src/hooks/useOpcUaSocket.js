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

  // ── PLC state — updated by server-pushed events ────────────────────────
  const [plcState, setPlcState] = useState({
    currentStation: null,
    stationId: null,
    robotStatus: null,
    robotStatusLabel: 'Chưa kết nối',
    arrivalDone: false,
    isPlcConnected: false,
    isSocketConnected: false,
  });

  // ── Connect / disconnect lifecycle ─────────────────────────────────────
  useEffect(() => {
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
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
      setPlcState((prev) => ({
        ...prev,
        currentStation: data.currentStation ?? prev.currentStation,
        stationId: data.stationId ?? prev.stationId,
        robotStatus: data.robotStatus ?? prev.robotStatus,
        robotStatusLabel: data.robotStatusLabel ?? prev.robotStatusLabel,
        arrivalDone: data.arrivalDone ?? prev.arrivalDone,
      }));
    });

    /**
     * Individual tag change events — useful if a component only cares
     * about one specific PLC value and wants minimal re-renders.
     */
    socket.on('plc:currentStation', (data) => {
      setPlcState((prev) => ({
        ...prev,
        currentStation: data.raw,
        stationId: data.stationId,
      }));
    });

    socket.on('plc:robotStatus', (data) => {
      setPlcState((prev) => ({
        ...prev,
        robotStatus: data.raw,
        robotStatusLabel: data.label,
      }));
    });

    socket.on('plc:arrivalDone', (data) => {
      setPlcState((prev) => ({
        ...prev,
        arrivalDone: data.value,
      }));
    });

    /**
     * OPC UA connection status (backend ↔ Kepware).
     */
    socket.on('plc:connectionStatus', (data) => {
      setPlcState((prev) => ({
        ...prev,
        isPlcConnected: data.connected,
      }));
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
    (stationNumber, isStat = false) =>
      emitCommand('plc:callCabin', { stationNumber, isStat }),
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

  // ── Memoized return value ──────────────────────────────────────────────
  return useMemo(
    () => ({
      plcState,
      callCabin,
      triggerEStop,
      releaseEStop,
      resetError,
      setMaintenance,
    }),
    [plcState, callCabin, triggerEStop, releaseEStop, resetError, setMaintenance],
  );
}
