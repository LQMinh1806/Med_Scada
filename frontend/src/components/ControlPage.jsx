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
  Grid,
  Stack,
  Typography,
  Fade,
  alpha,
} from '@mui/material';
import { PriorityHigh } from '@mui/icons-material';
import StationControlCard from './StationControlCard';
import SpecimenScanPanel from './SpecimenScanPanel';
import EStopButton from './EStopButton';
import { PRIORITY, USER_ROLES, ROBOT_STATUS } from '../constants';
import { useNotification } from '../contexts/NotificationContext';



const ControlPage = memo(function ControlPage({ scada }) {
  const {
    stations,
    robotState,
    callRobot,
    scanList,
    scanFeedback,
    lookupBarcode,
    removeFromScanList,
    clearScanList,
    dispatchBatchSpecimens,
    emergencyStop,
    maintenanceMode,
    queue,
    acknowledgeTask,
  } = scada;

  const notifications = useNotification();

  const [dispatchDialog, setDispatchDialog] = useState({ open: false, station: null });

  const canDispatch = scanList.length > 0 && !maintenanceMode.enabled;
  const hasSTAT = scanList.some((s) => s.priority === PRIORITY.STAT);

  const handleCall = useCallback(
    (stationId) => {
      callRobot(stationId, hasSTAT ? PRIORITY.STAT : PRIORITY.ROUTINE);
    },
    [callRobot, hasSTAT]
  );

  const handleDispatchRequest = useCallback(
    (station) => {
      if (scanList.length === 0 || maintenanceMode.enabled) return;
      setDispatchDialog({ open: true, station });
    },
    [scanList.length, maintenanceMode.enabled]
  );

  const handleCancelDispatch = useCallback(() => {
    setDispatchDialog({ open: false, station: null });
  }, []);

  const handleConfirmDispatch = useCallback(() => {
    if (!dispatchDialog.station || scanList.length === 0) return;
    const stationName = dispatchDialog.station.name;
    const count = scanList.length;
    const dispatched = dispatchBatchSpecimens(dispatchDialog.station.id);
    if (!dispatched) return;
    notifications.notifyDispatchSuccess(`${count} mẫu`, stationName);
    setDispatchDialog({ open: false, station: null });
  }, [scanList, dispatchDialog.station, dispatchBatchSpecimens, notifications]);


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
      if (!map[sid]) {
        map[sid] = {
          position: idx + 1,
          priority: item.priority,
          type: item.type,
          // Station has only ROUTINE entries — allows STAT override
          hasRoutineOnly: item.priority === PRIORITY.ROUTINE,
        };
      } else {
        // FIX: If ANY task for this station is STAT, mark hasRoutineOnly = false
        if (item.priority === PRIORITY.STAT) {
          map[sid].hasRoutineOnly = false;
        }
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
                  robotState.status === ROBOT_STATUS.ESTOP
                    ? alpha('#C41C1C', 0.14)
                    : robotState.status === ROBOT_STATUS.MAINTENANCE
                    ? alpha('#FF9800', 0.14)
                    : robotState.status === ROBOT_STATUS.MOVING
                    ? alpha('#1976D2', 0.14)
                    : alpha('#0BDF50', 0.12),
                color:
                  robotState.status === ROBOT_STATUS.ESTOP
                    ? '#C41C1C'
                    : robotState.status === ROBOT_STATUS.MAINTENANCE
                    ? '#E65100'
                    : robotState.status === ROBOT_STATUS.MOVING
                    ? '#1565C0'
                    : '#0A7B32',
                border: `1px solid ${
                  robotState.status === ROBOT_STATUS.ESTOP
                    ? alpha('#C41C1C', 0.26)
                    : robotState.status === ROBOT_STATUS.MAINTENANCE
                    ? alpha('#FF9800', 0.3)
                    : robotState.status === ROBOT_STATUS.MOVING
                    ? alpha('#1976D2', 0.22)
                    : alpha('#0BDF50', 0.2)
                }`,
                animation:
                  robotState.status === ROBOT_STATUS.ESTOP ||
                  robotState.status === ROBOT_STATUS.MAINTENANCE
                    ? 'flash-urgent 1.2s ease-in-out infinite'
                    : 'none',
              }}
            />

            {robotState.status === ROBOT_STATUS.ESTOP && (
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
            scanList={scanList}
            onLookupBarcode={lookupBarcode}
            onRemoveFromList={removeFromScanList}
            onClearList={clearScanList}
            scanFeedback={scanFeedback}
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
                  hasStatSpecimen={hasSTAT}
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
                bgcolor: hasSTAT ? '#C41C1C' : 'primary.main',
                color: '#111',
              }}
            >
              {hasSTAT && <PriorityHigh sx={{ mr: 1, verticalAlign: 'middle' }} />}
              {hasSTAT ? 'DISPATCH KHẨN CẤP (STAT)' : 'Xác nhận dispatch cabin'}
            </DialogTitle>
            <DialogContent dividers sx={{ pt: 2 }}>
              <Typography sx={{ mb: 2 }}>
                Xác nhận vận chuyển cabin cùng{' '}
                <strong>{scanList.length} mẫu bệnh phẩm</strong> đến{' '}
                <strong>{dispatchDialog.station?.name}</strong>?
              </Typography>

              {scanList.length > 0 ? (
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    bgcolor: hasSTAT ? alpha('#C41C1C', 0.07) : alpha('#65B5FF', 0.12),
                    border: `1px solid ${hasSTAT ? alpha('#C41C1C', 0.2) : alpha('#65B5FF', 0.25)}`,
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  <Stack spacing={0.5}>
                    {scanList.map((specimen, idx) => (
                      <Box
                        key={specimen.barcode}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                          py: 0.5,
                          borderBottom: idx < scanList.length - 1
                            ? `1px solid ${alpha('#000', 0.06)}`
                            : 'none',
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            fontFamily: '"IBM Plex Mono", monospace',
                            fontWeight: 700,
                            minWidth: 90,
                            color: 'text.primary',
                          }}
                        >
                          {specimen.barcode}
                        </Typography>
                        <Typography variant="body2" sx={{ flexGrow: 1, color: 'text.secondary' }}>
                          {specimen.patientName}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {specimen.testType}
                        </Typography>
                        {specimen.priority === PRIORITY.STAT && (
                          <Chip
                            label="STAT"
                            size="small"
                            sx={{
                              fontWeight: 800,
                              bgcolor: '#C41C1C',
                              color: '#fff',
                              fontSize: '0.65rem',
                              height: 20,
                            }}
                          />
                        )}
                      </Box>
                    ))}
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
                disabled={scanList.length === 0}
                sx={{ fontWeight: 800, minWidth: 140, minHeight: 46 }}
              >
                Dispatch {scanList.length} mẫu
              </Button>
            </DialogActions>
          </Dialog>
        </Box>
      </Box>
    </Fade>
  );
});

export default ControlPage;
