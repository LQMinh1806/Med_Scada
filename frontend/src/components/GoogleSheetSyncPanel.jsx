// ══════════════════════════════════════════════════════════════════════════════
// GoogleSheetSyncPanel.jsx
// ──────────────────────────────────────────────────────────────────────────────
// Panel đồng bộ danh sách mẫu bệnh phẩm từ Google Sheets về hệ thống SCADA.
// Thay thế ExcelImportPanel — người dùng chỉ cần chia sẻ Sheet và bấm Đồng Bộ.
// ══════════════════════════════════════════════════════════════════════════════

import { memo, useState, useCallback } from 'react';
import {
  Box, Button, Typography, Paper, Alert, CircularProgress,
  Table, TableHead, TableRow, TableCell, TableBody,
  Chip, Link, Divider, Tooltip, alpha,
} from '@mui/material';
import {
  CloudSync, OpenInNew, CheckCircle, ErrorOutlined,
  TableChart, InfoOutlined, ContentCopy,
} from '@mui/icons-material';

import { attachCsrfHeader } from '../utils/csrf';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');

// ── Cấu trúc cột yêu cầu trong Google Sheet ──────────────────────────────────
const REQUIRED_COLUMNS = [
  { col: 'A', name: 'Barcode',     note: 'Mã vạch duy nhất, ví dụ: EM-2026-001' },
  { col: 'B', name: 'PatientName', note: 'Họ tên bệnh nhân đầy đủ' },
  { col: 'C', name: 'TestType',    note: 'Mô tả loại bệnh phẩm & xét nghiệm' },
  { col: 'D', name: 'Trạm đích',  note: 'ST-01 / ST-02 / ST-03 / ST-04 hoặc tên trạm' },
];

// ── URL Google Sheet mẫu (public template) ────────────────────────────────────
// Kỹ thuật viên có thể tạo bản sao và sử dụng lại định dạng này.
const TEMPLATE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit';

// ── Trạng thái kết quả ─────────────────────────────────────────────────────────
const STATUS = { IDLE: 'idle', LOADING: 'loading', SUCCESS: 'success', ERROR: 'error' };

const priorityChipSx = (priority) => ({
  fontWeight: 700,
  fontSize: '0.65rem',
  height: 22,
  ...(priority === 'stat'
    ? { bgcolor: alpha('#C41C1C', 0.1), color: '#C41C1C', border: `1px solid ${alpha('#C41C1C', 0.3)}` }
    : { bgcolor: alpha('#2E7D32', 0.1), color: '#2E7D32', border: `1px solid ${alpha('#2E7D32', 0.3)}` }),
});

// ── Component chính ────────────────────────────────────────────────────────────
const GoogleSheetSyncPanel = memo(function GoogleSheetSyncPanel() {
  const [sheetId, setSheetId]     = useState('');
  const [status, setStatus]       = useState(STATUS.IDLE);
  const [message, setMessage]     = useState('');
  const [errors, setErrors]       = useState([]);
  const [imported, setImported]   = useState([]);
  const [copied, setCopied]       = useState(false);

  // Trích xuất Sheet ID từ URL đầy đủ hoặc chấp nhận ID thô
  const parseSheetId = useCallback((value) => {
    const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : value.trim();
  }, []);

  const handleSync = useCallback(async () => {
    const id = parseSheetId(sheetId);
    if (!id) {
      setMessage('Vui lòng nhập URL hoặc Sheet ID hợp lệ.');
      setStatus(STATUS.ERROR);
      return;
    }

    setStatus(STATUS.LOADING);
    setMessage('');
    setErrors([]);
    setImported([]);

    try {
      const res = await fetch(`${API_BASE_URL}/specimens/sync-sheet`, {
        method: 'POST',
        credentials: 'include',
        headers: attachCsrfHeader('POST', { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ sheetId: id }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.message || 'Đồng bộ thất bại.');
        setErrors(data.errors || []);
        setStatus(STATUS.ERROR);
        return;
      }

      setMessage(data.message || `Đã đồng bộ ${data.imported} mẫu thành công.`);
      setImported(data.specimens || []);
      setErrors(data.errors || []);
      setStatus(STATUS.SUCCESS);
    } catch (err) {
      setMessage('Không thể kết nối đến máy chủ. Vui lòng kiểm tra backend.');
      setStatus(STATUS.ERROR);
    }
  }, [sheetId, parseSheetId]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(parseSheetId(sheetId)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [sheetId, parseSheetId]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* ── Hướng dẫn ───────────────────────────────────────────────────── */}
      <Paper sx={{ p: 2.5, borderRadius: 3, border: `1px solid ${alpha('#1976D2', 0.15)}`, bgcolor: alpha('#1976D2', 0.03) }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <TableChart sx={{ color: '#1976D2', fontSize: 22 }} />
          <Typography variant="subtitle1" fontWeight={800} color="text.primary">
            ĐỒNG BỘ DỮ LIỆU MẪU TỪ GOOGLE SHEETS
          </Typography>
        </Box>

        <Alert severity="info" icon={<InfoOutlined fontSize="small" />} sx={{ mb: 2, borderRadius: 2 }}>
          Google Sheet phải được chia sẻ ở chế độ <strong>"Bất kỳ ai có đường liên kết có thể xem"</strong>.
          Hàng đầu tiên phải là tiêu đề cột theo định dạng bên dưới.
        </Alert>

        {/* Bảng cột yêu cầu */}
        <Table size="small" sx={{ mb: 2, '& th': { fontWeight: 700, bgcolor: alpha('#1976D2', 0.06) } }}>
          <TableHead>
            <TableRow>
              <TableCell>Cột</TableCell>
              <TableCell>Tên cột (Header)</TableCell>
              <TableCell>Mô tả</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {REQUIRED_COLUMNS.map(({ col, name, note }) => (
              <TableRow key={col} hover>
                <TableCell><code>{col}</code></TableCell>
                <TableCell><strong>{name}</strong></TableCell>
                <TableCell sx={{ color: 'text.secondary', fontSize: '0.82rem' }}>{note}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Link href={TEMPLATE_SHEET_URL} target="_blank" rel="noreferrer" underline="hover"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 700, fontSize: '0.85rem' }}>
          <OpenInNew fontSize="small" />
          Mở Google Sheet mẫu (Template)
        </Link>
      </Paper>

      {/* ── Nhập Sheet ID / URL ──────────────────────────────────────────── */}
      <Paper sx={{ p: 2.5, borderRadius: 3, border: `1px solid ${alpha('#1976D2', 0.15)}` }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
          Nhập URL hoặc Sheet ID của Google Sheet
        </Typography>

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Box
            component="input"
            placeholder="https://docs.google.com/spreadsheets/d/... hoặc dán trực tiếp Sheet ID"
            value={sheetId}
            onChange={(e) => setSheetId(e.target.value)}
            sx={{
              flex: 1,
              minWidth: 260,
              px: 1.5, py: 1,
              borderRadius: 1.5,
              border: `1px solid ${alpha('#000', 0.18)}`,
              fontSize: '0.85rem',
              fontFamily: '"IBM Plex Mono", monospace',
              bgcolor: 'background.paper',
              color: 'text.primary',
              outline: 'none',
              '&:focus': { borderColor: '#1976D2', boxShadow: `0 0 0 2px ${alpha('#1976D2', 0.15)}` },
            }}
          />

          <Tooltip title={copied ? 'Đã sao chép!' : 'Sao chép Sheet ID'}>
            <Box component="span">
              <Button
                variant="outlined"
                size="small"
                onClick={handleCopyId}
                disabled={!sheetId}
                startIcon={<ContentCopy fontSize="small" />}
                sx={{ height: 40 }}
              >
                {copied ? 'Đã sao chép' : 'Sao chép ID'}
              </Button>
            </Box>
          </Tooltip>

          <Button
            variant="contained"
            onClick={handleSync}
            disabled={!sheetId || status === STATUS.LOADING}
            startIcon={status === STATUS.LOADING
              ? <CircularProgress size={16} color="inherit" />
              : <CloudSync />}
            sx={{ height: 40, fontWeight: 800, minWidth: 140 }}
          >
            {status === STATUS.LOADING ? 'Đang đồng bộ...' : 'Đồng Bộ Ngay'}
          </Button>
        </Box>
      </Paper>

      {/* ── Kết quả ─────────────────────────────────────────────────────── */}
      {status === STATUS.SUCCESS && (
        <Paper sx={{ p: 2.5, borderRadius: 3, border: `1px solid ${alpha('#2E7D32', 0.25)}`, bgcolor: alpha('#2E7D32', 0.03) }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <CheckCircle sx={{ color: '#2E7D32' }} />
            <Typography fontWeight={700} color="#2E7D32">{message}</Typography>
          </Box>

          {errors.length > 0 && (
            <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
              <strong>{errors.length} dòng bị bỏ qua:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {errors.map((e, i) => <li key={i}>{e.reason || JSON.stringify(e)}</li>)}
              </ul>
            </Alert>
          )}

          {imported.length > 0 && (
            <>
              <Divider sx={{ mb: 1.5 }} />
              <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 1 }}>
                {imported.length} mẫu đã được nhập / cập nhật:
              </Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: alpha('#2E7D32', 0.06) } }}>
                      <TableCell>Barcode</TableCell>
                      <TableCell>Bệnh nhân</TableCell>
                      <TableCell>Xét nghiệm</TableCell>
                      <TableCell>Ưu tiên</TableCell>
                      <TableCell>Trạm đích</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {imported.map((s) => (
                      <TableRow key={s.barcode} hover>
                        <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{s.barcode}</TableCell>
                        <TableCell>{s.patientName}</TableCell>
                        <TableCell sx={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.testType}
                        </TableCell>
                        <TableCell>
                          <Chip label={s.priority?.toUpperCase()} size="small" sx={priorityChipSx(s.priority)} />
                        </TableCell>
                        <TableCell>{s.destinationStationId}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </>
          )}
        </Paper>
      )}

      {status === STATUS.ERROR && (
        <Alert severity="error" icon={<ErrorOutlined />} sx={{ borderRadius: 2 }}>
          <strong>Lỗi đồng bộ:</strong> {message}
          {errors.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              {errors.map((e, i) => <li key={i}>{e.reason || JSON.stringify(e)}</li>)}
            </ul>
          )}
        </Alert>
      )}

    </Box>
  );
});

export default GoogleSheetSyncPanel;
