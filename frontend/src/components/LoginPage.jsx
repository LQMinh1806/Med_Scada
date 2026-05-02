import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Card,
  Typography,
  TextField,
  Button,
  Fade,
  alpha,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  LinearProgress,
  keyframes,
} from '@mui/material';
import {
  LocalHospital,
  Login as LoginIcon,
  Fingerprint as FingerprintIcon,
  Close as CloseIcon,
  CheckCircleOutlineOutlined as CheckCircleOutline,
  ErrorOutlineOutlined as ErrorOutline,
} from '@mui/icons-material';
import { io } from 'socket.io-client';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

// FIX: Align socket URL fallback with useOpcUaSocket.js (empty string = same origin via Vite proxy)
// Previous code used `window.location.origin` which caused duplicate connections behind reverse proxies.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? '';

const FINGERPRINT_TIMEOUT_MS = 30_000;

// ── Animations ──────────────────────────────────────────────────────────────
const pulseRing = keyframes`
  0% { transform: scale(0.85); opacity: 0.6; }
  50% { transform: scale(1.15); opacity: 0.2; }
  100% { transform: scale(0.85); opacity: 0.6; }
`;

const scanLine = keyframes`
  0% { top: 10%; opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { top: 85%; opacity: 0; }
`;

const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
`;

const checkBounce = keyframes`
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
`;

// ── Fingerprint Modal Status ────────────────────────────────────────────────
const FP_STATUS = {
  WAITING: 'waiting',
  SUCCESS: 'success',
  TIMEOUT: 'timeout',
  ERROR: 'error',
};

// ── Fingerprint Waiting Modal ───────────────────────────────────────────────
const FingerprintModal = memo(function FingerprintModal({ open, onClose, onSuccess, scada }) {
  const [status, setStatus] = useState(FP_STATUS.WAITING);
  const [progress, setProgress] = useState(100);
  const [errorMsg, setErrorMsg] = useState('');
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const progressRef = useRef(null);
  const startTimeRef = useRef(null);

  // Clean up everything
  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (progressRef.current) {
      cancelAnimationFrame(progressRef.current);
      progressRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.emit('FINGERPRINT_LOGIN_CANCEL');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      cleanup();
      return;
    }

    setStatus(FP_STATUS.WAITING);
    setProgress(100);
    setErrorMsg('');

    // Connect to Socket.io
    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Fingerprint] Socket connected:', socket.id);
      socket.emit('FINGERPRINT_LOGIN_WAIT');
    });

    socket.on('connect_error', (err) => {
      console.error('[Fingerprint] Socket connect error:', err.message);
      setErrorMsg('Không thể kết nối máy chủ.');
      setStatus(FP_STATUS.ERROR);
    });
    socket.on('LOGIN_ERROR', (data) => {
      const message = String(data?.message || 'Không thể bắt đầu phiên đăng nhập vân tay.');
      setErrorMsg(message);
      setStatus(FP_STATUS.ERROR);
    });

    socket.on('LOGIN_SUCCESS', (data) => {
      console.log('[Fingerprint] LOGIN_SUCCESS received:', data);
      setStatus(FP_STATUS.SUCCESS);

      // Clear timeout
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      // Exchange JWT for HttpOnly auth cookie, then complete login
      (async () => {
        try {
          if (!data.token || !data.user) return;

          // Set HttpOnly cookie via dedicated endpoint so all subsequent API calls are authenticated
          const API = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
          const response = await fetch(`${API}/auth/fingerprint-session`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: data.token }),
          });
          if (!response.ok) {
            const result = await response.json().catch(() => null);
            throw new Error(result?.message || 'Fingerprint session exchange failed.');
          }

          scada.setCurrentUser({
            id: data.user.id,
            username: data.user.username,
            fullname: data.user.fullname,
            role: data.user.role,
            active: data.user.active,
            stationId: data.user.stationId ?? null,
          });

          if (typeof scada.hydratePersistedData === 'function') {
            scada.hydratePersistedData({ syncStations: false }).catch(() => null);
          }

          scada.setIsAuthenticated(true);
          if (typeof scada.reconnectSocket === 'function') scada.reconnectSocket();

          setTimeout(() => onSuccess(), 800);
        } catch (err) {
          console.error('[Fingerprint] Session setup failed:', err);
          setStatus(FP_STATUS.ERROR);
          setErrorMsg('Không thể thiết lập phiên đăng nhập.');
        }
      })();
    });

    // Start timeout countdown
    startTimeRef.current = Date.now();

    const updateProgress = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, 1 - elapsed / FINGERPRINT_TIMEOUT_MS);
      setProgress(remaining * 100);

      if (remaining > 0) {
        progressRef.current = requestAnimationFrame(updateProgress);
      }
    };
    progressRef.current = requestAnimationFrame(updateProgress);

    timerRef.current = setTimeout(() => {
      setStatus(FP_STATUS.TIMEOUT);
      setErrorMsg('Hết thời gian chờ quét vân tay.');
      socket.emit('FINGERPRINT_LOGIN_CANCEL');
      socket.disconnect();
    }, FINGERPRINT_TIMEOUT_MS);

    return cleanup;
  }, [open, cleanup, onSuccess, scada]);

  const handleClose = useCallback(() => {
    cleanup();
    onClose();
  }, [cleanup, onClose]);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            background: 'linear-gradient(180deg, #0f1923 0%, #152238 50%, #0d1520 100%)',
            border: `1px solid ${alpha('#65B5FF', 0.2)}`,
            boxShadow: `0 24px 80px ${alpha('#000', 0.5)}, 0 0 60px ${alpha('#1976D2', 0.15)}`,
            overflow: 'hidden',
          },
        },
      }}
    >
      {/* Close button */}
      <IconButton
        onClick={handleClose}
        sx={{
          position: 'absolute',
          right: 8,
          top: 8,
          color: alpha('#fff', 0.5),
          zIndex: 2,
          '&:hover': { color: '#fff', background: alpha('#fff', 0.08) },
        }}
      >
        <CloseIcon />
      </IconButton>

      <DialogContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          py: 5,
          px: 3,
          minHeight: 340,
        }}
      >
        {/* ── WAITING STATE ── */}
        {status === FP_STATUS.WAITING && (
          <Fade in timeout={500}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                animation: `${fadeInUp} 0.5s ease-out`,
              }}
            >
              {/* Fingerprint icon with pulse ring */}
              <Box sx={{ position: 'relative', mb: 3 }}>
                {/* Outer pulse ring */}
                <Box
                  sx={{
                    position: 'absolute',
                    inset: -18,
                    borderRadius: '50%',
                    border: `2px solid ${alpha('#64B5F6', 0.3)}`,
                    animation: `${pulseRing} 2s ease-in-out infinite`,
                  }}
                />
                {/* Second pulse ring, offset */}
                <Box
                  sx={{
                    position: 'absolute',
                    inset: -10,
                    borderRadius: '50%',
                    border: `1.5px solid ${alpha('#64B5F6', 0.2)}`,
                    animation: `${pulseRing} 2s ease-in-out 0.5s infinite`,
                  }}
                />
                {/* Fingerprint icon container */}
                <Box
                  sx={{
                    width: 100,
                    height: 100,
                    borderRadius: '50%',
                    background: `linear-gradient(135deg, ${alpha('#1976D2', 0.25)}, ${alpha('#64B5F6', 0.1)})`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `1.5px solid ${alpha('#64B5F6', 0.3)}`,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <FingerprintIcon
                    sx={{
                      fontSize: 52,
                      color: '#64B5F6',
                      filter: 'drop-shadow(0 0 8px rgba(100,181,246,0.4))',
                    }}
                  />
                  {/* Scanning line animation */}
                  <Box
                    sx={{
                      position: 'absolute',
                      left: '10%',
                      right: '10%',
                      height: 2,
                      background: `linear-gradient(90deg, transparent, ${alpha('#64B5F6', 0.8)}, transparent)`,
                      animation: `${scanLine} 2s ease-in-out infinite`,
                      boxShadow: `0 0 8px ${alpha('#64B5F6', 0.6)}`,
                    }}
                  />
                </Box>
              </Box>

              <Typography
                variant="h6"
                sx={{
                  color: '#E3F2FD',
                  fontWeight: 700,
                  mb: 0.5,
                  textAlign: 'center',
                }}
              >
                Đang chờ quét vân tay...
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: alpha('#B3D9FF', 0.7),
                  textAlign: 'center',
                  mb: 3,
                  maxWidth: 280,
                }}
              >
                Vui lòng đặt ngón tay lên cảm biến vân tay để đăng nhập vào hệ thống.
              </Typography>

              {/* Progress bar (countdown) */}
              <Box sx={{ width: '100%', px: 2 }}>
                <LinearProgress
                  variant="determinate"
                  value={progress}
                  sx={{
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: alpha('#fff', 0.06),
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 2,
                      background: `linear-gradient(90deg, #1976D2, #64B5F6)`,
                      transition: 'none',
                    },
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    textAlign: 'center',
                    mt: 1,
                    color: alpha('#B3D9FF', 0.5),
                    fontSize: '0.7rem',
                  }}
                >
                  Thời gian chờ: {Math.ceil((progress / 100) * (FINGERPRINT_TIMEOUT_MS / 1000))}s
                </Typography>
              </Box>
            </Box>
          </Fade>
        )}

        {/* ── SUCCESS STATE ── */}
        {status === FP_STATUS.SUCCESS && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              animation: `${fadeInUp} 0.4s ease-out`,
            }}
          >
            <CheckCircleOutline
              sx={{
                fontSize: 80,
                color: '#66BB6A',
                mb: 2,
                animation: `${checkBounce} 0.5s ease-out`,
                filter: 'drop-shadow(0 0 12px rgba(102,187,106,0.4))',
              }}
            />
            <Typography
              variant="h6"
              sx={{ color: '#C8E6C9', fontWeight: 700, mb: 0.5 }}
            >
              Xác thực thành công!
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: alpha('#A5D6A7', 0.7), textAlign: 'center' }}
            >
              Đang chuyển hướng vào hệ thống...
            </Typography>
          </Box>
        )}

        {/* ── TIMEOUT / ERROR STATE ── */}
        {(status === FP_STATUS.TIMEOUT || status === FP_STATUS.ERROR) && (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              animation: `${fadeInUp} 0.4s ease-out`,
            }}
          >
            <ErrorOutline
              sx={{
                fontSize: 80,
                color: status === FP_STATUS.TIMEOUT ? '#FFA726' : '#EF5350',
                mb: 2,
                animation: `${checkBounce} 0.5s ease-out`,
                filter:
                  status === FP_STATUS.TIMEOUT
                    ? 'drop-shadow(0 0 12px rgba(255,167,38,0.4))'
                    : 'drop-shadow(0 0 12px rgba(239,83,80,0.4))',
              }}
            />
            <Typography
              variant="h6"
              sx={{
                color: status === FP_STATUS.TIMEOUT ? '#FFE0B2' : '#FFCDD2',
                fontWeight: 700,
                mb: 0.5,
              }}
            >
              {status === FP_STATUS.TIMEOUT ? 'Hết thời gian chờ' : 'Lỗi kết nối'}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: alpha('#fff', 0.5),
                textAlign: 'center',
                mb: 3,
              }}
            >
              {errorMsg}
            </Typography>
            <Button
              variant="outlined"
              onClick={handleClose}
              sx={{
                borderColor: alpha('#fff', 0.2),
                color: '#B3D9FF',
                '&:hover': {
                  borderColor: alpha('#64B5F6', 0.5),
                  background: alpha('#fff', 0.04),
                },
              }}
            >
              Đóng
            </Button>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
});

// ── Login Page ──────────────────────────────────────────────────────────────
const LoginPage = memo(function LoginPage({ scada, onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fingerprintModalOpen, setFingerprintModalOpen] = useState(false);

  const handleLogin = useCallback(
    async (event) => {
      event.preventDefault();
      setError('');
      setIsSubmitting(true);

      const normalizedUsername = username.trim();

      try {
        const response = await fetch(`${API_BASE_URL}/auth/login`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username: normalizedUsername,
            password,
          }),
        });

        const result = await response.json().catch(() => null);

        if (!response.ok) {
          setError(result?.message || 'Đăng nhập thất bại.');
          return;
        }

        if (!result?.user) {
          setError('Phản hồi đăng nhập không hợp lệ từ máy chủ.');
          return;
        }

        scada.setCurrentUser({
          id: result.user.id,
          username: result.user.username,
          fullname: result.user.fullname,
          role: result.user.role,
          active: result.user.active,
          stationId: result.user.stationId ?? null,
        });

        if (typeof scada.hydratePersistedData === 'function') {
          await scada.hydratePersistedData({ syncStations: false }).catch(() => null);
        }

        scada.setIsAuthenticated(true);
        if (typeof scada.reconnectSocket === 'function') scada.reconnectSocket();
        onLogin();
      } catch {
        setError('Không kết nối được máy chủ xác thực.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [onLogin, password, scada, username]
  );

  const handleOpenFingerprintModal = useCallback(() => {
    setFingerprintModalOpen(true);
  }, []);

  const handleCloseFingerprintModal = useCallback(() => {
    setFingerprintModalOpen(false);
  }, []);

  const handleFingerprintSuccess = useCallback(() => {
    setFingerprintModalOpen(false);
    onLogin();
  }, [onLogin]);

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        background: `
          radial-gradient(circle at 16% 20%, rgba(25, 118, 210, 0.14), transparent 32%),
          radial-gradient(circle at 88% 10%, rgba(101, 181, 255, 0.2), transparent 34%),
          linear-gradient(180deg, #fffdf8 0%, #faf9f6 56%, #f1ede7 100%)
        `,
      }}
    >

      <Fade in timeout={800}>
        <Card
          sx={{
            maxWidth: 440,
            width: '92%',
            p: { xs: 3, sm: 4 },
            background: `${alpha('#FFFFFF', 0.92)}`,
            backdropFilter: 'blur(10px) saturate(135%)',
            border: `1px solid ${alpha('#111111', 0.1)}`,
            boxShadow: `
              0 0 0 1px ${alpha('#FFFFFF', 0.8)},
              0 22px 50px ${alpha('#111111', 0.16)},
              0 0 90px ${alpha('#65B5FF', 0.18)}
            `,
            borderRadius: 3,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Box
              sx={{
                width: 80,
                height: 80,
                borderRadius: '18px',
                background: 'linear-gradient(130deg, #1976D2, #64B5F6 50%, #81D4FA)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2.5,
                boxShadow: `0 10px 28px ${alpha('#1976D2', 0.35)}, 0 0 0 1px ${alpha('#111111', 0.12)}`,
                position: 'relative',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  inset: -4,
                  borderRadius: '22px',
                  border: `2px solid ${alpha('#111111', 0.1)}`,
                },
              }}
            >
              <LocalHospital sx={{ fontSize: 40, color: '#111' }} />
            </Box>
            <Typography
              variant="h5"
              fontWeight={900}
              sx={{
                color: 'text.primary',
              }}
            >
              HỆ THỐNG SCADA
            </Typography>
            <Typography
              variant="subtitle2"
              sx={{
                mt: 0.5,
                fontWeight: 500,
                color: 'text.secondary',
              }}
            >
              Logistics Mẫu Bệnh Phẩm Tự Động
            </Typography>
          </Box>

          <form onSubmit={handleLogin}>
            <TextField
              fullWidth
              label="Tên đăng nhập"
              margin="normal"
              variant="outlined"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              sx={{
                '& .MuiOutlinedInput-root': {
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: alpha('#1976D2', 0.4),
                  },
                },
              }}
            />
            <TextField
              fullWidth
              label="Mật khẩu"
              type="password"
              margin="normal"
              variant="outlined"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              sx={{
                '& .MuiOutlinedInput-root': {
                  '&:hover .MuiOutlinedInput-notchedOutline': {
                    borderColor: alpha('#1976D2', 0.4),
                  },
                },
              }}
            />

            {error && (
              <Fade in>
                <Typography
                  color="error"
                  sx={{
                    mt: 1,
                    fontWeight: 600,
                    textAlign: 'center',
                    fontSize: '0.87rem',
                  }}
                >
                  {error}
                </Typography>
              </Fade>
            )}

            <Button
              fullWidth
              type="submit"
              variant="contained"
              size="large"
              disabled={isSubmitting}
              startIcon={
                isSubmitting ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <LoginIcon />
                )
              }
              sx={{
                mt: 3,
                py: 1.5,
                fontSize: '0.95rem',
                fontWeight: 800,
                color: '#fff',
                background: 'linear-gradient(135deg, #1976D2, #64B5F6)',
                boxShadow: `0 6px 20px ${alpha('#1976D2', 0.28)}`,
                '&:hover': {
                  background: 'linear-gradient(135deg, #1565C0, #1E88E5)',
                  boxShadow: `0 10px 26px ${alpha('#1976D2', 0.34)}`,
                  transform: 'translateY(-1px)',
                },
                '&:active': {
                  transform: 'translateY(0)',
                },
              }}
            >
              {isSubmitting ? 'ĐANG ĐĂNG NHẬP...' : 'ĐĂNG NHẬP'}
            </Button>
          </form>

          {/* ── Divider ── */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              my: 2.5,
              gap: 1.5,
            }}
          >
            <Box sx={{ flex: 1, height: '1px', background: alpha('#111', 0.1) }} />
            <Typography
              variant="caption"
              sx={{ color: alpha('#626260', 0.6), fontSize: '0.7rem', letterSpacing: '0.08em' }}
            >
              HOẶC
            </Typography>
            <Box sx={{ flex: 1, height: '1px', background: alpha('#111', 0.1) }} />
          </Box>

          {/* ── Fingerprint Login Button ── */}
          <Button
            id="fingerprint-login-btn"
            fullWidth
            variant="outlined"
            size="large"
            onClick={handleOpenFingerprintModal}
            startIcon={
              <FingerprintIcon
                sx={{
                  fontSize: '1.4rem !important',
                }}
              />
            }
            sx={{
              py: 1.3,
              fontSize: '0.88rem',
              fontWeight: 700,
              color: '#1976D2',
              borderColor: alpha('#1976D2', 0.3),
              borderWidth: 1.5,
              background: alpha('#E3F2FD', 0.3),
              transition: 'all 0.2s ease',
              '&:hover': {
                borderColor: '#1976D2',
                background: alpha('#E3F2FD', 0.6),
                boxShadow: `0 4px 16px ${alpha('#1976D2', 0.15)}`,
                transform: 'translateY(-1px)',
              },
              '&:active': {
                transform: 'translateY(0)',
              },
            }}
          >
            ĐĂNG NHẬP BẰNG VÂN TAY
          </Button>

          {/* Version info */}
          <Typography
            sx={{
              textAlign: 'center',
              mt: 3,
              fontSize: '0.65rem',
              color: alpha('#626260', 0.8),
              letterSpacing: '0.06em',
            }}
          >
            SCADA Medical Transport v2.0 • Powered by CABIN-01
          </Typography>
        </Card>
      </Fade>

      {/* ── Fingerprint Modal ── */}
      <FingerprintModal
        open={fingerprintModalOpen}
        onClose={handleCloseFingerprintModal}
        onSuccess={handleFingerprintSuccess}
        scada={scada}
      />
    </Box>
  );
});

export default LoginPage;
