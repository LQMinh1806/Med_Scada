# Concerns & Technical Debt
**Date:** 2026-04-24

## Security
- Hardcoded fallback secrets in `server.js` (e.g., `JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret'`).
- ESP32 Fingerprint API key fallback (`esp32-fingerprint-secret-change-me`).

## Architecture & Code Quality
- `server.js` is very large (~1487 lines). Routes, models, and socket logic should be extracted into separate modular files (e.g., `routes/auth.js`, `controllers/userController.js`).
- Mixing of SSE (`/api/events`) and Socket.io connections may lead to duplicate realtime transport overhead.

## Testing
- Complete absence of automated tests in `package.json`.

## Reliability
- Error handling in OPC UA service could lead to disconnected states if Kepware connection drops, requiring robust auto-reconnection logic.
