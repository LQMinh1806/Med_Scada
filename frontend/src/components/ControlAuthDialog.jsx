import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  TextField,
  Typography,
  alpha,
  keyframes,
  Fade,
} from '@mui/material';
import {
  Close as CloseIcon,
  Fingerprint as FingerprintIcon,
  Lock as LockIcon,
  CheckCircleOutlineOutlined as CheckCircleOutline,
  ErrorOutlineOutlined as ErrorOutline,
  PrecisionManufacturing,
} from '@mui/icons-material';
import { io } from 'socket.io-client';
import { attachCsrfHeader } from '../utils/csrf';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? '';
const FINGERPRINT_TIMEOUT_MS = 30_000;

// ── Animations ────────────────────────────────────────────────
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
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const checkBounce = keyframes`
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
`;

const FP_STATUS = {
  WAITING: 'waiting',
  SUCCESS: 'success',
  TIMEOUT: 'timeout',
  ERROR: 'error',
};

// ── Fingerprint Panel ────────────────────────────────────────
const FingerprintPanel = memo(function FingerprintPanel({ active, scada, onSuccess }) {
  const [status, setStatus] = useState(FP_STATUS.WAITING);
  const [progress, setProgress] = useState(100);
  const [errorMsg, setErrorMsg] = useState('');
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const progressRef = useRef(null);
  const startTimeRef = useRef(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (progressRef.current) { cancelAnimationFrame(progressRef.current); progressRef.current = null; }
    if (socketRef.current) {
      socketRef.current.emit('FINGERPRINT_LOGIN_CANCEL');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!active) { cleanup(); return; }

    setStatus(FP_STATUS.WAITING);
    setProgress(100);
    setErrorMsg('');

    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'], withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => socket.emit('FINGERPRINT_LOGIN_WAIT'));
    socket.on('connect_error', () => { setErrorMsg('Không thể kết nối máy chủ.'); setStatus(FP_STATUS.ERROR); });
    socket.on('LOGIN_ERROR', (data) => { setErrorMsg(String(data?.message || 'Lỗi phiên vân tay.')); setStatus(FP_STATUS.ERROR); });

    socket.on('LOGIN_SUCCESS', (data) => {
      setStatus(FP_STATUS.SUCCESS);
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }

      (async () => {
        try {
          if (!data.token || !data.user) return;
          const response = await fetch(`${API_BASE_URL}/auth/fingerprint-session`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: data.token }),
          });
          if (!response.ok) throw new Error('Session exchange failed.');

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

          setTimeout(() => onSuccess(), 700);
        } catch {
          setStatus(FP_STATUS.ERROR);
          setErrorMsg('Không thể thiết lập phiên đăng nhập.');
        }
      })();
    });

    startTimeRef.current = Date.now();
    const updateProgress = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, 1 - elapsed / FINGERPRINT_TIMEOUT_MS);
      setProgress(remaining * 100);
      if (remaining > 0) progressRef.current = requestAnimationFrame(updateProgress);
    };
    progressRef.current = requestAnimationFrame(updateProgress);

    timerRef.current = setTimeout(() => {
      setStatus(FP_STATUS.TIMEOUT);
      setErrorMsg('Hết thời gian chờ quét vân tay.');
      socket.emit('FINGERPRINT_LOGIN_CANCEL');
      socket.disconnect();
    }, FINGERPRINT_TIMEOUT_MS);

    return cleanup;
  }, [active, cleanup, onSuccess, scada]);

  if (status === FP_STATUS.SUCCESS) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 3, animation: `${fadeInUp} 0.4s ease-out` }}>
        <CheckCircleOutline sx={{ fontSize: 70, color: '#66BB6A', mb: 1.5, animation: `${checkBounce} 0.5s ease-out`, filter: 'drop-shadow(0 0 10px rgba(102,187,106,0.4))' }} />
        <Typography variant="h6" fontWeight={700} sx={{ color: 'success.main' }}>Xác thực thành công!</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Đang mở trang điều khiển...</Typography>
      </Box>
    );
  }

  if (status === FP_STATUS.TIMEOUT || status === FP_STATUS.ERROR) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 3, animation: `${fadeInUp} 0.4s ease-out` }}>
        <ErrorOutline sx={{ fontSize: 70, color: status === FP_STATUS.TIMEOUT ? '#FFA726' : '#EF5350', mb: 1.5, animation: `${checkBounce} 0.5s ease-out` }} />
        <Typography variant="h6" fontWeight={700} sx={{ color: status === FP_STATUS.TIMEOUT ? 'warning.main' : 'error.main' }}>
          {status === FP_STATUS.TIMEOUT ? 'Hết thời gian chờ' : 'Lỗi kết nối'}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>{errorMsg}</Typography>
      </Box>
    );
  }

  // WAITING
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 2, animation: `${fadeInUp} 0.5s ease-out` }}>
      <Box sx={{ position: 'relative', mb: 2.5 }}>
        <Box sx={{ position: 'absolute', inset: -16, borderRadius: '50%', border: `2px solid ${alpha('#1976D2', 0.25)}`, animation: `${pulseRing} 2s ease-in-out infinite` }} />
        <Box sx={{ position: 'absolute', inset: -8, borderRadius: '50%', border: `1.5px solid ${alpha('#1976D2', 0.15)}`, animation: `${pulseRing} 2s ease-in-out 0.5s infinite` }} />
        <Box sx={{ width: 90, height: 90, borderRadius: '50%', background: `linear-gradient(135deg, ${alpha('#1976D2', 0.15)}, ${alpha('#64B5F6', 0.08)})`, border: `1.5px solid ${alpha('#1976D2', 0.25)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          <FingerprintIcon sx={{ fontSize: 46, color: '#1976D2', filter: 'drop-shadow(0 0 6px rgba(25,118,210,0.4))' }} />
          <Box sx={{ position: 'absolute', left: '10%', right: '10%', height: 2, background: `linear-gradient(90deg, transparent, ${alpha('#1976D2', 0.8)}, transparent)`, animation: `${scanLine} 2s ease-in-out infinite`, boxShadow: `0 0 6px ${alpha('#1976D2', 0.6)}` }} />
        </Box>
      </Box>

      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Đang chờ quét vân tay...</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', mb: 2, maxWidth: 260 }}>
        Vui lòng đặt ngón tay lên cảm biến để xác thực vào trang điều khiển.
      </Typography>

      <Box sx={{ width: '100%', px: 1 }}>
        <LinearProgress
          variant="determinate"
          value={progress}
          sx={{
            height: 4, borderRadius: 2, backgroundColor: alpha('#1976D2', 0.1),
            '& .MuiLinearProgress-bar': { borderRadius: 2, background: 'linear-gradient(90deg, #1976D2, #64B5F6)', transition: 'none' },
          }}
        />
        <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 0.5, color: 'text.secondary', fontSize: '0.68rem' }}>
          Thời gian chờ: {Math.ceil((progress / 100) * (FINGERPRINT_TIMEOUT_MS / 1000))}s
        </Typography>
      </Box>
    </Box>
  );
});

// ── Password Panel ───────────────────────────────────────────
const PasswordPanel = memo(function PasswordPanel({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: attachCsrfHeader('POST', { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) { setError(result?.message || 'Đăng nhập thất bại.'); return; }
      if (!result?.user) { setError('Phản hồi không hợp lệ từ máy chủ.'); return; }
      onSuccess(result.user);
    } catch {
      setError('Không kết nối được máy chủ xác thực.');
    } finally {
      setIsSubmitting(false);
    }
  }, [username, password, onSuccess]);

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ pt: 1 }}>
      <TextField
        fullWidth label="Tên đăng nhập" margin="normal" variant="outlined" size="small"
        value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username"
      />
      <TextField
        fullWidth label="Mật khẩu" type="password" margin="normal" variant="outlined" size="small"
        value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
      />
      {error && (
        <Typography color="error" sx={{ mt: 1, fontWeight: 600, fontSize: '0.84rem', textAlign: 'center' }}>
          {error}
        </Typography>
      )}
      <Button
        fullWidth type="submit" variant="contained" size="large"
        disabled={isSubmitting}
        startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : <LockIcon />}
        sx={{
          mt: 2, py: 1.3, fontWeight: 800, fontSize: '0.9rem',
          background: 'linear-gradient(135deg, #1976D2, #64B5F6)',
          '&:hover': { background: 'linear-gradient(135deg, #1565C0, #1E88E5)', transform: 'translateY(-1px)' },
        }}
      >
        {isSubmitting ? 'ĐANG XÁC THỰC...' : 'XÁC NHẬN & VÀO ĐIỀU KHIỂN'}
      </Button>
    </Box>
  );
});

// ── Main Dialog ──────────────────────────────────────────────
const ControlAuthDialog = memo(function ControlAuthDialog({ open, onClose, onSuccess, scada }) {
  const [mode, setMode] = useState('password'); // 'password' | 'fingerprint'

  // Reset mode when dialog opens
  useEffect(() => {
    if (open) setMode('password');
  }, [open]);

  const handlePasswordSuccess = useCallback((user) => {
    // Update scada user context with the newly authenticated user
    scada.setCurrentUser({
      id: user.id,
      username: user.username,
      fullname: user.fullname,
      role: user.role,
      active: user.active,
      stationId: user.stationId ?? null,
    });
    if (typeof scada.hydratePersistedData === 'function') {
      scada.hydratePersistedData({ syncStations: false }).catch(() => null);
    }
    scada.setIsAuthenticated(true);
    if (typeof scada.reconnectSocket === 'function') scada.reconnectSocket();
    setTimeout(() => onSuccess(), 300);
  }, [scada, onSuccess]);

  const handleFingerprintSuccess = useCallback(() => {
    onSuccess();
  }, [onSuccess]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      TransitionComponent={Fade}
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            border: `1px solid ${alpha('#1976D2', 0.2)}`,
            boxShadow: `0 24px 60px ${alpha('#000', 0.18)}, 0 0 50px ${alpha('#1976D2', 0.08)}`,
          },
        },
      }}
    >
      <DialogTitle sx={{ pb: 1, pr: 6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{
            width: 36, height: 36, borderRadius: '8px',
            background: 'linear-gradient(135deg, #1976D2, #64B5F6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <PrecisionManufacturing sx={{ fontSize: 20, color: '#111' }} />
          </Box>
          <Box>
            <Typography fontWeight={800} sx={{ lineHeight: 1.2, fontSize: '1rem' }}>
              Xác thực để vào Điều khiển
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Cần xác thực bảo mật để truy cập trang điều khiển
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <IconButton
        onClick={onClose}
        sx={{ position: 'absolute', right: 8, top: 8, color: 'text.secondary', '&:hover': { bgcolor: alpha('#C41C1C', 0.08), color: 'error.main' } }}
      >
        <CloseIcon />
      </IconButton>

      {/* Mode Toggle */}
      <Box sx={{ display: 'flex', mx: 3, mb: 0, mt: 0, borderRadius: 2, overflow: 'hidden', border: `1px solid ${alpha('#1976D2', 0.2)}` }}>
        <Button
          fullWidth size="small"
          variant={mode === 'password' ? 'contained' : 'text'}
          startIcon={<LockIcon sx={{ fontSize: '16px !important' }} />}
          onClick={() => setMode('password')}
          sx={{ borderRadius: 0, fontWeight: 700, fontSize: '0.78rem', py: 0.9 }}
        >
          Mật khẩu
        </Button>
        <Divider orientation="vertical" flexItem />
        <Button
          fullWidth size="small"
          variant={mode === 'fingerprint' ? 'contained' : 'text'}
          startIcon={<FingerprintIcon sx={{ fontSize: '16px !important' }} />}
          onClick={() => setMode('fingerprint')}
          sx={{ borderRadius: 0, fontWeight: 700, fontSize: '0.78rem', py: 0.9 }}
        >
          Vân tay
        </Button>
      </Box>

      <DialogContent sx={{ pt: 2 }}>
        {mode === 'password' && (
          <PasswordPanel onSuccess={handlePasswordSuccess} />
        )}
        {mode === 'fingerprint' && (
          <FingerprintPanel active={mode === 'fingerprint'} scada={scada} onSuccess={handleFingerprintSuccess} />
        )}
      </DialogContent>
    </Dialog>
  );
});

export default ControlAuthDialog;
