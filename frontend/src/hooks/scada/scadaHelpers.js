import { ROBOT_STATUS } from '../../constants';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function buildOrderedPoints(railPoints, fromIdx, toIdx) {
  const pts = [];
  if (fromIdx <= toIdx) {
    for (let i = fromIdx; i <= toIdx; i += 1) pts.push(railPoints[i]);
  } else {
    for (let i = fromIdx; i >= toIdx; i -= 1) pts.push(railPoints[i]);
  }
  return pts;
}

export function cr2BezierSegments(points) {
  const segments = [];
  if (!points || points.length < 2) return segments;

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    segments.push({
      p0: { x: p1.x, y: p1.y },
      p1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      p2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p3: { x: p2.x, y: p2.y },
    });
  }
  return segments;
}

export function sampleBezierPoints(segments, samplesPerSeg = 32) {
  const pts = [];
  for (const segment of segments) {
    for (let j = 0; j <= samplesPerSeg; j += 1) {
      const t = j / samplesPerSeg;
      const u = 1 - t;
      pts.push({
        x: u * u * u * segment.p0.x + 3 * u * u * t * segment.p1.x + 3 * u * t * t * segment.p2.x + t * t * t * segment.p3.x,
        y: u * u * u * segment.p0.y + 3 * u * u * t * segment.p1.y + 3 * u * t * t * segment.p2.y + t * t * t * segment.p3.y,
      });
    }
  }
  return pts;
}

export function computeCumulative(points) {
  if (!points || points.length < 2) {
    return { points: points || [], cumulativeLengths: [0], total: 0 };
  }
  const cumulativeLengths = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    cumulativeLengths.push(total);
  }
  return { points, cumulativeLengths, total };
}

export function computePolylineLength(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

export function getFinalAngle(points) {
  if (!points || points.length < 2) return 0;
  const from = points[points.length - 2];
  const to = points[points.length - 1];
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function parseMaintenanceEvent(eventText) {
  const text = String(eventText || '').trim();
  if (!text.startsWith('[MAINTENANCE]')) return null;

  const enabled = text.includes('ENABLED');
  const disabled = text.includes('DISABLED');
  if (!enabled && !disabled) return null;

  const reasonMatch = text.match(/\breason=(.+)$/i);
  return {
    enabled,
    reason: enabled ? (reasonMatch?.[1] || '').trim() : '',
  };
}

export function parseRobotStateEvent(eventText) {
  const text = String(eventText || '').trim();
  if (!text.startsWith('[ROBOT_STATE]')) return null;

  const payload = text.slice('[ROBOT_STATE]'.length).trim();
  const parts = payload.split(/\s+/);
  const values = {};

  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) values[key] = value;
  }

  const statusCode = (values.status || '').toUpperCase();
  const STATUS_MAP = {
    READY: ROBOT_STATUS.READY,
    MOVING: ROBOT_STATUS.MOVING,
    ESTOP: ROBOT_STATUS.ESTOP,
    MAINTENANCE: ROBOT_STATUS.MAINTENANCE,
  };
  const status = STATUS_MAP[statusCode] || null;

  const index = Number.parseInt(values.index, 10);
  const x = Number.parseFloat(values.x);
  const y = Number.parseFloat(values.y);

  return {
    status,
    index: Number.isNaN(index) ? null : index,
    x: Number.isNaN(x) ? null : x,
    y: Number.isNaN(y) ? null : y,
    targetId: values.target || null,
  };
}
