import { memo, useId, useMemo, useCallback } from 'react';
import { PRIORITY, ROBOT_STATUS } from '../constants';

// === Helpers to map positionPct (0–100) → (x, y, angle) on the rail polyline ===

function computeSegmentLengths(points) {
  const lengths = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    lengths.push(Math.hypot(dx, dy));
  }
  return lengths;
}

function getPositionOnRail(railPoints, pct) {
  if (!railPoints || railPoints.length < 2) return { x: 0, y: 0, angle: 0 };
  const clampedPct = Math.min(Math.max(pct, 0), 100);

  const segLengths = computeSegmentLengths(railPoints);
  const totalLength = segLengths.reduce((a, b) => a + b, 0);
  const targetDist = (clampedPct / 100) * totalLength;

  let accumulated = 0;
  for (let i = 0; i < segLengths.length; i++) {
    const segLen = segLengths[i];
    if (accumulated + segLen >= targetDist || i === segLengths.length - 1) {
      const t = segLen > 0 ? (targetDist - accumulated) / segLen : 0;
      const p0 = railPoints[i];
      const p1 = railPoints[i + 1] || p0;
      const x = p0.x + t * (p1.x - p0.x);
      const y = p0.y + t * (p1.y - p0.y);
      const angle = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
      return { x, y, angle };
    }
    accumulated += segLen;
  }
  const last = railPoints[railPoints.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
}

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
  if (status === ROBOT_STATUS.MOVING) return '#1976D2';
  if (status === ROBOT_STATUS.ESTOP) return '#ff5252';
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

const StationNode = memo(function StationNode({ station, tx, ty, angle, onClick, sensorActive }) {
  const handleClick = useCallback(() => onClick(station.id), [onClick, station.id]);

  return (
    <g
      transform={`translate(${tx}, ${ty}) rotate(${angle})`}
      style={{ cursor: 'pointer' }}
      onClick={handleClick}
    >
      <rect x={-28} y={-22} width={56} height={44} rx={8} fill="#1f2c34" stroke={sensorActive ? '#4CAF50' : '#607d8b'} strokeWidth={sensorActive ? 3 : 2} />
      <rect x={-24} y={-17} width={48} height={34} rx={6} fill={sensorActive ? '#E8F5E9' : '#E1F5FE'} stroke={sensorActive ? '#4CAF50' : '#0288D1'} strokeWidth={1.5} />
      {/* Status LED: bright green when sensor detects cabin */}
      <circle cx={20} cy={-11} r={3.2} fill={sensorActive ? '#00E676' : '#7cffcb'}>
        {sensorActive
          ? <animate attributeName="opacity" values="1;0.5;1" dur="0.8s" repeatCount="indefinite" />
          : <animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite" />
        }
      </circle>
      {/* Sensor active glow ring */}
      {sensorActive && (
        <circle cx={20} cy={-11} r={6} fill="none" stroke="#00E676" strokeWidth={1.5} opacity={0.6}>
          <animate attributeName="r" values="4;8;4" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.7;0.15;0.7" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
      <text x={0} y={10} fill="#212121" fontSize={14} fontWeight="700" textAnchor="middle">
        {station.id}
      </text>
    </g>
  );
});

const SMOOTH_TRANSITION = 'transform 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)';

const CabinSprite = memo(function CabinSprite({ pose, ledColor, status, moveId, ids, animating, useTransition }) {
  const blinkDur = status === ROBOT_STATUS.MOVING ? '0.6s' : '1.4s';

  return (
    <>
      {/* Motion trail */}
      {animating && (
        <g
          style={{
            transform: `translate(${pose.x}px, ${pose.y}px) rotate(${pose.angle}deg)`,
            ...(useTransition ? { transition: SMOOTH_TRANSITION } : {}),
          }}
          opacity="0.45"
        >
          <path d="M -86 0 L -42 -8 L -42 8 Z" fill="#80deea" filter={`url(#${ids.softBlur})`} />
          <path d="M -106 0 L -58 -11 L -58 11 Z" fill="#26c6da" filter={`url(#${ids.softBlur})`} />
        </g>
      )}

      {/* Cabin body — smooth glide via CSS transition */}
      <g
        key={`cabin-${moveId}`}
        style={{
          transform: `translate(${pose.x}px, ${pose.y}px) rotate(${pose.angle}deg)`,
          ...(useTransition ? { transition: SMOOTH_TRANSITION } : {}),
        }}
      >
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

// === Encoder position overlay (shown inside SVG) ===

const BAR_TRANSITION = 'all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)';

const EncoderOverlay = memo(function EncoderOverlay({ encoderData }) {
  if (!encoderData) return null;
  const { positionCm, positionPct, speedCmPerSec, direction, railLengthCm, outOfBounds } = encoderData;

  const dirArrow = direction === 'TIEN' ? '→' : direction === 'LUI' ? '←' : '●';
  const dirColor = direction === 'TIEN' ? '#00e5ff' : direction === 'LUI' ? '#ffa726' : '#66ff99';
  const pct = Math.min(Math.max(Number(positionPct) || 0, 0), 100);
  const barWidth = 1560; // SVG units (viewBox 1600, with 20px margin each side)
  const filledWidth = (pct / 100) * barWidth;

  return (
    <g>
      {/* Position progress bar at bottom — smooth transition */}
      <rect x={20} y={388} width={barWidth} height={10} rx={5} fill="rgba(255,255,255,0.08)" />
      <rect x={20} y={388} width={Math.max(filledWidth, 0)} height={10} rx={5}
        fill={outOfBounds ? '#ff5252' : '#00e5ff'} opacity={0.85}
        style={{ transition: BAR_TRANSITION }} />
      {/* Cabin position marker on bar — smooth glide */}
      <circle cx={20 + filledWidth} cy={393} r={7} fill={outOfBounds ? '#ff5252' : '#00e5ff'}
        stroke="white" strokeWidth={2}
        style={{ transition: BAR_TRANSITION }} />

      {/* Info strip bottom-right */}
      <rect x={1300} y={340} width={280} height={44} rx={8} fill="rgba(0,0,0,0.55)" />
      <text x={1315} y={358} fill="#b0bec5" fontSize={11} fontFamily="monospace">VỊ TRÍ ENCODER</text>
      <text x={1315} y={376} fill="white" fontSize={13} fontWeight="bold" fontFamily="monospace">
        {`${Number(positionCm).toFixed(1)} cm`}
      </text>
      <text x={1430} y={376} fill={dirColor} fontSize={13} fontWeight="bold" fontFamily="monospace">
        {`${dirArrow} ${Math.abs(Number(speedCmPerSec)).toFixed(1)} cm/s`}
      </text>

      {/* Station labels on bar */}
      <text x={20} y={408} fill="#78909c" fontSize={9} fontFamily="monospace">ST-01</text>
      <text x={1555} y={408} fill="#78909c" fontSize={9} fontFamily="monospace" textAnchor="end">ST-04</text>
      <text x={20 + barWidth / 2} y={408} fill="#78909c" fontSize={9} fontFamily="monospace" textAnchor="middle">
        {`${Number(railLengthCm / 2).toFixed(0)} cm`}
      </text>

      {/* Out of bounds warning */}
      {outOfBounds && (
        <text x={800} y={370} fill="#ff5252" fontSize={14} fontWeight="bold" fontFamily="monospace" textAnchor="middle">
          ⚠ VƯỢT BIÊN RAY
        </text>
      )}
    </g>
  );
});

// === Main component ===

const ScadaSVGMap = memo(function ScadaSVGMap({ scada, encoderData }) {
  const { robotState, stations, railPoints, animating, animPos, moveId, callRobot, plcState } = scada;
  const stationSensors = plcState?.stationSensors || {};
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

  // If encoder data is available, override pose with real hardware position
  const encoderPose = useMemo(() => {
    if (!encoderData || typeof encoderData.positionPct !== 'number') return null;
    return getPositionOnRail(railPoints, encoderData.positionPct);
  }, [encoderData, railPoints]);

  const robotIdleAngle = useMemo(
    () => getTrackAngle(railPoints, robotState.index),
    [railPoints, robotState.index]
  );

  const ledColor = useMemo(() => getStatusLedColor(robotState.status), [robotState.status]);

  // Priority: encoderData (real hardware) > animation > idle position
  const cabinPose = encoderPose
    ? encoderPose
    : animating
      ? { x: animPos.x, y: animPos.y, angle: animPos.angle }
      : { x: robotState.x, y: robotState.y, angle: robotIdleAngle };

  return (
    <svg
      width="100%"
      viewBox="0 0 1600 420"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', width: '100%', height: 'clamp(260px, 26vw, 320px)' }}
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
          sensorActive={Boolean(stationSensors[s.id])}
        />
      ))}

      <CabinSprite
        pose={cabinPose}
        ledColor={ledColor}
        status={robotState.status}
        moveId={moveId}
        ids={ids}
        animating={animating && !encoderPose}
        useTransition={!!encoderPose}
      />

      {/* Encoder real-time position overlay */}
      <EncoderOverlay encoderData={encoderData} />

      {/* Debug: encoder data connection status */}
      <g>
        <rect x={20} y={10} width={encoderData ? 220 : 160} height={24} rx={6}
          fill={encoderData ? 'rgba(0,200,83,0.85)' : 'rgba(255,50,50,0.75)'} />
        <text x={30} y={27} fill="white" fontSize={11} fontWeight="bold" fontFamily="monospace">
          {encoderData
            ? `✓ ENCODER: ${Number(encoderData.positionPct).toFixed(1)}% | ${Number(encoderData.positionCm).toFixed(0)}cm`
            : '✗ NO ENCODER DATA'}
        </text>
      </g>
    </svg>
  );
});

export default ScadaSVGMap;
