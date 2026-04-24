import { memo } from 'react';
import { Box, Fade } from '@mui/material';

/**
 * TabPanel with smooth Fade transition.
 * Only renders children when active (lazy mount).
 */
const TabPanel = memo(function TabPanel({ children, value, index }) {
  const isActive = value === index;

  return (
    <Box
      role="tabpanel"
      hidden={!isActive}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      sx={{ py: 3 }}
    >
      {isActive && (
        <Fade in timeout={350}>
          <Box>{children}</Box>
        </Fade>
      )}
    </Box>
  );
});

export default TabPanel;