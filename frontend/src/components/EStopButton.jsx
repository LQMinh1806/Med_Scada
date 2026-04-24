import { memo, useCallback, useState } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography, Box, alpha } from '@mui/material';
import { PowerOff } from '@mui/icons-material';

/**
 * Emergency Stop (E-Stop) button with confirmation dialog.
 * Prominent red button that requires confirmation before executing.
 */
const EStopButton = memo(function EStopButton({ onEStop, disabled = false }) {
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
          bgcolor: '#1976D2',
          color: '#fff',
          fontWeight: 900,
          fontSize: '0.85rem',
          py: 0.6,
          px: 2,
          borderRadius: 1,
          border: '2px solid #115293',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          boxShadow: `0 8px 18px ${alpha('#1976D2', 0.35)}`,
          transition: 'all 0.2s ease',
          '&:hover': {
            bgcolor: '#115293',
          },
          '&.Mui-disabled': {
            bgcolor: alpha('#1976D2', 0.3),
            border: `2px solid ${alpha('#115293', 0.2)}`,
          },
        }}
      >
        E-STOP
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
