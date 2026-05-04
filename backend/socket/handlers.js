// ══════════════════════════════════════════════════════════════════════════════
// socket/handlers.js
// ──────────────────────────────────────────────────────────────────────────────
// All Socket.io event handlers — PLC commands, cross-device sync,
// fingerprint login/enrollment workflows.
// ══════════════════════════════════════════════════════════════════════════════

import jwt from 'jsonwebtoken';
import {
  JWT_SECRET,
  AUTH_COOKIE_NAME,
} from '../config.js';
import { parseCookieHeader } from '../middleware/auth.js';
import { emitSnapshotToSocket, callCabin, setEStop, resetError, setMaintenanceMode as setPlcMaintenanceMode } from '../opcua-service.js';
import {
  getActiveFingerprintLoginSocketId,
  setFingerprintLoginSession,
  clearFingerprintLoginSession,
  pendingEnrollments,
} from '../services/fingerprint-session.js';

/**
 * Register Socket.io authentication middleware and connection handlers.
 * @param {import('socket.io').Server} io
 */
export function registerSocketHandlers(io) {
  // ── Authentication middleware ────────────────────────────────────────
  // Allows unauthenticated connections (needed for fingerprint login
  // waiting room) but tags authenticated users on socket.data.user
  // for PLC command guards.
  io.use((socket, next) => {
    const cookies = parseCookieHeader(socket.handshake.headers?.cookie);
    const token = String(cookies[AUTH_COOKIE_NAME] || '').trim();

    if (!token) {
      socket.data.user = null;
      return next();
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.data.user = {
        sub: payload.sub,
        username: payload.username,
        role: String(payload.role || '').toLowerCase(),
        stationId: payload.stationId ?? null,
      };
    } catch {
      socket.data.user = null;
    }

    next();
  });

  // ── Connection handler ──────────────────────────────────────────────
  io.on('connection', (socket) => {
    console.log(`[Socket.io] New client connected! ID: ${socket.id} | Origin: ${socket.handshake.headers.origin} | User: ${socket.data.user?.username || 'Anonymous'}`);

    function ensureSocketPermission(ack, requiredRole = null) {
      if (!socket.data.user?.sub) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Authentication required.' });
        return false;
      }
      if (requiredRole && socket.data.user.role !== requiredRole) {
        if (typeof ack === 'function') ack({ ok: false, error: 'Insufficient permission.' });
        return false;
      }
      return true;
    }

    // Push latest PLC snapshot to newly connected client
    emitSnapshotToSocket(socket);

    // ── Cross-device state synchronization ────────────────────────────
    // SECURITY: Only authenticated sockets can broadcast state —
    // unauthenticated clients (fingerprint login waiting room) are
    // blocked to prevent state injection attacks.
    socket.on('scada:stateSync', (data) => {
      if (!socket.data.user?.sub) {
        console.warn(`[Socket.io] BLOCKED unauthenticated stateSync from ${socket.id}`);
        return;
      }
      socket.broadcast.emit('scada:stateSync', {
        ...data,
        _sourceSocketId: socket.id,
        _ts: Date.now(),
      });
    });

    socket.on('scada:dataSync', (data) => {
      if (!socket.data.user?.sub) {
        console.warn(`[Socket.io] BLOCKED unauthenticated dataSync from ${socket.id}`);
        return;
      }
      socket.broadcast.emit('scada:dataSync', {
        ...data,
        _sourceSocketId: socket.id,
        _ts: Date.now(),
      });
    });

    // ── OPC UA: PLC command handlers ─────────────────────────────────
    socket.on('plc:callCabin', async (data, ack) => {
      if (!ensureSocketPermission(ack)) return;

      // Location-based RBAC: operators can only command their assigned station
      if (socket.data.user?.role === 'operator' && socket.data.user?.stationId) {
        const requestedStationId = data?.stationId;

        if (data?.action === 'DISPATCH') {
          if (requestedStationId === socket.data.user.stationId) {
            if (typeof ack === 'function') ack({ ok: false, error: 'Bạn không thể điều cabin đến trạm của chính mình.' });
            return;
          }
        } else {
          if (requestedStationId && requestedStationId !== socket.data.user.stationId) {
            console.warn(`[Socket.io] RBAC denied callCabin: operator ${socket.data.user.username} (station=${socket.data.user.stationId}) tried station=${requestedStationId}`);
            if (typeof ack === 'function') ack({ ok: false, error: 'Bạn không có quyền gọi cabin ở trạm này.' });
            return;
          }
        }
      }

      console.log(`[Socket.io] callCabin from ${socket.data.user?.username || socket.id}:`, data);
      try {
        const stationNumber = Number(data?.stationNumber);
        if (!Number.isInteger(stationNumber) || stationNumber < 1 || stationNumber > 4) {
          throw new Error('Invalid stationNumber');
        }
        const isStat = Boolean(data?.isStat);
        await callCabin(stationNumber, isStat);
        console.log(`[Socket.io] callCabin executed successfully for ${socket.data.user?.username || socket.id}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        console.error(`[Socket.io] callCabin error for ${socket.id}:`, err.message);
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('plc:eStop', async (data, ack) => {
      if (!ensureSocketPermission(ack)) return;
      try {
        const active = Boolean(data?.active);
        await setEStop(active);
        console.log(`[Socket.io] plc:eStop ${active ? 'ENGAGED' : 'RELEASED'} by ${socket.data.user?.username || socket.id}`);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        console.error('[Socket.io] plc:eStop error:', err.message);
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('plc:reset', async (_data, ack) => {
      if (!ensureSocketPermission(ack)) return;
      try {
        await resetError();
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        console.error('[Socket.io] plc:reset error:', err.message);
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    socket.on('plc:maintenance', async (data, ack) => {
      if (!ensureSocketPermission(ack, 'tech')) return;
      try {
        const active = Boolean(data?.active);
        await setPlcMaintenanceMode(active);
        if (typeof ack === 'function') ack({ ok: true });
      } catch (err) {
        console.error('[Socket.io] plc:maintenance error:', err.message);
        if (typeof ack === 'function') ack({ ok: false, error: err.message });
      }
    });

    // ── Fingerprint: login mode ──────────────────────────────────────
    socket.on('FINGERPRINT_LOGIN_WAIT', () => {
      const activeId = getActiveFingerprintLoginSocketId();
      if (activeId && activeId !== socket.id) {
        socket.emit('LOGIN_ERROR', { message: 'Another fingerprint login session is in progress.' });
        return;
      }
      setFingerprintLoginSession(socket.id);
      socket.join('fingerprint-login-waiters');
      console.log(`[Socket.io] ${socket.id} joined fingerprint-login-waiters`);
    });

    socket.on('FINGERPRINT_LOGIN_CANCEL', () => {
      socket.leave('fingerprint-login-waiters');
      if (getActiveFingerprintLoginSocketId() === socket.id) {
        clearFingerprintLoginSession();
      }
      console.log(`[Socket.io] ${socket.id} left fingerprint-login-waiters`);
    });

    // ── Fingerprint: enrollment mode ─────────────────────────────────
    socket.on('FINGERPRINT_ENROLL_START', (data) => {
      if (!socket.data.user?.sub || socket.data.user.role !== 'tech') {
        socket.emit('ENROLL_ERROR', { message: 'Insufficient permission.' });
        return;
      }

      const { userId, username } = data || {};
      if (!userId) {
        socket.emit('ENROLL_ERROR', { message: 'userId is required.' });
        return;
      }

      const existing = pendingEnrollments.get(socket.id);
      if (existing && existing.timer) clearTimeout(existing.timer);

      const timer = setTimeout(() => {
        pendingEnrollments.delete(socket.id);
        socket.leave('fingerprint-enroll-waiters');
        socket.emit('ENROLL_ERROR', { message: 'Enrollment timed out.' });
        console.log(`[Socket.io] Enrollment timed out for ${socket.id}`);
      }, 60000);

      pendingEnrollments.set(socket.id, { userId, username, status: 'waiting', timer });
      socket.join('fingerprint-enroll-waiters');
      console.log(`[Socket.io] ${socket.id} waiting for enrollment, userId=${userId}`);
    });

    socket.on('FINGERPRINT_ENROLL_CANCEL', () => {
      const existing = pendingEnrollments.get(socket.id);
      if (existing && existing.timer) clearTimeout(existing.timer);
      pendingEnrollments.delete(socket.id);
      socket.leave('fingerprint-enroll-waiters');
    });

    // ── Disconnect cleanup ───────────────────────────────────────────
    socket.on('disconnect', () => {
      if (getActiveFingerprintLoginSocketId() === socket.id) {
        clearFingerprintLoginSession();
      }
      const existing = pendingEnrollments.get(socket.id);
      if (existing && existing.timer) clearTimeout(existing.timer);
      pendingEnrollments.delete(socket.id);
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });
}
