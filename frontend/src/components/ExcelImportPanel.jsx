import { memo, useCallback, useState, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  alpha,
  Fade,
  CircularProgress,
  keyframes,
} from '@mui/material';
import {
  CloudUpload,
  CheckCircle,
  ErrorOutlineOutlined,
  InsertDriveFile,
  TableChart,
} from '@mui/icons-material';
import * as XLSX from 'xlsx';
import { attachCsrfHeader } from '../utils/csrf';
import { STATIONS } from '../constants';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
const DESTINATION_COLUMN_KEYS = [
  'DestinationStationId',
  'destinationStationId',
  'DestinationStation',
  'destinationStation',
  'ToStationId',
  'toStationId',
  'ToStation',
  'toStation',
  'Destination',
  'destination',
  'Trạm đích',
  'Tram dich',
  'Trạm đến',
  'Tram den',
  'Nơi nhận',
  'Noi nhan',
];

function normalizeLookupText(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function readFirstValue(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return row[key];
  }
  return '';
}

function resolveDestinationStation(rawValue) {
  const normalized = normalizeLookupText(rawValue);
  if (!normalized) return null;
  return STATIONS.find((station) => (
    normalizeLookupText(station.id) === normalized ||
    normalizeLookupText(station.name) === normalized ||
    normalizeLookupText(String(station.idx + 1)) === normalized ||
    normalizeLookupText(String(station.idx)) === normalized
  )) || null;
}

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

/**
 * Excel Import Panel for Admin page.
 * Allows tech users to upload an Excel file to pre-load specimen records.
 */
const ExcelImportPanel = memo(function ExcelImportPanel() {
  const [previewData, setPreviewData] = useState([]);
  const [fileName, setFileName] = useState('');
  const [fileReady, setFileReady] = useState(null); // File object
  const [parseErrors, setParseErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null); // { success: bool, message, count, errors }
  const fileInputRef = useRef(null);

  // ── Parse Excel file for preview ──────────────────────────────────────
  const handleFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportResult(null);
    setFileName(file.name);
    setFileReady(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
          setParseErrors([{ row: 0, reason: 'File Excel không có sheet nào.' }]);
          setPreviewData([]);
          return;
        }

        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
        const parsed = [];
        const errors = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const barcode = String(
            row.Barcode || row.barcode || row['Mã vạch'] || row['Ma vach'] || row.Code || ''
          ).trim().toUpperCase();

          const patientName = String(
            row.PatientName || row.patientName || row['Tên bệnh nhân'] || row['Ten benh nhan'] ||
            row.Patient || row.Name || row['Họ tên'] || ''
          ).trim();

          const testType = String(
            row.TestType || row.testType || row['Loại xét nghiệm'] || row['Loai xet nghiem'] ||
            row.Test || row.Type || ''
          ).trim();

          const destinationRaw = readFirstValue(row, DESTINATION_COLUMN_KEYS);
          const destinationStation = resolveDestinationStation(destinationRaw);

          if (!barcode) {
            errors.push({ row: i + 2, reason: 'Thiếu mã vạch (Barcode)' });
            continue;
          }
          if (!patientName) {
            errors.push({ row: i + 2, reason: `${barcode}: Thiếu tên bệnh nhân` });
            continue;
          }
          if (!testType) {
            errors.push({ row: i + 2, reason: `${barcode}: Thiếu loại xét nghiệm` });
            continue;
          }
          if (!destinationStation) {
            errors.push({ row: i + 2, reason: `${barcode}: Thiếu hoặc sai trạm đích` });
            continue;
          }

          parsed.push({
            barcode,
            patientName,
            testType,
            destinationStationId: destinationStation.id,
            destinationStationName: destinationStation.name,
          });
        }

        setPreviewData(parsed);
        setParseErrors(errors);
      } catch (err) {
        setParseErrors([{ row: 0, reason: `Lỗi đọc file: ${err.message}` }]);
        setPreviewData([]);
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  // ── Upload to server ──────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (!fileReady) return;

    setImporting(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append('file', fileReady);

      const method = 'POST';
      const headers = attachCsrfHeader(method, {});

      const response = await fetch(`${API_BASE_URL}/specimens/import`, {
        method,
        credentials: 'include',
        headers,
        body: formData,
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setImportResult({
          success: false,
          message: data?.message || `Import thất bại: ${response.status}`,
          errors: data?.errors || [],
        });
      } else {
        setImportResult({
          success: true,
          message: data?.message || 'Import thành công!',
          count: data?.imported || 0,
          errors: data?.errors || [],
        });
        // Clear preview after success
        setPreviewData([]);
        setFileReady(null);
        setFileName('');
        setParseErrors([]);
        // Reset file input
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (err) {
      setImportResult({
        success: false,
        message: `Lỗi kết nối: ${err.message}`,
      });
    } finally {
      setImporting(false);
    }
  }, [fileReady]);

  const handleClear = useCallback(() => {
    setPreviewData([]);
    setFileName('');
    setFileReady(null);
    setParseErrors([]);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  return (
    <Paper sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, border: `1px solid ${alpha('#1976D2', 0.15)}` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <TableChart sx={{ color: '#1976D2' }} />
        <Typography variant="subtitle1" fontWeight={800} sx={{ color: 'text.primary' }}>
          IMPORT DỮ LIỆU MẪU TỪ EXCEL
        </Typography>
      </Box>

      {/* Instructions */}
      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2" fontWeight={600}>
          File Excel cần có các cột: <code>Barcode</code>, <code>PatientName</code>, <code>TestType</code>, <code>DestinationStation</code>.
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Hỗ trợ tên cột tiếng Việt: Mã vạch, Tên bệnh nhân, Loại xét nghiệm, Trạm đích. Trạm đích có thể ghi ST-02 hoặc tên trạm.
        </Typography>
      </Alert>

      {/* Upload area */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 2,
          mb: 2,
        }}
      >
        <Button
          variant="outlined"
          component="label"
          startIcon={<CloudUpload />}
          sx={{
            fontWeight: 700,
            minHeight: 46,
            borderStyle: 'dashed',
            borderWidth: 2,
            '&:hover': { borderStyle: 'solid' },
          }}
        >
          {fileName || 'Chọn file Excel (.xlsx, .xls)'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={handleFileChange}
          />
        </Button>

        {fileReady && (
          <Fade in timeout={300}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                onClick={handleImport}
                disabled={importing || previewData.length === 0}
                startIcon={importing ? <CircularProgress size={18} color="inherit" /> : <CloudUpload />}
                sx={{ fontWeight: 700, minWidth: 160 }}
              >
                {importing ? 'Đang import...' : `Import ${previewData.length} mẫu`}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                onClick={handleClear}
                sx={{ fontWeight: 700 }}
              >
                Hủy
              </Button>
            </Box>
          </Fade>
        )}
      </Box>

      {/* Import result */}
      {importResult && (
        <Fade in timeout={300}>
          <Alert
            severity={importResult.success ? 'success' : 'error'}
            icon={importResult.success ? <CheckCircle /> : <ErrorOutlineOutlined />}
            sx={{
              mb: 2,
              fontWeight: 600,
              animation: `${fadeUp} 0.4s ease-out`,
            }}
          >
            {importResult.message}
            {importResult.errors?.length > 0 && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>
                  Lỗi ({importResult.errors.length}):
                </Typography>
                {importResult.errors.slice(0, 10).map((err, idx) => (
                  <Typography key={idx} variant="body2" sx={{ ml: 1, opacity: 0.9 }}>
                    • Dòng {err.row}: {err.reason}
                  </Typography>
                ))}
                {importResult.errors.length > 10 && (
                  <Typography variant="body2" sx={{ ml: 1, fontStyle: 'italic' }}>
                    ...và {importResult.errors.length - 10} lỗi khác.
                  </Typography>
                )}
              </Box>
            )}
          </Alert>
        </Fade>
      )}

      {/* Parse errors */}
      {parseErrors.length > 0 && !importResult && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={700}>
            {parseErrors.length} dòng bị bỏ qua:
          </Typography>
          {parseErrors.slice(0, 5).map((err, idx) => (
            <Typography key={idx} variant="body2" sx={{ ml: 1, mt: 0.3 }}>
              • Dòng {err.row}: {err.reason}
            </Typography>
          ))}
          {parseErrors.length > 5 && (
            <Typography variant="body2" sx={{ ml: 1, mt: 0.3, fontStyle: 'italic' }}>
              ...và {parseErrors.length - 5} dòng khác.
            </Typography>
          )}
        </Alert>
      )}

      {/* Preview table */}
      {previewData.length > 0 && (
        <Fade in timeout={400}>
          <Box>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 1, color: 'text.secondary' }}>
              <InsertDriveFile sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'middle' }} />
              Xem trước ({previewData.length} mẫu từ file <em>{fileName}</em>):
            </Typography>
            <TableContainer
              sx={{
                maxHeight: 350,
                borderRadius: 2,
                border: `1px solid ${alpha('#1976D2', 0.1)}`,
              }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08) }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08) }}>Barcode</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08) }}>Tên bệnh nhân</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08) }}>Loại XN</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: alpha('#1976D2', 0.08) }}>Trạm đích</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {previewData.map((row, idx) => (
                    <TableRow key={row.barcode} hover>
                      <TableCell>{idx + 1}</TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight={700}
                          sx={{ fontFamily: '"IBM Plex Mono", monospace' }}
                        >
                          {row.barcode}
                        </Typography>
                      </TableCell>
                      <TableCell>{row.patientName}</TableCell>
                      <TableCell>{row.testType}</TableCell>
                      <TableCell>
                        <Chip
                          label={`${row.destinationStationId} · ${row.destinationStationName}`}
                          size="small"
                          sx={{
                            fontWeight: 800,
                            fontSize: '0.7rem',
                            bgcolor: alpha('#1976D2', 0.14),
                            color: '#111',
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </Fade>
      )}
    </Paper>
  );
});

export default ExcelImportPanel;
