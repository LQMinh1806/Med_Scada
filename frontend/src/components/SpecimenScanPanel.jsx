import { memo, useCallback, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
  alpha,
  Fade,
} from '@mui/material';
import { QrCodeScanner, PriorityHigh } from '@mui/icons-material';
import PrioritySelector from './PrioritySelector';
import { PRIORITY, TEST_TYPES, PATIENT_NAMES } from '../constants';

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildMockSpecimen(barcodeOverride, priority) {
  const randomCode = `SP-${Math.floor(100000 + Math.random() * 900000)}`;
  return {
    barcode: (barcodeOverride || randomCode).trim(),
    patientName: randomItem(PATIENT_NAMES),
    testType: randomItem(TEST_TYPES),
    priority,
    scanTime: new Date().toLocaleString(),
  };
}

/**
 * Specimen scanning panel with priority selection.
 * Handles barcode input, mock scanning, and displays current specimen info.
 */
const SpecimenScanPanel = memo(function SpecimenScanPanel({
  currentSpecimen,
  onScan,
  onClear,
}) {
  const [scannerInput, setScannerInput] = useState('');
  const [scanError, setScanError] = useState('');
  const [priority, setPriority] = useState(PRIORITY.ROUTINE);

  const isSTAT = currentSpecimen?.priority === PRIORITY.STAT;

  const handleScan = useCallback(
    (barcodeValue) => {
      const value = (barcodeValue || '').trim();
      if (!value) {
        setScanError('Vui lòng nhập/quét barcode trước khi dispatch.');
        return;
      }
      const result = onScan(buildMockSpecimen(value, priority));
      if (result) {
        setScanError('');
        setScannerInput('');
      }
    },
    [onScan, priority]
  );

  const handleScannerKeyDown = useCallback(
    (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      handleScan(scannerInput);
    },
    [handleScan, scannerInput]
  );

  const handleSimulateScan = useCallback(() => {
    const result = onScan(buildMockSpecimen(null, priority));
    if (result) setScanError('');
  }, [onScan, priority]);

  const handleClear = useCallback(() => {
    onClear();
    setScanError('');
  }, [onClear]);

  return (
    <Paper
      sx={{
        p: 1,
        mb: 1,
        borderLeft: isSTAT ? '6px solid #C41C1C' : '6px solid #1976D2',
        transition: 'border-color 0.3s ease',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <QrCodeScanner sx={{ color: '#1976D2' }} />
          <Typography variant="subtitle1" fontWeight={800} sx={{ color: 'text.primary' }}>
            THÔNG TIN MẪU BỆNH PHẨM
          </Typography>
        </Box>
        <PrioritySelector value={priority} onChange={setPriority} />
      </Box>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 1 }}>
        <TextField
          fullWidth
          label="Quét barcode (nhấn Enter)"
          value={scannerInput}
          onChange={(e) => setScannerInput(e.target.value)}
          onKeyDown={handleScannerKeyDown}
          placeholder="VD: SP-238901"
          InputProps={{ sx: { minHeight: 40, fontSize: '0.95rem' } }}
          InputLabelProps={{ sx: { fontSize: '1rem' } }}
        />
        <Button
          variant="contained"
          onClick={() => handleScan(scannerInput)}
          sx={{ minWidth: 140, minHeight: 40, fontWeight: 700, fontSize: '0.9rem' }}
          startIcon={<QrCodeScanner />}
        >
          Quét
        </Button>
        <Button
          variant="outlined"
          onClick={handleSimulateScan}
          sx={{ minWidth: 160, minHeight: 40, fontWeight: 700, fontSize: '0.9rem' }}
        >
          Simulate Scan
        </Button>
      </Stack>

      {scanError && (
        <Fade in>
          <Alert severity="error" sx={{ mb: 1 }}>
            {scanError}
          </Alert>
        </Fade>
      )}

      {currentSpecimen ? (
        <Fade in>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              bgcolor: isSTAT ? alpha('#C41C1C', 0.07) : alpha('#65B5FF', 0.13),
              border: `1px solid ${isSTAT ? alpha('#C41C1C', 0.24) : alpha('#65B5FF', 0.28)}`,
            }}
          >
            <Grid container spacing={1.5}>
              <Grid item xs={12} sm={6} md={3}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  Barcode
                </Typography>
                <Typography
                  fontWeight={700}
                  sx={{
                    fontFamily: '"IBM Plex Mono", monospace',
                    color: 'text.primary',
                  }}
                >
                  {currentSpecimen.barcode}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6} md={2.5}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  Bệnh nhân
                </Typography>
                <Typography fontWeight={700} sx={{ color: 'text.primary' }}>
                  {currentSpecimen.patientName}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  Xét nghiệm
                </Typography>
                <Typography fontWeight={700} sx={{ color: 'text.primary' }}>
                  {currentSpecimen.testType}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6} md={2.5}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  Thời gian quét
                </Typography>
                <Typography fontWeight={700} sx={{ color: 'text.primary' }}>
                  {currentSpecimen.scanTime}
                </Typography>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  Ưu tiên
                </Typography>
                <Chip
                  icon={isSTAT ? <PriorityHigh sx={{ fontSize: '14px !important' }} /> : undefined}
                  label={isSTAT ? 'STAT' : 'Routine'}
                size="medium"
                  sx={{
                    mt: 0.3,
                    fontWeight: 800,
                    bgcolor: isSTAT ? '#C41C1C' : '#0BDF50',
                    color: '#111',
                  }}
                />
              </Grid>
              <Grid item xs={12}>
                <Button size="small" color="inherit" onClick={handleClear} sx={{ color: 'text.secondary' }}>
                  Xóa mẫu hiện tại
                </Button>
              </Grid>
            </Grid>
          </Box>
        </Fade>
      ) : (
        <Alert severity="info" sx={{ fontWeight: 600 }}>
          Chưa có thông tin mẫu. Dispatch Cabin sẽ bị vô hiệu hóa đến khi quét xong.
        </Alert>
      )}
    </Paper>
  );
});

export default SpecimenScanPanel;
