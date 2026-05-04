// ══════════════════════════════════════════════════════════════════════════════
// services/fingerprint-session.js
// ──────────────────────────────────────────────────────────────────────────────
// Manages the server-side state for fingerprint login and enrollment sessions.
// ══════════════════════════════════════════════════════════════════════════════

import { FINGERPRINT_LOGIN_TIMEOUT_SERVER_MS } from '../config.js';

// ── Fingerprint login session (singleton — only one device can wait at a time) ──
const fingerprintLoginSession = { socketId: null, expiresAt: 0, timer: null };

export function getActiveFingerprintLoginSocketId() {
  if (!fingerprintLoginSession.socketId) return null;
  if (Date.now() > fingerprintLoginSession.expiresAt) {
    clearFingerprintLoginSession();
    return null;
  }
  return fingerprintLoginSession.socketId;
}

export function setFingerprintLoginSession(socketId) {
  clearFingerprintLoginSession();
  fingerprintLoginSession.socketId = socketId;
  fingerprintLoginSession.expiresAt = Date.now() + FINGERPRINT_LOGIN_TIMEOUT_SERVER_MS;
  fingerprintLoginSession.timer = setTimeout(() => {
    console.log(`[Socket.io] Fingerprint login session expired for ${socketId}`);
    clearFingerprintLoginSession();
  }, FINGERPRINT_LOGIN_TIMEOUT_SERVER_MS);
}

export function clearFingerprintLoginSession() {
  if (fingerprintLoginSession.timer) {
    clearTimeout(fingerprintLoginSession.timer);
    fingerprintLoginSession.timer = null;
  }
  fingerprintLoginSession.socketId = null;
  fingerprintLoginSession.expiresAt = 0;
}

// ── Fingerprint enrollment sessions (one per admin socket) ───────────────────
// Map<socketId, { userId, username, status, timer }>
export const pendingEnrollments = new Map();
