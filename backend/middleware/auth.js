// ══════════════════════════════════════════════════════════════════════════════
// middleware/auth.js
// ──────────────────────────────────────────────────────────────────────────────
// Authentication, authorization, and CSRF middleware for Express routes.
// ══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  JWT_SECRET,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_MAX_AGE_MS,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  SAFE_HTTP_METHODS,
} from '../config.js';

// ── Cookie helpers ───────────────────────────────────────────────────────────

export function parseCookieHeader(rawCookie) {
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

export function getCookieToken(req) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const token = String(cookies[AUTH_COOKIE_NAME] || '').trim();
  return token || null;
}

export function getCsrfCookieToken(req) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const token = String(cookies[CSRF_COOKIE_NAME] || '').trim();
  return token || null;
}

export function getRequestToken(req) {
  return getCookieToken(req);
}

export function generateCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function setAuthCookie(res, token) {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
}

export function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export function clearCsrfCookie(res) {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

// ── Express middleware ───────────────────────────────────────────────────────

export function optionalAuth(req, _res, next) {
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

export function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication required.' });
    return;
  }
  next();
}

export function requireCsrf(req, res, next) {
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

  // ESP32 fingerprint endpoints use API key auth, not cookies — exempt from CSRF
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

export function requireRole(role) {
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

export function getRequesterId(req) {
  const userId = Number(req.user?.sub);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return userId;
}
