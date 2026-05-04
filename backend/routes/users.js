// ══════════════════════════════════════════════════════════════════════════════
// routes/users.js
// ──────────────────────────────────────────────────────────────────────────────
// User management routes: list, update, delete.
// ══════════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  DB_ROLE,
  mapUserForApi,
  ARCHIVED_USERNAME_PREFIX,
  DELETED_OWNER_USERNAME,
  DELETED_OWNER_FULLNAME,
} from '../config.js';
import { requireAuth, requireRole, getRequesterId } from '../middleware/auth.js';
import { broadcastSyncRequired } from '../services/sync.js';

async function getOrCreateDeletedOwnerUserId(prisma) {
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

export default function createUserRoutes(prisma) {
  const router = Router();

  // ── GET /api/users ─────────────────────────────────────────────────────
  router.get('/', requireAuth, requireRole('tech'), async (_, res) => {
    try {
      const users = await prisma.user.findMany({
        where: {
          AND: [
            { username: { not: { startsWith: ARCHIVED_USERNAME_PREFIX } } },
            { username: { not: DELETED_OWNER_USERNAME } },
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

  // ── PATCH /api/users/:username ─────────────────────────────────────────
  router.patch('/:username', requireAuth, requireRole('tech'), async (req, res) => {
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

      // When only stationId is updated (no role in body),
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

  // ── DELETE /api/users/:username ────────────────────────────────────────
  router.delete('/:username', requireAuth, requireRole('tech'), async (req, res) => {
    try {
      const username = String(req.params.username || '').trim().toLowerCase();
      const requesterId = getRequesterId(req);
      if (!username) {
        return res.status(400).json({ message: 'username is required.' });
      }

      const targetUser = await prisma.user.findUnique({
        where: { username },
        select: { id: true, username: true, fullname: true },
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

      const deletedOwnerId = await getOrCreateDeletedOwnerUserId(prisma);

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

  return router;
}
