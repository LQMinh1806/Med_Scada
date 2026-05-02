import { memo, useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  Switch,
  Stack,
  TextField,
  Typography,
  Fade,
  alpha,
} from '@mui/material';
import { BuildCircle, PriorityHigh } from '@mui/icons-material';
import StationControlCard from './StationControlCard';
import SpecimenScanPanel from './SpecimenScanPanel';
import EStopButton from './EStopButton';
import { PRIORITY, USER_ROLES } from '../constants';
import { useNotification } from '../contexts/NotificationContext';



const ControlPage = memo(function ControlPage({ scada }) {
  const {
    stations,
    robotState,
    callRobot,
    currentSpecimen,
    registerScannedSpecimen,
    clearCurrentSpecimen,
    dispatchScannedSpecimen,
    emergencyStop,
    maintenanceMode,
    queue,
    acknowledgeTask,
  } = scada;

  const notifications = useNotification();

  const [dispatchDialog, setDispatchDialog] = useState({ open: false, station: null });

  const canDispatch = Boolean(currentSpecimen) && !maintenanceMode.enabled;
  const isSTAT = currentSpecimen?.priority === PRIORITY.STAT;

  const handleScan = useCallback(
    (specimenData) => {
      const result = registerScannedSpecimen(specimenData);
      if (result && result.priority === PRIORITY.STAT) {
        notifications.notifyStatSpecimen(result.barcode);
      }
      return result;
    },
    [registerScannedSpecimen, notifications]
  );

  const handleCall = useCallback(
    (stationId) => {
      callRobot(stationId, isSTAT ? PRIORITY.STAT : PRIORITY.ROUTINE);
    },
    [callRobot, isSTAT]
  );

  const handleDispatchRequest = useCallback(
    (station) => {
      if (!currentSpecimen || maintenanceMode.enabled) return;
      setDispatchDialog({ open: true, station });
    },
    [currentSpecimen, maintenanceMode.enabled]
  );

  const handleCancelDispatch = useCallback(() => {
    setDispatchDialog({ open: false, station: null });
  }, []);

  const handleConfirmDispatch = useCallback(() => {
    if (!dispatchDialog.station || !currentSpecimen) return;
    const barcode = currentSpecimen.barcode;
    const stationName = dispatchDialog.station.name;
    const dispatched = dispatchScannedSpecimen(dispatchDialog.station.id);
    if (!dispatched) return;
    notifications.notifyDispatchSuccess(barcode, stationName);
    setDispatchDialog({ open: false, station: null });
  }, [currentSpecimen, dispatchDialog.station, dispatchScannedSpecimen, notifications]);


  const handleEStop = useCallback(() => {
    emergencyStop();
    notifications.notifyEStop();
  }, [emergencyStop, notifications]);

  const handleResetEStop = useCallback(() => {
    acknowledgeTask();
    notifications.notify('Hệ thống đã được khôi phục sau Dừng khẩn cấp', 'success');
  }, [acknowledgeTask, notifications]);

  const stationQueueMap = useMemo(() => {
    const map = {};
    if (!queue || queue.length === 0) return map;
    queue.forEach((item, idx) => {
      const sid = item.stationId;
      // Only keep the first (most relevant) entry per station
      if (!map[sid]) {
        map[sid] = {
          position: idx + 1,
          priority: item.priority,
          type: item.type,
          // Station has only ROUTINE entries — allows STAT override
          hasRoutineOnly: item.priority === PRIORITY.ROUTINE,
        };
      }
    });
    return map;
  }, [queue]);

  const stationViewModels = useMemo(
    () =>
      stations.map((station) => ({
        station,
        isCurrent: robotState.index === station.idx,
        isTarget: robotState.targetId === station.id,
        queueInfo: stationQueueMap[station.id] || null,
      })),
    [stations, robotState.index, robotState.targetId, stationQueueMap]
  );

  return (
    <Fade in timeout={400}>
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: { xs: 1, md: 2 } }}>
        <Box sx={{ width: '100%', maxWidth: 1200 }}>
          <Box sx={{ textAlign: 'center', mb: 1.5 }}>
            <Typography variant="h6" fontWeight={900} gutterBottom sx={{ color: 'text.primary' }}>
              BẢNG ĐIỀU KHIỂN CABIN
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              Quản lý và điều phối cabin vận chuyển cho {stations.length} trạm
            </Typography>
          </Box>

          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1,
              mb: 1,
              p: 0.75,
              borderRadius: 2,
              border: `1px solid ${alpha('#111111', 0.1)}`,
              bgcolor: alpha('#65B5FF', 0.08),
            }}
          >
            <Chip
              size="small"
              label={robotState.status}
              sx={{
                fontWeight: 700,
                bgcolor:
                  robotState.status === 'Dừng khẩn cấp'
                    ? alpha('#C41C1C', 0.14)
                    : alpha('#0BDF50', 0.12),
                color: robotState.status === 'Dừng khẩn cấp' ? '#C41C1C' : '#0A7B32',
                border: `1px solid ${robotState.status === 'Dừng khẩn cấp'
                  ? alpha('#C41C1C', 0.26)
                  : alpha('#0BDF50', 0.2)
                  }`,
              }}
            />

            {robotState.status === 'Dừng khẩn cấp' && (
              <Button
                variant="outlined"
                color="error"
                size="small"
                onClick={handleResetEStop}
                sx={{ fontWeight: 700, mr: 1, borderWidth: 2 }}
              >
                KHÔI PHỤC
              </Button>
            )}
            <EStopButton onEStop={handleEStop} />
          </Box>

          {maintenanceMode.enabled && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Hệ thống đang ở chế độ bảo trì. Mọi lệnh gọi dispatch cabin đã bị khóa.
              {maintenanceMode.reason ? ` Lý do: ${maintenanceMode.reason}.` : ''}
            </Alert>
          )}

          <SpecimenScanPanel
            currentSpecimen={currentSpecimen}
            onScan={handleScan}
            onClear={clearCurrentSpecimen}
          />

          <Grid container spacing={1} justifyContent="center" alignItems="stretch">
            {stationViewModels.map(({ station, isCurrent, isTarget, queueInfo }) => (
              <Grid item xs={12} sm={6} md={3} key={station.id} sx={{ display: 'flex' }}>
                <StationControlCard
                  station={station}
                  isCurrent={isCurrent}
                  isTarget={isTarget}
                  onCall={handleCall}
                  onDispatchRequest={handleDispatchRequest}
                  canDispatch={canDispatch}
                  hasStatSpecimen={isSTAT}
                  disableActions={maintenanceMode.enabled}
                  queueInfo={queueInfo}
                  currentUser={scada.currentUser}
                />
              </Grid>
            ))}
          </Grid>

          <Dialog
            open={dispatchDialog.open}
            onClose={handleCancelDispatch}
            maxWidth="sm"
            fullWidth
            TransitionComponent={Fade}
          >
            <DialogTitle
              sx={{
                bgcolor: isSTAT ? '#C41C1C' : 'primary.main',
                color: '#111',
              }}
            >
              {isSTAT && <PriorityHigh sx={{ mr: 1, verticalAlign: 'middle' }} />}
              {isSTAT ? 'DISPATCH KHẨN CẤP (STAT)' : 'Xác nhận dispatch cabin'}
            </DialogTitle>
            <DialogContent dividers sx={{ pt: 2 }}>
              <Typography sx={{ mb: 2 }}>
                Xác nhận vận chuyển cabin cùng mẫu bệnh phẩm đến{' '}
                <strong>{dispatchDialog.station?.name}</strong>?
              </Typography>

              {currentSpecimen ? (
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    bgcolor: isSTAT ? alpha('#C41C1C', 0.07) : alpha('#65B5FF', 0.12),
                    border: `1px solid ${isSTAT ? alpha('#C41C1C', 0.2) : alpha('#65B5FF', 0.25)}`,
                  }}
                >
                  <Stack spacing={1}>
                    <Typography>
                      <strong>Barcode:</strong> {currentSpecimen.barcode}
                    </Typography>
                    <Typography>
                      <strong>Bệnh nhân:</strong> {currentSpecimen.patientName}
                    </Typography>
                    <Typography>
                      <strong>Xét nghiệm:</strong> {currentSpecimen.testType}
                    </Typography>
                    <Typography>
                      <strong>Thời gian quét:</strong> {currentSpecimen.scanTime}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <strong>Ưu tiên:</strong>
                      <Chip
                        label={isSTAT ? 'STAT - Khẩn cấp' : 'Routine'}
                        size="small"
                        sx={{
                          fontWeight: 800,
                          bgcolor: isSTAT ? '#C41C1C' : '#0BDF50',
                          color: '#111',
                        }}
                      />
                    </Box>
                  </Stack>
                </Box>
              ) : (
                <Alert severity="error">Không tìm thấy dữ liệu mẫu bệnh phẩm.</Alert>
              )}
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
              <Button onClick={handleCancelDispatch} sx={{ fontWeight: 700 }}>
                Hủy
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={handleConfirmDispatch}
                disabled={!currentSpecimen}
                sx={{ fontWeight: 800, minWidth: 140, minHeight: 46 }}
              >
                Xác nhận Dispatch
              </Button>
            </DialogActions>
          </Dialog>
        </Box>
      </Box>
    </Fade>
  );
});

export default ControlPage;
