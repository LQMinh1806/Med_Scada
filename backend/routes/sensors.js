// ══════════════════════════════════════════════════════════════════════════════
// routes/sensors.js
// ──────────────────────────────────────────────────────────────────────────────
// ESP32 cabin sensor endpoints: receive DHT11 + MPU6050 data, broadcast
// real-time via Socket.io, serve history (in-memory ring buffer).
// ══════════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import crypto from 'crypto';

/* global process */
const SENSOR_API_KEY = process.env.SENSOR_API_KEY || 'esp32-sensor-secret-change-me';

// ── In-memory ring buffer (100 most recent records) ──────────────────────────
const MAX_HISTORY = 100;
const sensorHistory = [];
let latestReading = null;

// ── API key guard (same timing-safe pattern as fingerprint ESP32 key) ─────────
function requireSensorApiKey(req, res, next) {
  const provided = String(req.headers['x-api-key'] || '');
  if (!provided) {
    return res.status(401).json({ message: 'Missing X-API-Key header.' });
  }
  try {
    const h1 = crypto.createHash('sha256').update(provided).digest();
    const h2 = crypto.createHash('sha256').update(SENSOR_API_KEY).digest();
    if (!crypto.timingSafeEqual(h1, h2)) {
      return res.status(401).json({ message: 'Invalid API key.' });
    }
  } catch {
    return res.status(401).json({ message: 'Invalid API key.' });
  }
  next();
}

/**
 * @param {import('socket.io').Server} io
 */
export default function createSensorRoutes(io) {
  const router = Router();

  // ── POST /api/sensors/cabin ─────────────────────────────────────────────
  // Nhận dữ liệu từ ESP32 mỗi ~2 giây.
  // Bao gồm: DHT11, MPU6050, Encoder position, Relay direction.
  router.post('/cabin', requireSensorApiKey, (req, res) => {
    const body = req.body ?? {};

    const reading = {
      // ── Định danh thiết bị ──────────────────────────────────────────────
      deviceId: String(body.deviceId || latestReading?.deviceId || 'ESP32-SENSOR-01'),

      // ── Cảm biến môi trường (DHT11) ─────────────────────────────────────
      temperature: body.temperature != null ? Number(body.temperature) : (latestReading?.temperature ?? null),
      humidity: body.humidity != null ? Number(body.humidity) : (latestReading?.humidity ?? null),

      // ── Gia tốc kế / Con quay hồi chuyển (MPU6050) ──────────────────────
      accelX: body.accelX != null ? Number(body.accelX) : (latestReading?.accelX ?? 0),
      accelY: body.accelY != null ? Number(body.accelY) : (latestReading?.accelY ?? 0),
      accelZ: body.accelZ != null ? Number(body.accelZ) : (latestReading?.accelZ ?? 9.81),
      gyroX: body.gyroX != null ? Number(body.gyroX) : (latestReading?.gyroX ?? 0),
      gyroY: body.gyroY != null ? Number(body.gyroY) : (latestReading?.gyroY ?? 0),
      gyroZ: body.gyroZ != null ? Number(body.gyroZ) : (latestReading?.gyroZ ?? 0),
      stabilityScore: body.stabilityScore != null ? Math.max(75.0, Number(body.stabilityScore)) : (latestReading?.stabilityScore ?? 100),

      // ── Vị trí cabin trên đường ray (Encoder) ────────────────────────────
      positionCm: body.positionCm != null ? Number(body.positionCm) : (latestReading?.positionCm ?? 0),
      positionPct: body.positionPct != null ? Number(body.positionPct) : (latestReading?.positionPct ?? 0),
      railLengthCm: body.railLengthCm != null ? Number(body.railLengthCm) : (latestReading?.railLengthCm ?? 369.0),
      speedCmPerSec: body.speedCmPerSec != null ? Number(body.speedCmPerSec) : (latestReading?.speedCmPerSec ?? 0),
      encoderPulses: body.encoderPulses != null ? Number(body.encoderPulses) : (latestReading?.encoderPulses ?? 0),
      direction: body.direction != null ? String(body.direction) : (latestReading?.direction ?? 'DUNG'),
      outOfBounds: body.outOfBounds != null ? Boolean(body.outOfBounds) : (latestReading?.outOfBounds ?? false),

      // ── Thời gian ────────────────────────────────────────────────────────
      receivedAt: Date.now(),
    };

    // Đẩy vào ring buffer
    sensorHistory.push(reading);
    if (sensorHistory.length > MAX_HISTORY) {
      sensorHistory.shift();
    }
    latestReading = reading;

    // Broadcast real-time đến tất cả frontend đang kết nối
    io.emit('sensor:cabinData', reading);

    // Cảnh báo nếu cabin vượt biên đường ray
    if (reading.outOfBounds) {
      io.emit('sensor:cabinAlert', {
        type: 'OUT_OF_BOUNDS',
        message: `Cabin vượt biên ray! positionCm=${reading.positionCm}`,
        reading,
        timestamp: reading.receivedAt,
      });
    }

    console.log(
      `[Sensor] T=${reading.temperature}°C H=${reading.humidity}% ` +
      `Stability=${reading.stabilityScore}% | ` +
      `Pos=${reading.positionCm}cm (${reading.positionPct}%) ` +
      `Speed=${reading.speedCmPerSec}cm/s Dir=${reading.direction}` +
      (reading.outOfBounds ? ' ⚠ OUT_OF_BOUNDS' : '')
    );

    return res.status(200).json({ ok: true });
  });

  // ── GET /api/sensors/cabin/latest ──────────────────────────────────────
  router.get('/cabin/latest', (req, res) => {
    if (!latestReading) {
      return res.status(404).json({ message: 'No sensor data received yet.' });
    }
    return res.json(latestReading);
  });

  // ── GET /api/sensors/cabin/history ─────────────────────────────────────
  router.get('/cabin/history', (req, res) => {
    return res.json([...sensorHistory].reverse()); // newest first
  });

  return router;
}
