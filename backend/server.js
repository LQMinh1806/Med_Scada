/* global process */
// ══════════════════════════════════════════════════════════════════════════════
// server.js — Entry Point
// ──────────────────────────────────────────────────────────────────────────────
// Wires together middleware, routes, Socket.io handlers, and OPC UA service.
// All business logic lives in routes/, socket/, and services/ modules.
// ══════════════════════════════════════════════════════════════════════════════

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
import prismaPkg from '@prisma/client';
import { Server as SocketIOServer } from 'socket.io';

// ── Config & modules ─────────────────────────────────────────────────────────
import { PORT, HOST, FRONTEND_ORIGINS, DEFAULT_STATIONS } from './config.js';
import { optionalAuth, requireCsrf } from './middleware/auth.js';
import { bindIo } from './services/sync.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { initOpcUa, shutdownOpcUa } from './opcua-service.js';

// ── Route modules ────────────────────────────────────────────────────────────
import createAuthRoutes from './routes/auth.js';
import createUserRoutes from './routes/users.js';
import createDataRoutes from './routes/data.js';
import createFingerprintRoutes from './routes/fingerprint.js';

// ── Initialize core services ─────────────────────────────────────────────────
const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();
const app = express();
const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? FRONTEND_ORIGINS : true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Bind Socket.io instance to sync service (for server-initiated broadcasts)
bindIo(io);

// Register all Socket.io event handlers (PLC, sync, fingerprint)
registerSocketHandlers(io);

// ── Express middleware pipeline ──────────────────────────────────────────────
app.use(
  cors({
    origin(origin, callback) {
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

// ── Serve built frontend (production / domain access) ────────────────────────
const FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend', 'dist');
const hasFrontendBuild = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));
if (hasFrontendBuild) {
  console.log(`[Server] Serving frontend build from ${FRONTEND_DIST}`);
  app.use(express.static(FRONTEND_DIST, { index: false }));
}

// ── Mount API routes ─────────────────────────────────────────────────────────
const dataRoutes = createDataRoutes(prisma);
app.use('/api/auth', createAuthRoutes(prisma));
app.use('/api/users', createUserRoutes(prisma));
app.use('/api/fingerprint', createFingerprintRoutes(prisma, io));
// Data routes are mounted at /api directly (health, events, bootstrap, etc.)
app.use('/api', dataRoutes);

// ── SPA catch-all ────────────────────────────────────────────────────────────
if (hasFrontendBuild) {
  const indexHtml = path.join(FRONTEND_DIST, 'index.html');
  app.get('/{*path}', (_req, res) => {
    res.sendFile(indexHtml);
  });
}

// ── Database seeding ─────────────────────────────────────────────────────────
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

// ── Start server ─────────────────────────────────────────────────────────────
async function startServer() {
  await prisma.$connect();
  await seedDefaultStations();

  // Initialise OPC UA connection to Kepware
  try {
    await initOpcUa(io);
    console.log('[Server] OPC UA service initialised.');
  } catch (err) {
    // Non-fatal: will auto-reconnect in the background
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
  try { httpServer.close(); } catch { /* ignore */ }
  await prisma.$disconnect();
  process.exit(1);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
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
