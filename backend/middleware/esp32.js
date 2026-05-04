// ══════════════════════════════════════════════════════════════════════════════
// middleware/esp32.js
// ──────────────────────────────────────────────────────────────────────────────
// API key authentication middleware for ESP32 hardware endpoints.
// ══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { ESP32_API_KEY } from '../config.js';

export function requireEsp32ApiKey(req, res, next) {
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
