import { memo, useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
  Fade,
} from '@mui/material';
import { FileDownload } from '@mui/icons-material';
import { PRIORITY } from '../constants';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeExcelCell(value) {
  const raw = String(value ?? '');
  const escaped = escapeHtml(raw);
  return /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${escaped}` : escaped;
}

function buildPriorityLabel(priority) {
  return priority === PRIORITY.STAT ? 'STAT' : 'Routine';
}

const TransportHistoryDialog = memo(function TransportHistoryDialog({
  open,
  onClose,
  records,
  title = 'Lịch Sử Vận Chuyển',
}) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const handleChangePage = useCallback((event, newPage) => {
    setPage(newPage);
  }, []);

  const handleChangeRowsPerPage = useCallback((event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  }, []);

  const hasRecords = records && records.length > 0;

  const statCount = useMemo(
    () => (records || []).filter((r) => r.priority === PRIORITY.STAT).length,
    [records]
  );

  const routineCount = (records?.length || 0) - statCount;

  const paginatedRecords = useMemo(() => {
    if (!records) return [];
    return records.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [records, page, rowsPerPage]);

  const handleExportExcelReport = useCallback(() => {
    if (!hasRecords) return;

    const generatedAt = new Date();
    const generatedAtString = generatedAt.toLocaleString('vi-VN');
    const reportDate = generatedAt.toISOString().slice(0, 10);

    const tableRows = records
      .map((record, index) => {
        const priorityLabel = buildPriorityLabel(record.priority);
        const priorityClass = priorityLabel === 'STAT' ? 'priority-stat' : 'priority-routine';
        return `
          <tr>
            <td>${index + 1}</td>
            <td>${sanitizeExcelCell(record.barcode)}</td>
            <td>${sanitizeExcelCell(record.patientName)}</td>
            <td>${sanitizeExcelCell(record.testType)}</td>
            <td><span class="priority ${priorityClass}">${priorityLabel}</span></td>
            <td>${sanitizeExcelCell(record.scanTime)}</td>
            <td>${sanitizeExcelCell(record.dispatchTime)}</td>
            <td>${sanitizeExcelCell(record.arrivalTime)}</td>
            <td>${sanitizeExcelCell(record.fromStationName)}</td>
            <td>${sanitizeExcelCell(record.toStationName)}</td>
            <td>${sanitizeExcelCell(record.cabinId)}</td>
          </tr>
        `;
      })
      .join('');

    const htmlReport = `
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 20px;
            color: #1f2937;
          }
          .report-title {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 6px;
          }
          .meta {
            margin-bottom: 14px;
            color: #4b5563;
          }
          .summary {
            margin-bottom: 14px;
            padding: 10px 12px;
            background: #f3f7fb;
            border: 1px solid #d6e3ef;
            border-radius: 6px;
            width: fit-content;
          }
          table {
            border-collapse: collapse;
            width: 100%;
          }
          th, td {
            border: 1px solid #cfd8e3;
            padding: 8px;
            font-size: 12px;
            text-align: left;
          }
          th {
            background: #eaf2fa;
            color: #0f3c61;
            font-weight: 700;
          }
          tr:nth-child(even) {
            background: #f9fcff;
          }
          .priority {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 700;
          }
          .priority-stat {
            background: #fde8e8;
            color: #b42318;
          }
          .priority-routine {
            background: #eef2f7;
            color: #334155;
          }
        </style>
      </head>
      <body>
        <div class="report-title">BÁO CÁO LỊCH SỬ VẬN CHUYỂN MẪU BỆNH PHẨM</div>
        <div class="meta">Thời gian xuất: ${escapeHtml(generatedAtString)}</div>
        <div class="summary">
          Tổng lượt vận chuyển: <b>${records.length}</b><br/>
          Mẫu STAT: <b>${statCount}</b><br/>
          Mẫu Routine: <b>${routineCount}</b>
        </div>
        <table>
          <thead>
            <tr>
              <th>STT</th>
              <th>Barcode</th>
              <th>Bệnh nhân</th>
              <th>Xét nghiệm</th>
              <th>Ưu tiên</th>
              <th>Quét</th>
              <th>Dispatch</th>
              <th>Đến nơi</th>
              <th>Từ trạm</th>
              <th>Đến trạm</th>
              <th>Cabin</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([`\uFEFF${htmlReport}`], {
      type: 'application/vnd.ms-excel;charset=utf-8;'
    });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bao-cao-van-chuyen-${reportDate}.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [hasRecords, records, routineCount, statCount]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      TransitionComponent={Fade}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {title}
        {statCount > 0 && (
          <Chip
            label={`${statCount} STAT`}
            size="small"
            sx={{
              bgcolor: '#FF4D6A',
              color: '#fff',
              fontWeight: 800,
              fontSize: '0.7rem',
            }}
          />
        )}
      </DialogTitle>

      <DialogContent dividers>
        {!hasRecords ? (
          <Alert severity="info" sx={{ fontWeight: 600 }}>
            Chưa có dữ liệu vận chuyển mẫu bệnh phẩm.
          </Alert>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Tổng số lượt vận chuyển: <strong>{records.length}</strong>
              {statCount > 0 && (
                <> — <strong style={{ color: '#FF4D6A' }}>{statCount} mẫu STAT</strong></>
              )}
            </Typography>

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Barcode</TableCell>
                    <TableCell>Bệnh nhân</TableCell>
                    <TableCell>Xét nghiệm</TableCell>
                    <TableCell>Ưu tiên</TableCell>
                    <TableCell>Quét</TableCell>
                    <TableCell>Dispatch</TableCell>
                    <TableCell>Đến nơi</TableCell>
                    <TableCell>Từ trạm</TableCell>
                    <TableCell>Đến trạm</TableCell>
                    <TableCell>Cabin</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {paginatedRecords.map((record, index) => {
                    const isStat = record.priority === PRIORITY.STAT;
                    return (
                      <TableRow
                        key={`${record.specimenId}-${index}`}
                        hover
                        sx={isStat ? { bgcolor: 'rgba(211, 47, 47, 0.04)' } : undefined}
                      >
                        <TableCell>
                          <Typography
                            variant="body2"
                            fontWeight={isStat ? 800 : 600}
                            sx={isStat ? { color: '#FF4D6A' } : undefined}
                          >
                            {record.barcode}
                          </Typography>
                        </TableCell>
                        <TableCell>{record.patientName}</TableCell>
                        <TableCell>{record.testType}</TableCell>
                        <TableCell>
                          <Chip
                            label={isStat ? 'STAT' : 'Routine'}
                            size="small"
                            sx={{
                              fontWeight: 700,
                              fontSize: '0.68rem',
                              bgcolor: isStat ? '#FF4D6A' : '#e0e0e0',
                              color: isStat ? '#fff' : '#616161',
                            }}
                          />
                        </TableCell>
                        <TableCell>{record.scanTime}</TableCell>
                        <TableCell>{record.dispatchTime}</TableCell>
                        <TableCell>{record.arrivalTime}</TableCell>
                        <TableCell>{record.fromStationName}</TableCell>
                        <TableCell>{record.toStationName}</TableCell>
                        <TableCell>{record.cabinId}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <TablePagination
                rowsPerPageOptions={[10, 25, 50, 100]}
                component="div"
                count={records.length}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={handleChangePage}
                onRowsPerPageChange={handleChangeRowsPerPage}
                labelRowsPerPage="Số dòng mỗi trang:"
              />
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} sx={{ fontWeight: 700 }}>
          Đóng
        </Button>
        <Button
          variant="contained"
          startIcon={<FileDownload />}
          onClick={handleExportExcelReport}
          disabled={!hasRecords}
          sx={{ fontWeight: 700 }}
        >
          Xuất báo cáo (.xls)
        </Button>
      </DialogActions>
    </Dialog>
  );
});

export default TransportHistoryDialog;
