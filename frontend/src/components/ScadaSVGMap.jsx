import { memo, useId, useMemo, useCallback } from 'react';
import { PRIORITY } from '../constants';

// === Geometry helpers ===

function getTrackAngle(railPoints, index) {
  const point = railPoints[index];
  const nextPoint = railPoints[index + 1] || railPoints[index - 1] || point;
  return (Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x) * 180) / Math.PI;
}

function normalize(x, y) {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function buildOffsetPoints(points, offset) {
  if (!points || points.length === 0) return [];
  return points.map((point, index) => {
    const prev = points[index - 1] || point;
    const next = points[index + 1] || point;
    const tangent = normalize(next.x - prev.x, next.y - prev.y);
    return {
      x: point.x + -tangent.y * offset,
      y: point.y + tangent.x * offset,
    };
  });
}

function pointsToPolyline(points) {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function getStatusLedColor(status) {
  if (status === 'Đang di chuyển') return '#1976D2';
  if (status === 'Dừng khẩn cấp') return '#ff5252';
  return '#66ff99';
}

// === Sub-components ===

const RailDefs = memo(function RailDefs({ ids }) {
  return (
    <defs>
      <pattern id={ids.grid} width="60" height="60" patternUnits="userSpaceOnUse">
        <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
      </pattern>

      <linearGradient id={ids.bedGradient} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#455a64" />
        <stop offset="100%" stopColor="#263238" />
      </linearGradient>

      <linearGradient id={ids.steelGradient} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#d7dee3" />
        <stop offset="45%" stopColor="#9aa7b1" />
        <stop offset="100%" stopColor="#6c7a84" />
      </linearGradient>

      <linearGradient id={ids.grooveGradient} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#1f2a31" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#0f171c" stopOpacity="0.9" />
      </linearGradient>

      <linearGradient id={ids.tubeGradient} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#4fc3f7" stopOpacity="0.1" />
        <stop offset="50%" stopColor="#4dd0e1" stopOpacity="0.45" />
        <stop offset="100%" stopColor="#80deea" stopOpacity="0.15" />
      </linearGradient>

      <linearGradient id={ids.magneticGradient} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.05" />
        <stop offset="50%" stopColor="#00e5ff" stopOpacity="0.8" />
        <stop offset="100%" stopColor="#00e5ff" stopOpacity="0.05" />
      </linearGradient>

      <linearGradient id={ids.cabinBodyGradient} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f5f8fb" />
        <stop offset="55%" stopColor="#d9e4ee" />
        <stop offset="100%" stopColor="#b7c8d7" />
      </linearGradient>

      <linearGradient id={ids.cabinGlassGradient} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#e1f5fe" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#81d4fa" stopOpacity="0.4" />
      </linearGradient>

      <linearGradient id={ids.cabinAccentGradient} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#26c6da" />
        <stop offset="100%" stopColor="#00acc1" />
      </linearGradient>

      <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
        <feMerge>
          <feMergeNode in="coloredBlur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <filter id={ids.softBlur} x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="4" />
      </filter>

      <filter id={ids.dropShadow} x="-40%" y="-40%" width="220%" height="220%">
        <feDropShadow dx="0" dy="6" stdDeviation="4" floodColor="#000" floodOpacity="0.35" />
      </filter>
    </defs>
  );
});

const RailTrack = memo(function RailTrack({ railGeometry, ids }) {
  return (
    <>
      {/* Background grid */}
      <rect width="100%" height="100%" fill={`url(#${ids.grid})`} opacity="0.36" />

      {/* Shadow */}
      <polyline
        points={railGeometry.centerline}
        transform="translate(14,12)"
        stroke="rgba(0,0,0,0.38)"
        strokeWidth="38"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Bed */}
      <polyline
        points={railGeometry.centerline}
        stroke={`url(#${ids.bedGradient})`}
        strokeWidth="34"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Service tube */}
      <polyline
        points={railGeometry.serviceTube}
        stroke={`url(#${ids.tubeGradient})`}
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        filter={`url(#${ids.softBlur})`}
      />

      {/* Rails */}
      <polyline points={railGeometry.leftRail} stroke={`url(#${ids.steelGradient})`} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <polyline points={railGeometry.rightRail} stroke={`url(#${ids.steelGradient})`} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* Grooves */}
      <polyline points={railGeometry.leftRail} stroke={`url(#${ids.grooveGradient})`} strokeWidth="2.8" strokeLinecap="round" fill="none" />
      <polyline points={railGeometry.rightRail} stroke={`url(#${ids.grooveGradient})`} strokeWidth="2.8" strokeLinecap="round" fill="none" />

      {/* Magnetic guide */}
      <polyline
        points={railGeometry.centerGroove}
        stroke={`url(#${ids.magneticGradient})`}
        strokeWidth="3.5"
        strokeDasharray="8 18"
        strokeLinecap="round"
        fill="none"
        filter={`url(#${ids.glow})`}
      >
        <animate attributeName="stroke-dashoffset" from="0" to="-220" dur="3.8s" repeatCount="indefinite" />
      </polyline>

      {/* Center highlight */}
      <polyline
        points={railGeometry.centerGroove}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth="1"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
    </>
  );
});

const StationNode = memo(function StationNode({ station, tx, ty, angle, onClick }) {
  const handleClick = useCallback(() => onClick(station.id), [onClick, station.id]);

  return (
    <g
      transform={`translate(${tx}, ${ty}) rotate(${angle})`}
      style={{ cursor: 'pointer' }}
      onClick={handleClick}
    >
      <rect x={-28} y={-22} width={56} height={44} rx={8} fill="#1f2c34" stroke="#607d8b" strokeWidth={2} />
      <rect x={-24} y={-17} width={48} height={34} rx={6} fill="#E1F5FE" stroke="#0288D1" strokeWidth={1.5} />
      <circle cx={20} cy={-11} r={3.2} fill="#7cffcb">
        <animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite" />
      </circle>
      <text x={0} y={10} fill="#212121" fontSize={14} fontWeight="700" textAnchor="middle">
        {station.id}
      </text>
    </g>
  );
});

const CabinSprite = memo(function CabinSprite({ pose, ledColor, status, moveId, ids, animating }) {
  const blinkDur = status === 'Đang di chuyển' ? '0.6s' : '1.4s';

  return (
    <>
      {/* Motion trail */}
      {animating && (
        <g transform={`translate(${pose.x}, ${pose.y}) rotate(${pose.angle})`} opacity="0.45">
          <path d="M -86 0 L -42 -8 L -42 8 Z" fill="#80deea" filter={`url(#${ids.softBlur})`} />
          <path d="M -106 0 L -58 -11 L -58 11 Z" fill="#26c6da" filter={`url(#${ids.softBlur})`} />
        </g>
      )}

      {/* Cabin body */}
      <g key={`cabin-${moveId}`} transform={`translate(${pose.x}, ${pose.y}) rotate(${pose.angle})`}>
        {/* Shadow */}
        <ellipse cx="10" cy="32" rx="48" ry="10" fill="rgba(0,0,0,0.35)" filter={`url(#${ids.softBlur})`} />

        <g filter={`url(#${ids.dropShadow})`}>
          {/* Body */}
          <rect x={-44} y={-22} width={108} height={54} rx={26} fill={`url(#${ids.cabinBodyGradient})`} stroke="#6b8799" strokeWidth="1.8" />

          {/* Glass */}
          <rect x={-35} y={-14} width={80} height={22} rx={10} fill={`url(#${ids.cabinGlassGradient})`} stroke="rgba(255,255,255,0.7)" strokeWidth="1.1" />

          {/* Accent strip */}
          <path d="M -34 16 H 44" stroke={`url(#${ids.cabinAccentGradient})`} strokeWidth="4" strokeLinecap="round" />

          {/* Display panel */}
          <rect x={-8} y={-2} width={26} height={20} rx={6} fill="#263238" opacity="0.85" />
          <path d="M -1 8 h12" stroke="#b2ebf2" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M 5 2 v12" stroke="#b2ebf2" strokeWidth="2.2" strokeLinecap="round" />

          {/* Status LED */}
          <circle cx="-30" cy="-6" r="4.8" fill={ledColor} filter={`url(#${ids.glow})`}>
            <animate attributeName="opacity" values="1;0.3;1" dur={blinkDur} repeatCount="indefinite" />
          </circle>

          {/* Detail circles */}
          <circle cx="-17" cy="-6" r="3.5" fill="#90a4ae" />
          <circle cx="56" cy="5" r="4" fill="#455a64" />
        </g>

        {/* Label */}
        <text x="10" y="10" fill="#102027" fontSize="12" fontWeight="700" textAnchor="middle">
          CABIN-01
        </text>
      </g>
    </>
  );
});

// === Main component ===

const ScadaSVGMap = memo(function ScadaSVGMap({ scada }) {
  const { robotState, stations, railPoints, animating, animPos, moveId, callRobot } = scada;
  const rawId = useId();

  const idPrefix = useMemo(() => rawId.replace(/:/g, ''), [rawId]);

  const ids = useMemo(
    () => ({
      grid: `${idPrefix}-grid`,
      bedGradient: `${idPrefix}-bed-gradient`,
      steelGradient: `${idPrefix}-steel-gradient`,
      grooveGradient: `${idPrefix}-groove-gradient`,
      tubeGradient: `${idPrefix}-tube-gradient`,
      magneticGradient: `${idPrefix}-magnetic-gradient`,
      cabinBodyGradient: `${idPrefix}-cabin-body-gradient`,
      cabinGlassGradient: `${idPrefix}-cabin-glass-gradient`,
      cabinAccentGradient: `${idPrefix}-cabin-accent-gradient`,
      glow: `${idPrefix}-glow`,
      softBlur: `${idPrefix}-soft-blur`,
      dropShadow: `${idPrefix}-drop-shadow`,
    }),
    [idPrefix]
  );

  const railGeometry = useMemo(() => {
    const leftRail = buildOffsetPoints(railPoints, -11);
    const rightRail = buildOffsetPoints(railPoints, 11);
    const centerGroove = buildOffsetPoints(railPoints, 0);
    const serviceTube = buildOffsetPoints(railPoints, 24);
    return {
      centerline: pointsToPolyline(railPoints),
      leftRail: pointsToPolyline(leftRail),
      rightRail: pointsToPolyline(rightRail),
      centerGroove: pointsToPolyline(centerGroove),
      serviceTube: pointsToPolyline(serviceTube),
    };
  }, [railPoints]);

  const stationTransforms = useMemo(
    () =>
      stations.map((station) => {
        const point = railPoints[station.idx];
        const angle = getTrackAngle(railPoints, station.idx);
        const rad = (angle * Math.PI) / 180;
        const offsetDistance = -56;
        return {
          id: station.id,
          station,
          angle,
          tx: point.x + -Math.sin(rad) * offsetDistance,
          ty: point.y + Math.cos(rad) * offsetDistance,
        };
      }),
    [stations, railPoints]
  );

  const robotIdleAngle = useMemo(
    () => getTrackAngle(railPoints, robotState.index),
    [railPoints, robotState.index]
  );

  const ledColor = useMemo(() => getStatusLedColor(robotState.status), [robotState.status]);

  const cabinPose = animating
    ? { x: animPos.x, y: animPos.y, angle: animPos.angle }
    : { x: robotState.x, y: robotState.y, angle: robotIdleAngle };

  return (
    <svg
      width="100%"
      viewBox="0 0 1600 420"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', width: '100%', height: 'clamp(250px, 25vw, 300px)' }}
    >
      <RailDefs ids={ids} />
      <RailTrack railGeometry={railGeometry} ids={ids} />

      {stationTransforms.map((s) => (
        <StationNode
          key={s.id}
          station={s.station}
          tx={s.tx}
          ty={s.ty}
          angle={s.angle}
          onClick={callRobot}
        />
      ))}

      <CabinSprite
        pose={cabinPose}
        ledColor={ledColor}
        status={robotState.status}
        moveId={moveId}
        ids={ids}
        animating={animating}
      />
    </svg>
  );
});

export default ScadaSVGMap;