import { useCallback, useState, useEffect, useRef, useMemo, memo } from 'react';
import {
  ThemeProvider,
  CssBaseline,
  Box,
  AppBar,
  Toolbar,
  Typography,
  Button,
  Chip,
  IconButton,
  Container,
  alpha,
  Fade,
} from '@mui/material';
import {
  LocalHospital,
  ArrowBack,
  PowerSettingsNew,
  AccessTime,
  FiberManualRecord,
} from '@mui/icons-material';

import theme from './theme';
import { ROUTES, USER_ROLES, ROBOT_STATUS } from './constants';
import { attachCsrfHeader } from './utils/csrf';
import { useNotification } from './contexts/NotificationContext';
import useScada from './hooks/useScada';
import useAudioAlerts from './hooks/useAudioAlerts';

import LoginPage from './components/LoginPage';
import MonitoringDisplay from './components/MonitoringDisplay';
import ControlPage from './components/ControlPage';
import AdminPage from './components/AdminPage';
import AudioAlertControls from './components/AudioAlertControls';
import ControlAuthDialog from './components/ControlAuthDialog';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

/**
 * Live clock for the AppBar — updates every second.
 */
const LiveClock = memo(function LiveClock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formattedTime = time.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const formattedDate = time.toLocaleDateString('vi-VN', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'flex' },
        alignItems: 'center',
        gap: 0.75,
        px: 1.5,
        py: 0.5,
        borderRadius: 1.5,
        bgcolor: 'rgba(101, 181, 255, 0.16)',
        border: '1px solid rgba(17, 17, 17, 0.1)',
      }}
    >
      <AccessTime sx={{ fontSize: 16, color: '#111111', opacity: 0.7 }} />
      <Box>
        <Typography
          sx={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: '0.82rem',
            fontWeight: 600,
            color: '#111111',
            lineHeight: 1.2,
            letterSpacing: '0.04em',
          }}
        >
          {formattedTime}
        </Typography>
        <Typography
          sx={{
            fontSize: '0.62rem',
            fontWeight: 500,
            color: 'rgba(17, 17, 17, 0.6)',
            lineHeight: 1,
          }}
        >
          {formattedDate}
        </Typography>
      </Box>
    </Box>
  );
});

/**
 * Page renderer — memoized to prevent unnecessary re-renders.
 */
const PageContent = memo(function PageContent({ currentPage, navigateTo, scada, onControlAccess, onTransportComplete }) {
  const isTech = scada.currentUser?.role === USER_ROLES.TECH;

  switch (currentPage) {
    case ROUTES.MONITORING:
      return (
        <MonitoringDisplay
          scada={scada}
          navigateTo={navigateTo}
          currentUser={scada.currentUser}
          onControlAccess={onControlAccess}
        />
      );
    case ROUTES.CONTROL:
      return <ControlPage scada={scada} onComplete={onTransportComplete} />;
    case ROUTES.ADMIN:
      return isTech ? <AdminPage scada={scada} /> : <MonitoringDisplay scada={scada} navigateTo={navigateTo} currentUser={scada.currentUser} onControlAccess={onControlAccess} />;
    default:
      return (
        <MonitoringDisplay
          scada={scada}
          navigateTo={navigateTo}
          currentUser={scada.currentUser}
          onControlAccess={onControlAccess}
        />
      );
  }
});

/**
 * Page title map for breadcrumb-style navigation.
 */
const PAGE_TITLES = {
  [ROUTES.HUB]: 'Trung Tâm',
  [ROUTES.MONITORING]: 'Giám Sát',
  [ROUTES.CONTROL]: 'Điều Khiển',
  [ROUTES.ADMIN]: 'Kỹ Thuật',
};

export default function App() {
  const scada = useScada();
  const [currentPage, setCurrentPage] = useState(ROUTES.LOGIN);
  const [sessionResolved, setSessionResolved] = useState(false);
  const [controlAuthOpen, setControlAuthOpen] = useState(false);
  const notifications = useNotification();
  const audioAlerts = useAudioAlerts();
  const { notifyCabinArrived } = notifications;
  const { playCabinArrived } = audioAlerts;

  // === Cabin arrival notification (visual + audio) ===
  const prevStatusRef = useRef(scada.robotState.status);
  useEffect(() => {
    const currentStatus = scada.robotState.status;
    if (prevStatusRef.current === ROBOT_STATUS.MOVING && currentStatus === ROBOT_STATUS.READY) {
      const targetStation = scada.stations.find((s) => s.id === scada.robotState.targetId);
      if (targetStation) {
        notifyCabinArrived(targetStation.name);
        playCabinArrived();
      }
    }
    prevStatusRef.current = currentStatus;
  }, [
    scada.robotState.status,
    scada.robotState.targetId,
    scada.stations,
    notifyCabinArrived,
    playCabinArrived,
  ]);

  // === Navigation ===
  const navigateTo = useCallback((page) => setCurrentPage(page), []);

  const handleLogin = useCallback(() => {
    setCurrentPage(ROUTES.MONITORING);
  }, []);

  // Control page access
  const handleControlAccess = useCallback(() => {
    setControlAuthOpen(true);
  }, []);

  const handleControlAuthSuccess = useCallback(() => {
    setControlAuthOpen(false);
    setCurrentPage(ROUTES.CONTROL);
  }, []);

  const handleControlAuthClose = useCallback(() => {
    setControlAuthOpen(false);
  }, []);

  // Auto-return to monitoring after transport completes
  const handleTransportComplete = useCallback(() => {
    setCurrentPage(ROUTES.MONITORING);
  }, []);

  // Fix: destructure stable references to avoid depending on entire scada object
  const { setIsAuthenticated, setCurrentUser } = scada;
  const handleLogout = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: attachCsrfHeader('POST', {}),
      });
    } catch {
      // Keep local logout deterministic even when backend is temporarily unavailable.
    }

    setIsAuthenticated(false);
    setCurrentUser(null);
    setCurrentPage(ROUTES.LOGIN);
  }, [setIsAuthenticated, setCurrentUser]);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/auth/session`, {
          method: 'GET',
          credentials: 'include',
        });
        const result = await response.json().catch(() => null);
        if (!active) return;

        if (response.ok && result?.user) {
          setCurrentUser({
            id: result.user.id,
            username: result.user.username,
            fullname: result.user.fullname,
            role: result.user.role,
            active: result.user.active,
            stationId: result.user.stationId ?? null,
          });
          setIsAuthenticated(true);
          setCurrentPage((prev) => (prev === ROUTES.LOGIN ? ROUTES.MONITORING : prev));
        }
      } catch {
        // Ignore restore-session failures; login screen remains available.
      } finally {
        if (active) setSessionResolved(true);
      }
    };

    restoreSession();

    return () => {
      active = false;
    };
  }, [setCurrentUser, setIsAuthenticated]);

  const handleGoHome = useCallback(() => navigateTo(ROUTES.MONITORING), [navigateTo]);

  // Memoize the system status indicator
  const systemStatus = useMemo(() => {
    const isOnline = scada.robotState.isOnline;
    return {
      color: isOnline ? '#0BDF50' : '#C41C1C',
      label: isOnline ? 'ONLINE' : 'OFFLINE',
    };
  }, [scada.robotState.isOnline]);

  const isMaintenance = scada.maintenanceMode?.enabled;

  if (!sessionResolved) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
      </ThemeProvider>
    );
  }

  // === Pre-auth render ===
  if (!scada.isAuthenticated) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LoginPage scada={scada} onLogin={handleLogin} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      {/* === Top bar === */}
      <AppBar position="static" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1, minHeight: { xs: 64, sm: 72 } }}>
          {/* Back button: show on CONTROL and ADMIN pages only */}
          {(currentPage === ROUTES.CONTROL || currentPage === ROUTES.ADMIN) && (
            <Fade in>
              <IconButton
                color="inherit"
                onClick={handleGoHome}
                sx={{
                  mr: 0.5,
                  '&:hover': {
                    bgcolor: 'rgba(17, 17, 17, 0.06)',
                  },
                }}
                aria-label="Về trang giám sát"
              >
                <ArrowBack />
              </IconButton>
            </Fade>
          )}

          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #1976D2, #64B5F6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mr: 1,
              boxShadow: '0 8px 20px rgba(25, 118, 210, 0.32)',
            }}
          >
            <LocalHospital sx={{ fontSize: 20, color: '#111111' }} />
          </Box>

          <Box sx={{ flexGrow: 1 }}>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 800,
                letterSpacing: '0.04em',
                fontSize: { xs: '0.78rem', sm: '0.88rem', md: '0.95rem' },
                lineHeight: 1.2,
                color: '#111111',
              }}
            >
              HỆ THỐNG ĐIỀU KHIỂN VÀ QUẢN LÝ CABIN VẬN CHUYỂN TỰ ĐỘNG
            </Typography>
            {currentPage !== ROUTES.MONITORING && (
              <Typography
                sx={{
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  color: 'rgba(17, 17, 17, 0.56)',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                {PAGE_TITLES[currentPage] || 'Dashboard'}
              </Typography>
            )}
          </Box>

          {/* System status indicator */}
          <Chip
            icon={
              <FiberManualRecord
                sx={{
                  fontSize: '10px !important',
                  color: `${systemStatus.color} !important`,
                }}
              />
            }
            label={systemStatus.label}
            size="small"
            sx={{
              display: { xs: 'none', sm: 'flex' },
              bgcolor: alpha(systemStatus.color, 0.08),
              color: systemStatus.color,
              fontWeight: 700,
              fontSize: '0.68rem',
              minHeight: 30,
              letterSpacing: '0.06em',
              border: `1px solid ${alpha(systemStatus.color, 0.15)}`,
            }}
          />

          <LiveClock />

          <Chip
            label={`${scada.currentUser?.fullname ?? scada.currentUser?.username ?? 'N/A'}`}
            sx={{
              bgcolor: 'rgba(101, 181, 255, 0.18)',
              color: '#111111',
              fontWeight: 700,
              fontSize: '0.76rem',
              display: { xs: 'none', sm: 'flex' },
              border: '1px solid rgba(17, 17, 17, 0.12)',
            }}
          />

          {isMaintenance && (
            <Chip
              label="HỆ THỐNG ĐANG BẢO TRÌ"
              size="small"
              sx={{
              bgcolor: alpha('#FF9800', 0.16),
              color: '#E65100',
                fontWeight: 800,
                letterSpacing: '0.05em',
              border: `1px solid ${alpha('#FF9800', 0.5)}`,
                animation: 'flash-urgent 1s ease-in-out infinite',
              }}
            />
          )}

          <AudioAlertControls audioAlerts={audioAlerts} />

          <Button
            color="inherit"
            startIcon={<PowerSettingsNew />}
            onClick={handleLogout}
            sx={{
              ml: 0.5,
              fontWeight: 700,
              fontSize: '0.78rem',
              color: 'text.secondary',
              '&:hover': {
                bgcolor: 'rgba(196, 28, 28, 0.08)',
                color: '#C41C1C',
              },
            }}
          >
            Thoát
          </Button>
        </Toolbar>
      </AppBar>

      {/* === Page content === */}
      <Box
        component="main"
        sx={{
          minHeight: { xs: 'calc(100dvh - 64px)', sm: 'calc(100dvh - 72px)' },
          overflowY: 'visible',
          py: { xs: 2, md: 3 },
        }}
      >
        <Container maxWidth="xl" sx={{ px: { xs: 1.5, sm: 2 } }}>
          <PageContent
            currentPage={currentPage}
            navigateTo={navigateTo}
            scada={scada}
            onControlAccess={handleControlAccess}
            onTransportComplete={handleTransportComplete}
          />
        </Container>
      </Box>

      {/* === Control Auth Dialog === */}
      <ControlAuthDialog
        open={controlAuthOpen}
        onClose={handleControlAuthClose}
        onSuccess={handleControlAuthSuccess}
        scada={scada}
      />
    </ThemeProvider>
  );
}
