/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo } from 'react';
import { useSnackbar } from 'notistack';
import { IconButton } from '@mui/material';
import { Close } from '@mui/icons-material';

// === Context ===
const NotificationContext = createContext(null);

/**
 * Hook to access notification system throughout the app.
 * Wraps notistack with medical-domain-specific helpers.
 */
export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotification must be used inside NotificationProvider');
  }
  return ctx;
}

/**
 * Provides toast notification helpers for SCADA system events.
 */
export function NotificationProvider({ children }) {
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const dismiss = useCallback(
    (key) => () => closeSnackbar(key),
    [closeSnackbar]
  );

  const notify = useCallback(
    (message, variant = 'info', options = {}) => {
      enqueueSnackbar(message, {
        variant,
        autoHideDuration: options.persist ? null : (options.duration ?? 4000),
        persist: options.persist ?? false,
        preventDuplicate: options.preventDuplicate ?? false,
        anchorOrigin: { vertical: 'bottom', horizontal: 'right' },
        action: (key) => (
          <IconButton size="small" color="inherit" onClick={dismiss(key)}>
            <Close fontSize="small" />
          </IconButton>
        ),
        ...options,
      });
    },
    [enqueueSnackbar, dismiss]
  );

  // Domain-specific notification helpers
  const notifyCabinArrived = useCallback(
    (stationName) => notify(`Cabin đã đến ${stationName}`, 'success', { duration: 5000 }),
    [notify]
  );

  const notifyDispatchSuccess = useCallback(
    (barcode, stationName) => notify(`Đã dispatch mẫu ${barcode} -> ${stationName}`, 'success', { duration: 5000 }),
    [notify]
  );

  const notifyEStop = useCallback(
    () => notify('Dừng khẩn cấp đã được kích hoạt', 'error', { duration: 8000 }),
    [notify]
  );

  const notifyStatSpecimen = useCallback(
    (barcode) => notify(`Mẫu STAT: ${barcode}. Ưu tiên xử lý`, 'error', { duration: 7000 }),
    [notify]
  );

  const notifyError = useCallback(
    (msg) => notify(`${msg}`, 'error', { duration: 5000 }),
    [notify]
  );

  const notifyInfo = useCallback(
    (msg) => notify(msg, 'info'),
    [notify]
  );

  const value = useMemo(() => ({
    notify,
    notifyCabinArrived,
    notifyDispatchSuccess,
    notifyEStop,
    notifyStatSpecimen,
    notifyError,
    notifyInfo,
  }), [
    notify,
    notifyCabinArrived,
    notifyDispatchSuccess,
    notifyEStop,
    notifyStatSpecimen,
    notifyError,
    notifyInfo,
  ]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
