import { memo, useCallback } from 'react';
import { Box, Button, Paper, Typography, Chip, Tooltip, alpha } from '@mui/material';
import { HourglassBottom, CheckCircle, Star } from '@mui/icons-material';

/**
 * Individual station control card with LED indicator, route status,
 * and queue status display.
 *
 * @param {object}  queueInfo           Queue info for this station (null if not queued)
 * @param {number}  queueInfo.position  1-based position in the queue
 * @param {string}  queueInfo.type      'CALL' | 'DISPATCH'
 */
const StationControlCard = memo(function StationControlCard({
  station,
  isCurrent,
  isTarget,
  onCall,
  onDispatchRequest,
  canDispatch,
  disableActions = false,
  queueInfo = null,
  routeStopInfo = null,
  onConfirmPickup,
  currentUser = null,
}) {
  const ledColor = isCurrent ? '#0BDF50' : isTarget ? '#1976D2' : '#868685';
  const ledGlow = isCurrent
    ? `0 0 8px rgba(11, 223, 80, 0.7), 0 0 16px rgba(11, 223, 80, 0.35)`
    : isTarget
    ? `0 0 8px rgba(25, 118, 210, 0.7), 0 0 16px rgba(25, 118, 210, 0.35)`
    : 'none';

  const statusLabel = isCurrent ? 'Cabin tại đây' : isTarget ? 'Đích đến' : 'Sẵn sàng';
  const borderAccent = isCurrent ? '#0BDF50' : isTarget ? '#1976D2' : 'transparent';

  const handleCall = useCallback(() => onCall(station.id), [onCall, station.id]);
  const handleDispatch = useCallback(() => onDispatchRequest(station), [onDispatchRequest, station]);
  const handleConfirmPickup = useCallback(() => {
    if (onConfirmPickup) onConfirmPickup(station.id);
  }, [onConfirmPickup, station.id]);

  // --- Location-based RBAC logic ---
  const currentRole = String(currentUser?.role || '').toLowerCase();
  const isTech = currentRole === 'tech';
  const isOperator = currentRole === 'operator' && currentUser?.stationId;
  // Operator ONLY allowed to CALL their own station
  const isCallRestricted = isOperator && currentUser.stationId !== station.id;
  // Operator creates a dispatch route only from their assigned/source station
  const isDispatchRestricted = isOperator && currentUser.stationId !== station.id;
  const hasStationConfirmPermission = isTech || currentUser?.stationId === station.id;

  // --- Queue-aware disable logic ---
  const isCallDisabled = disableActions || Boolean(queueInfo) || isCallRestricted;
  const isDispatchOriginUnavailable = !isCurrent;
  const isDispatchDisabled =
    !canDispatch ||
    disableActions ||
    isDispatchOriginUnavailable ||
    isDispatchRestricted ||
    Boolean(queueInfo);

  const isQueued = Boolean(queueInfo);
  const canConfirmPickup = Boolean(routeStopInfo?.canConfirm && hasStationConfirmPermission);
  const confirmTooltip = routeStopInfo?.canConfirm && !hasStationConfirmPermission
    ? `Chỉ tài khoản được phân quyền ${station.name} mới được xác nhận tại trạm này`
    : !routeStopInfo?.canConfirm
      ? 'Chưa đến lượt xác nhận tại trạm này'
      : '';

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
          {/* --- Queue position badge --- */}
          {isQueued && (
            <Chip
              icon={<HourglassBottom sx={{ fontSize: '15px !important' }} />}
              label={`Đang đợi (#${queueInfo.position})`}
              size="medium"
              color="warning"
              sx={{
                fontWeight: 700,
                fontSize: '0.73rem',
                height: 26,
              }}
            />
          )}
          {routeStopInfo && (
            <Chip
              icon={routeStopInfo.isPriority ? <Star sx={{ fontSize: '15px !important' }} /> : undefined}
              label={
                routeStopInfo.canConfirm
                  ? 'Chờ lấy hàng'
                  : `Tuyến #${routeStopInfo.position}/${routeStopInfo.total}`
              }
              size="medium"
              color={routeStopInfo.canConfirm ? 'warning' : 'info'}
              sx={{ fontWeight: 800, fontSize: '0.73rem', height: 26 }}
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
              ? 'Bạn chỉ được tạo lộ trình từ trạm được phân công'
              : isDispatchOriginUnavailable
                ? 'Cabin phải đang ở trạm này trước khi tạo lộ trình'
              : isQueued
                ? 'Trạm đã có lệnh trong hàng chờ'
                : ''
          }
          disableHoverListener={!isDispatchRestricted && !isDispatchOriginUnavailable && !isQueued}
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
              }}
            >
              ĐIỀU CABIN ĐẾN
            </Button>
          </span>
        </Tooltip>
        {routeStopInfo && (
          <Tooltip
            title={confirmTooltip}
            disableHoverListener={!confirmTooltip}
          >
            <span>
              <Button
                variant={canConfirmPickup ? 'contained' : 'outlined'}
                color={canConfirmPickup ? 'success' : 'inherit'}
                fullWidth
                disabled={!canConfirmPickup}
                onClick={handleConfirmPickup}
                startIcon={<CheckCircle />}
                sx={{
                  py: 0.75,
                  fontSize: '0.78rem',
                  fontWeight: 800,
                  ...(canConfirmPickup && {
                    boxShadow: `0 8px 18px ${alpha('#0BDF50', 0.25)}`,
                  }),
                }}
              >
                XÁC NHẬN ĐÃ LẤY HÀNG
              </Button>
            </span>
          </Tooltip>
        )}
      </Box>
    </Paper>
  );
});

export default StationControlCard;
