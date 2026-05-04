/* global process */
// ══════════════════════════════════════════════════════════════════════════════
// config.js
// ──────────────────────────────────────────────────────────────────────────────
// Central configuration — environment variables, constants, and security
// validation. All other modules import from here.
// ══════════════════════════════════════════════════════════════════════════════

// ── Database role/priority/status mappings ────────────────────────────────────
export const DB_ROLE = {
  tech: 'TECH',
  operator: 'OPERATOR',
};

export function toApiRole(dbRole) {
  if (dbRole === 'TECH') return 'tech';
  if (dbRole === 'OPERATOR') return 'operator';
  return String(dbRole || '').toLowerCase();
}

export const DB_PRIORITY = {
  stat: 'STAT',
  routine: 'ROUTINE',
};

export const DB_TRANSPORT_STATUS = {
  running: 'RUNNING',
  arrived: 'ARRIVED',
  error: 'ERROR',
};

export const DEFAULT_STATIONS = [
  { id: 'ST-01', name: 'Trung Tâm', locationIndex: 0 },
  { id: 'ST-02', name: 'Xét Nghiệm', locationIndex: 2 },
  { id: 'ST-03', name: 'Vi Sinh', locationIndex: 3 },
  { id: 'ST-04', name: 'PCR', locationIndex: 5 },
];

// ── Utility converters ───────────────────────────────────────────────────────
export function toDbPriority(apiPriority) {
  const normalized = String(apiPriority || '').trim().toLowerCase();
  return DB_PRIORITY[normalized] || 'ROUTINE';
}

export function toApiPriority(dbPriority) {
  return dbPriority === 'STAT' ? 'stat' : 'routine';
}

export function toDbTransportStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return DB_TRANSPORT_STATUS[normalized] || 'RUNNING';
}

export function toIsoOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function toIsoOrNow(value) {
  return toIsoOrNull(value) || new Date();
}

export function parseLogType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'info';
  return normalized;
}

export function mapUserForApi(user) {
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

// ── Server configuration ─────────────────────────────────────────────────────
export const PORT = Number(process.env.PORT) || 3000;
export const HOST = process.env.HOST || '0.0.0.0';

// ── JWT & Auth ───────────────────────────────────────────────────────────────
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
export const AUTH_COOKIE_NAME = 'scada_access_token';
export const AUTH_COOKIE_MAX_AGE_MS = Number(process.env.AUTH_COOKIE_MAX_AGE_MS) || 8 * 60 * 60 * 1000;
export const CSRF_COOKIE_NAME = 'scada_csrf_token';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// ── User management constants ────────────────────────────────────────────────
export const ARCHIVED_USERNAME_PREFIX = 'deleted_';
export const DELETED_OWNER_USERNAME = '__deleted_owner__';
export const DELETED_OWNER_FULLNAME = 'System Deleted Owner';

// ── ESP32 Fingerprint ────────────────────────────────────────────────────────
const ESP32_API_KEY_DEFAULT = 'esp32-fingerprint-secret-change-me';
export const ESP32_API_KEY = process.env.ESP32_API_KEY || ESP32_API_KEY_DEFAULT;

// ── Fingerprint login session ────────────────────────────────────────────────
export const FINGERPRINT_LOGIN_TIMEOUT_SERVER_MS = 35_000;

// ── CORS ─────────────────────────────────────────────────────────────────────
export const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// ── Production safety checks ─────────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required in production.');
  }
  if (ESP32_API_KEY === ESP32_API_KEY_DEFAULT) {
    throw new Error(
      'ESP32_API_KEY must be set in production. The default key is insecure. ' +
      'Set a strong, unique API key in your .env file.'
    );
  }
} else {
  if (JWT_SECRET === 'dev-only-change-this-secret') {
    console.warn('⚠️  [Security] Using default JWT_SECRET — acceptable for development only.');
  }
}
