/* global process */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import http from 'http';
import express from 'express';
import cors from 'cors';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prismaPkg from '@prisma/client';
import { Server as SocketIOServer } from 'socket.io';
import {
  initOpcUa,
  shutdownOpcUa,
  emitSnapshotToSocket,
  callCabin,
  setEStop,
  resetError,
  setMaintenanceMode as setPlcMaintenanceMode,
} from './opcua-service.js';

const { PrismaClient } = prismaPkg;
const DB_ROLE = {
  tech: 'TECH',
  operator: 'OPERATOR',
};

function toApiRole(dbRole) {
  if (dbRole === 'TECH') return 'tech';
  if (dbRole === 'OPERATOR') return 'operator';
  return String(dbRole || '').toLowerCase();
}

const DB_PRIORITY = {
  stat: 'STAT',
  routine: 'ROUTINE',
};

const DB_TRANSPORT_STATUS = {
  running: 'RUNNING',
  arrived: 'ARRIVED',
  error: 'ERROR',
};

const DEFAULT_STATIONS = [
  { id: 'ST-01', name: 'Trung tam', locationIndex: 0 },
  { id: 'ST-02', name: 'Xet nghiem', locationIndex: 2 },
  { id: 'ST-03', name: 'Vi sinh', locationIndex: 3 },
  { id: 'ST-04', name: 'PCR', locationIndex: 5 },
];

function toDbPriority(apiPriority) {
  const normalized = String(apiPriority || '').trim().toLowerCase();
  return DB_PRIORITY[normalized] || 'ROUTINE';
}

function toApiPriority(dbPriority) {
  return dbPriority === 'STAT' ? 'stat' : 'routine';
}

function toDbTransportStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return DB_TRANSPORT_STATUS[normalized] || 'RUNNING';
}

function toIsoOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function toIsoOrNow(value) {
  return toIsoOrNull(value) || new Date();
}

function parseLogType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'info';
  return normalized;
}

function mapUserForApi(user) {
  return {
    id: user.id,
    username: user.username,
    fullname: user.fullname,
    role: toApiRole(user.role),
    active: user.active,
    fingerprintId: user.fingerprintId ?? null,
    stationId: user.stationId ?? null,
    createdAt: user.createdAt,
  };
}

const app = express();
const httpServer = http.createServer(app);
const prisma = new PrismaClient();
const sseClients = new Set();

// ── ESP32 Fingerprint Configuration ──────────────────────────────────────────
const ESP32_API_KEY = process.env.ESP32_API_KEY || 'esp32-fingerprint-secret-change-me';

const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Socket.io server — shares the same HTTP server as Express
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? FRONTEND_ORIGINS : true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Track pending fingerprint enrollment sessions
// Map<socketId, { userId, username, status, timer }>
const pendingEnrollments = new Map();

// FIX [C1]: Fingerprint login session with expiry timeout to prevent
// indefinite session lock when client disconnects without cancelling.
const FINGERPRINT_LOGIN_TIMEOUT_SERVER_MS = 35_000; // match frontend + 5s margin
const fingerprintLoginSession = { socketId: null, expiresAt: 0, timer: null };

function getActiveFingerprintLoginSocketId() {
  if (!fingerprintLoginSession.socketId) return null;
  if (Date.now() > fingerprintLoginSession.expiresAt) {
    clearFingerprintLoginSession();
    return null;
  }
  return fingerprintLoginSession.socketId;
}

function setFingerprintLoginSession(socketId) {
  clearFingerprintLoginSession();
  fingerprintLoginSession.socketId = socketId;
  fingerprintLoginSession.expiresAt = Date.now() + FINGERPRINT_LOGIN_TIMEOUT_SERVER_MS;
  fingerprintLoginSession.timer = setTimeout(() => {
    console.log(`[Socket.io] Fingerprint login session expired for ${socketId}`);
    clearFingerprintLoginSession();
  }, FINGERPRINT_LOGIN_TIMEOUT_SERVER_MS);
}

function clearFingerprintLoginSession() {
  if (fingerprintLoginSession.timer) {
    clearTimeout(fingerprintLoginSession.timer);
    fingerprintLoginSession.timer = null;
  }
  fingerprintLoginSession.socketId = null;
  fingerprintLoginSession.expiresAt = 0;
}

// ── Socket.io authentication middleware ──────────────────────────────────────
// Allows unauthenticated connections (needed for fingerprint login waiting room)
// but tags authenticated users on socket.data.user for PLC command guards.
io.use((socket, next) => {
  const cookies = parseCookieHeader(socket.handshake.headers?.cookie);
  const token = String(cookies[AUTH_COOKIE_NAME] || '').trim();

  if (!token) {
    // Allow connection — fingerprint login clients won't have a cookie yet
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

  // ── OPC UA: Push latest PLC snapshot to newly connected client ──────
  emitSnapshotToSocket(socket);

  // ── Cross-device state synchronization ──────────────────────────────
  // Relay UI state snapshots (robot position, queue, maintenance, etc.)
  // from one client to ALL other connected clients across all devices.
  // Uses socket.broadcast (not rooms) because sockets may connect before
  // login — room-based approach is unreliable. Frontend-side filtering
  // (onStateSyncRef is null when not authenticated) handles security.
  socket.on('scada:stateSync', (data) => {
    socket.broadcast.emit('scada:stateSync', {
      ...data,
      _sourceSocketId: socket.id,
      _ts: Date.now(),
    });
  });

  // Relay data mutation notifications (new logs, specimens, transports)
  // so other devices can update their local state immediately.
  socket.on('scada:dataSync', (data) => {
    socket.broadcast.emit('scada:dataSync', {
      ...data,
      _sourceSocketId: socket.id,
      _ts: Date.now(),
    });
  });

  // ── OPC UA: PLC command handlers from Frontend ─────────────────────
  socket.on('plc:callCabin', async (data, ack) => {
    if (!ensureSocketPermission(ack)) return;

    // ── Location-based RBAC: operators can only command their assigned station ──
    if (socket.data.user?.role === 'operator' && socket.data.user?.stationId) {
      const requestedStationId = data?.stationId;

      if (data?.action === 'DISPATCH') {
        // DISPATCH: Cho phép đi mọi trạm TRỪ trạm của chính mình
        if (requestedStationId === socket.data.user.stationId) {
          if (typeof ack === 'function') ack({ ok: false, error: 'Bạn không thể điều cabin đến trạm của chính mình.' });
          return;
        }
      } else {
        // CALL (hoặc mặc định): Chỉ được phép tại trạm của mình
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
      // FIX [L2]: Audit log for safety-critical E-Stop operations
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

  // ── Fingerprint: login mode ─────────────────────────────────────────
  // Client requests to start fingerprint login mode
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

  // Client cancels fingerprint login wait
  socket.on('FINGERPRINT_LOGIN_CANCEL', () => {
    socket.leave('fingerprint-login-waiters');
    if (getActiveFingerprintLoginSocketId() === socket.id) {
      clearFingerprintLoginSession();
    }
    console.log(`[Socket.io] ${socket.id} left fingerprint-login-waiters`);
  });

  // Client requests to start enrollment (admin must provide userId)
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

// FIX [H1]: Debounce broadcastSyncRequired to collapse rapid mutations
// (e.g. 4 system-log writes during a robot move) into a single sync event.
let syncDebounceTimer = null;
let pendingSyncReasons = new Set();
const SYNC_DEBOUNCE_MS = 200;

function broadcastSyncRequired(reason) {
  pendingSyncReasons.add(reason);
  if (syncDebounceTimer) return;

  syncDebounceTimer = setTimeout(() => {
    syncDebounceTimer = null;
    const reasons = [...pendingSyncReasons];
    pendingSyncReasons.clear();

    const ts = Date.now();
    const payload = JSON.stringify({
      type: 'sync-required',
      reason: reasons.join(','),
      ts,
    });

    // Notify via SSE (legacy path)
    if (sseClients.size) {
      for (const client of sseClients) {
        try {
          client.write(`data: ${payload}\n\n`);
        } catch {
          sseClients.delete(client);
        }
      }
    }

    // Also notify via Socket.io for instant cross-device sync
    io.emit('scada:dataSync', {
      type: 'sync-required',
      reason: reasons.join(','),
      _ts: ts,
      _sourceSocketId: '__server__',
    });
  }, SYNC_DEBOUNCE_MS);
}

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const AUTH_COOKIE_NAME = 'scada_access_token';
const AUTH_COOKIE_MAX_AGE_MS = Number(process.env.AUTH_COOKIE_MAX_AGE_MS) || 8 * 60 * 60 * 1000;
const CSRF_COOKIE_NAME = 'scada_csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ARCHIVED_USERNAME_PREFIX = 'deleted_';
const DELETED_OWNER_USERNAME = '__deleted_owner__';
const DELETED_OWNER_FULLNAME = 'System Deleted Owner';

function parseCookieHeader(rawCookie) {
  const source = String(rawCookie || '').trim();
  if (!source) return {};

  const cookies = {};
  for (const part of source.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

function getCookieToken(req) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const token = String(cookies[AUTH_COOKIE_NAME] || '').trim();
  return token || null;
}

function getCsrfCookieToken(req) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const token = String(cookies[CSRF_COOKIE_NAME] || '').trim();
  return token || null;
}

function getRequestToken(req) {
  return getCookieToken(req);
}

function generateCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
}

function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

function optionalAuth(req, _res, next) {
  const token = getRequestToken(req);
  if (!token) {
    req.user = null;
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      sub: payload?.sub,
      username: payload?.username,
      role: String(payload?.role || '').toLowerCase(),
    };
  } catch {
    req.user = null;
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication required.' });
    return;
  }
  next();
}

function requireCsrf(req, res, next) {
  if (SAFE_HTTP_METHODS.has(req.method)) {
    next();
    return;
  }

  if (req.path === '/api/auth/login') {
    next();
    return;
  }

  // Fingerprint session exchange — client has no CSRF cookie yet
  if (req.path === '/api/auth/fingerprint-session') {
    next();
    return;
  }

  // FIX: ESP32 fingerprint endpoints use API key auth, not cookies — exempt from CSRF
  // Only exempt specific ESP32 paths, NOT the admin DELETE endpoint
  if (req.path === '/api/fingerprint/status' ||
      req.path === '/api/fingerprint/match' ||
      req.path === '/api/fingerprint/enroll' ||
      req.path === '/api/fingerprint/enroll-step') {
    next();
    return;
  }

  if (req.path === '/api/auth/register' && !req.user) {
    next();
    return;
  }

  if (!getRequestToken(req)) {
    next();
    return;
  }

  const cookieToken = getCsrfCookieToken(req);
  const headerToken = String(req.headers?.[CSRF_HEADER_NAME] || '').trim();

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    res.status(403).json({ message: 'CSRF token missing or invalid.' });
    return;
  }

  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required.' });
      return;
    }

    if (req.user.role !== role) {
      res.status(403).json({ message: 'Insufficient permission.' });
      return;
    }

    next();
  };
}

function getRequesterId(req) {
  const userId = Number(req.user?.sub);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return userId;
}

async function getOrCreateDeletedOwnerUserId() {
  const existing = await prisma.user.findUnique({
    where: { username: DELETED_OWNER_USERNAME },
    select: { id: true },
  });
  if (existing) return existing.id;

  const passwordHash = await bcrypt.hash('system-deleted-owner-only', 10);

  const user = await prisma.user.upsert({
    where: { username: DELETED_OWNER_USERNAME },
    update: {},
    create: {
      username: DELETED_OWNER_USERNAME,
      passwordHash,
      fullname: DELETED_OWNER_FULLNAME,
      role: DB_ROLE.tech,
      active: false,
    },
    select: { id: true },
  });
  return user.id;
}

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production.');
}

app.use(
  cors({
    origin(origin, callback) {
      // Allow all origins in development
      if (process.env.NODE_ENV !== 'production') {
        callback(null, true);
        return;
      }

      if (!origin) {
        callback(null, true);
        return;
      }

      if (FRONTEND_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked for origin: ${origin}`));
      }
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(optionalAuth);
app.use(requireCsrf);

// ── Serve built frontend (production / domain access) ─────────────────────
// When frontend/dist exists, serve it as static files from the backend.
// This allows Cloudflare Tunnel to point directly to the backend port,
// eliminating the triple-proxy (Cloudflare → Vite → Backend) that breaks
// WebSocket connections for cross-device sync.
const FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend', 'dist');
const hasFrontendBuild = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));
if (hasFrontendBuild) {
  console.log(`[Server] Serving frontend build from ${FRONTEND_DIST}`);
  app.use(express.static(FRONTEND_DIST, { index: false }));
}

app.get('/api/health', (_, res) => {
  res.status(200).json({ ok: true, service: 'scada-backend' });
});

app.get('/api/events', requireAuth, (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  sseClients.add(res);
  res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25000);

  res.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

app.get('/api/bootstrap', requireAuth, async (_, res) => {
  try {
    const [users, stations, specimens, transportRecords, systemLogs] = await Promise.all([
      prisma.user.findMany({
        where: {
          AND: [
            {
              username: {
                not: {
                  startsWith: ARCHIVED_USERNAME_PREFIX,
                },
              },
            },
            {
              username: {
                not: DELETED_OWNER_USERNAME,
              },
            },
          ],
        },
        select: {
          id: true,
          username: true,
          fullname: true,
          role: true,
          active: true,
          fingerprintId: true,
          stationId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.station.findMany({
        select: { id: true, name: true, locationIndex: true },
        orderBy: { locationIndex: 'asc' },
      }),
      prisma.specimen.findMany({
        select: {
          id: true,
          barcode: true,
          patientName: true,
          testType: true,
          priority: true,
          scanTime: true,
          scannedById: true,
          scannedBy: {
            select: {
              username: true,
            },
          },
        },
        orderBy: { scanTime: 'desc' },
        take: 300,
      }),
      prisma.transportRecord.findMany({
        select: {
          id: true,
          cabinId: true,
          status: true,
          dispatchTime: true,
          arrivalTime: true,
          specimen: {
            select: {
              id: true,
              barcode: true,
              patientName: true,
              testType: true,
              priority: true,
              scanTime: true,
            },
          },
          fromStation: {
            select: {
              id: true,
              name: true,
            },
          },
          toStation: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { dispatchTime: 'desc' },
        take: 500,
      }),
      prisma.systemLog.findMany({
        select: {
          id: true,
          event: true,
          type: true,
          createdAt: true,
          userId: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    ]);

    return res.status(200).json({
      users: users.map(mapUserForApi),
      stations,
      scannedSpecimens: specimens.map((item) => ({
        id: item.id,
        barcode: item.barcode,
        patientName: item.patientName,
        testType: item.testType,
        priority: toApiPriority(item.priority),
        scanTime: item.scanTime,
        scannedById: item.scannedById,
        scannedByUsername: item.scannedBy?.username || null,
      })),
      transportedSpecimens: transportRecords.map((item) => ({
        transportId: item.id,
        specimenId: item.specimen.id,
        barcode: item.specimen.barcode,
        patientName: item.specimen.patientName,
        testType: item.specimen.testType,
        priority: toApiPriority(item.specimen.priority),
        scanTime: item.specimen.scanTime,
        dispatchTime: item.dispatchTime,
        arrivalTime: item.arrivalTime,
        fromStationId: item.fromStation.id,
        fromStationName: item.fromStation.name,
        toStationId: item.toStation.id,
        toStationName: item.toStation.name,
        cabinId: item.cabinId,
        status: String(item.status || '').toLowerCase(),
      })),
      systemLogs,
    });
  } catch (error) {
    console.error('BOOTSTRAP_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, fullname, role = 'operator', stationId = null } = req.body ?? {};

    const normalizedUsername = String(username || '').trim().toLowerCase();
    const normalizedFullname = String(fullname || '').trim();
    const normalizedRole = String(role || '').trim().toLowerCase();

    if (!normalizedUsername || !password || !normalizedFullname) {
      return res.status(400).json({ message: 'username, password, and fullname are required.' });
    }

    if (normalizedUsername.length < 3 || normalizedUsername.length > 32) {
      return res.status(400).json({ message: 'username must be between 3 and 32 characters.' });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ message: 'password must be at least 6 characters.' });
    }

    if (!Object.keys(DB_ROLE).includes(normalizedRole)) {
      return res.status(400).json({ message: "role must be either 'tech' or 'operator'." });
    }

    // FIX [C2]: Use transaction to make bootstrap check + create atomic,
    // preventing race condition when two requests hit empty DB simultaneously.
    const isBootstrapRegistration = await prisma.$transaction(async (tx) => {
      const count = await tx.user.count();
      return count === 0;
    });
    if (!isBootstrapRegistration && !req.user) {
      return res.status(401).json({ message: 'Only authenticated tech users can register new accounts.' });
    }

    if (!isBootstrapRegistration && req.user?.role !== 'tech') {
      return res.status(403).json({ message: 'Only tech users can register new accounts.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);

    // Normalize stationId: only persist for operators
    const normalizedStationId = normalizedRole === 'operator' && stationId
      ? String(stationId).trim()
      : null;

    const createdUser = await prisma.user.create({
      data: {
        username: normalizedUsername,
        passwordHash,
        fullname: normalizedFullname,
        role: DB_ROLE[normalizedRole],
        active: true,
        stationId: normalizedStationId,
      },
      select: {
        id: true,
        username: true,
        fullname: true,
        role: true,
        active: true,
        stationId: true,
        createdAt: true,
      },
    });

    broadcastSyncRequired('user-created');

    return res.status(201).json({
      message: 'User registered successfully.',
      user: mapUserForApi(createdUser),
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Username already exists.' });
    }

    console.error('REGISTER_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body ?? {};

    const normalizedUsername = String(username || '').trim().toLowerCase();

    if (!normalizedUsername || !password) {
      return res.status(400).json({ message: 'username and password are required.' });
    }

    const user = await prisma.user.findUnique({
      where: { username: normalizedUsername },
    });

    if (!user || !user.active) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const isPasswordValid = await bcrypt.compare(String(password), user.passwordHash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: toApiRole(user.role),
        stationId: user.stationId ?? null,
      },
      JWT_SECRET,
      {
        expiresIn: JWT_EXPIRES_IN,
      }
    );

    setAuthCookie(res, token);
    setCsrfCookie(res, generateCsrfToken());

    return res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        fullname: user.fullname,
        role: toApiRole(user.role),
        active: user.active,
        stationId: user.stationId ?? null,
      },
    });
  } catch (error) {
    console.error('LOGIN_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/auth/logout', (_req, res) => {
  clearAuthCookie(res);
  clearCsrfCookie(res);
  return res.status(200).json({ message: 'Logged out.' });
});

// ── POST /api/auth/fingerprint-session ────────────────────────────────────────
// Called by frontend after receiving JWT from fingerprint LOGIN_SUCCESS event.
// Exchanges the JWT for an HttpOnly auth cookie so subsequent API calls work.
app.post('/api/auth/fingerprint-session', async (req, res) => {
  try {
    const { token } = req.body ?? {};
    if (!token) {
      return res.status(400).json({ message: 'token is required.' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, active: true },
    });

    if (!user || !user.active) {
      return res.status(401).json({ message: 'User not found or inactive.' });
    }

    setAuthCookie(res, token);
    setCsrfCookie(res, generateCsrfToken());

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('FINGERPRINT_SESSION_ERROR', error);
    return res.status(401).json({ message: 'Invalid token.' });
  }
});

app.get('/api/auth/session', requireAuth, async (req, res) => {
  try {
    const requesterId = getRequesterId(req);
    if (!requesterId) {
      clearAuthCookie(res);
      clearCsrfCookie(res);
      return res.status(401).json({ message: 'Invalid access token payload.' });
    }

    const user = await prisma.user.findUnique({
      where: { id: requesterId },
      select: {
        id: true,
        username: true,
        fullname: true,
        role: true,
        active: true,
        stationId: true,
      },
    });

    if (!user || !user.active) {
      clearAuthCookie(res);
      clearCsrfCookie(res);
      return res.status(401).json({ message: 'Session has expired.' });
    }

    if (!getCsrfCookieToken(req)) {
      setCsrfCookie(res, generateCsrfToken());
    }

    return res.status(200).json({ user: mapUserForApi(user) });
  } catch (error) {
    console.error('GET_SESSION_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.get('/api/users', requireAuth, requireRole('tech'), async (_, res) => {
  try {
    const users = await prisma.user.findMany({
      where: {
        AND: [
          {
            username: {
              not: {
                startsWith: ARCHIVED_USERNAME_PREFIX,
              },
            },
          },
          {
            username: {
              not: DELETED_OWNER_USERNAME,
            },
          },
        ],
      },
      select: {
        id: true,
        username: true,
        fullname: true,
        role: true,
        active: true,
        fingerprintId: true,
        stationId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.status(200).json({ users: users.map(mapUserForApi) });
  } catch (error) {
    console.error('GET_USERS_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.patch('/api/users/:username', requireAuth, requireRole('tech'), async (req, res) => {
  try {
    const username = String(req.params.username || '').trim().toLowerCase();
    const { role, active, fullname, stationId } = req.body ?? {};

    if (!username) {
      return res.status(400).json({ message: 'username is required.' });
    }

    const data = {};
    if (typeof active === 'boolean') data.active = active;

    if (typeof fullname === 'string') {
      const normalizedFullname = fullname.trim();
      if (normalizedFullname) data.fullname = normalizedFullname;
    }

    if (typeof role === 'string') {
      const normalizedRole = role.trim().toLowerCase();
      if (!Object.keys(DB_ROLE).includes(normalizedRole)) {
        return res.status(400).json({ message: "role must be either 'tech' or 'operator'." });
      }
      data.role = DB_ROLE[normalizedRole];
      if (data.role === 'TECH') {
        data.stationId = null;
      }
    }

    // FIX [L3]: When only stationId is updated (no role in body),
    // query the user's current role from DB to apply RBAC correctly.
    if (stationId !== undefined) {
      const effectiveRole = data.role || (
        await prisma.user.findUnique({
          where: { username },
          select: { role: true },
        })
      )?.role;
      if (effectiveRole !== 'TECH') {
        data.stationId = String(stationId).trim() || null;
      }
      // If role is TECH (either already or being set), stationId is already
      // cleared by the role-change block above.
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ message: 'No valid update fields provided.' });
    }

    const user = await prisma.user.update({
      where: { username },
      data,
      select: {
        id: true,
        username: true,
        fullname: true,
        role: true,
        active: true,
        stationId: true,
        createdAt: true,
      },
    });

    broadcastSyncRequired('user-updated');

    return res.status(200).json({ user: mapUserForApi(user) });
  } catch (error) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'User not found.' });
    }
    console.error('PATCH_USER_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.delete('/api/users/:username', requireAuth, requireRole('tech'), async (req, res) => {
  try {
    const username = String(req.params.username || '').trim().toLowerCase();
    const requesterId = getRequesterId(req);
    if (!username) {
      return res.status(400).json({ message: 'username is required.' });
    }

    const targetUser = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        fullname: true,
      },
    });

    if (!targetUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (requesterId && targetUser.id === requesterId) {
      return res.status(400).json({ message: 'Cannot delete current authenticated user.' });
    }

    if (targetUser.username === DELETED_OWNER_USERNAME) {
      return res.status(400).json({ message: 'Cannot delete system ownership account.' });
    }

    const deletedOwnerId = await getOrCreateDeletedOwnerUserId();

    await prisma.$transaction(async (tx) => {
      await tx.systemLog.updateMany({
        where: { userId: targetUser.id },
        data: { userId: null },
      });

      await tx.specimen.updateMany({
        where: { scannedById: targetUser.id },
        data: { scannedById: deletedOwnerId },
      });

      await tx.user.delete({ where: { id: targetUser.id } });
    });

    broadcastSyncRequired('user-deleted');

    return res.status(200).json({ message: 'User permanently deleted from database.' });
  } catch (error) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (error?.code === 'P2003') {
      return res.status(409).json({
        message: 'Cannot delete user because related records still reference this account.',
      });
    }

    console.error('DELETE_USER_ERROR', error);
    return res.status(500).json({ message: error?.message || 'Internal server error.' });
  }
});

app.post('/api/stations/sync', requireAuth, requireRole('tech'), async (req, res) => {
  try {
    const stations = Array.isArray(req.body?.stations) ? req.body.stations : [];
    if (!stations.length) {
      return res.status(400).json({ message: 'stations is required.' });
    }

    const payload = stations.map((station, index) => ({
      id: String(station?.id || '').trim(),
      name: String(station?.name || '').trim(),
      locationIndex:
        typeof station?.locationIndex === 'number' ? station.locationIndex : index,
    }));

    if (payload.some((station) => !station.id || !station.name)) {
      return res.status(400).json({ message: 'Each station must include id and name.' });
    }

    await prisma.$transaction(
      payload.map((station) =>
        prisma.station.upsert({
          where: { id: station.id },
          create: station,
          update: {
            name: station.name,
            locationIndex: station.locationIndex,
          },
        })
      )
    );

    broadcastSyncRequired('stations-synced');

    return res.status(200).json({ message: 'Stations synced.', count: payload.length });
  } catch (error) {
    console.error('SYNC_STATIONS_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/specimens/scan', requireAuth, async (req, res) => {
  try {
    const {
      barcode,
      patientName,
      testType,
      priority = 'routine',
      scanTime,
    } = req.body ?? {};

    const normalizedBarcode = String(barcode || '').trim().toUpperCase();
    const normalizedPatientName = String(patientName || '').trim();
    const normalizedTestType = String(testType || '').trim();
    const requesterId = getRequesterId(req);

    if (!normalizedBarcode || !normalizedPatientName || !normalizedTestType) {
      return res.status(400).json({ message: 'barcode, patientName, testType are required.' });
    }

    if (!requesterId) {
      return res.status(401).json({ message: 'Invalid access token payload.' });
    }

    const scannedBy = await prisma.user.findUnique({ where: { id: requesterId } });
    if (!scannedBy || !scannedBy.active) {
      return res.status(403).json({ message: 'Authenticated user is inactive or missing.' });
    }

    const specimen = await prisma.specimen.upsert({
      where: { barcode: normalizedBarcode },
      create: {
        barcode: normalizedBarcode,
        patientName: normalizedPatientName,
        testType: normalizedTestType,
        priority: toDbPriority(priority),
        scanTime: toIsoOrNow(scanTime),
        scannedById: scannedBy.id,
      },
      update: {
        patientName: normalizedPatientName,
        testType: normalizedTestType,
        priority: toDbPriority(priority),
        scanTime: toIsoOrNow(scanTime),
        scannedById: scannedBy.id,
      },
      select: {
        id: true,
        barcode: true,
        patientName: true,
        testType: true,
        priority: true,
        scanTime: true,
        scannedById: true,
      },
    });

    broadcastSyncRequired('specimen-scanned');

    return res.status(201).json({
      specimen: {
        ...specimen,
        priority: toApiPriority(specimen.priority),
      },
    });
  } catch (error) {
    console.error('SCAN_SPECIMEN_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/transports/complete', requireAuth, async (req, res) => {
  try {
    const {
      cabinId,
      status = 'arrived',
      barcode,
      patientName,
      testType,
      priority,
      scanTime,
      dispatchTime,
      arrivalTime,
      fromStationId,
      toStationId,
    } = req.body ?? {};

    const normalizedBarcode = String(barcode || '').trim().toUpperCase();
    const normalizedCabinId = String(cabinId || '').trim();
    const normalizedFromStationId = String(fromStationId || '').trim();
    const normalizedToStationId = String(toStationId || '').trim();
    const requesterId = getRequesterId(req);

    if (!normalizedBarcode || !normalizedCabinId || !normalizedFromStationId || !normalizedToStationId) {
      return res.status(400).json({ message: 'cabinId, barcode, fromStationId, toStationId are required.' });
    }

    if (!requesterId) {
      return res.status(401).json({ message: 'Invalid access token payload.' });
    }

    const [fromStation, toStation, scannedBy] = await Promise.all([
      prisma.station.findUnique({ where: { id: normalizedFromStationId } }),
      prisma.station.findUnique({ where: { id: normalizedToStationId } }),
      prisma.user.findUnique({ where: { id: requesterId } }),
    ]);

    if (!fromStation || !toStation) {
      return res.status(404).json({ message: 'from/to station not found. Please sync stations first.' });
    }

    if (!scannedBy || !scannedBy.active) {
      return res.status(403).json({ message: 'Authenticated user is inactive or missing.' });
    }

    const normalizedPatientName = String(patientName || 'Unknown').trim() || 'Unknown';
    const normalizedTestType = String(testType || 'Unknown').trim() || 'Unknown';
    const parsedScanTime = toIsoOrNull(scanTime) || new Date();
    const parsedDispatchTime = toIsoOrNull(dispatchTime);
    const parsedArrivalTime = arrivalTime == null ? null : toIsoOrNull(arrivalTime);
    const normalizedStatus = toDbTransportStatus(status);

    if (!parsedDispatchTime) {
      return res.status(400).json({ message: 'dispatchTime must be a valid ISO datetime.' });
    }

    if (arrivalTime != null && !parsedArrivalTime) {
      return res.status(400).json({ message: 'arrivalTime must be a valid ISO datetime.' });
    }

    if (parsedArrivalTime && parsedArrivalTime < parsedDispatchTime) {
      return res.status(400).json({ message: 'arrivalTime must be greater than or equal to dispatchTime.' });
    }

    const record = await prisma.$transaction(async (tx) => {
      const specimen = await tx.specimen.upsert({
        where: { barcode: normalizedBarcode },
        create: {
          barcode: normalizedBarcode,
          patientName: normalizedPatientName,
          testType: normalizedTestType,
          priority: toDbPriority(priority),
          scanTime: parsedScanTime,
          scannedById: scannedBy.id,
        },
        update: {
          patientName: normalizedPatientName,
          testType: normalizedTestType,
          priority: toDbPriority(priority),
          scanTime: parsedScanTime,
          scannedById: scannedBy.id,
        },
        select: { id: true, barcode: true },
      });

      const resolvedArrivalTime = normalizedStatus === 'ARRIVED'
        ? (parsedArrivalTime || new Date())
        : parsedArrivalTime;

      return tx.transportRecord.create({
        data: {
          cabinId: normalizedCabinId,
          status: normalizedStatus,
          dispatchTime: parsedDispatchTime,
          arrivalTime: resolvedArrivalTime,
          specimenId: specimen.id,
          fromStationId: fromStation.id,
          toStationId: toStation.id,
        },
        select: {
          id: true,
          cabinId: true,
          status: true,
          dispatchTime: true,
          arrivalTime: true,
          specimenId: true,
          fromStationId: true,
          toStationId: true,
        },
      });
    });

    broadcastSyncRequired('transport-completed');

    return res.status(201).json({
      record: {
        ...record,
        status: String(record.status || '').toLowerCase(),
      },
    });
  } catch (error) {
    console.error('COMPLETE_TRANSPORT_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

app.post('/api/system-logs', requireAuth, async (req, res) => {
  try {
    const { event, type = 'info' } = req.body ?? {};
    const normalizedEvent = String(event || '').trim();
    const normalizedType = parseLogType(type);
    const requesterId = getRequesterId(req);

    if (!normalizedEvent) {
      return res.status(400).json({ message: 'event is required.' });
    }

    if (!requesterId) {
      return res.status(401).json({ message: 'Invalid access token payload.' });
    }

    const log = await prisma.systemLog.create({
      data: {
        event: normalizedEvent,
        type: normalizedType,
        userId: requesterId,
      },
      select: {
        id: true,
        event: true,
        type: true,
        userId: true,
        createdAt: true,
      },
    });

    broadcastSyncRequired('system-log-created');

    return res.status(201).json({ log });
  } catch (error) {
    console.error('CREATE_SYSTEM_LOG_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── ESP32 Fingerprint Middleware ────────────────────────────────────────────
function requireEsp32ApiKey(req, res, next) {
  const apiKey = String(req.headers['x-api-key'] || req.body?.apiKey || '');
  if (!apiKey) {
    return res.status(401).json({ message: 'Missing API key.' });
  }

  const providedHash = crypto.createHash('sha256').update(apiKey).digest();
  const expectedHash = crypto.createHash('sha256').update(ESP32_API_KEY).digest();

  if (!crypto.timingSafeEqual(providedHash, expectedHash)) {
    return res.status(401).json({ message: 'Invalid API key.' });
  }
  next();
}

// ── GET /api/fingerprint/status ─────────────────────────────────────────────
// Called periodically by ESP32 to know if it should be in MATCH or ENROLL mode.
app.get('/api/fingerprint/status', requireEsp32ApiKey, (req, res) => {
  for (const [sid, session] of pendingEnrollments.entries()) {
    if (session.status === 'waiting') {
      return res.json({ mode: 'enroll', userId: session.userId, slotId: session.userId });
    }
  }
  return res.json({ mode: 'match' });
});

// ── POST /api/fingerprint/match ─────────────────────────────────────────────
// Called by ESP32 when a known fingerprint is scanned for LOGIN.
app.post('/api/fingerprint/match', requireEsp32ApiKey, async (req, res) => {
  try {
    const { fingerprintId } = req.body ?? {};
    const parsedId = Number(fingerprintId);

    if (!Number.isInteger(parsedId) || parsedId < 0) {
      return res.status(400).json({ message: 'fingerprintId must be a non-negative integer.' });
    }

    const user = await prisma.user.findUnique({
      where: { fingerprintId: parsedId },
      select: {
        id: true,
        username: true,
        fullname: true,
        role: true,
        active: true,
        stationId: true,
      },
    });

    if (!user) {
      return res.status(404).json({ message: 'No user found with this fingerprint.' });
    }

    if (!user.active) {
      return res.status(403).json({ message: 'User account is deactivated.' });
    }

    // Generate JWT token for the matched user
    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: toApiRole(user.role),
        stationId: user.stationId ?? null,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const targetSocketId = getActiveFingerprintLoginSocketId();
    if (!targetSocketId || !io.sockets.sockets.has(targetSocketId)) {
      clearFingerprintLoginSession();
      return res.status(409).json({ message: 'No active fingerprint login session.' });
    }

    // Emit LOGIN_SUCCESS only to the active waiting client
    io.to(targetSocketId).emit('LOGIN_SUCCESS', {
      token,
      user: {
        id: user.id,
        username: user.username,
        fullname: user.fullname,
        role: toApiRole(user.role),
        active: user.active,
        stationId: user.stationId ?? null,
      },
    });
    clearFingerprintLoginSession();

    console.log(`[Fingerprint] LOGIN_SUCCESS emitted for user: ${user.username}`);

    return res.status(200).json({
      message: 'Fingerprint matched. Login event emitted.',
      user: { id: user.id, username: user.username },
    });
  } catch (error) {
    console.error('FINGERPRINT_MATCH_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── POST /api/fingerprint/enroll-step ───────────────────────────────────────
// Called by ESP32 when step 1 (first scan) is complete.
app.post('/api/fingerprint/enroll-step', requireEsp32ApiKey, (req, res) => {
  const { userId, step } = req.body ?? {};
  console.log(`[Fingerprint] Enroll step ${step} complete for userId=${userId}`);
  io.emit('ENROLL_STEP_DONE', { userId: Number(userId), step });
  res.json({ success: true });
});


// ── POST /api/fingerprint/enroll ────────────────────────────────────────────
// Called by ESP32 after successfully enrolling a new fingerprint into the
// sensor module's internal memory. Stores the mapping in the database.
app.post('/api/fingerprint/enroll', requireEsp32ApiKey, async (req, res) => {
  try {
    const { fingerprintId, userId } = req.body ?? {};
    const parsedFingerprintId = Number(fingerprintId);
    const parsedUserId = Number(userId);

    if (!Number.isInteger(parsedFingerprintId) || parsedFingerprintId < 0) {
      return res.status(400).json({ message: 'fingerprintId must be a non-negative integer.' });
    }

    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      return res.status(400).json({ message: 'userId must be a positive integer.' });
    }

    // Check if another user already has this fingerprintId
    const existingUser = await prisma.user.findUnique({
      where: { fingerprintId: parsedFingerprintId },
      select: { id: true, username: true },
    });

    if (existingUser && existingUser.id !== parsedUserId) {
      return res.status(409).json({
        message: `Fingerprint ID ${parsedFingerprintId} is already assigned to user "${existingUser.username}".`,
      });
    }

    // Update the user with the fingerprint ID
    const updatedUser = await prisma.user.update({
      where: { id: parsedUserId },
      data: { fingerprintId: parsedFingerprintId },
      select: {
        id: true,
        username: true,
        fullname: true,
        fingerprintId: true,
      },
    });

    // Clear ALL pending enrollments for this userId FIRST (before emitting success)
    // Use Number() cast to avoid type mismatch between string and number
    const clearedSocketIds = [];
    for (const [socketId, enrollment] of pendingEnrollments.entries()) {
      if (Number(enrollment.userId) === parsedUserId) {
        if (enrollment.timer) clearTimeout(enrollment.timer);
        pendingEnrollments.delete(socketId);
        clearedSocketIds.push(socketId);
        console.log(`[Fingerprint] Cleared pendingEnrollment for socket ${socketId}, userId=${enrollment.userId}`);
      }
    }
    console.log(`[Fingerprint] Cleared ${clearedSocketIds.length} pending session(s). Remaining: ${pendingEnrollments.size}`);

    // Emit ENROLL_SUCCESS to ALL connected clients (broadcast)
    // The frontend filters by userId, so broadcasting is safe and avoids room issues
    io.emit('ENROLL_SUCCESS', {
      userId: updatedUser.id,
      username: updatedUser.username,
      fullname: updatedUser.fullname,
      fingerprintId: updatedUser.fingerprintId,
    });

    // Remove cleared sockets from the room
    for (const sid of clearedSocketIds) {
      const sock = io.sockets.sockets.get(sid);
      if (sock) sock.leave('fingerprint-enroll-waiters');
    }

    console.log(`[Fingerprint] ENROLL_SUCCESS for user: ${updatedUser.username}, fpId=${parsedFingerprintId}`);

    return res.status(200).json({
      message: 'Fingerprint enrolled successfully.',
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        fingerprintId: updatedUser.fingerprintId,
      },
    });
  } catch (error) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'User not found.' });
    }
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'This fingerprint ID is already in use.' });
    }
    console.error('FINGERPRINT_ENROLL_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

// ── DELETE /api/fingerprint/:userId ──────────────────────────────────────────
// Remove fingerprint association from a user (admin action)
app.delete('/api/fingerprint/:userId', requireAuth, requireRole('tech'), async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: 'Invalid userId.' });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { fingerprintId: null },
      select: { id: true, username: true },
    });

    return res.status(200).json({
      message: `Fingerprint removed from user "${updatedUser.username}".`,
    });
  } catch (error) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'User not found.' });
    }
    console.error('FINGERPRINT_DELETE_ERROR', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
});

async function seedDefaultStations() {
  await prisma.$transaction(
    DEFAULT_STATIONS.map((station) =>
      prisma.station.upsert({
        where: { id: station.id },
        create: station,
        update: {
          name: station.name,
          locationIndex: station.locationIndex,
        },
      })
    )
  );
}

// ── SPA catch-all: serve index.html for all non-API routes ────────────────
// Must be placed AFTER all API routes so /api/* is handled correctly.
if (hasFrontendBuild) {
  const indexHtml = path.join(FRONTEND_DIST, 'index.html');
  app.get('/{*path}', (_req, res) => {
    res.sendFile(indexHtml);
  });
}

async function startServer() {
  await prisma.$connect();
  await seedDefaultStations();

  // ── Initialise OPC UA connection to Kepware ────────────────────────
  try {
    await initOpcUa(io);
    console.log('[Server] OPC UA service initialised.');
  } catch (err) {
    // Non-fatal: the OPC UA service will auto-reconnect in the background.
    // The REST API and other Socket.io features remain fully operational.
    console.error('[Server] OPC UA init failed (will retry):', err.message);
  }

  httpServer.listen(PORT, HOST, () => {
    const interfaces = os.networkInterfaces();
    const networkAddresses = Object.values(interfaces)
      .flat()
      .filter((item) => item && item.family === 'IPv4' && !item.internal)
      .map((item) => item.address);

    console.log(`SCADA backend listening on http://localhost:${PORT}`);
    console.log(`Socket.io server attached to HTTP server on port ${PORT}`);
    for (const address of networkAddresses) {
      console.log(`SCADA backend LAN: http://${address}:${PORT}`);
    }
  });
}

startServer().catch(async (error) => {
  console.error('SERVER_START_ERROR', error);
  // FIX: Close HTTP server if it was started before the error occurred
  try { httpServer.close(); } catch { /* ignore */ }
  await prisma.$disconnect();
  process.exit(1);
});

// FIX: Gracefully close HTTP server before disconnecting services
// to drain in-flight requests and prevent dangling connections.
async function gracefulShutdown(signal) {
  console.log(`[Server] Received ${signal}, shutting down gracefully…`);
  try {
    await new Promise((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  } catch { /* ignore close errors */ }
  await shutdownOpcUa();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT').catch((error) => {
    console.error('GRACEFUL_SHUTDOWN_ERROR', error);
    process.exit(1);
  });
});
process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM').catch((error) => {
    console.error('GRACEFUL_SHUTDOWN_ERROR', error);
    process.exit(1);
  });
});
