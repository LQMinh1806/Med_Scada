import { memo, useMemo, useRef, useLayoutEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  alpha,
  Chip,
  Grid,
} from '@mui/material';
import {
  Close,
  Thermostat,
  WaterDrop,
  Vibration,
  TrendingDown,
  TrendingUp,
  Remove,
} from '@mui/icons-material';

// ── Moving average utility ────────────────────────────────────────────────────
function movingAvg(arr, w = 5) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - w + 1), i + 1).filter((v) => v != null);
    if (slice.length === 0) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

// ── SVG Line Chart component ─────────────────────────────────────────────────
//
// Dataset shape:
//   { data, color, strokeWidth?, opacity?, showDots?, dotOpacity?, fillOpacity? }
//
// Recommended pairing (matches latency benchmark chart style):
//   Raw line : strokeWidth=1.2, opacity=0.5, showDots=true,  fillOpacity=0.12
//   MA line  : strokeWidth=2.8, opacity=1,   showDots=false, fillOpacity=0
//
const LineChart = memo(function LineChart({ datasets, height = 160, showGrid = true }) {
  // Track real container width so we can compensate for SVG viewBox distortion
  // when rendering dot ellipses (a <circle> in preserveAspectRatio="none" SVG
  // gets stretched; we use <ellipse> with corrected rx/ry instead).
  const containerRef   = useRef(null);
  const [containerWidth, setContainerWidth] = useState(400);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width || 400);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const allValues = datasets.flatMap((ds) => ds.data.filter((v) => v != null));
  if (allValues.length === 0) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height, opacity: 0.4 }}>
        <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>Chưa có dữ liệu</Typography>
      </Box>
    );
  }

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const range  = Math.max(rawMax - rawMin, 0.1);
  const padV   = range * 0.12;
  const yMin   = rawMin - padV;
  const yMax   = rawMax + padV;
  const yRange = yMax - yMin;

  const maxLen = Math.max(...datasets.map((ds) => ds.data.length), 1);

  const toX = (i) => (maxLen === 1 ? 50 : (i / (maxLen - 1)) * 100);
  const toY = (v) => 100 - ((v - yMin) / yRange) * 100;

  const makePath = (data) => {
    const pts = data
      .map((v, i) => (v != null ? `${toX(i)},${toY(v)}` : null))
      .filter(Boolean);
    return pts.length >= 2 ? `M ${pts.join(' L ')}` : '';
  };

  const gridLines = [0, 25, 50, 75, 100].map((pct) => ({
    pct,
    value: yMin + (yRange * pct) / 100,
  }));

  // Target screen-space dot radius (px); compensate for viewBox stretch.
  const SCREEN_DOT_R = 2.5;
  const dotRx = (SCREEN_DOT_R * 100) / Math.max(containerWidth, 1);
  const dotRy = (SCREEN_DOT_R * 100) / Math.max(height, 1);

  return (
    <Box ref={containerRef} sx={{ position: 'relative', width: '100%', height }}>
      <svg
        width="100%"
        height={height}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* Grid lines */}
        {showGrid && gridLines.slice(1, -1).map(({ pct }) => (
          <line
            key={pct}
            x1={0} y1={pct} x2={100} y2={pct}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={0.5}
          />
        ))}

        {/* Area fills — only rendered when fillOpacity > 0 */}
        {datasets.map((ds, di) => {
          const fo = ds.fillOpacity ?? (di === 0 ? 0.08 : 0);
          if (fo <= 0) return null;
          const pts = ds.data.map((v, i) => (v != null ? `${toX(i)},${toY(v)}` : null)).filter(Boolean);
          if (pts.length < 2) return null;
          const areaPath = `M ${pts[0]} L ${pts.join(' L ')} L ${toX(ds.data.length - 1)},100 L ${toX(0)},100 Z`;
          return (
            <path
              key={`area-${di}`}
              d={areaPath}
              fill={ds.color}
              fillOpacity={fo}
            />
          );
        })}

        {/* Lines */}
        {datasets.map((ds, di) => {
          const path = makePath(ds.data);
          if (!path) return null;
          return (
            <path
              key={`line-${di}`}
              d={path}
              fill="none"
              stroke={ds.color}
              strokeWidth={ds.strokeWidth ?? 1.8}
              strokeOpacity={ds.opacity ?? 1}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {/* Per-point dots (ellipses compensate for viewBox aspect-ratio stretch) */}
        {datasets.map((ds, di) =>
          ds.showDots
            ? ds.data.map((v, i) =>
                v != null ? (
                  <ellipse
                    key={`dot-${di}-${i}`}
                    cx={toX(i)}
                    cy={toY(v)}
                    rx={dotRx}
                    ry={dotRy}
                    fill={ds.color}
                    fillOpacity={ds.dotOpacity ?? 0.65}
                  />
                ) : null
              )
            : null
        )}

        {/* Terminator dot on last point of non-showDots datasets (e.g. MA line) */}
        {datasets.map((ds, di) => {
          if (ds.showDots) return null;
          const last = ds.data.findLastIndex((v) => v != null);
          if (last < 0) return null;
          return (
            <ellipse
              key={`last-${di}`}
              cx={toX(last)}
              cy={toY(ds.data[last])}
              rx={dotRx}
              ry={dotRy}
              fill={ds.color}
            />
          );
        })}
      </svg>

      {/* Y-axis labels */}
      {showGrid && (
        <Box sx={{ position: 'absolute', right: 0, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', pointerEvents: 'none' }}>
          {[yMax, (yMax + yMin) / 2, yMin].map((v, i) => (
            <Typography key={i} sx={{ fontSize: '0.52rem', color: 'text.disabled', lineHeight: 1, fontFamily: '"JetBrains Mono", monospace' }}>
              {v.toFixed(1)}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
});

const TrendIcon = memo(function TrendIcon({ trend }) {
  if (Math.abs(trend) < 0.1) return <Remove sx={{ fontSize: 14, color: '#888' }} />;
  return trend > 0
    ? <TrendingUp sx={{ fontSize: 14, color: '#FF5722' }} />
    : <TrendingDown sx={{ fontSize: 14, color: '#0BDF50' }} />;
});

// ── Stat item ────────────────────────────────────────────────────────────────
const StatBox = ({ label, value, unit, color, icon: Icon }) => (
  <Box sx={{ p: 1, borderRadius: 2, bgcolor: alpha(color, 0.1), border: `1px solid ${alpha(color, 0.2)}` }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
      {Icon && <Icon sx={{ fontSize: 13, color }} />}
      <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
    </Box>
    <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 800, fontSize: '1.05rem', color, lineHeight: 1 }}>
      {value ?? '--'}
      {unit && <span style={{ fontSize: '0.68rem', fontWeight: 600, marginLeft: 2, opacity: 0.8 }}>{unit}</span>}
    </Typography>
  </Box>
);

// ── Main Dialog ───────────────────────────────────────────────────────────────
const SensorChartDialog = memo(function SensorChartDialog({
  open, onClose, type, sensorHistory, latestData,
}) {
  const isEnv = type === 'env';

  // Extract time-series arrays from history
  const history = useMemo(() => {
    if (!Array.isArray(sensorHistory) || sensorHistory.length === 0) return [];
    return sensorHistory;
  }, [sensorHistory]);

  const envChartData = useMemo(() => {
    const temp = history.map((d) => d.temperature);
    const hum  = history.map((d) => d.humidity);
    return { temp, hum, tempMA: movingAvg(temp, 5), humMA: movingAvg(hum, 5) };
  }, [history]);

  const stabilityChartData = useMemo(() => {
    const score = history.map((d) => d.stabilityScore);
    const ax    = history.map((d) => d.accelX);
    const ay    = history.map((d) => d.accelY);
    const az    = history.map((d) => d.accelZ);
    return {
      score, scoreMA: movingAvg(score, 5),
      ax,    axMA:    movingAvg(ax, 5),
      ay,    ayMA:    movingAvg(ay, 5),
      az,    azMA:    movingAvg(az, 5),
    };
  }, [history]);

  // Stats: min/max/avg
  const computeStats = (arr) => {
    const valid = arr.filter((v) => v != null);
    if (valid.length === 0) return { min: null, max: null, avg: null, trend: 0 };
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
    const trend = valid.length >= 2 ? valid[valid.length - 1] - valid[0] : 0;
    return { min: min.toFixed(1), max: max.toFixed(1), avg: avg.toFixed(1), trend };
  };

  const tempStats   = useMemo(() => computeStats(envChartData.temp),  [envChartData.temp]);
  const humStats    = useMemo(() => computeStats(envChartData.hum),   [envChartData.hum]);
  const scoreStats  = useMemo(() => computeStats(stabilityChartData.score), [stabilityChartData.score]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          borderTop: `3px solid ${isEnv ? '#65B5FF' : '#0BDF50'}`,
          borderRadius: 2,
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {isEnv
            ? <Thermostat sx={{ color: '#65B5FF', fontSize: 20 }} />
            : <Vibration sx={{ color: '#0BDF50', fontSize: 20 }} />
          }
          <Box>
            <Typography variant="subtitle1" fontWeight={800} sx={{ lineHeight: 1.2 }}>
              {isEnv ? 'BIỂU ĐỒ NHIỆT ĐỘ & ĐỘ ẨM' : 'BIỂU ĐỒ ĐỘ ỔN ĐỊNH CABIN'}
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
              {history.length} điểm dữ liệu — {Math.round(history.length * 2 / 60)} phút gần nhất
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {latestData && (
            <Chip
              size="small"
              label={`ESP32: ${latestData.deviceId || 'SENSOR-01'}`}
              sx={{ fontSize: '0.65rem', bgcolor: alpha('#0BDF50', 0.12), color: '#0BDF50', fontWeight: 700, border: '1px solid ' + alpha('#0BDF50', 0.2) }}
            />
          )}
          <IconButton onClick={onClose} size="small">
            <Close sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ pt: 0 }}>
        {isEnv ? (
          /* ── Environment charts ─────────────────────────────────────────── */
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Stats row */}
            <Grid container spacing={1}>
              <Grid item xs={6} sm={3}>
                <StatBox label="Nhiệt độ hiện tại" value={latestData?.temperature?.toFixed(1)} unit="°C" color="#65B5FF" icon={Thermostat} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <StatBox label="Cao nhất" value={tempStats.max} unit="°C" color="#FF5722" />
              </Grid>
              <Grid item xs={6} sm={3}>
                <StatBox label="Trung bình" value={tempStats.avg} unit="°C" color="#1976D2" />
              </Grid>
              <Grid item xs={6} sm={3}>
                <StatBox label="Độ ẩm hiện tại" value={latestData?.humidity?.toFixed(1)} unit="%" color="#29B6F6" icon={WaterDrop} />
              </Grid>
            </Grid>

            {/* Temperature chart */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#65B5FF' }} />
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Nhiệt độ (°C)
                </Typography>
                <TrendIcon trend={tempStats.trend} />
                {tempStats.trend !== 0 && (
                  <Typography sx={{ fontSize: '0.65rem', color: tempStats.trend > 0 ? '#FF5722' : '#0BDF50', fontWeight: 600 }}>
                    {tempStats.trend > 0 ? '+' : ''}{Number(tempStats.trend).toFixed(1)}°C
                  </Typography>
                )}
                {latestData?.temperature > 35 && (
                  <Chip label="CẢNH BÁO > 35°C" size="small" color="error" sx={{ height: 18, fontSize: '0.58rem', fontWeight: 700, ml: 'auto' }} />
                )}
              </Box>
              <Box sx={{ bgcolor: alpha('#65B5FF', 0.05), borderRadius: 2, p: 1.25, border: `1px solid ${alpha('#65B5FF', 0.12)}` }}>
                <LineChart
                  datasets={[
                    { data: envChartData.temp,   color: '#65B5FF', strokeWidth: 1.2, opacity: 0.5, showDots: true,  dotOpacity: 0.55, fillOpacity: 0.12 },
                    { data: envChartData.tempMA, color: '#65B5FF', strokeWidth: 2.8, opacity: 1,   showDots: false, fillOpacity: 0 },
                  ]}
                  height={140}
                />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.4 }}>
                <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>{history.length * 2}s trước</Typography>
                <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>Hiện tại</Typography>
              </Box>
            </Box>

            {/* Humidity chart */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#29B6F6' }} />
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Độ ẩm (%)
                </Typography>
                <TrendIcon trend={humStats.trend} />
                {humStats.trend !== 0 && (
                  <Typography sx={{ fontSize: '0.65rem', color: humStats.trend > 0 ? '#FF9800' : '#0BDF50', fontWeight: 600 }}>
                    {humStats.trend > 0 ? '+' : ''}{Number(humStats.trend).toFixed(1)}%
                  </Typography>
                )}
                {latestData?.humidity > 80 && (
                  <Chip label="CẢNH BÁO > 80%" size="small" color="warning" sx={{ height: 18, fontSize: '0.58rem', fontWeight: 700, ml: 'auto' }} />
                )}
              </Box>
              <Box sx={{ bgcolor: alpha('#29B6F6', 0.05), borderRadius: 2, p: 1.25, border: `1px solid ${alpha('#29B6F6', 0.12)}` }}>
                <LineChart
                  datasets={[
                    { data: envChartData.hum,   color: '#29B6F6', strokeWidth: 1.2, opacity: 0.5, showDots: true,  dotOpacity: 0.55, fillOpacity: 0.12 },
                    { data: envChartData.humMA, color: '#29B6F6', strokeWidth: 2.8, opacity: 1,   showDots: false, fillOpacity: 0 },
                  ]}
                  height={120}
                />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.4 }}>
                <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>{history.length * 2}s trước</Typography>
                <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>Hiện tại</Typography>
              </Box>
            </Box>
          </Box>
        ) : (
          /* ── Stability charts ───────────────────────────────────────────── */
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Stats row */}
            <Grid container spacing={1}>
              <Grid item xs={6} sm={3}>
                <StatBox label="Stability Score" value={latestData?.stabilityScore?.toFixed(1)} unit="%" color="#0BDF50" icon={Vibration} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <StatBox label="Thấp nhất" value={scoreStats.min} unit="%" color="#FF5722" />
              </Grid>
              <Grid item xs={6} sm={3}>
                <StatBox label="Trung bình" value={scoreStats.avg} unit="%" color="#65B5FF" />
              </Grid>
              <Grid item xs={6} sm={3}>
                <StatBox label="Cao nhất" value={scoreStats.max} unit="%" color="#0BDF50" />
              </Grid>
            </Grid>

            {/* Stability score chart */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#0BDF50' }} />
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Điểm ổn định (%)
                </Typography>
                {latestData?.stabilityScore < 80 && (
                  <Chip label="RUN LẮC" size="small" color={latestData?.stabilityScore < 50 ? 'error' : 'warning'} sx={{ height: 18, fontSize: '0.58rem', fontWeight: 700, ml: 'auto' }} />
                )}
              </Box>
              <Box sx={{ bgcolor: alpha('#0BDF50', 0.05), borderRadius: 2, p: 1.25, border: `1px solid ${alpha('#0BDF50', 0.12)}` }}>
                <LineChart
                  datasets={[
                    { data: stabilityChartData.score,   color: '#0BDF50', strokeWidth: 1.2, opacity: 0.5, showDots: true,  dotOpacity: 0.55, fillOpacity: 0.12 },
                    { data: stabilityChartData.scoreMA, color: '#0BDF50', strokeWidth: 2.8, opacity: 1,   showDots: false, fillOpacity: 0 },
                  ]}
                  height={140}
                />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.4 }}>
                <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>{history.length * 2}s trước</Typography>
                <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>Hiện tại</Typography>
              </Box>
            </Box>

            {/* 3-axis acceleration chart */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Gia tốc 3 trục (m/s²)
                </Typography>
                {['X', 'Y', 'Z'].map((axis, i) => (
                  <Box key={axis} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                    <Box sx={{ width: 8, height: 3, borderRadius: 2, bgcolor: ['#FF5722', '#FFC107', '#29B6F6'][i] }} />
                    <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', fontWeight: 600 }}>{axis}</Typography>
                  </Box>
                ))}
              </Box>
              <Box sx={{ bgcolor: alpha('#FF5722', 0.04), borderRadius: 2, p: 1.25, border: `1px solid ${alpha('#FF5722', 0.1)}` }}>
                <LineChart
                  datasets={[
                    { data: stabilityChartData.ax,   color: '#FF5722', strokeWidth: 1.2, opacity: 0.5, showDots: true,  dotOpacity: 0.55, fillOpacity: 0.08 },
                    { data: stabilityChartData.axMA, color: '#FF5722', strokeWidth: 2.8, opacity: 1,   showDots: false, fillOpacity: 0 },
                    { data: stabilityChartData.ay,   color: '#FFC107', strokeWidth: 1.2, opacity: 0.5, showDots: true,  dotOpacity: 0.55, fillOpacity: 0 },
                    { data: stabilityChartData.ayMA, color: '#FFC107', strokeWidth: 2.8, opacity: 1,   showDots: false, fillOpacity: 0 },
                    { data: stabilityChartData.az,   color: '#29B6F6', strokeWidth: 1.2, opacity: 0.5, showDots: true,  dotOpacity: 0.55, fillOpacity: 0 },
                    { data: stabilityChartData.azMA, color: '#29B6F6', strokeWidth: 2.8, opacity: 1,   showDots: false, fillOpacity: 0 },
                  ]}
                  height={130}
                />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.4 }}>
                <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>{history.length * 2}s trước</Typography>
                <Typography sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>Hiện tại</Typography>
              </Box>
            </Box>

            {/* Latest values */}
            {latestData && (
              <Box sx={{ display: 'flex', gap: 1 }}>
                {[
                  { label: 'Accel X', value: latestData.accelX?.toFixed(3), color: '#FF5722' },
                  { label: 'Accel Y', value: latestData.accelY?.toFixed(3), color: '#FFC107' },
                  { label: 'Accel Z', value: latestData.accelZ?.toFixed(3), color: '#29B6F6' },
                ].map((item) => (
                  <Box
                    key={item.label}
                    sx={{ flex: 1, p: 0.75, borderRadius: 1.5, bgcolor: alpha(item.color, 0.08), textAlign: 'center', border: `1px solid ${alpha(item.color, 0.18)}` }}
                  >
                    <Typography sx={{ fontSize: '0.6rem', color: 'text.secondary', fontWeight: 600 }}>{item.label}</Typography>
                    <Typography sx={{ fontFamily: '"JetBrains Mono", monospace', fontSize: '0.82rem', fontWeight: 800, color: item.color }}>
                      {item.value ?? '--'}
                    </Typography>
                    <Typography sx={{ fontSize: '0.56rem', color: 'text.disabled' }}>m/s²</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
});

export default SensorChartDialog;
