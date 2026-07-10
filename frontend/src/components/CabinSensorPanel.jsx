import { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Paper,
  Box,
  Typography,
  alpha,
  Chip,
  Tooltip,
} from '@mui/material';
import {
  Thermostat,
  WaterDrop,
  Vibration,
  SignalWifiOff,
  FiberManualRecord,
} from '@mui/icons-material';
import SensorChartDialog from './SensorChartDialog';

// ── Timeout để xác định ESP32 offline ────────────────────────────────────────
const OFFLINE_TIMEOUT_MS = 10_000; // 10 giây không nhận data = offline

// ── Gauge vòng tròn SVG đơn giản ─────────────────────────────────────────────
const CircleGauge = memo(function CircleGauge({ value, max, color, size = 64 }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(Math.max(value / max, 0), 1);
  const dash = pct * circumference;

  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      {/* Track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={5}
      />
      {/* Progress */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  );
});

// ── Thẻ cảm biến môi trường (Nhiệt độ / Độ ẩm) ──────────────────────────────
const EnvSensorCard = memo(function EnvSensorCard({ sensorData, isOnline, onClick }) {
  const temp = sensorData?.temperature;
  const hum  = sensorData?.humidity;

  const tempAlert = temp != null && temp > 35;
  const humAlert  = hum  != null && hum  > 80;
  const hasAlert  = isOnline && (tempAlert || humAlert);

  const tempColor = tempAlert ? '#FF5722' : '#65B5FF';
  const humColor  = humAlert  ? '#FF9800' : '#29B6F6';

  return (
    <Paper
      onClick={isOnline ? onClick : undefined}
      sx={{
        p: 1.25,
        cursor: isOnline ? 'pointer' : 'default',
        borderTop: `2px solid ${hasAlert ? '#FF5722' : '#65B5FF'}`,
        transition: 'all 0.25s ease',
        position: 'relative',
        overflow: 'hidden',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        '&:hover': isOnline ? {
          transform: 'translateY(-2px)',
          boxShadow: `0 10px 24px ${alpha(hasAlert ? '#FF5722' : '#65B5FF', 0.22)}`,
        } : {},
        '&::after': hasAlert ? {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, ${alpha('#FF5722', 0.04)}, transparent)`,
          pointerEvents: 'none',
        } : {},
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Thermostat sx={{ fontSize: 15, color: '#65B5FF' }} />
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            MÔI TRƯỜNG CABIN
          </Typography>
        </Box>
        {!isOnline && (
          <Chip
            icon={<SignalWifiOff sx={{ fontSize: '11px !important' }} />}
            label="OFFLINE"
            size="small"
            sx={{ height: 20, fontSize: '0.58rem', fontWeight: 700, bgcolor: alpha('#666', 0.15), color: '#888' }}
          />
        )}
        {isOnline && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
            <FiberManualRecord sx={{ fontSize: 8, color: '#0BDF50', animation: 'pulse-ring 2s ease-out infinite' }} />
            <Typography sx={{ fontSize: '0.6rem', color: '#0BDF50', fontWeight: 700 }}>LIVE</Typography>
          </Box>
        )}
      </Box>

      {/* Readings */}
      {isOnline && sensorData ? (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          {/* Temperature */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <CircleGauge value={temp ?? 0} max={60} color={tempColor} size={64} />
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <Thermostat sx={{ fontSize: 12, color: tempColor, mb: -0.3 }} />
                <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 800, fontSize: '0.78rem', color: tempColor, lineHeight: 1 }}>
                  {temp != null ? temp.toFixed(1) : '--'}
                </Typography>
              </Box>
            </Box>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', fontWeight: 600 }}>
              °C {tempAlert && <span style={{ color: '#FF5722' }}>⚠</span>}
            </Typography>
          </Box>

          {/* Humidity */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <CircleGauge value={hum ?? 0} max={100} color={humColor} size={64} />
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <WaterDrop sx={{ fontSize: 12, color: humColor, mb: -0.3 }} />
                <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 800, fontSize: '0.78rem', color: humColor, lineHeight: 1 }}>
                  {hum != null ? hum.toFixed(1) : '--'}
                </Typography>
              </Box>
            </Box>
            <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', fontWeight: 600 }}>
              % {humAlert && <span style={{ color: '#FF9800' }}>⚠</span>}
            </Typography>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 64, opacity: 0.35 }}>
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>Chờ dữ liệu ESP32...</Typography>
        </Box>
      )}

      {isOnline && (
        <Typography sx={{ mt: 0.75, fontSize: '0.6rem', color: 'text.secondary', textAlign: 'center', fontStyle: 'italic' }}>
          Nhấn để xem biểu đồ
        </Typography>
      )}
    </Paper>
  );
});

// ── Thẻ giám sát độ rung lắc (MPU6050) ─────────────────────────────────────
const StabilitySensorCard = memo(function StabilitySensorCard({ sensorData, sensorHistory, isOnline, onClick }) {
  const score = sensorData?.stabilityScore ?? null;
  const isUnstable = score != null && score < 80;
  const isCritical = score != null && score < 50;

  const scoreColor = isCritical ? '#FF1744' : isUnstable ? '#FF9800' : '#0BDF50';

  const stabilityPoints = useMemo(() => {
    if (!sensorHistory || sensorHistory.length === 0) return [];
    return sensorHistory.slice(-25).map((r) => r.stabilityScore ?? 100);
  }, [sensorHistory]);

  const chartPaths = useMemo(() => {
    const values = stabilityPoints.length > 0 ? stabilityPoints : [100];
    const min = 0;
    const range = 100;

    const points = values.map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return { x, y };
    });

    if (points.length === 0) return { linePath: '', areaPath: '' };

    let linePath = `M ${points[0].x},${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      // Điểm kiểm soát uốn cong mượt mà theo trục X
      const cx = (p0.x + p1.x) / 2;
      linePath += ` C ${cx},${p0.y} ${cx},${p1.y} ${p1.x},${p1.y}`;
    }

    // Area path khép kín xuống cạnh dưới
    const areaPath = `${linePath} L 100,100 L 0,100 Z`;

    return { linePath, areaPath };
  }, [stabilityPoints]);



  return (
    <Paper
      onClick={isOnline ? onClick : undefined}
      sx={{
        p: 1.25,
        cursor: isOnline ? 'pointer' : 'default',
        borderTop: `2px solid ${isCritical ? '#FF1744' : isUnstable ? '#FF9800' : '#0BDF50'}`,
        transition: 'all 0.25s ease',
        position: 'relative',
        overflow: 'hidden',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        '&:hover': isOnline ? {
          transform: 'translateY(-2px)',
          boxShadow: `0 10px 24px ${alpha(scoreColor, 0.2)}`,
        } : {},
        ...(isCritical ? {
          animation: 'flash-urgent 1.2s ease-in-out infinite',
        } : {}),
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.8 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Vibration sx={{ fontSize: 15, color: scoreColor }} />
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            ĐỘ ỔN ĐỊNH CABIN
          </Typography>
        </Box>
        {!isOnline && (
          <Chip
            icon={<SignalWifiOff sx={{ fontSize: '11px !important' }} />}
            label="OFFLINE"
            size="small"
            sx={{ height: 20, fontSize: '0.58rem', fontWeight: 700, bgcolor: alpha('#666', 0.15), color: '#888' }}
          />
        )}
        {isOnline && isCritical && (
          <Chip label="RUNG MẠNH!" size="small" color="error" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 800 }} />
        )}
        {isOnline && isUnstable && !isCritical && (
          <Chip label="CẢNH BÁO" size="small" color="warning" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />
        )}
      </Box>

      {isOnline && sensorData ? (
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          {/* Stability Score Circle */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <CircleGauge value={score ?? 0} max={100} color={scoreColor} size={64} />
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 900, fontSize: '0.88rem', color: scoreColor, lineHeight: 1 }}>
                  {score != null ? Math.round(score) : '--'}
                </Typography>
                <Typography sx={{ fontSize: '0.5rem', color: scoreColor, fontWeight: 700 }}>%</Typography>
              </Box>
            </Box>
            <Typography sx={{ fontSize: '0.58rem', color: 'text.secondary', fontWeight: 600, textAlign: 'center' }}>
              Stability
            </Typography>
          </Box>

          {/* Sparkline chart */}
          <Box sx={{ flex: 1, height: 64, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Box sx={{ borderRadius: 2, bgcolor: alpha(scoreColor, 0.04), height: '100%', position: 'relative', overflow: 'hidden' }}>
              <svg width="100%" height="100%" viewBox="0 -5 100 110" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
                <defs>
                  <linearGradient id={`chart-gradient-${scoreColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={scoreColor} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={scoreColor} stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <path
                  d={chartPaths.areaPath}
                  fill={`url(#chart-gradient-${scoreColor.replace('#', '')})`}
                />
                <path
                  d={chartPaths.linePath}
                  fill="none"
                  stroke={scoreColor}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={{ filter: `drop-shadow(0px 2px 3px ${alpha(scoreColor, 0.3)})` }}
                />
              </svg>
            </Box>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 64, opacity: 0.35 }}>
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>Chờ dữ liệu MPU6050...</Typography>
        </Box>
      )}

      {isOnline && (
        <Typography sx={{ mt: 0.75, fontSize: '0.6rem', color: 'text.secondary', textAlign: 'center', fontStyle: 'italic' }}>
          Nhấn để xem biểu đồ
        </Typography>
      )}
    </Paper>
  );
});

// ── Main export ───────────────────────────────────────────────────────────────
const CabinSensorPanel = memo(function CabinSensorPanel({ sensorData, sensorHistory }) {
  const [chartOpen, setChartOpen] = useState(false);
  const [chartType, setChartType] = useState('env'); // 'env' | 'stability'
  const lastReceivedRef = useRef(null);
  const [isOnline, setIsOnline] = useState(false);

  // Theo dõi thời gian nhận data gần nhất để xác định online/offline
  useEffect(() => {
    if (sensorData) {
      lastReceivedRef.current = Date.now();
      setIsOnline(true);
    }
  }, [sensorData]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (lastReceivedRef.current && Date.now() - lastReceivedRef.current > OFFLINE_TIMEOUT_MS) {
        setIsOnline(false);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenEnv = useCallback(() => {
    setChartType('env');
    setChartOpen(true);
  }, []);

  const handleOpenStability = useCallback(() => {
    setChartType('stability');
    setChartOpen(true);
  }, []);

  const handleClose = useCallback(() => setChartOpen(false), []);

  return (
    <>
        <EnvSensorCard
          sensorData={sensorData}
          isOnline={isOnline}
          onClick={handleOpenEnv}
        />
        <StabilitySensorCard
          sensorData={sensorData}
          sensorHistory={sensorHistory}
          isOnline={isOnline}
          onClick={handleOpenStability}
        />

      <SensorChartDialog
        open={chartOpen}
        onClose={handleClose}
        type={chartType}
        sensorHistory={sensorHistory}
        latestData={sensorData}
      />
    </>
  );
});

export default CabinSensorPanel;
