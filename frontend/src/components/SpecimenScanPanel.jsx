import { memo, useCallback, useState, useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  alpha,
  Fade,
  Zoom,
  keyframes,
} from '@mui/material';
import {
  QrCodeScanner,
  Delete,
  CheckCircle,
  ErrorOutlineOutlined,
} from '@mui/icons-material';

const flashGreen = keyframes`
  0% { background-color: transparent; }
  20% { background-color: rgba(11, 223, 80, 0.25); }
  100% { background-color: transparent; }
`;

const flashRed = keyframes`
  0% { background-color: transparent; }
  20% { background-color: rgba(196, 28, 28, 0.2); }
  100% { background-color: transparent; }
`;

const slideIn = keyframes`
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
`;


/**
 * Batch Specimen Scanning Panel with global HID barcode scanner support.
 * - Listens for keyboard events globally (HID scanners behave like keyboards)
 * - Looks up scanned barcodes via API to get patient data
 * - Maintains a scan list that can be dispatched as a batch
 */
const SpecimenScanPanel = memo(function SpecimenScanPanel({
  scanList,
  onLookupBarcode,
  onRemoveFromList,
  onClearList,
  onUpdateDestination,
  stations = [],
  scanFeedback,
}) {
  const [manualInput, setManualInput] = useState('');
  const scanBufferRef = useRef('');
  const scanTimerRef = useRef(null);
  const containerRef = useRef(null);

  // ── Global keyboard listener for HID barcode scanner ──────────────────
  useEffect(() => {
    const SCAN_CHAR_TIMEOUT_MS = 50; // Barcode scanners type chars < 50ms apart

    const handleKeyDown = (event) => {
      // Skip if user is typing in an input/textarea
      const tagName = event.target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return;
      }

      // Enter key = end of barcode scan
      if (event.key === 'Enter' && scanBufferRef.current.length > 2) {
        event.preventDefault();
        const barcode = scanBufferRef.current.trim();
        scanBufferRef.current = '';
        if (scanTimerRef.current) {
          clearTimeout(scanTimerRef.current);
          scanTimerRef.current = null;
        }
        if (barcode) {
          onLookupBarcode(barcode);
        }
        return;
      }

      // Only accumulate printable characters
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        scanBufferRef.current += event.key;

        // Reset timer — if no more chars arrive within timeout, clear buffer
        if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
        scanTimerRef.current = setTimeout(() => {
          scanBufferRef.current = '';
          scanTimerRef.current = null;
        }, SCAN_CHAR_TIMEOUT_MS);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
    };
  }, [onLookupBarcode]);

  // ── Manual barcode entry ──────────────────────────────────────────────
  const handleManualScan = useCallback(() => {
    const barcode = manualInput.trim();
    if (!barcode) return;
    onLookupBarcode(barcode);
    setManualInput('');
  }, [manualInput, onLookupBarcode]);

  const handleManualKeyDown = useCallback(
    (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleManualScan();
      }
    },
    [handleManualScan]
  );

  const missingDestinationCount = scanList.filter((specimen) => !specimen.destinationStationId).length;

  return (
    <Paper
      ref={containerRef}
      sx={{
        p: 1.5,
        mb: 1,
        borderLeft: '6px solid #1976D2',
        transition: 'border-color 0.3s ease',
        position: 'relative',
        overflow: 'hidden',
        ...(scanFeedback === 'success' && {
          animation: `${flashGreen} 0.6s ease-out`,
        }),
        ...(scanFeedback === 'error' && {
          animation: `${flashRed} 0.6s ease-out`,
        }),
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          mb: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <QrCodeScanner sx={{ color: '#1976D2' }} />
          <Typography
            variant="subtitle1"
            fontWeight={800}
            sx={{ color: 'text.primary' }}
          >
            QUÉT MẪU BỆNH PHẨM
          </Typography>
          {scanList.length > 0 && (
            <Chip
              label={`${scanList.length} mẫu`}
              size="small"
              sx={{
                fontWeight: 700,
                bgcolor: alpha('#1976D2', 0.12),
                color: '#1976D2',
                border: `1px solid ${alpha('#1976D2', 0.2)}`,
              }}
            />
          )}
        </Box>
      </Box>

      {/* Manual input row */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 1 }}>
        <TextField
          fullWidth
          label="Nhập mã vạch (hoặc quét bằng máy)"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          onKeyDown={handleManualKeyDown}
          placeholder="Quét tự động hoặc nhập tay..."
          InputProps={{ sx: { minHeight: 40, fontSize: '0.95rem' } }}
          InputLabelProps={{ sx: { fontSize: '1rem' } }}
          autoComplete="off"
        />
        <Button
          variant="contained"
          onClick={handleManualScan}
          sx={{
            minWidth: 140,
            minHeight: 40,
            fontWeight: 700,
            fontSize: '0.9rem',
          }}
          startIcon={<QrCodeScanner />}
        >
          Tra cứu
        </Button>
        {scanList.length > 0 && (
          <Button
            variant="outlined"
            color="error"
            onClick={onClearList}
            sx={{ minWidth: 120, minHeight: 40, fontWeight: 700, fontSize: '0.9rem' }}
          >
            Xóa tất cả
          </Button>
        )}
      </Stack>

      {/* Scan feedback message */}
      {scanFeedback === 'success' && (
        <Fade in timeout={200}>
          <Alert
            severity="success"
            icon={<CheckCircle />}
            sx={{
              mb: 1,
              fontWeight: 600,
              animation: `${slideIn} 0.3s ease-out`,
            }}
          >
            Đã thêm mẫu vào danh sách!
          </Alert>
        </Fade>
      )}
      {scanFeedback === 'error' && (
        <Fade in timeout={200}>
          <Alert
            severity="error"
            icon={<ErrorOutlineOutlined />}
            sx={{
              mb: 1,
              fontWeight: 600,
              animation: `${slideIn} 0.3s ease-out`,
            }}
          >
            Không tìm thấy mẫu trong hệ thống!
          </Alert>
        </Fade>
      )}
      {scanFeedback === 'duplicate' && (
        <Fade in timeout={200}>
          <Alert
            severity="warning"
            sx={{
              mb: 1,
              fontWeight: 600,
              animation: `${slideIn} 0.3s ease-out`,
            }}
          >
            Mẫu này đã có trong danh sách!
          </Alert>
        </Fade>
      )}

      {missingDestinationCount > 0 && (
        <Alert severity="warning" sx={{ mb: 1, fontWeight: 600 }}>
          {missingDestinationCount} mẫu chưa có trạm đích.
        </Alert>
      )}

      {/* Scan list table */}
      {scanList.length > 0 ? (
        <Fade in timeout={300}>
          <TableContainer
            sx={{
              maxHeight: 280,
              borderRadius: 2,
              border: `1px solid ${alpha('#1976D2', 0.15)}`,
              bgcolor: alpha('#65B5FF', 0.04),
            }}
          >
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08), color: 'text.primary' }}>#</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08), color: 'text.primary' }}>Barcode</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08), color: 'text.primary' }}>Bệnh nhân</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08), color: 'text.primary' }}>Xét nghiệm</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08), color: 'text.primary' }}>Trạm đích</TableCell>
                  <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08), color: 'text.primary' }} align="center">Xóa</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {scanList.map((specimen, index) => (
                  <TableRow
                    key={specimen.barcode}
                    hover
                    sx={{
                      animation: `${slideIn} 0.3s ease-out`,
                      '&:hover': {
                        bgcolor: alpha('#1976D2', 0.06),
                      },
                    }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600} sx={{ color: 'text.secondary' }}>
                        {index + 1}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography
                        fontWeight={700}
                        sx={{
                          fontFamily: '"IBM Plex Mono", monospace',
                          color: 'text.primary',
                          fontSize: '0.9rem',
                        }}
                      >
                        {specimen.barcode}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight={600} sx={{ color: 'text.primary' }}>
                        {specimen.patientName}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography sx={{ color: 'text.secondary' }}>
                        {specimen.testType}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 170 }}>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={specimen.destinationStationId || ''}
                          displayEmpty
                          onChange={(event) => onUpdateDestination?.(specimen.barcode, event.target.value)}
                          sx={{
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            bgcolor: specimen.destinationStationId
                              ? alpha('#0BDF50', 0.08)
                              : alpha('#FF9800', 0.1),
                          }}
                        >
                          <MenuItem value="" disabled>
                            Chọn trạm
                          </MenuItem>
                          {stations.map((station) => (
                            <MenuItem key={station.id} value={station.id}>
                              {station.name}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => onRemoveFromList(specimen.barcode)}
                        sx={{ opacity: 0.7, '&:hover': { opacity: 1 } }}
                      >
                        <Delete fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Fade>
      ) : (
        <Alert severity="info" sx={{ fontWeight: 600 }}>
          Chưa có mẫu nào. Quét mã vạch hoặc nhập tay để thêm mẫu vào khay vận chuyển.
        </Alert>
      )}
    </Paper>
  );
});

export default SpecimenScanPanel;
