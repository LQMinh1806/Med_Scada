// ══════════════════════════════════════════════════════════════════════════════
// routes/fingerprint.js
// ──────────────────────────────────────────────────────────────────────────────
// ESP32 fingerprint hardware endpoints: status, match, enroll, delete.
// ══════════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRES_IN, toApiRole } from '../config.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireEsp32ApiKey } from '../middleware/esp32.js';
import {
  getActiveFingerprintLoginSocketId,
  clearFingerprintLoginSession,
  pendingEnrollments,
} from '../services/fingerprint-session.js';

export default function createFingerprintRoutes(prisma, io) {
  const router = Router();

  // ── GET /api/fingerprint/status ────────────────────────────────────────
  // Called periodically by ESP32 to know if it should be in MATCH or ENROLL mode.
  router.get('/status', requireEsp32ApiKey, (req, res) => {
    for (const [sid, session] of pendingEnrollments.entries()) {
      if (session.status === 'waiting') {
        return res.json({ mode: 'enroll', userId: session.userId, slotId: session.userId });
      }
    }
    return res.json({ mode: 'match' });
  });

  // ── POST /api/fingerprint/match ────────────────────────────────────────
  // Called by ESP32 when a known fingerprint is scanned for LOGIN.
  router.post('/match', requireEsp32ApiKey, async (req, res) => {
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

  // ── POST /api/fingerprint/enroll-step ──────────────────────────────────
  // Called by ESP32 when step 1 (first scan) is complete.
  router.post('/enroll-step', requireEsp32ApiKey, (req, res) => {
    const { userId, step } = req.body ?? {};
    console.log(`[Fingerprint] Enroll step ${step} complete for userId=${userId}`);
    io.emit('ENROLL_STEP_DONE', { userId: Number(userId), step });
    res.json({ success: true });
  });

  // ── POST /api/fingerprint/enroll ───────────────────────────────────────
  // Called by ESP32 after successfully enrolling a new fingerprint.
  router.post('/enroll', requireEsp32ApiKey, async (req, res) => {
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

      const existingUser = await prisma.user.findUnique({
        where: { fingerprintId: parsedFingerprintId },
        select: { id: true, username: true },
      });

      if (existingUser && existingUser.id !== parsedUserId) {
        return res.status(409).json({
          message: `Fingerprint ID ${parsedFingerprintId} is already assigned to user "${existingUser.username}".`,
        });
      }

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

      // Clear ALL pending enrollments for this userId
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

      io.emit('ENROLL_SUCCESS', {
        userId: updatedUser.id,
        username: updatedUser.username,
        fullname: updatedUser.fullname,
        fingerprintId: updatedUser.fingerprintId,
      });

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

  // ── DELETE /api/fingerprint/:userId ────────────────────────────────────
  router.delete('/:userId', requireAuth, requireRole('tech'), async (req, res) => {
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

  return router;
}
