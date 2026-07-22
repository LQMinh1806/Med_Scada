import { memo, useCallback, useMemo, useState } from 'react';
import {
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
  Speed,
  LocalShipping,
  PrecisionManufacturing,
  AdminPanelSettings,
  ArrowForward,
} from '@mui/icons-material';
import ScadaSVGMap from './ScadaSVGMap';
import TransportHistoryDialog from './TransportHistoryDialog';
import CabinSensorPanel from './CabinSensorPanel';
import { ROBOT_STATUS, USER_ROLES } from '../constants';

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
  const isQueuePriority = queueInfo?.priority === 'station-priority';

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
          label={`#${queueInfo.position} ${isQueuePriority ? 'Ưu tiên' : 'Đợi'}`}
          color="warning"
          size="small"
          sx={{
            height: 22,
            fontWeight: 700,
            fontSize: '0.62rem',
            animation: isQueuePriority ? 'pulse-queue 1.2s ease-in-out infinite' : 'none',
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

const MonitoringDisplay = memo(function MonitoringDisplay({ scada, navigateTo, currentUser, onControlAccess }) {
  const { robotState, stations, transportedSpecimens, queue, cabinSensorData, sensorHistory } = scada;
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const handleOpenHistory = useCallback(() => setIsHistoryOpen(true), []);
  const handleCloseHistory = useCallback(() => setIsHistoryOpen(false), []);

  const statusColor = useMemo(() => {
    if (robotState.status === ROBOT_STATUS.ESTOP) return '#C41C1C';
    if (robotState.status === ROBOT_STATUS.MOVING) return '#1976D2';
    return '#05903A';
  }, [robotState.status]);

  const kpis = useMemo(() => {
    const records = transportedSpecimens || [];
    const total = records.length;
    const destinationCount = new Set(records.map((record) => record.toStationId).filter(Boolean)).size;

    // Helper tính thời gian di chuyển vật lý giữa 2 trạm (giây)
    const getActualTravelSec = (fromId, toId) => {
      const getSec = (num) => (num === 1 ? 0 : num === 2 ? 11 : num === 3 ? 19 : 30);
      const fNum = parseInt(String(fromId || '').replace(/\D/g, ''), 10);
      const tNum = parseInt(String(toId || '').replace(/\D/g, ''), 10);
      if (fNum && tNum && fNum !== tNum) {
        return Math.abs(getSec(tNum) - getSec(fNum));
      }
      return 15;
    };

    // Tính thời gian di chuyển thực tế của cabin giữa các trạm (bỏ qua thời gian chờ người bấm xác nhận)
    let totalTravelMs = 0;
    let validTimings = 0;
    for (const record of records) {
      if (!record.fromStationId || !record.toStationId) continue;

      let travelMs = 0;
      if (record.dispatchTime && record.arrivalTime) {
        const dispatch = new Date(record.dispatchTime).getTime();
        const arrival = new Date(record.arrivalTime).getTime();
        const diffMs = arrival - dispatch;
        // Nếu thời gian chênh lệch nằm trong khoảng thực tế di chuyển (0 < t <= 90s)
        if (!Number.isNaN(dispatch) && !Number.isNaN(arrival) && diffMs > 0 && diffMs <= 90000) {
          travelMs = diffMs;
        } else {
          // Nếu bị trễ do người vận hành chậm bấm xác nhận, lấy chuẩn hành trình thực tế giữa 2 trạm
          travelMs = getActualTravelSec(record.fromStationId, record.toStationId) * 1000;
        }
      } else {
        travelMs = getActualTravelSec(record.fromStationId, record.toStationId) * 1000;
      }

      totalTravelMs += travelMs;
      validTimings += 1;
    }

    let avgTravelDisplay = '—';
    let avgTravelUnit = 'phút';
    if (validTimings > 0) {
      const avgMs = totalTravelMs / validTimings;
      const avgSec = avgMs / 1000;
      if (avgSec < 60) {
        avgTravelDisplay = avgSec.toFixed(0);
        avgTravelUnit = 'giây';
      } else {
        avgTravelDisplay = (avgSec / 60).toFixed(1);
        avgTravelUnit = 'phút';
      }
    }

    return { total, destinationCount, avgTravelDisplay, avgTravelUnit };
  }, [transportedSpecimens]);

  const queueByStationId = useMemo(() => {
    if (!Array.isArray(queue) || queue.length === 0) return {};
    const map = {};
    queue.forEach((item, idx) => {
      if (!item?.stationId || map[item.stationId]) return;
      map[item.stationId] = {
        position: idx + 1,
        priority: item.priority,
        type: item.type,
      };
    });
    return map;
  }, [queue]);

  return (
    <Fade in timeout={400}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.72 }}>
        {/* ── KPI row + action buttons ────────────────────────────── */}
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'stretch' }}>

          {/* 3 KPI cards */}
          <Box sx={{
            flex: 3,
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 0.75,
          }}>
            <KpiCard icon={<LocalShipping />} label="Tổng vận chuyển" value={kpis.total} unit="lượt" color="#65B5FF" />
            <KpiCard icon={<Speed />} label="TG di chuyển TB" value={kpis.avgTravelDisplay} unit={kpis.avgTravelUnit} color="#1976D2" />
            <KpiCard icon={<TrendingUp />} label="Trạm nhận" value={kpis.destinationCount} unit="trạm" color="#FF9800" />
          </Box>

          {/* Nút Điều khiển — luôn hiện, style như hình 2 */}
          <Button
            id="monitoring-control-btn"
            variant="contained"
            onClick={onControlAccess}
            startIcon={<PrecisionManufacturing sx={{ fontSize: '20px !important' }} />}
            sx={{
              flex: 1,
              minHeight: 98,
              fontWeight: 800,
              fontSize: '0.9rem',
              px: 2.5,
              borderRadius: 2,
              gap: 1.5,
              background: 'linear-gradient(135deg, #1976D2, #42A5F5)',
              boxShadow: `0 4px 14px ${alpha('#1976D2', 0.3)}`,
              color: '#ffffff',
              '&:hover': {
                background: 'linear-gradient(135deg, #1565C0, #1E88E5)',
                boxShadow: `0 6px 18px ${alpha('#1976D2', 0.45)}`,
                transform: 'translateY(-2px)',
              },
              '&:active': { transform: 'translateY(0)' },
              transition: 'all 0.2s ease',
            }}
          >
            Điều khiển
          </Button>

          {/* Nút Kỹ thuật — chỉ hiện với role tech, style như hình 2 */}
          {currentUser?.role === USER_ROLES.TECH && (
            <Button
              id="monitoring-admin-btn"
              variant="outlined"
              onClick={() => navigateTo?.('admin')}
              startIcon={<AdminPanelSettings sx={{ fontSize: '20px !important' }} />}
              sx={{
                flex: 1,
                minHeight: 98,
                fontWeight: 800,
                fontSize: '0.9rem',
                px: 2.5,
                borderRadius: 2,
                gap: 1.5,
                borderColor: alpha('#E65100', 0.5),
                borderWidth: '1.5px',
                color: '#E65100',
                bgcolor: 'background.paper',
                '&:hover': {
                  bgcolor: alpha('#FF9800', 0.08),
                  borderColor: '#E65100',
                  borderWidth: '1.5px',
                  transform: 'translateY(-2px)',
                  boxShadow: `0 6px 14px ${alpha('#E65100', 0.15)}`,
                },
                '&:active': { transform: 'translateY(0)' },
                transition: 'all 0.2s ease',
              }}
            >
              Kỹ thuật
            </Button>
          )}
        </Box>


        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, alignItems: 'stretch' }}>
          {/* ── Left column ────────────────────────────────────────── */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, justifyContent: 'flex-start', flex: { sm: '1 1 0%' }, width: { xs: '100%', sm: '33.33%' } }}>
            {/* Cabin status card */}
            <Paper
              sx={{
                p: 1.15,
                bgcolor: alpha('#ffffff', 0.9),
                borderLeft: `4px solid ${statusColor}`,
                boxShadow: `0 10px 26px ${alpha('#111111', 0.12)}`,
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
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

            {/* ESP32 Cabin Sensor Panel */}
            <CabinSensorPanel
              sensorData={cabinSensorData}
              sensorHistory={sensorHistory}
            />
          </Box>

          {/* ── Right column ───────────────────────────────────────── */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, flex: { sm: '2 1 0%' }, width: { xs: '100%', sm: '66.66%' } }}>
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
                <ScadaSVGMap scada={scada} encoderData={cabinSensorData} />
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
                  const queueInfo = queueByStationId[station.id] || null;
                  return (
                    <StationStatusChip key={station.id} station={station} queueInfo={queueInfo} />
                  );
                })}
              </Box>
            </Paper>
          </Box>
        </Box>

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
