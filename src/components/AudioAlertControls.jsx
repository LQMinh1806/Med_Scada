import { memo, useCallback } from 'react';
import {
  Box,
  IconButton,
  Slider,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { VolumeUp, VolumeOff } from '@mui/icons-material';

/**
 * Compact audio controls for the AppBar or control panel.
 * Provides toggle and volume slider for SCADA audio alerts.
 */
const AudioAlertControls = memo(function AudioAlertControls({ audioAlerts }) {
  const { enabled, setEnabled, volume, setVolume } = audioAlerts;

  const handleToggle = useCallback(() => {
    setEnabled((prev) => !prev);
  }, [setEnabled]);

  const handleVolumeChange = useCallback(
    (_, newValue) => {
      setVolume(newValue / 100);
    },
    [setVolume]
  );

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.25,
        borderRadius: 2,
        bgcolor: enabled
          ? alpha('#65B5FF', 0.22)
          : alpha('#C41C1C', 0.08),
        border: `1px solid ${enabled
          ? alpha('#111111', 0.14)
          : alpha('#C41C1C', 0.2)
        }`,
        transition: 'all 0.2s ease',
      }}
    >
      <Tooltip title={enabled ? 'Tắt âm thanh' : 'Bật âm thanh'}>
        <IconButton
          size="small"
          onClick={handleToggle}
          sx={{
            color: enabled ? '#111111' : '#C41C1C',
            '&:hover': {
              bgcolor: alpha(enabled ? '#1976D2' : '#C41C1C', 0.12),
            },
          }}
        >
          {enabled ? <VolumeUp sx={{ fontSize: 18 }} /> : <VolumeOff sx={{ fontSize: 18 }} />}
        </IconButton>
      </Tooltip>

      {enabled && (
        <Slider
          size="small"
          value={Math.round(volume * 100)}
          onChange={handleVolumeChange}
          min={0}
          max={100}
          sx={{
            width: 60,
            color: '#1976D2',
            '& .MuiSlider-thumb': {
              width: 12,
              height: 12,
            },
            '& .MuiSlider-track': {
              height: 3,
            },
            '& .MuiSlider-rail': {
              height: 3,
              opacity: 0.2,
            },
          }}
        />
      )}

      <Typography
        sx={{
          fontSize: '0.6rem',
          fontWeight: 600,
          color: enabled ? '#111111' : '#C41C1C',
          opacity: 0.7,
          display: { xs: 'none', sm: 'block' },
          whiteSpace: 'nowrap',
        }}
      >
        {enabled ? `${Math.round(volume * 100)}%` : 'MUTED'}
      </Typography>
    </Box>
  );
});

export default AudioAlertControls;
