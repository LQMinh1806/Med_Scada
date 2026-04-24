import { Component } from 'react';
import { Alert, Box, Button, Paper, Typography } from '@mui/material';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
    this.handleReload = this.handleReload.bind(this);
    this.handleClearScadaCache = this.handleClearScadaCache.bind(this);
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: String(error?.message || 'Unknown runtime error'),
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error('UI_CRASH_ERROR_BOUNDARY', error, errorInfo);
  }

  handleReload() {
    window.location.reload();
  }

  handleClearScadaCache() {
    Object.keys(localStorage)
      .filter((key) => key.startsWith('scada:'))
      .forEach((key) => {
        localStorage.removeItem(key);
      });
    window.location.reload();
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <Box
        sx={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 2,
          background: 'linear-gradient(180deg, #0B1426 0%, #0F1923 100%)',
        }}
      >
        <Paper sx={{ p: 3, width: '100%', maxWidth: 560 }}>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
            Giao diện tạm thời bị gián đoạn do lỗi hệ thống
          </Typography>
          <Alert severity="error" sx={{ mb: 2 }}>
            {this.state.errorMessage}
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Vui lòng tải lại hệ thống. Nếu lỗi tiếp tục xảy ra, xin hãy liên hệ kỹ thuật viên.
          </Typography>
          <Button variant="contained" onClick={this.handleReload} sx={{ fontWeight: 700, mr: 1 }}>
            Tải lại hệ thống
          </Button>
          <Button
            variant="outlined"
            onClick={this.handleClearScadaCache}
            sx={{ fontWeight: 700 }}
          >
            Xóa Cache & Khởi động lại
          </Button>
        </Paper>
      </Box>
    );
  }
}

export default ErrorBoundary;
