import { memo } from 'react';
import { ToggleButton, ToggleButtonGroup, Typography, Box, alpha } from '@mui/material';
import { PriorityHigh, Schedule } from '@mui/icons-material';
import { PRIORITY } from '../constants';

/**
 * Priority selector for specimen scanning (Routine vs STAT).
 */
const PrioritySelector = memo(function PrioritySelector({ value, onChange }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Typography variant="caption" fontWeight={700} sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
        Mức ưu tiên:
      </Typography>
      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={(_, newVal) => { if (newVal !== null) onChange(newVal); }}
        sx={{ height: 40 }}
      >
        <ToggleButton
          value={PRIORITY.ROUTINE}
          sx={{
            px: 2,
            fontWeight: 600,
            fontSize: '0.85rem',
            textTransform: 'none',
            borderRadius: '8px 0 0 8px !important',
            borderColor: alpha('#111111', 0.22),
            color: 'text.secondary',
            '&.Mui-selected': {
              bgcolor: alpha('#1976D2', 0.14),
              color: '#1976D2',
              borderColor: alpha('#1976D2', 0.45),
              '&:hover': { bgcolor: alpha('#1976D2', 0.2) },
            },
          }}
        >
          <Schedule sx={{ fontSize: 20, mr: 0.75 }} />
          Routine
        </ToggleButton>
        <ToggleButton
          value={PRIORITY.STAT}
          sx={{
            px: 2,
            fontWeight: 700,
            fontSize: '0.85rem',
            textTransform: 'none',
            borderRadius: '0 8px 8px 0 !important',
            borderColor: alpha('#111111', 0.22),
            color: 'text.secondary',
            '&.Mui-selected': {
              bgcolor: alpha('#1976D2', 0.14),
              color: '#1976D2',
              borderColor: alpha('#1976D2', 0.5),
              '&:hover': { bgcolor: alpha('#1976D2', 0.2) },
            },
          }}
        >
          <PriorityHigh sx={{ fontSize: 16, mr: 0.5 }} />
          STAT
        </ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
});

export default PrioritySelector;
