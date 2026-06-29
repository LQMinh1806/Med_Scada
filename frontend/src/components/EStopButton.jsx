import { memo, useCallback, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography, Box, alpha } from '@mui/material';
import { PowerOff } from '@mui/icons-material';

/**
 * Emergency Stop (E-Stop) button with confirmation dialog.
 * Prominent red button that requires confirmation before executing.
 *
 * @param {Object} props
 * @param {Function} props.onEStop - Callback when E-Stop is confirmed
 * @param {boolean} props.disabled - Whether the button is disabled
 * @param {boolean} props.hwEStopActive - True when the physical hardware E-Stop button (I1.2) is engaged
 */
const EStopButton = memo(function EStopButton({ onEStop, disabled = false, hwEStopActive = false }) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleClick = useCallback(() => setConfirmOpen(true), []);
  const handleClose = useCallback(() => setConfirmOpen(false), []);
  const handleConfirm = useCallback(() => {
    onEStop();
    setConfirmOpen(false);
  }, [onEStop]);

  return (
    <>
      <Button
        variant="contained"
        onClick={handleClick}
        disabled={disabled}
        startIcon={<PowerOff />}
        sx={{
          bgcolor: hwEStopActive ? '#C41C1C' : '#1976D2',
          color: '#fff',
          fontWeight: 900,
          fontSize: '0.85rem',
          py: 0.6,
          px: 2,
          borderRadius: 1,
          border: hwEStopActive ? '2px solid #8B0000' : '2px solid #115293',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          boxShadow: hwEStopActive
            ? `0 8px 18px ${alpha('#C41C1C', 0.5)}`
            : `0 8px 18px ${alpha('#1976D2', 0.35)}`,
          transition: 'all 0.2s ease',
          animation: hwEStopActive ? 'flash-urgent 1.2s ease-in-out infinite' : 'none',
          '&:hover': {
            bgcolor: hwEStopActive ? '#8B0000' : '#115293',
          },
          '&.Mui-disabled': {
            bgcolor: alpha('#1976D2', 0.3),
            border: `2px solid ${alpha('#115293', 0.2)}`,
          },
        }}
      >
        {hwEStopActive ? 'HUỶ E-STOP [PLC]' : 'E-STOP'}
      </Button>

      <Dialog open={confirmOpen} onClose={handleClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ bgcolor: '#C41C1C', color: '#fff', textAlign: 'center' }}>
          XÁC NHẬN DỪNG KHẨN CẤP
        </DialogTitle>
        <DialogContent sx={{ textAlign: 'center', pt: 3 }}>
          <Typography variant="body1" fontWeight={600}>
            Bạn có chắc muốn kích hoạt <strong>E-STOP</strong>?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Cabin sẽ dừng ngay lập tức tại vị trí hiện tại và cần thao tác kỹ thuật để khôi phục.
          </Typography>
          {hwEStopActive && (
            <Typography variant="body2" sx={{ mt: 1.5, color: '#C41C1C', fontWeight: 700 }}>
              ⚠ PLC đang báo Dừng khẩn cấp! Hãy giải phóng nút Dừng khẩn cấp trên phần cứng trước.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 3, gap: 2 }}>
          <Button variant="outlined" onClick={handleClose} sx={{ minWidth: 120 }}>
            Hủy
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleConfirm}
            sx={{ minWidth: 120, fontWeight: 800 }}
          >
            XÁC NHẬN E-STOP
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
});

export default EStopButton;
