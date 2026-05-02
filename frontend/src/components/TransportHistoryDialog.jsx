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

  const handleExportExcelReport = useCallback(async () => {
    if (!hasRecords) return;

    const generatedAt = new Date();
    const generatedAtString = generatedAt.toLocaleString('vi-VN');
    const reportDate = generatedAt.toISOString().slice(0, 10);
    const headerRow = [
      'STT',
      'Barcode',
      'Bệnh nhân',
      'Xét nghiệm',
      'Ưu tiên',
      'Quét',
      'Dispatch',
      'Đến nơi',
      'Từ trạm',
      'Đến trạm',
      'Cabin',
    ];

    const dataRows = records.map((record, index) => ([
      index + 1,
      record.barcode,
      record.patientName,
      record.testType,
      buildPriorityLabel(record.priority),
      record.scanTime,
      record.dispatchTime,
      record.arrivalTime,
      record.fromStationName,
      record.toStationName,
      record.cabinId,
    ]));

    const sheetRows = [
      ['BÁO CÁO LỊCH SỬ VẬN CHUYỂN MẪU BỆNH PHẨM'],
      ['Thời gian xuất', generatedAtString],
      ['Tổng lượt vận chuyển', records.length],
      ['Mẫu STAT', statCount],
      ['Mẫu Routine', routineCount],
      [],
      headerRow,
      ...dataRows,
    ];

    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'BaoCaoVanChuyen');
    XLSX.writeFile(workbook, `bao-cao-van-chuyen-${reportDate}.xlsx`);
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
          Xuất báo cáo (.xlsx)
        </Button>
      </DialogActions>
    </Dialog>
  );
});

export default TransportHistoryDialog;
