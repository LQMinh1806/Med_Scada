import { memo, useCallback, useMemo, useState } from 'react';
import {
  Grid,
  Paper,
  Typography,
  Box,
  Chip,
  Button,
  alpha,
  Fade,
} from '@mui/material';
import {
  Map as MapIcon,
  History,
  TrendingUp,
  Schedule,
  Speed,
  LocalShipping,
  Insights,
} from '@mui/icons-material';
import ScadaSVGMap from './ScadaSVGMap';
import TransportHistoryDialog from './TransportHistoryDialog';
import { PRIORITY } from '../constants';

const KpiCard = memo(function KpiCard({ icon, label, value, unit, color, trend }) {
  return (
    <Paper
      sx={{
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        minHeight: 98,
        overflow: 'hidden',
        borderTop: `2px solid ${color}`, 
        transition: 'all 0.25s ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: `0 10px 22px ${alpha(color, 0.18)}`,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: 1,
            bgcolor: alpha(color, 0.12),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            '& .MuiSvgIcon-root': {
              fontSize: 16,
              color,
            },
          }}
        >
          {icon}
        </Box>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            color: 'text.secondary',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            fontSize: '0.66rem',
            lineHeight: 1.1,
          }}
        >
          {label}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.4 }}>
        <Typography
          sx={{
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 800,
            fontSize: '1.36rem',
            color: 'text.primary',
            lineHeight: 1,
          }}
        >
          {value}
        </Typography>
        {unit && (
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', fontWeight: 600 }}>
            {unit}
          </Typography>
        )}
      </Box>

      {trend !== undefined && (
        <Typography
          sx={{
            fontSize: '0.66rem',
            fontWeight: 600,
            color: trend >= 0 ? '#05903A' : '#C41C1C',
            display: 'flex',
            alignItems: 'center',
            gap: 0.25,
          }}
        >
          <TrendingUp sx={{ fontSize: 11, transform: trend < 0 ? 'rotate(180deg)' : 'none' }} />
          {trend >= 0 ? '+' : ''}{trend}% vs hôm qua
        </Typography>
      )}
    </Paper>
  );
});

const StationStatusChip = memo(function StationStatusChip({ station, queueInfo }) {
  const ready = station.ready;
  const isQueued = Boolean(queueInfo);
  const isQueueStat = queueInfo?.priority === PRIORITY.STAT;

  return (
    <Paper
      sx={{
        px: 1,
        py: 0.85,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        minHeight: 58,
        borderTop: `2px solid ${ready ? '#05903A' : '#C41C1C'}`,
        transition: 'all 0.25s ease',
        '&:hover': {
          boxShadow: (theme) => `0 8px 18px ${alpha(theme.palette.primary.main, 0.08)}`,
        },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" fontWeight={800} sx={{ fontSize: '0.75rem', lineHeight: 1.15 }}>
          {station.id}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.1, display: 'block', fontSize: '0.72rem' }}>
          {station.name}
        </Typography>
      </Box>
      {isQueued && (
        <Chip
          label={`#${queueInfo.position} ${isQueueStat ? 'STAT' : 'Đợi'}`}
          color={isQueueStat ? 'error' : 'warning'}
          size="small"
          sx={{
            height: 22,
            fontWeight: 700,
            fontSize: '0.62rem',
            animation: isQueueStat ? 'pulse-queue 1.2s ease-in-out infinite' : 'none',
            '@keyframes pulse-queue': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.7 },
            },
          }}
        />
      )}
      <Chip
        label={ready ? 'Sẵn sàng' : 'Đang bận'}
        color={ready ? 'success' : 'error'}
        variant={ready ? 'filled' : 'outlined'}
        size="small"
        sx={{ height: 27, fontWeight: 700, fontSize: '0.69rem' }}
      />
    </Paper>
  );
});

const ThroughputSparkline = memo(function ThroughputSparkline({ points }) {
  const chartPath = useMemo(() => {
    const values = points.length > 0 ? points : [0];
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = Math.max(max - min, 1);

    return values
      .map((value, index) => {
        const x = (index / Math.max(values.length - 1, 1)) * 100;
        const y = 100 - ((value - min) / range) * 100;
        return `${x},${y}`;
      })
      .join(' ');
  }, [points]);

  return (
    <Box sx={{ mt: 0.8, p: 0.8, borderRadius: 2, bgcolor: alpha('#65B5FF', 0.12) }}>
      <svg width="100%" height="56" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline
          points={chartPath}
          fill="none"
          stroke="#1976D2"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>12h trước</Typography>
        <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary' }}>Hiện tại</Typography>
      </Box>
    </Box>
  );
});

const MonitoringDisplay = memo(function MonitoringDisplay({ scada }) {
  const { robotState, stations, transportedSpecimens, queue } = scada;
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const handleOpenHistory = useCallback(() => setIsHistoryOpen(true), []);
  const handleCloseHistory = useCallback(() => setIsHistoryOpen(false), []);

  const statusColor = useMemo(() => {
    if (robotState.status === 'Dừng khẩn cấp') return '#C41C1C';
    if (robotState.status === 'Đang di chuyển') return '#1976D2';
    return '#05903A';
  }, [robotState.status]);

  const kpis = useMemo(() => {
    const records = transportedSpecimens || [];
    const total = records.length;
    const statCount = records.filter((record) => record.priority === PRIORITY.STAT).length;
    const statRatio = total > 0 ? ((statCount / total) * 100).toFixed(1) : '0';

    let avgDeliveryMin = 0;
    let validTimings = 0;
    for (const record of records) {
      if (!record.dispatchTime || !record.arrivalTime) continue;
      const dispatch = new Date(record.dispatchTime).getTime();
      const arrival = new Date(record.arrivalTime).getTime();
      if (!Number.isNaN(dispatch) && !Number.isNaN(arrival) && arrival > dispatch) {
        avgDeliveryMin += (arrival - dispatch) / 60000;
        validTimings += 1;
      }
    }
    avgDeliveryMin = validTimings > 0 ? (avgDeliveryMin / validTimings).toFixed(1) : '—';

    return { total, statCount, statRatio, avgDeliveryMin };
  }, [transportedSpecimens]);

  const operationalInsights = useMemo(() => {
    const records = transportedSpecimens || [];
    const recent = records.slice(0, 80);
    let withinSla = 0;
    let measured = 0;

    for (const item of recent) {
      if (!item.dispatchTime || !item.arrivalTime) continue;
      const dispatch = new Date(item.dispatchTime).getTime();
      const arrival = new Date(item.arrivalTime).getTime();
      if (Number.isNaN(dispatch) || Number.isNaN(arrival) || arrival <= dispatch) continue;
      measured += 1;
      if ((arrival - dispatch) / 60000 <= 8) {
        withinSla += 1;
      }
    }

    const slaRate = measured > 0 ? Number(((withinSla / measured) * 100).toFixed(1)) : 0;

    const timestamps = records
      .map((item) => new Date(item.arrivalTime || item.dispatchTime || '').getTime())
      .filter((value) => !Number.isNaN(value));

    const throughputPoints = Array(12).fill(0);
    if (timestamps.length > 0) {
      const latestTimestamp = Math.max(...timestamps);
      const oneHourMs = 60 * 60 * 1000;
      for (const timestamp of timestamps) {
        const diffHours = Math.floor((latestTimestamp - timestamp) / oneHourMs);
        if (diffHours >= 0 && diffHours < 12) {
          throughputPoints[11 - diffHours] += 1;
        }
      }
    }

    const readinessRate = stations.length > 0
      ? Number(((stations.filter((station) => station.ready).length / stations.length) * 100).toFixed(1))
      : 0;

    return { slaRate, measured, throughputPoints, readinessRate };
  }, [stations, transportedSpecimens]);

  return (
    <Fade in timeout={400}>
      <Box sx={{ display: 'grid', gap: 0.72, transform: { xs: 'translateX(4px)', md: 'translateX(40px)' } }}>
        <Grid container spacing={0.75}>
          <Grid item xs={6} sm={3}>
            <KpiCard icon={<LocalShipping />} label="Tổng vận chuyển" value={kpis.total} unit="lượt" color="#65B5FF" />
          </Grid>
          <Grid item xs={6} sm={3}>
            <KpiCard icon={<Speed />} label="Thời gian TB" value={kpis.avgDeliveryMin} unit="phút" color="#1976D2" />
          </Grid>
          <Grid item xs={6} sm={3}>
            <KpiCard icon={<TrendingUp />} label="Mẫu STAT" value={kpis.statCount} unit={`(${kpis.statRatio}%)`} color="#C41C1C" />
          </Grid>
          <Grid item xs={6} sm={3}>
            <KpiCard icon={<Schedule />} label="Uptime" value={robotState.isOnline ? '100' : '0'} unit="%" color="#0BDF50" />
          </Grid>
        </Grid>

        <Grid container spacing={0.8} alignItems="stretch">
          <Grid item xs={12} lg={8} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Paper
              sx={{
                p: { xs: 1.05, md: 1.25 },
                display: 'flex',
                flexDirection: 'column',
                gap: 0.85,
                borderTop: '3px solid #1976D2',
                overflow: 'hidden',
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  <MapIcon sx={{ color: '#1976D2', fontSize: 18 }} />
                  <Typography variant="subtitle2" fontWeight={800} sx={{ color: 'text.primary' }}>
                    BẢN ĐỒ GIÁM SÁT CABIN VẬN CHUYỂN
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<History />}
                  onClick={handleOpenHistory}
                  sx={{ fontWeight: 700, py: 0.5, minHeight: 32 }}
                >
                  Lịch sử
                </Button>
              </Box>

              <Box
                sx={{
                  bgcolor: alpha('#65B5FF', 0.08),
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: `1px solid ${alpha('#111111', 0.1)}`,
                }}
              >
                <ScadaSVGMap scada={scada} />
              </Box>
            </Paper>

            <Paper sx={{ p: 1.05, borderTop: '3px solid #65B5FF' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" fontWeight={800} sx={{ color: 'text.primary' }}>
                  TRẠNG THÁI TRẠM
                </Typography>
                <Typography sx={{ fontSize: '0.67rem', color: 'text.secondary', fontWeight: 600 }}>
                  {stations.length} trạm
                </Typography>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, gap: 0.9 }}>
                {stations.map((station) => {
                  // Find the first queue entry for this station
                  const queueIdx = queue ? queue.findIndex((item) => item.stationId === station.id) : -1;
                  const queueItem = queueIdx >= 0 ? queue[queueIdx] : null;
                  const queueInfo = queueItem
                    ? { position: queueIdx + 1, priority: queueItem.priority, type: queueItem.type }
                    : null;
                  return (
                    <StationStatusChip key={station.id} station={station} queueInfo={queueInfo} />
                  );
                })}
              </Box>
            </Paper>
          </Grid>

          <Grid item xs={12} lg={4} sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Paper
              sx={{
                p: 1.15,
                bgcolor: alpha('#ffffff', 0.9),
                borderLeft: `4px solid ${statusColor}`,
                boxShadow: `0 10px 26px ${alpha('#111111', 0.12)}`,
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color: '#1976D2',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontSize: '0.72rem',
                }}
              >
                CABIN-01 — TRẠNG THÁI
              </Typography>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, mt: 0.7, mb: 0.9 }}>
                <Box
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    bgcolor: statusColor,
                    boxShadow: `0 0 14px ${statusColor}`,
                    position: 'relative',
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      inset: -3,
                      borderRadius: '50%',
                      border: `2px solid ${alpha(statusColor, 0.35)}`,
                      animation: 'pulse-ring 2s ease-out infinite',
                    },
                  }}
                />
                <Typography variant="subtitle1" fontWeight={900} sx={{ color: 'text.primary', letterSpacing: '0.02em', fontSize: '1.08rem' }}>
                  {robotState.status}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, p: 0.95, bgcolor: alpha('#65B5FF', 0.12), borderRadius: 2 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.72rem' }}>
                  Đích đến:
                </Typography>
                <Chip
                  size="small"
                  label={robotState.targetId || 'N/A'}
                  sx={{
                    fontWeight: 800,
                    fontFamily: '"IBM Plex Mono", monospace',
                    color: '#111111',
                    bgcolor: alpha('#1976D2', 0.22),
                    border: `1px solid ${alpha('#111111', 0.18)}`,
                    height: 24,
                  }}
                />
              </Box>
            </Paper>

            <Paper sx={{ p: 1.15, borderTop: '3px solid #65B5FF' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 0.75 }}>
                <Insights sx={{ color: '#65B5FF', fontSize: 18 }} />
                <Typography variant="subtitle2" fontWeight={800} sx={{ color: 'text.primary' }}>
                  OPERATIONAL ANALYTICS
                </Typography>
              </Box>

              <Grid container spacing={0.8}>
                <Grid item xs={6}>
                  <Box sx={{ p: 0.95, borderRadius: 2, bgcolor: alpha('#0BDF50', 0.12) }}>
                    <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary', fontWeight: 600 }}>
                      SLA &lt; 8 phút
                    </Typography>
                    <Typography sx={{ fontWeight: 800, fontSize: '1.12rem', color: '#05903A' }}>
                      {operationalInsights.slaRate}%
                    </Typography>
                  </Box>
                </Grid>
                <Grid item xs={6}>
                  <Box sx={{ p: 0.95, borderRadius: 2, bgcolor: alpha('#65B5FF', 0.18) }}>
                    <Typography sx={{ fontSize: '0.66rem', color: 'text.secondary', fontWeight: 600 }}>
                      Trạm sẵn sàng
                    </Typography>
                    <Typography sx={{ fontWeight: 800, fontSize: '1.12rem', color: '#1468B8' }}>
                      {operationalInsights.readinessRate}%
                    </Typography>
                  </Box>
                </Grid>
              </Grid>

              <Typography sx={{ mt: 0.85, fontSize: '0.68rem', color: 'text.secondary', fontWeight: 600 }}>
                Throughput 12 giờ gần nhất
              </Typography>
              <ThroughputSparkline points={operationalInsights.throughputPoints} />
              <Typography sx={{ mt: 0.55, fontSize: '0.66rem', color: 'text.secondary' }}>
                Mẫu có dữ liệu SLA: {operationalInsights.measured}
              </Typography>
            </Paper>
          </Grid>
        </Grid>

        <TransportHistoryDialog
          open={isHistoryOpen}
          onClose={handleCloseHistory}
          records={transportedSpecimens}
          title="Lịch Sử Vận Chuyển — Giám Sát"
        />
      </Box>
    </Fade>
  );
});

export default MonitoringDisplay;