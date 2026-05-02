import { memo, useCallback } from 'react';
import { Box, Button, Paper, Typography, Chip, Tooltip, alpha } from '@mui/material';
import { Warning, HourglassBottom } from '@mui/icons-material';
import { PRIORITY } from '../constants';

/**
 * Individual station control card with LED indicator, priority awareness,
 * and queue status display.
 *
 * @param {object}  queueInfo           Queue info for this station (null if not queued)
 * @param {number}  queueInfo.position  1-based position in the queue
 * @param {string}  queueInfo.priority  'stat' | 'routine'
 * @param {string}  queueInfo.type      'CALL' | 'DISPATCH'
 * @param {boolean} queueInfo.hasRoutineOnly  True if only ROUTINE tasks are queued
 */
const StationControlCard = memo(function StationControlCard({
  station,
  isCurrent,
  isTarget,
  onCall,
  onDispatchRequest,
  canDispatch,
  hasStatSpecimen,
  disableActions = false,
  queueInfo = null,
  currentUser = null,
}) {
  const ledColor = isCurrent ? '#0BDF50' : isTarget ? '#1976D2' : '#868685';
  const ledGlow = 'none';

  const statusLabel = isCurrent ? 'Cabin tại đây' : isTarget ? 'Đích đến' : 'Sẵn sàng';
  const borderAccent = isCurrent ? '#0BDF50' : isTarget ? '#1976D2' : 'transparent';

  const handleCall = useCallback(() => onCall(station.id), [onCall, station.id]);
  const handleDispatch = useCallback(() => onDispatchRequest(station), [onDispatchRequest, station]);

  // --- Location-based RBAC logic ---
  const isOperator = currentUser?.role === 'operator' && currentUser?.stationId;
  // Operator ONLY allowed to CALL their own station
  const isCallRestricted = isOperator && currentUser.stationId !== station.id;
  // Operator ONLY allowed to DISPATCH to other stations (cannot dispatch to self)
  const isDispatchRestricted = isOperator && currentUser.stationId === station.id;

  // --- Queue-aware disable logic ---
  const isCallDisabled = disableActions || Boolean(queueInfo) || isCallRestricted;
  const isDispatchDisabled =
    !canDispatch ||
    disableActions ||
    isDispatchRestricted ||
    (queueInfo && !(queueInfo.hasRoutineOnly && hasStatSpecimen));

  const isQueued = Boolean(queueInfo);
  const isQueueStat = queueInfo?.priority === PRIORITY.STAT;

  return (
    <Paper
      sx={{
        p: 1.25,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 160,
        borderTop: `4px solid ${borderAccent}`,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
        overflow: 'hidden',
        '&:hover': {
          boxShadow: `0 12px 28px ${alpha('#111', 0.14)}`,
        },
      }}
    >
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="h6" fontWeight={800} sx={{ fontSize: '1rem', color: 'text.primary' }}>
            {station.name}
          </Typography>
          <Tooltip title={statusLabel}>
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                bgcolor: ledColor,
                boxShadow: ledGlow,
                flexShrink: 0,
                transition: 'all 0.3s ease',
              }}
            />
          </Tooltip>
        </Box>

        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          Mã: <span style={{ fontFamily: '"IBM Plex Mono", monospace', fontWeight: 600 }}>{station.id}</span>
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, flexWrap: 'wrap' }}>
          <Chip
            label={`${station.samples} mẫu chờ`}
            size="medium"
            variant="outlined"
            sx={{
              fontWeight: 600,
              fontSize: '0.8rem',
              borderColor: alpha('#111111', 0.18),
              color: 'text.secondary',
            }}
          />
          {hasStatSpecimen && (
            <Chip
              icon={<Warning sx={{ fontSize: '18px !important' }} />}
              label="STAT"
              size="medium"
              sx={{
                bgcolor: '#C41C1C',
                color: '#fff',
                fontWeight: 800,
                fontSize: '0.8rem',
              }}
            />
          )}
          {/* --- Queue position badge --- */}
          {isQueued && (
            <Chip
              icon={<HourglassBottom sx={{ fontSize: '15px !important' }} />}
              label={`Đang đợi (#${queueInfo.position})`}
              size="medium"
              color={isQueueStat ? 'error' : 'warning'}
              sx={{
                fontWeight: 700,
                fontSize: '0.73rem',
                height: 26,
                animation: isQueueStat ? 'pulse-queue 1.2s ease-in-out infinite' : 'none',
                '@keyframes pulse-queue': {
                  '0%, 100%': { opacity: 1 },
                  '50%': { opacity: 0.7 },
                },
              }}
            />
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
        <Tooltip
          title={isCallRestricted ? 'Bạn chỉ có quyền gọi cabin về trạm của mình' : isQueued ? 'Trạm đã có lệnh trong hàng chờ' : ''}
          disableHoverListener={!isCallRestricted && !isQueued}
        >
          <span>
            <Button
              variant="contained"
              color="primary"
              fullWidth
              onClick={handleCall}
              disabled={isCallDisabled}
              sx={{ py: 0.8, fontSize: '0.85rem', fontWeight: 700 }}
            >
              GỌI CABIN
            </Button>
          </span>
        </Tooltip>
        <Tooltip
          title={
            isDispatchRestricted
              ? 'Bạn không thể dispatch đến trạm của chính mình'
              : isQueued && !(queueInfo.hasRoutineOnly && hasStatSpecimen)
                ? 'Trạm đã có lệnh trong hàng chờ'
                : ''
          }
          disableHoverListener={!isDispatchRestricted && (!isQueued || (queueInfo?.hasRoutineOnly && hasStatSpecimen))}
        >
          <span>
            <Button
              variant="outlined"
              color="primary"
              fullWidth
              disabled={isDispatchDisabled}
              onClick={handleDispatch}
              sx={{
                py: 0.8, fontSize: '0.85rem', fontWeight: 700,
                ...(hasStatSpecimen && canDispatch && !isDispatchDisabled && {
                  borderColor: '#1976D2',
                  color: '#1976D2',
                  borderWidth: 2,
                  '&:hover': {
                    bgcolor: alpha('#1976D2', 0.08),
                    borderWidth: 2,
                  },
                }),
              }}
            >
              ĐIỀU CABIN ĐẾN
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Paper>
  );
});

export default StationControlCard;
