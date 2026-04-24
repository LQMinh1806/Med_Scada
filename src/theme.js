import { createTheme, alpha } from '@mui/material';

// Intercom-inspired palette from the new DESIGN.md source.
const INK = '#111111';
const CREAM = '#FAF9F6';
const OAT = '#DEDBD6';
const WARM_SAND = '#D3CEC6';
const ACCENT_BLUE = '#1976D2';
const REPORT_BLUE = '#65B5FF';
const REPORT_GREEN = '#0BDF50';
const REPORT_RED = '#C41C1C';
const MUTED_TEXT = '#626260';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: ACCENT_BLUE,
      light: '#64B5F6',
      dark: '#0D47A1',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: REPORT_BLUE,
      light: '#8BC7FF',
      dark: '#2D91EC',
      contrastText: '#111111',
    },
    error: {
      main: REPORT_RED,
      light: '#DC5757',
      dark: '#A91818',
    },
    warning: {
      main: '#FFC091',
      light: '#FFD9B9',
      dark: '#E49C66',
    },
    success: {
      main: REPORT_GREEN,
      light: '#4BE980',
      dark: '#05903A',
    },
    info: {
      main: REPORT_BLUE,
      light: '#A6D5FF',
      dark: '#4A9BE8',
    },
    background: {
      default: CREAM,
      paper: '#FFFFFF',
    },
    text: {
      primary: INK,
      secondary: MUTED_TEXT,
    },
    divider: alpha(INK, 0.12),
  },

  shape: {
    borderRadius: 8,
  },

  typography: {
    fontFamily: '"Sora", "IBM Plex Sans", "Segoe UI", sans-serif',
    h4: { fontWeight: 700, letterSpacing: '-0.02em', fontSize: '1.8rem' },
    h5: { fontWeight: 700, letterSpacing: '-0.015em', fontSize: '1.4rem' },
    h6: { fontWeight: 700, letterSpacing: '-0.005em', fontSize: '1.06rem' },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600, letterSpacing: '0.01em' },
    button: { fontWeight: 700, letterSpacing: '0.005em', textTransform: 'none' },
    body1: { lineHeight: 1.52 },
    body2: { lineHeight: 1.5 },
    caption: { fontWeight: 500, letterSpacing: '0.02em' },
  },

  components: {
    // === Global baseline ===
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          background: `linear-gradient(180deg, #FFFDF8 0%, ${CREAM} 60%, #EEF5FD 100%)`,
          backgroundAttachment: 'fixed',
          minHeight: '100dvh',
          color: INK,
        },
        '#root': {
          minHeight: '100dvh',
        },
        '*': {
          scrollbarWidth: 'thin',
          scrollbarColor: `${alpha(INK, 0.22)} transparent`,
        },
      },
    },

    // === AppBar ===
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: `linear-gradient(110deg, ${alpha('#FFFFFF', 0.92)} 0%, ${alpha(CREAM, 0.92)} 100%)`,
          backdropFilter: 'blur(12px) saturate(140%)',
          borderBottom: `1px solid ${alpha(INK, 0.12)}`,
          color: INK,
        },
      },
      defaultProps: {
        elevation: 0,
      },
    },

    // === Paper & Card ===
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          border: `1px solid ${alpha(OAT, 0.95)}`,
          boxShadow: `0 8px 24px ${alpha('#111111', 0.06)}`,
          backgroundImage: 'none',
          backgroundColor: '#FFFFFF',
        },
      },
      defaultProps: {
        elevation: 0,
      },
    },

    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          border: `1px solid ${alpha(OAT, 0.95)}`,
          boxShadow: `0 14px 28px ${alpha('#111111', 0.08)}`,
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          backgroundImage: 'none',
          backgroundColor: '#FFFFFF',
          '&:hover': {
            boxShadow: `0 18px 34px ${alpha('#111111', 0.1)}`,
            borderColor: alpha(ACCENT_BLUE, 0.34),
          },
        },
      },
      defaultProps: {
        elevation: 0,
      },
    },

    // === Buttons ===
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 700,
          paddingInline: 20,
          paddingBlock: 10,
          minHeight: 46,
          fontSize: '0.9rem',
          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          '@media (max-width:900px)': {
            minHeight: 44,
            paddingInline: 16,
            fontSize: '0.86rem',
          },
        },
        contained: {
          boxShadow: `0 8px 22px ${alpha(ACCENT_BLUE, 0.28)}`,
          '&:hover': {
            boxShadow: `0 12px 30px ${alpha(ACCENT_BLUE, 0.34)}`,
            transform: 'translateY(-1px) scale(1.02)',
          },
          '&:active': {
            transform: 'scale(0.98)',
          },
        },
        outlined: {
          borderWidth: '1px',
          borderColor: alpha(INK, 0.25),
          '&:hover': {
            borderWidth: '1px',
            borderColor: alpha(INK, 0.5),
            backgroundColor: alpha(INK, 0.03),
          },
        },
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: {
          minWidth: 44,
          minHeight: 44,
          transition: 'all 0.2s ease',
          '&:hover': {
            backgroundColor: alpha(INK, 0.06),
          },
        },
      },
    },

    // === Form inputs ===
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'medium',
      },
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 6,
            minHeight: 44,
            transition: 'box-shadow 0.25s ease',
            '&.Mui-focused': {
              boxShadow: `0 0 0 3px ${alpha(REPORT_BLUE, 0.24)}`,
            },
          },
        },
      },
    },

    MuiSelect: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          minHeight: 44,
          fontWeight: 700,
        },
      },
    },

    // === Table ===
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 700,
          backgroundColor: alpha(REPORT_BLUE, 0.14),
          color: INK,
          fontSize: '0.76rem',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          borderBottom: `1px solid ${alpha(INK, 0.1)}`,
        },
        root: {
          borderColor: alpha(INK, 0.08),
          padding: '8px 12px',
          fontSize: '0.82rem',
        },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background-color 0.15s ease',
          '&:nth-of-type(even)': {
            backgroundColor: alpha(REPORT_BLUE, 0.05),
          },
          '&:hover': {
            backgroundColor: `${alpha(ACCENT_BLUE, 0.06)} !important`,
          },
        },
      },
    },

    // === Chip ===
    MuiChip: {
      styleOverrides: {
        root: {
          minHeight: 30,
          fontWeight: 700,
          borderRadius: 24,
        },
      },
    },

    // === Dialog ===
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 10,
          boxShadow: `0 24px 50px ${alpha('#111111', 0.2)}, 0 0 0 1px ${alpha(INK, 0.08)}`,
          backgroundImage: 'none',
          backgroundColor: alpha('#FFFFFF', 0.98),
          backdropFilter: 'blur(10px)',
        },
      },
    },

    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontWeight: 800,
          fontSize: '1rem',
        },
      },
    },

    // === Tabs ===
    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 42,
        },
        indicator: {
          height: 3,
          borderRadius: '3px 3px 0 0',
          backgroundColor: ACCENT_BLUE,
          boxShadow: `0 0 10px ${alpha(ACCENT_BLUE, 0.45)}`,
        },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          fontWeight: 700,
          fontSize: '0.78rem',
          minHeight: 42,
          transition: 'all 0.2s ease',
          borderRadius: '6px 6px 0 0',
          '&:hover': {
            backgroundColor: alpha(REPORT_BLUE, 0.16),
          },
        },
      },
    },

    // === Alert ===
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          fontWeight: 600,
          border: `1px solid`,
          alignItems: 'center',
          '& .MuiAlert-icon': {
            opacity: 0.95,
            marginRight: 10,
          },
        },
        standardError: {
          borderColor: alpha(REPORT_RED, 0.22),
          backgroundColor: alpha(REPORT_RED, 0.08),
          boxShadow: `inset 4px 0 0 ${alpha(REPORT_RED, 0.78)}`,
        },
        standardWarning: {
          borderColor: alpha('#FFC091', 0.5),
          backgroundColor: alpha('#FFC091', 0.26),
          boxShadow: `inset 4px 0 0 ${alpha('#E49C66', 0.8)}`,
        },
        standardSuccess: {
          borderColor: alpha(REPORT_GREEN, 0.24),
          backgroundColor: alpha(REPORT_GREEN, 0.1),
          boxShadow: `inset 4px 0 0 ${alpha(REPORT_GREEN, 0.75)}`,
        },
        standardInfo: {
          borderColor: alpha(REPORT_BLUE, 0.3),
          backgroundColor: alpha(REPORT_BLUE, 0.14),
          boxShadow: `inset 4px 0 0 ${alpha(REPORT_BLUE, 0.8)}`,
        },
      },
    },

    // === Switch ===
    MuiSwitch: {
      styleOverrides: {
        root: {
          padding: 8,
        },
        track: {
          borderRadius: 14,
          minHeight: 26,
        },
      },
    },

    // === Tooltip ===
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          borderRadius: 6,
          fontWeight: 600,
          fontSize: '0.75rem',
          backgroundColor: alpha(INK, 0.94),
          backdropFilter: 'blur(8px)',
          border: `1px solid ${alpha(WARM_SAND, 0.9)}`,
        },
      },
    },
  },
});

export default theme;
