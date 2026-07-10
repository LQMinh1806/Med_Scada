import { memo, useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  Fade,
  alpha,
} from '@mui/material';
import {
  Star,
  StarBorder,
  AltRoute,
  PowerOff,
} from '@mui/icons-material';
import StationControlCard from './StationControlCard';
import SpecimenScanPanel from './SpecimenScanPanel';
import EStopButton from './EStopButton';
import { ROBOT_STATUS } from '../constants';
import { useNotification } from '../contexts/NotificationContext';



const ControlPage = memo(function ControlPage({ scada, onComplete }) {
  const {
    stations,
    robotState,
    callRobot,
    scanList,
    scanFeedback,
    lookupBarcode,
    removeFromScanList,
    clearScanList,
    updateScanListDestination,
    previewDispatchRoute,
    startDispatchRoute,
    activeDispatchRoute,
    confirmRouteStop,
    confirmPickup,
    emergencyStop,
    maintenanceMode,
    queue,
    acknowledgeTask,
    plcState,
  } = scada;

  // Track previous activeDispatchRoute to detect completion (active → null)
  const prevRouteRef = useRef(null);
  useEffect(() => {
    const hadRoute = prevRouteRef.current !== null;
    const hasRoute = activeDispatchRoute !== null && activeDispatchRoute !== undefined;
    prevRouteRef.current = activeDispatchRoute ?? null;
    // If route just disappeared (completed), go back to monitoring
    if (hadRoute && !hasRoute && typeof onComplete === 'function') {
      const timer = setTimeout(() => onComplete(), 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [activeDispatchRoute, onComplete]);

  const notifications = useNotification();

  const [dispatchDialog, setDispatchDialog] = useState({
    open: false,
    originStation: null,
    selectedStationIds: [],
    priorityStationId: null,
  });

  const [mergeDialog, setMergeDialog] = useState({
    open: false,
    stationId: null,
    priorityStationId: null,
  });

  // Trạng thái momentary cho nút xác nhận ghép mẫu
  const isConfirmingMergeRef = useRef(false);
  const [isConfirmingMerge, setIsConfirmingMerge] = useState(false);

  const missingDestinationCount = scanList.filter((specimen) => !specimen.destinationStationId).length;
  const canDispatch = scanList.length > 0 && missingDestinationCount === 0 && !maintenanceMode.enabled && !activeDispatchRoute;
  const activeRouteStop = activeDispatchRoute?.stops?.[activeDispatchRoute.currentStopIndex] || null;
  const isEStop = robotState.status === ROBOT_STATUS.ESTOP;
  const canAppendSpecimensAtStop = !isEStop && Boolean(
    activeDispatchRoute?.status === 'waiting_confirm' &&
    activeRouteStop &&
    (
      scada.currentUser?.role === 'tech' ||
      scada.currentUser?.stationId === activeRouteStop.stationId
    )
  );

  const waitingSpecimenCounts = useMemo(() => {
    const counts = {};
    const addCount = (stationId, count = 1) => {
      if (!stationId || count <= 0) return;
      counts[stationId] = (counts[stationId] || 0) + count;
    };

    // Dùng plcState.currentStation để xác định trạm hiện tại chính xác từ PLC
    const plcStationNum = plcState?.currentStation;
    const currentStation = plcStationNum != null
      ? stations.find((s) => parseInt(s.id.split('-')[1], 10) === plcStationNum)
      : stations.find((station) => station.idx === robotState.index);
    const scanSourceStationId = scada.currentUser?.stationId || currentStation?.id || null;
    addCount(scanSourceStationId, scanList.length);

    if (activeDispatchRoute?.specimenRecords?.length) {
      const confirmedStationIds = new Set(
        (activeDispatchRoute.stops || [])
          .filter((stop) => stop.status === 'confirmed')
          .map((stop) => stop.stationId)
      );

      (activeDispatchRoute.stops || []).forEach((stop) => {
        if (confirmedStationIds.has(stop.stationId)) return;
        const stopCount = Number(stop.specimenCount) || (
          Array.isArray(stop.specimenBarcodes) ? stop.specimenBarcodes.length : 0
        );
        addCount(stop.stationId, stopCount);
      });
    }

    return counts;
  }, [activeDispatchRoute, robotState.index, scanList.length, scada.currentUser?.stationId, stations, plcState?.currentStation]);

  const handleCall = useCallback(
    (stationId) => {
      callRobot(stationId);
    },
    [callRobot]
  );

  const handleDispatchRequest = useCallback(
    (station) => {
      if (scanList.length === 0 || maintenanceMode.enabled) return;
      const selectedStationIds = [...new Set(
        scanList
          .map((specimen) => specimen.destinationStationId)
          .filter((stationId) => stationId && stations.some((item) => item.id === stationId))
      )];
      if (selectedStationIds.length === 0 || missingDestinationCount > 0) {
        notifications.notify('Chọn trạm đích cho tất cả mẫu trước khi tạo lộ trình', 'warning', { duration: 5000 });
        return;
      }
      setDispatchDialog({
        open: true,
        originStation: station,
        selectedStationIds,
        priorityStationId: null,
      });
    },
    [scanList, stations, missingDestinationCount, maintenanceMode.enabled, notifications]
  );

  const handleCancelDispatch = useCallback(() => {
    setDispatchDialog({
      open: false,
      originStation: null,
      selectedStationIds: [],
      priorityStationId: null,
    });
  }, []);

  const handleTogglePriorityStation = useCallback((stationId) => {
    setDispatchDialog((prev) => {
      return {
        ...prev,
        priorityStationId: prev.priorityStationId === stationId ? null : stationId,
      };
    });
  }, []);

  const handleConfirmDispatch = useCallback(() => {
    if (!dispatchDialog.originStation || scanList.length === 0 || dispatchDialog.selectedStationIds.length === 0) return;
    const count = scanList.length;
    const route = startDispatchRoute(
      dispatchDialog.originStation.id,
      dispatchDialog.priorityStationId
    );
    if (!route) return;
    const routeText = route.stops.map((stop) => stop.stationName).join(' -> ');
    notifications.notify(`Đã tạo lộ trình ${count} mẫu: ${routeText}`, 'success', { duration: 6000 });
    setDispatchDialog({
      open: false,
      originStation: null,
      selectedStationIds: [],
      priorityStationId: null,
    });
  }, [dispatchDialog.originStation, dispatchDialog.priorityStationId, dispatchDialog.selectedStationIds, notifications, scanList.length, startDispatchRoute]);

  const handleConfirmPickup = useCallback((stationId) => {
    // If there are new specimens scanned, open merge dialog to allow priority selection
    if (scanList.length > 0 && canAppendSpecimensAtStop) {
      setMergeDialog({
        open: true,
        stationId,
        priorityStationId: null,
      });
      return;
    }
    // No new specimens — confirm directly without dialog
    const ok = confirmRouteStop(stationId);
    if (ok) {
      const stationName = stations.find((station) => station.id === stationId)?.name || stationId;
      notifications.notify(`Đã xác nhận gửi hàng tại ${stationName}`, 'success', { duration: 5000 });
    }
  }, [canAppendSpecimensAtStop, confirmRouteStop, notifications, scanList.length, stations]);

  const handleCancelMerge = useCallback(() => {
    setMergeDialog({ open: false, stationId: null, priorityStationId: null });
  }, []);

  const handleToggleMergePriority = useCallback((stationId) => {
    setMergeDialog((prev) => ({
      ...prev,
      priorityStationId: prev.priorityStationId === stationId ? null : stationId,
    }));
  }, []);

  const handleConfirmMerge = useCallback(() => {
    if (!mergeDialog.stationId || isConfirmingMergeRef.current) return;
    isConfirmingMergeRef.current = true;
    setIsConfirmingMerge(true);
    const ok = confirmRouteStop(mergeDialog.stationId, mergeDialog.priorityStationId);
    if (ok) {
      const stationName = stations.find((station) => station.id === mergeDialog.stationId)?.name || mergeDialog.stationId;
      notifications.notify(`Đã xác nhận nhận hàng và ghép ${scanList.length} mẫu tại ${stationName}`, 'success', { duration: 6000 });
    }
    setMergeDialog({ open: false, stationId: null, priorityStationId: null });
    setTimeout(() => {
      isConfirmingMergeRef.current = false;
      setIsConfirmingMerge(false);
    }, 2000);
  }, [confirmRouteStop, mergeDialog.stationId, mergeDialog.priorityStationId, notifications, scanList.length, stations]);


  const handleEStop = useCallback(() => {
    emergencyStop();
    notifications.notifyEStop();
  }, [emergencyStop, notifications]);

  const handleResetEStop = useCallback(() => {
    acknowledgeTask();
    notifications.notify('Hệ thống đã được khôi phục sau Dừng khẩn cấp', 'success');
  }, [acknowledgeTask, notifications]);

  const handleConfirmStationPickup = useCallback((stationId) => {
    if (confirmPickup) {
      confirmPickup().then((res) => {
        if (res?.ok) {
          const stationName = stations.find((s) => s.id === stationId)?.name || stationId;
          notifications.notify(`Đã gửi lệnh GỬI HÀNG tại ${stationName} (Confirm_CMD2)`, 'success', { duration: 4000 });
        } else {
          notifications.notify(`Lỗi gửi lệnh GỬI HÀNG: ${res?.error || 'Unknown'}`, 'error');
        }
      }).catch((err) => {
        notifications.notify(`Lệnh GỬI HÀNG lỗi kết nối: ${err?.message}`, 'error');
      });
    }
  }, [confirmPickup, notifications, stations]);

  const stationQueueMap = useMemo(() => {
    const map = {};
    if (!queue || queue.length === 0) return map;
    queue.forEach((item, idx) => {
      const sid = item.stationId;
      if (!map[sid]) {
        map[sid] = {
          position: idx + 1,
          type: item.type,
        };
      }
    });
    return map;
  }, [queue]);

  const routeStopMap = useMemo(() => {
    const map = {};
    if (!activeDispatchRoute) return map;
    activeDispatchRoute.stops.forEach((stop, index) => {
      const isCurrentStop = index === activeDispatchRoute.currentStopIndex;
      map[stop.stationId] = {
        ...stop,
        position: index + 1,
        total: activeDispatchRoute.stops.length,
        isCurrentStop,
        canConfirm: activeDispatchRoute.status === 'waiting_confirm' && isCurrentStop,
        isPriority: activeDispatchRoute.priorityStationId === stop.stationId,
      };
    });
    return map;
  }, [activeDispatchRoute]);

  const stationViewModels = useMemo(
    () =>
      stations.map((station) => {
        // isCurrent: chỉ dùng currentStation từ PLC để xác định cabin đang ở trạm nào
        // plcState.currentStation là số trạm (1-4), station.idx cũng là số (0-indexed)
        // station.id là ST-01..ST-04, map với plcState.currentStation
        const plcStationNum = plcState?.currentStation; // 1-4
        const isCurrentByPlc = plcStationNum != null && parseInt(station.id.split('-')[1], 10) === plcStationNum;
        return {
          station: {
            ...station,
            samples: waitingSpecimenCounts[station.id] || 0,
          },
          isCurrent: isCurrentByPlc,
          isTarget: robotState.targetId === station.id,
          queueInfo: stationQueueMap[station.id] || null,
          routeStopInfo: routeStopMap[station.id] || null,
        };
      }),
    [stations, robotState.targetId, routeStopMap, stationQueueMap, waitingSpecimenCounts, plcState?.currentStation]
  );

  const destinationOptions = useMemo(() => {
    if (!dispatchDialog.originStation) return [];
    return dispatchDialog.selectedStationIds
      .map((stationId) => stations.find((station) => station.id === stationId))
      .filter(Boolean);
  }, [dispatchDialog.originStation, dispatchDialog.selectedStationIds, stations]);

  const routePreview = useMemo(() => {
    if (!dispatchDialog.originStation || dispatchDialog.selectedStationIds.length === 0) return [];
    return previewDispatchRoute(
      dispatchDialog.originStation.id,
      dispatchDialog.selectedStationIds,
      dispatchDialog.priorityStationId
    );
  }, [dispatchDialog.originStation, dispatchDialog.priorityStationId, dispatchDialog.selectedStationIds, previewDispatchRoute]);

  // === Merge dialog: compute future station list and preview ===
  const mergeFutureStations = useMemo(() => {
    if (!mergeDialog.open || !mergeDialog.stationId || !activeDispatchRoute) return [];
    const currentStopIndex = activeDispatchRoute.currentStopIndex;
    const remainingStationIds = activeDispatchRoute.stops
      .slice(currentStopIndex + 1)
      .filter((stop) => stop.status !== 'confirmed')
      .map((stop) => stop.stationId);
    const newDestinationIds = scanList
      .map((spec) => spec.destinationStationId)
      .filter((id) => id && id !== mergeDialog.stationId);
    const allFutureIds = [...new Set([...remainingStationIds, ...newDestinationIds])];
    return allFutureIds
      .map((id) => stations.find((s) => s.id === id))
      .filter(Boolean);
  }, [mergeDialog.open, mergeDialog.stationId, activeDispatchRoute, scanList, stations]);

  const mergeRoutePreview = useMemo(() => {
    if (!mergeDialog.open || !mergeDialog.stationId || mergeFutureStations.length === 0) return [];
    return previewDispatchRoute(
      mergeDialog.stationId,
      mergeFutureStations.map((s) => s.id),
      mergeDialog.priorityStationId
    );
  }, [mergeDialog.open, mergeDialog.stationId, mergeDialog.priorityStationId, mergeFutureStations, previewDispatchRoute]);

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
            <EStopButton onEStop={handleEStop} hwEStopActive={Boolean(plcState?.eStopActive)} />
          </Box>

          {/* === E-Stop Freeze Banner === */}
          {isEStop && (
            <Alert
              severity="error"
              icon={<PowerOff />}
              sx={{
                mb: 2,
                fontWeight: 700,
                fontSize: '0.95rem',
                border: '2px solid #C41C1C',
                animation: 'flash-urgent 1.5s ease-in-out infinite',
              }}
            >
              ⛔ HỆ THỐNG ĐANG DỪNG KHẨN CẤP — Mọi thao tác đã bị khóa. Lộ trình được giữ lại và sẽ tiếp tục sau khi giải phóng E-Stop.
            </Alert>
          )}

          {maintenanceMode.enabled && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Hệ thống đang ở chế độ bảo trì. Mọi lệnh gọi dispatch cabin đã bị khóa.
              {maintenanceMode.reason ? ` Lý do: ${maintenanceMode.reason}.` : ''}
            </Alert>
          )}

          {activeDispatchRoute && (
            <Alert
              severity={activeDispatchRoute.status === 'waiting_confirm' ? 'warning' : 'info'}
              icon={<AltRoute />}
              sx={{ mb: 2, fontWeight: 600 }}
            >
              Lộ trình đang chạy:{' '}
              <strong>{activeDispatchRoute.originStationName}</strong>
              {' -> '}
              {activeDispatchRoute.stops.map((stop, index) => (
                <span key={stop.stationId}>
                  {index > 0 ? ' -> ' : ''}
                  {stop.stationName}
                  {activeDispatchRoute.priorityStationId === stop.stationId ? ' ★' : ''}
                </span>
              ))}
              {activeDispatchRoute.status === 'waiting_confirm'
                ? ' - Đang chờ xác nhận đã nhận hàng.'
                : ' - Cabin đang di chuyển theo lộ trình.'}
              {canAppendSpecimensAtStop
                ? ' Có thể quét thêm mẫu tại trạm này trước khi xác nhận để ghép vào tuyến.'
                : ''}
            </Alert>
          )}

          <SpecimenScanPanel
            scanList={scanList}
            onLookupBarcode={lookupBarcode}
            onRemoveFromList={removeFromScanList}
            onClearList={clearScanList}
            onUpdateDestination={updateScanListDestination}
            stations={stations}
            scanFeedback={scanFeedback}
          />

          <Grid container spacing={1} justifyContent="center" alignItems="stretch">
            {stationViewModels.map(({ station, isCurrent, isTarget, queueInfo, routeStopInfo }) => (
              <Grid item xs={12} sm={6} md={3} key={station.id} sx={{ display: 'flex' }}>
                <StationControlCard
                  station={station}
                  isCurrent={isCurrent}
                  isTarget={isTarget}
                  onCall={handleCall}
                  onDispatchRequest={handleDispatchRequest}
                  canDispatch={canDispatch && isCurrent}
                  disableActions={maintenanceMode.enabled || isEStop || Boolean(activeDispatchRoute)}
                  queueInfo={queueInfo}
                  routeStopInfo={routeStopInfo}
                  onConfirmPickup={handleConfirmPickup}
                  onConfirmStationPickup={handleConfirmStationPickup}
                  currentUser={scada.currentUser}
                  sensorActive={Boolean(plcState?.stationSensors?.[station.id])}
                />
              </Grid>
            ))}
          </Grid>

          <Dialog
            open={dispatchDialog.open}
            onClose={handleCancelDispatch}
            maxWidth="md"
            fullWidth
            TransitionComponent={Fade}
          >
            <DialogTitle
              sx={{
                bgcolor: 'primary.main',
                color: '#111',
              }}
            >
              Tạo lộ trình điều cabin
            </DialogTitle>
            <DialogContent dividers sx={{ pt: 2 }}>
              <Typography sx={{ mb: 2 }}>
                Cabin sẽ xuất phát từ <strong>{dispatchDialog.originStation?.name}</strong> cùng{' '}
                <strong>{scanList.length} mẫu bệnh phẩm</strong>. Các trạm đích được lấy từ từng mẫu,
                có thể bấm ngôi sao để ưu tiên một trạm chạy trước.
              </Typography>

              <Typography sx={{ mb: 0.75, fontWeight: 800, color: 'text.primary' }}>
                Trạm cần điều đến
              </Typography>
              <Stack spacing={0.75} sx={{ mb: 2 }}>
                {destinationOptions.map((station) => {
                  const isPriority = dispatchDialog.priorityStationId === station.id;
                  const distance = dispatchDialog.originStation
                    ? Math.abs(station.idx - dispatchDialog.originStation.idx)
                    : 0;
                  const specimenCount = scanList.filter((specimen) => specimen.destinationStationId === station.id).length;

                  return (
                    <Paper
                      key={station.id}
                      sx={{
                        p: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        border: `1px solid ${isPriority ? alpha('#FF9800', 0.5) : alpha('#1976D2', 0.18)}`,
                        bgcolor: isPriority ? alpha('#FF9800', 0.08) : alpha('#65B5FF', 0.1),
                      }}
                    >
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 800, color: 'text.primary' }}>
                          {station.name}
                        </Typography>
                        <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                          {station.id} · {specimenCount} mẫu · cách trạm nguồn {distance} đoạn ray
                        </Typography>
                      </Box>
                      <Tooltip title={isPriority ? 'Bỏ ưu tiên' : 'Ưu tiên trạm này chạy trước'}>
                        <IconButton
                          color={isPriority ? 'warning' : 'default'}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleTogglePriorityStation(station.id);
                          }}
                        >
                          {isPriority ? <Star /> : <StarBorder />}
                        </IconButton>
                      </Tooltip>
                    </Paper>
                  );
                })}
              </Stack>

              <Box
                sx={{
                  p: 1.25,
                  mb: 2,
                  borderRadius: 2,
                  bgcolor: alpha('#0BDF50', 0.08),
                  border: `1px solid ${alpha('#0BDF50', 0.18)}`,
                }}
              >
                <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', fontWeight: 800, mb: 0.5 }}>
                  LỘ TRÌNH DỰ KIẾN
                </Typography>
                {routePreview.length > 0 ? (
                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
                    <Chip label={dispatchDialog.originStation?.name || 'Trạm nguồn'} size="small" color="primary" />
                    {routePreview.map((station, index) => (
                      <Box key={station.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography sx={{ color: 'text.secondary', fontWeight: 800 }}>→</Typography>
                        <Chip
                          label={`${index + 1}. ${station.name}${dispatchDialog.priorityStationId === station.id ? ' ★' : ''}`}
                          size="small"
                          color={dispatchDialog.priorityStationId === station.id ? 'warning' : 'default'}
                          sx={{ fontWeight: 700 }}
                        />
                      </Box>
                    ))}
                  </Stack>
                ) : (
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
                    Chưa chọn trạm đích.
                  </Typography>
                )}
              </Box>

              <Divider sx={{ mb: 2 }} />

              {scanList.length > 0 ? (
                <Box
                  sx={{
                    p: 2,
                    borderRadius: 2,
                    bgcolor: alpha('#65B5FF', 0.12),
                    border: `1px solid ${alpha('#65B5FF', 0.25)}`,
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
                disabled={scanList.length === 0 || dispatchDialog.selectedStationIds.length === 0}
                sx={{ fontWeight: 800, minWidth: 140, minHeight: 46 }}
              >
                Tạo lộ trình {scanList.length} mẫu
              </Button>
            </DialogActions>
          </Dialog>

          {/* === Merge priority dialog === */}
          <Dialog
            open={mergeDialog.open}
            onClose={handleCancelMerge}
            maxWidth="md"
            fullWidth
            TransitionComponent={Fade}
          >
            <DialogTitle
              sx={{
                bgcolor: 'warning.main',
                color: '#111',
              }}
            >
              Ghép hàng — Chọn trạm ưu tiên
            </DialogTitle>
            <DialogContent dividers sx={{ pt: 2 }}>
              <Typography sx={{ mb: 2 }}>
                Bạn đang ghép <strong>{scanList.length} mẫu mới</strong> vào tuyến hiện tại.
                Chọn ngôi sao ★ để ưu tiên một trạm chạy trước trong lộ trình còn lại.
              </Typography>

              <Typography sx={{ mb: 0.75, fontWeight: 800, color: 'text.primary' }}>
                Trạm còn lại + trạm mới
              </Typography>
              <Stack spacing={0.75} sx={{ mb: 2 }}>
                {mergeFutureStations.map((station) => {
                  const isPriority = mergeDialog.priorityStationId === station.id;
                  const isNewFromScan = scanList.some((spec) => spec.destinationStationId === station.id);
                  const existingInRoute = activeDispatchRoute?.stops?.some(
                    (stop) => stop.stationId === station.id && stop.status !== 'confirmed'
                  );
                  const newSpecimenCount = scanList.filter((spec) => spec.destinationStationId === station.id).length;
                  const existingSpecimenCount = activeDispatchRoute?.stops
                    ?.find((stop) => stop.stationId === station.id)?.specimenCount || 0;

                  return (
                    <Paper
                      key={station.id}
                      sx={{
                        p: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        border: `1px solid ${isPriority ? alpha('#FF9800', 0.5) : alpha('#1976D2', 0.18)}`,
                        bgcolor: isPriority
                          ? alpha('#FF9800', 0.08)
                          : isNewFromScan && !existingInRoute
                            ? alpha('#0BDF50', 0.08)
                            : alpha('#65B5FF', 0.1),
                      }}
                    >
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 800, color: 'text.primary' }}>
                          {station.name}
                          {isNewFromScan && !existingInRoute && (
                            <Chip label="MỚI" size="small" color="success" sx={{ ml: 1, fontWeight: 700, height: 20, fontSize: '0.68rem' }} />
                          )}
                        </Typography>
                        <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                          {station.id}
                          {existingInRoute ? ` · ${existingSpecimenCount} mẫu cũ` : ''}
                          {newSpecimenCount > 0 ? ` · ${newSpecimenCount} mẫu mới` : ''}
                        </Typography>
                      </Box>
                      <Tooltip title={isPriority ? 'Bỏ ưu tiên' : 'Ưu tiên trạm này chạy trước'}>
                        <IconButton
                          color={isPriority ? 'warning' : 'default'}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleToggleMergePriority(station.id);
                          }}
                        >
                          {isPriority ? <Star /> : <StarBorder />}
                        </IconButton>
                      </Tooltip>
                    </Paper>
                  );
                })}
              </Stack>

              <Box
                sx={{
                  p: 1.25,
                  borderRadius: 2,
                  bgcolor: alpha('#0BDF50', 0.08),
                  border: `1px solid ${alpha('#0BDF50', 0.18)}`,
                }}
              >
                <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', fontWeight: 800, mb: 0.5 }}>
                  LỘ TRÌNH DỰ KIẾN SAU GHÉP
                </Typography>
                {mergeRoutePreview.length > 0 ? (
                  <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
                    <Chip
                      label={stations.find((s) => s.id === mergeDialog.stationId)?.name || 'Trạm hiện tại'}
                      size="small"
                      color="primary"
                    />
                    {mergeRoutePreview.map((station, index) => (
                      <Box key={station.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography sx={{ color: 'text.secondary', fontWeight: 800 }}>→</Typography>
                        <Chip
                          label={`${index + 1}. ${station.name}${mergeDialog.priorityStationId === station.id ? ' ★' : ''}`}
                          size="small"
                          color={mergeDialog.priorityStationId === station.id ? 'warning' : 'default'}
                          sx={{ fontWeight: 700 }}
                        />
                      </Box>
                    ))}
                  </Stack>
                ) : (
                  <Typography sx={{ color: 'text.secondary', fontSize: '0.85rem' }}>
                    Không còn trạm nào phía trước.
                  </Typography>
                )}
              </Box>
            </DialogContent>
            <DialogActions sx={{ p: 2 }}>
              <Button onClick={handleCancelMerge} sx={{ fontWeight: 700 }}>
                Hủy
              </Button>
              <Button
                variant="contained"
                color="warning"
                onClick={handleConfirmMerge}
                disabled={isConfirmingMerge}
                sx={{ fontWeight: 800, minWidth: 180, minHeight: 46 }}
              >
                {isConfirmingMerge ? 'ĐANG XÁC NHẬN...' : `Xác nhận ghép ${scanList.length} mẫu`}
              </Button>
            </DialogActions>
          </Dialog>
        </Box>
      </Box>
    </Fade>
  );
});

export default ControlPage;
