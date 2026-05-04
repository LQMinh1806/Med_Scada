// ══════════════════════════════════════════════════════════════════════════════
// routes/auth.js
// ──────────────────────────────────────────────────────────────────────────────
// Authentication routes: login, register, logout, session, fingerprint-session.
// ══════════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  DB_ROLE,
  toApiRole,
  mapUserForApi,
  JWT_SECRET,
  JWT_EXPIRES_IN,
} from '../config.js';
import {
  requireAuth,
  setAuthCookie,
  setCsrfCookie,
  clearAuthCookie,
  clearCsrfCookie,
  generateCsrfToken,
  getCsrfCookieToken,
  getRequesterId,
} from '../middleware/auth.js';
import { broadcastSyncRequired } from '../services/sync.js';

export default function createAuthRoutes(prisma) {
  const router = Router();

  // ── POST /api/auth/register ────────────────────────────────────────────
  router.post('/register', async (req, res) => {
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

      // Atomic bootstrap check — prevents race condition
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

  // ── POST /api/auth/login ───────────────────────────────────────────────
  router.post('/login', async (req, res) => {
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
        { expiresIn: JWT_EXPIRES_IN }
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

  // ── POST /api/auth/logout ──────────────────────────────────────────────
  router.post('/logout', (_req, res) => {
    clearAuthCookie(res);
    clearCsrfCookie(res);
    return res.status(200).json({ message: 'Logged out.' });
  });

  // ── POST /api/auth/fingerprint-session ─────────────────────────────────
  router.post('/fingerprint-session', async (req, res) => {
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

  // ── GET /api/auth/session ──────────────────────────────────────────────
  router.get('/session', requireAuth, async (req, res) => {
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

  return router;
}
