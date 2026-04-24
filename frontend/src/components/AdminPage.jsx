import { memo, useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  alpha,
  CircularProgress,
  LinearProgress,
  keyframes,
} from '@mui/material';
import { 
  BuildCircle, 
  Delete, 
  History,
  Fingerprint as FingerprintIcon,
  Close as CloseIcon,
  CheckCircleOutlineOutlined as CheckCircleOutline,
  ErrorOutlineOutlined as ErrorOutline,
} from '@mui/icons-material';
import { io } from 'socket.io-client';
import TabPanel from './TabPanel';
import TransportHistoryDialog from './TransportHistoryDialog';
import { USER_ROLES } from '../constants';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin;
const ENROLL_TIMEOUT_MS = 60_000;

const pulseRing = keyframes`
  0% { transform: scale(0.85); opacity: 0.6; }
  50% { transform: scale(1.15); opacity: 0.2; }
  100% { transform: scale(0.85); opacity: 0.6; }
`;

const scanLine = keyframes`
  0% { top: 10%; opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { top: 85%; opacity: 0; }
`;

const checkBounce = keyframes`
  0% { transform: scale(0); opacity: 0; }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); opacity: 1; }
`;

const INITIAL_NEW_USER = {
  username: '',
  fullname: '',
  password: '',
  role: USER_ROLES.OPERATOR,
};

const maintenanceSwitchSx = {
  width: 54,
  height: 30,
  padding: 0.5,
  '& .MuiSwitch-switchBase': {
    padding: 0.5,
    '&.Mui-checked': {
      transform: 'translateX(24px)',
      color: '#FF9800',
      '& + .MuiSwitch-track': {
        backgroundColor: alpha('#FF9800', 0.25),
        borderColor: alpha('#FF9800', 0.55),
        opacity: 1,
      },
    },
  },
  '& .MuiSwitch-thumb': {
    width: 22,
    height: 22,
    boxShadow: `0 2px 8px ${alpha('#000', 0.35)}`,
  },
  '& .MuiSwitch-track': {
    borderRadius: 15,
    border: `1px solid ${alpha('#111111', 0.28)}`,
    backgroundColor: alpha('#65B5FF', 0.2),
    opacity: 1,
    transition: 'all 0.25s ease',
  },
};

/**
 * Pure utility — extract outside component to avoid unnecessary useCallback.
 */
function toTimeValue(value) {
  const parsed = new Date(value || '').getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * System logs table sub-component.
 */
const SystemLogsTable = memo(function SystemLogsTable({ logs }) {
  return (
    <Paper sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, border: `1px solid ${alpha('#1976D2', 0.15)}` }}>
      <Typography variant="subtitle1" fontWeight={800} gutterBottom sx={{ color: 'text.primary' }}>
        NHẬT KÝ VẬN HÀNH (SYSTEM LOGS)
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Thời Gian</TableCell>
              <TableCell>Sự Kiện</TableCell>
              <TableCell>Mức Độ</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id} hover>
                <TableCell>
                  <Typography
                    variant="body2"
                    fontWeight={600}
                    sx={{
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: '0.78rem',
                      color: 'text.secondary',
                    }}
                  >
                    {log.id}
                  </Typography>
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{log.time}</TableCell>
                <TableCell sx={{ color: 'text.primary' }}>{log.event}</TableCell>
                <TableCell>
                  <Chip
                    label={log.type}
                    size="small"
                    sx={{
                      fontWeight: 700,
                      fontSize: '0.7rem',
                      bgcolor:
                        log.type === 'error'
                          ? alpha('#FF4D6A', 0.12)
                          : log.type === 'success'
                          ? alpha('#36D399', 0.12)
                          : alpha('#0A7AFF', 0.12),
                      color:
                        log.type === 'error'
                          ? '#FF4D6A'
                          : log.type === 'success'
                          ? '#36D399'
                          : '#4DA3FF',
                      border: `1px solid ${
                        log.type === 'error'
                          ? alpha('#FF4D6A', 0.15)
                          : log.type === 'success'
                          ? alpha('#36D399', 0.15)
                          : alpha('#0A7AFF', 0.15)
                      }`,
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Paper>
  );
});

/**
 * User management table sub-component.
 */
const UserManagementTable = memo(function UserManagementTable({
  users,
  onToggleActive,
  onUpdateRole,
  onRemove,
  onEnrollFingerprint,
}) {
  return (
    <Paper sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, border: `1px solid ${alpha('#1976D2', 0.15)}` }}>
      <Typography variant="subtitle1" fontWeight={800} gutterBottom sx={{ color: 'text.primary' }}>
        QUẢN LÝ QUYỀN TRUY CẬP
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Username</TableCell>
              <TableCell>Họ & Tên</TableCell>
              <TableCell>Vai Trò</TableCell>
              <TableCell>Kích hoạt</TableCell>
              <TableCell>Hành động</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={700} sx={{ color: 'text.primary' }}>
                    {user.username}
                  </Typography>
                </TableCell>
                <TableCell sx={{ color: 'text.secondary' }}>{user.fullname}</TableCell>
                <TableCell sx={{ width: 180 }}>
                  <FormControl size="small" fullWidth>
                    <Select
                      value={user.role}
                      onChange={(event) =>
                        onUpdateRole(user.username, event.target.value)
                      }
                    >
                      <MenuItem value={USER_ROLES.TECH}>Kỹ thuật viên</MenuItem>
                      <MenuItem value={USER_ROLES.OPERATOR}>Vận hành viên</MenuItem>
                    </Select>
                  </FormControl>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={user.active}
                    onChange={() => onToggleActive(user.username)}
                    color="primary"
                  />
                </TableCell>
                <TableCell>
                  <Tooltip title={user.fingerprintId ? "Cập nhật vân tay" : "Đăng ký vân tay"}>
                    <IconButton
                      size="small"
                      color={user.fingerprintId ? "success" : "primary"}
                      onClick={() => onEnrollFingerprint(user)}
                    >
                      <FingerprintIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Xóa tài khoản">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => onRemove(user.username)}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Paper>
  );
});

/**
 * New user creation form sub-component.
 */
const CreateUserForm = memo(function CreateUserForm({ onCreateUser }) {
  const [newUser, setNewUser] = useState(INITIAL_NEW_USER);

  const setField = useCallback((field, value) => {
    setNewUser((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback(
    (event) => {
      event.preventDefault();
      const success = onCreateUser({
        username: newUser.username.trim(),
        password: newUser.password,
        fullname: newUser.fullname.trim(),
        role: newUser.role,
      });
      if (success) {
        setNewUser(INITIAL_NEW_USER);
      }
    },
    [newUser, onCreateUser]
  );

  return (
    <Card
      variant="outlined"
      sx={{
        maxWidth: 520,
        mx: 'auto',
        p: 2.5,
        borderRadius: 3,
        borderColor: alpha('#1976D2', 0.15),
      }}
    >
      <Typography variant="subtitle1" fontWeight={800} gutterBottom sx={{ color: 'text.primary' }}>
        CẤP TÀI KHOẢN HỆ THỐNG
      </Typography>
      <Box component="form" onSubmit={handleSubmit} noValidate autoComplete="off">
        <TextField
          fullWidth
          label="Họ và Tên"
          margin="normal"
          required
          value={newUser.fullname}
          onChange={(e) => setField('fullname', e.target.value)}
          autoComplete="off"
        />
        <TextField
          fullWidth
          label="Mã Nhân Viên (Username)"
          margin="normal"
          required
          value={newUser.username}
          onChange={(e) => setField('username', e.target.value)}
          autoComplete="off"
        />
        <TextField
          fullWidth
          label="Mật khẩu khởi tạo"
          type="password"
          margin="normal"
          required
          value={newUser.password}
          onChange={(e) => setField('password', e.target.value)}
          autoComplete="off"
        />
        <FormControl fullWidth margin="normal" size="small" required>
          <InputLabel>Vai trò hệ thống</InputLabel>
          <Select
            value={newUser.role}
            label="Vai trò hệ thống"
            onChange={(e) => setField('role', e.target.value)}
          >
            <MenuItem value={USER_ROLES.OPERATOR}>Vận hành viên (Giám sát & Điều khiển)</MenuItem>
            <MenuItem value={USER_ROLES.TECH}>Kỹ thuật viên (Toàn quyền)</MenuItem>
          </Select>
        </FormControl>
        <Button
          type="submit"
          variant="contained"
          color="primary"
          fullWidth
          sx={{ mt: 1.5, py: 0.8, fontWeight: 800 }}
        >
          THÊM NHÂN SỰ
        </Button>
      </Box>
    </Card>
  );
});

/**
 * Persisted data viewer for technical users.
 */
const PersistedDataPanel = memo(function PersistedDataPanel({ scada }) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [isUsersOpen, setIsUsersOpen] = useState(false);
  const [isScannedOpen, setIsScannedOpen] = useState(false);
  const [isTransportedOpen, setIsTransportedOpen] = useState(false);
  const [usersSortBy, setUsersSortBy] = useState('username');
  const [usersSortOrder, setUsersSortOrder] = useState('asc');
  const [scannedSortBy, setScannedSortBy] = useState('scanTime');
  const [scannedSortOrder, setScannedSortOrder] = useState('desc');
  const [transportSortBy, setTransportSortBy] = useState('dispatchTime');
  const [transportSortOrder, setTransportSortOrder] = useState('desc');

  const handleRefresh = useCallback(async () => {
    if (typeof scada.hydratePersistedData !== 'function') return;

    setRefreshError('');
    setIsRefreshing(true);
    try {
      await scada.hydratePersistedData();
    } catch {
      setRefreshError('Không thể đồng bộ dữ liệu từ máy chủ.');
    } finally {
      setIsRefreshing(false);
    }
  }, [scada]);

  const closeUsersDialog = useCallback(() => setIsUsersOpen(false), []);
  const closeScannedDialog = useCallback(() => setIsScannedOpen(false), []);
  const closeTransportedDialog = useCallback(() => setIsTransportedOpen(false), []);

  const sortedUsers = useMemo(() => {
    const list = [...scada.users];
    const direction = usersSortOrder === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (usersSortBy === 'id') return (a.id - b.id) * direction;
      const left = String(a[usersSortBy] || '').toLowerCase();
      const right = String(b[usersSortBy] || '').toLowerCase();
      return left.localeCompare(right) * direction;
    });
  }, [scada.users, usersSortBy, usersSortOrder]);

  const sortedScanned = useMemo(() => {
    const list = [...scada.scannedSpecimens];
    const direction = scannedSortOrder === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (scannedSortBy === 'scanTime') {
        return (toTimeValue(a.scanTime) - toTimeValue(b.scanTime)) * direction;
      }
      const left = String(a[scannedSortBy] || '').toLowerCase();
      const right = String(b[scannedSortBy] || '').toLowerCase();
      return left.localeCompare(right) * direction;
    });
  }, [scada.scannedSpecimens, scannedSortBy, scannedSortOrder]);

  const sortedTransported = useMemo(() => {
    const list = [...scada.transportedSpecimens];
    const direction = transportSortOrder === 'asc' ? 1 : -1;
    return list.sort((a, b) => {
      if (transportSortBy === 'dispatchTime' || transportSortBy === 'arrivalTime') {
        return (toTimeValue(a[transportSortBy]) - toTimeValue(b[transportSortBy])) * direction;
      }
      const left = String(a[transportSortBy] || '').toLowerCase();
      const right = String(b[transportSortBy] || '').toLowerCase();
      return left.localeCompare(right) * direction;
    });
  }, [scada.transportedSpecimens, transportSortBy, transportSortOrder]);

  return (
    <Paper sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, border: `1px solid ${alpha('#1976D2', 0.15)}` }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1,
          mb: 1,
        }}
      >
        <Typography variant="subtitle1" fontWeight={800} sx={{ color: 'text.primary' }}>
          DỮ LIỆU ĐÃ LƯU TRÊN HỆ THỐNG
        </Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={handleRefresh}
          disabled={isRefreshing}
          sx={{ fontWeight: 700 }}
        >
          {isRefreshing ? 'Đang đồng bộ...' : 'Làm mới từ Database'}
        </Button>
      </Box>

      {refreshError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {refreshError}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(180px, 1fr))' },
          gap: 1,
          mb: 2,
        }}
      >
        <Button variant="outlined" onClick={() => setIsUsersOpen(true)} sx={{ fontWeight: 700 }}>
          Xem người dùng
        </Button>
        <Button variant="outlined" onClick={() => setIsScannedOpen(true)} sx={{ fontWeight: 700 }}>
          Xem mẫu đã quét
        </Button>
        <Button variant="outlined" onClick={() => setIsTransportedOpen(true)} sx={{ fontWeight: 700 }}>
          Xem vận chuyển đã lưu
        </Button>
      </Box>

      <Dialog open={isUsersOpen} onClose={closeUsersDialog} fullWidth maxWidth="md">
        <DialogTitle>Người dùng đã lưu</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Sắp xếp theo</InputLabel>
              <Select
                value={usersSortBy}
                label="Sắp xếp theo"
                onChange={(event) => setUsersSortBy(event.target.value)}
              >
                <MenuItem value="id">ID</MenuItem>
                <MenuItem value="username">Username</MenuItem>
                <MenuItem value="fullname">Họ tên</MenuItem>
                <MenuItem value="role">Vai trò</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Thứ tự</InputLabel>
              <Select
                value={usersSortOrder}
                label="Thứ tự"
                onChange={(event) => setUsersSortOrder(event.target.value)}
              >
                <MenuItem value="asc">Tăng dần</MenuItem>
                <MenuItem value="desc">Giảm dần</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>ID</TableCell>
                  <TableCell>Username</TableCell>
                  <TableCell>Họ tên</TableCell>
                  <TableCell>Vai trò</TableCell>
                  <TableCell>Kích hoạt</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedUsers.map((user) => (
                  <TableRow key={user.id} hover>
                    <TableCell>{user.id}</TableCell>
                    <TableCell>{user.username}</TableCell>
                    <TableCell>{user.fullname}</TableCell>
                    <TableCell>{user.role}</TableCell>
                    <TableCell>{user.active ? 'Có' : 'Không'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeUsersDialog}>Đóng</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isScannedOpen} onClose={closeScannedDialog} fullWidth maxWidth="lg">
        <DialogTitle>Mẫu đã quét</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Sắp xếp theo</InputLabel>
              <Select
                value={scannedSortBy}
                label="Sắp xếp theo"
                onChange={(event) => setScannedSortBy(event.target.value)}
              >
                <MenuItem value="scanTime">Thời gian quét</MenuItem>
                <MenuItem value="barcode">Mã mẫu</MenuItem>
                <MenuItem value="patientName">Tên bệnh nhân</MenuItem>
                <MenuItem value="testType">Loại xét nghiệm</MenuItem>
                <MenuItem value="priority">Mức ưu tiên</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Thứ tự</InputLabel>
              <Select
                value={scannedSortOrder}
                label="Thứ tự"
                onChange={(event) => setScannedSortOrder(event.target.value)}
              >
                <MenuItem value="asc">Tăng dần</MenuItem>
                <MenuItem value="desc">Giảm dần</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Mã mẫu</TableCell>
                  <TableCell>Bệnh nhân</TableCell>
                  <TableCell>Xét nghiệm</TableCell>
                  <TableCell>Ưu tiên</TableCell>
                  <TableCell>Thời điểm quét</TableCell>
                  <TableCell>Trạng thái</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedScanned.map((specimen) => (
                  <TableRow key={specimen.id} hover>
                    <TableCell>{specimen.barcode}</TableCell>
                    <TableCell>{specimen.patientName}</TableCell>
                    <TableCell>{specimen.testType}</TableCell>
                    <TableCell>{specimen.priority}</TableCell>
                    <TableCell>{specimen.scanTime}</TableCell>
                    <TableCell>{specimen.status || 'scanned'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeScannedDialog}>Đóng</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isTransportedOpen} onClose={closeTransportedDialog} fullWidth maxWidth="lg">
        <DialogTitle>Vận chuyển đã lưu</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Sắp xếp theo</InputLabel>
              <Select
                value={transportSortBy}
                label="Sắp xếp theo"
                onChange={(event) => setTransportSortBy(event.target.value)}
              >
                <MenuItem value="dispatchTime">Thời gian dispatch</MenuItem>
                <MenuItem value="arrivalTime">Thời gian arrival</MenuItem>
                <MenuItem value="fromStationName">Trạm đi</MenuItem>
                <MenuItem value="toStationName">Trạm đến</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel>Thứ tự</InputLabel>
              <Select
                value={transportSortOrder}
                label="Thứ tự"
                onChange={(event) => setTransportSortOrder(event.target.value)}
              >
                <MenuItem value="asc">Tăng dần</MenuItem>
                <MenuItem value="desc">Giảm dần</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Mã mẫu</TableCell>
                  <TableCell>Từ</TableCell>
                  <TableCell>Đến</TableCell>
                  <TableCell>Dispatch</TableCell>
                  <TableCell>Arrival</TableCell>
                  <TableCell>Cabin</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedTransported.map((item) => (
                  <TableRow
                    key={`${item.transportId || item.specimenId}-${item.dispatchTime || item.arrivalTime || 'na'}`}
                    hover
                  >
                    <TableCell>{item.barcode}</TableCell>
                    <TableCell>{item.fromStationName}</TableCell>
                    <TableCell>{item.toStationName}</TableCell>
                    <TableCell>{item.dispatchTime}</TableCell>
                    <TableCell>{item.arrivalTime}</TableCell>
                    <TableCell>{item.cabinId}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeTransportedDialog}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
});

// === Main AdminPage ===

const AdminPage = memo(function AdminPage({ scada }) {
  const [tabIndex, setTabIndex] = useState(0); // Mặc định mở tab Lịch Sử Hệ Thống
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [maintenanceReason, setMaintenanceReason] = useState(scada.maintenanceMode?.reason || '');
  
  // Fingerprint Enrollment State
  const [enrollUser, setEnrollUser] = useState(null);

  const handleEnrollFingerprint = useCallback((user) => {
    setEnrollUser(user);
  }, []);

  const handleCloseEnroll = useCallback(() => {
    setEnrollUser(null);
  }, []);

  const handleTabChange = useCallback((_, newValue) => {
    setTabIndex(newValue);
  }, []);

  const handleToggleMaintenance = useCallback((_, checked) => {
    scada.setMaintenanceState(checked, maintenanceReason);
    if (!checked) {
      setMaintenanceReason('');
    }
  }, [maintenanceReason, scada]);

  const handleOpenHistory = useCallback(() => setIsHistoryOpen(true), []);
  const handleCloseHistory = useCallback(() => setIsHistoryOpen(false), []);

  return (
    <Box
      sx={{
        width: '100%',
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Tab bar */}
      <Paper
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          backdropFilter: 'blur(16px)',
          border: `1px solid ${alpha('#1976D2', 0.15)}`,
          background: `linear-gradient(135deg, ${alpha('#1976D2', 0.08)} 0%, ${alpha('#64B5F6', 0.05)} 100%)`,
          borderRadius: 3,
          mb: 1,
          boxShadow: `0 8px 32px ${alpha('#000', 0.15)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pr: 2,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Tabs
          value={tabIndex}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            '& .MuiTab-root': {
              color: 'text.secondary',
              '&.Mui-selected': { color: 'primary.main' },
            },
            '& .MuiTabs-indicator': {
              bgcolor: 'primary.main',
              boxShadow: `0 0 12px ${alpha('#1976D2', 0.5)}`,
            },
          }}
        >
          <Tab label="1. Lịch Sử Hệ Thống" />
          <Tab label="2. Quản Lý Tài Khoản" />
          <Tab label="3. Cấp Tài Khoản" />
          <Tab label="4. Dữ Liệu Đã Lưu" />
        </Tabs>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: { xs: 1, sm: 0 }, pl: { xs: 2, sm: 0 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TextField
              size="small"
              placeholder="Lý do bảo trì..."
              value={maintenanceReason}
              onChange={(e) => setMaintenanceReason(e.target.value)}
              disabled={scada.maintenanceMode?.enabled}
              sx={{
                width: 140,
                '& .MuiInputBase-root': { fontSize: '0.75rem', height: 32 },
              }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={scada.maintenanceMode?.enabled || false}
                  onChange={handleToggleMaintenance}
                  color="warning"
                  sx={maintenanceSwitchSx}
                />
              }
              label={scada.maintenanceMode?.enabled ? 'CHẾ ĐỘ BẢO TRÌ' : 'CHẾ ĐỘ BẢO TRÌ'}
              sx={{
                mr: 0,
                '& .MuiFormControlLabel-label': {
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  color: scada.maintenanceMode?.enabled ? '#FF9800' : 'text.secondary',
                },
              }}
            />
            {scada.maintenanceMode?.enabled && (
              <BuildCircle sx={{ fontSize: 18, color: '#FF9800', opacity: 0.9 }} />
            )}
          </Box>
          <Button
            variant="contained"
            size="small"
            startIcon={<History />}
            onClick={handleOpenHistory}
            sx={{
              bgcolor: alpha('#1976D2', 0.1),
              color: '#1976D2',
              fontWeight: 700,
              border: `1px solid ${alpha('#1976D2', 0.15)}`,
              '&:hover': {
                bgcolor: alpha('#1976D2', 0.2),
              },
            }}
          >
            Lịch sử vận chuyển
          </Button>
        </Box>
      </Paper>

      {/* Tab content */}
      <Box sx={{ flexGrow: 1 }}>
        <TabPanel value={tabIndex} index={0}>
          <SystemLogsTable logs={scada.systemLogs} />
        </TabPanel>

        <TabPanel value={tabIndex} index={1}>
          <UserManagementTable
            users={scada.users}
            onToggleActive={scada.toggleUserActive}
            onUpdateRole={scada.updateUserRole}
            onRemove={scada.removeUser}
            onEnrollFingerprint={handleEnrollFingerprint}
          />
        </TabPanel>

        <TabPanel value={tabIndex} index={2}>
          <CreateUserForm onCreateUser={scada.addUser} />
        </TabPanel>

        <TabPanel value={tabIndex} index={3}>
          <PersistedDataPanel scada={scada} />
        </TabPanel>
      </Box>

      {/* Transport history dialog */}
      <TransportHistoryDialog
        open={isHistoryOpen}
        onClose={handleCloseHistory}
        records={scada.transportedSpecimens}
        title="Lịch Sử Vận Chuyển — Admin"
      />

      {/* Fingerprint Enrollment Modal */}
      <FingerprintEnrollModal
        user={enrollUser}
        onClose={handleCloseEnroll}
        scada={scada}
      />
    </Box>
  );
});

// ── Fingerprint Enroll Modal Component ─────────────────────────────────────────
const FP_STATUS = { WAITING: 'waiting', SUCCESS: 'success', TIMEOUT: 'timeout', ERROR: 'error' };

const FingerprintEnrollModal = memo(function FingerprintEnrollModal({ user, onClose, scada }) {
  const [status, setStatus] = useState(FP_STATUS.WAITING);
  const [progress, setProgress] = useState(100);
  const [errorMsg, setErrorMsg] = useState('');
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const progressRef = useRef(null);
  const startTimeRef = useRef(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (progressRef.current) cancelAnimationFrame(progressRef.current);
    if (socketRef.current) {
      socketRef.current.emit('FINGERPRINT_ENROLL_CANCEL');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!user) {
      cleanup();
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(FP_STATUS.WAITING);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(100);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setErrorMsg('');

    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'], withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('FINGERPRINT_ENROLL_START', { userId: user.id, username: user.username });
    });

    socket.on('connect_error', () => {
      setErrorMsg('Không thể kết nối máy chủ.');
      setStatus(FP_STATUS.ERROR);
    });

    socket.on('ENROLL_SUCCESS', (data) => {
      if (data.userId === user.id) {
        setStatus(FP_STATUS.SUCCESS);
        if (timerRef.current) clearTimeout(timerRef.current);
        if (scada && typeof scada.hydratePersistedData === 'function') {
          scada.hydratePersistedData({ syncStations: false }).catch(() => null);
        }
      }
    });

    socket.on('ENROLL_ERROR', (data) => {
      setErrorMsg(data.message || 'Lỗi đăng ký vân tay.');
      setStatus(FP_STATUS.ERROR);
    });

    startTimeRef.current = Date.now();
    const updateProgress = () => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, 1 - elapsed / ENROLL_TIMEOUT_MS);
      setProgress(remaining * 100);
      if (remaining > 0) progressRef.current = requestAnimationFrame(updateProgress);
    };
    progressRef.current = requestAnimationFrame(updateProgress);

    timerRef.current = setTimeout(() => {
      setStatus(FP_STATUS.TIMEOUT);
      setErrorMsg('Hết thời gian chờ đăng ký.');
      socket.emit('FINGERPRINT_ENROLL_CANCEL');
      socket.disconnect();
    }, ENROLL_TIMEOUT_MS);

    return cleanup;
  }, [user, cleanup, scada]);

  const handleClose = useCallback(() => {
    cleanup();
    onClose();
  }, [cleanup, onClose]);

  return (
    <Dialog open={!!user} onClose={handleClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3, background: 'linear-gradient(180deg, #0f1923 0%, #152238 50%, #0d1520 100%)', border: `1px solid ${alpha('#65B5FF', 0.2)}`, overflow: 'hidden' } } }}>
      <IconButton onClick={handleClose} sx={{ position: 'absolute', right: 8, top: 8, color: alpha('#fff', 0.5), zIndex: 2 }}>
        <CloseIcon />
      </IconButton>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 5, px: 3, minHeight: 340 }}>
        {status === FP_STATUS.WAITING && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Box sx={{ position: 'relative', mb: 3 }}>
              <Box sx={{ position: 'absolute', inset: -18, borderRadius: '50%', border: `2px solid ${alpha('#64B5F6', 0.3)}`, animation: `${pulseRing} 2s ease-in-out infinite` }} />
              <Box sx={{ width: 100, height: 100, borderRadius: '50%', background: `linear-gradient(135deg, ${alpha('#1976D2', 0.25)}, ${alpha('#64B5F6', 0.1)})`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${alpha('#64B5F6', 0.3)}`, position: 'relative', overflow: 'hidden' }}>
                <FingerprintIcon sx={{ fontSize: 52, color: '#64B5F6' }} />
                <Box sx={{ position: 'absolute', left: '10%', right: '10%', height: 2, background: `linear-gradient(90deg, transparent, ${alpha('#64B5F6', 0.8)}, transparent)`, animation: `${scanLine} 2s ease-in-out infinite` }} />
              </Box>
            </Box>
            <Typography variant="h6" sx={{ color: '#E3F2FD', fontWeight: 700, mb: 0.5, textAlign: 'center' }}>
              Đăng ký vân tay
            </Typography>
            <Typography variant="body2" sx={{ color: alpha('#B3D9FF', 0.7), textAlign: 'center', mb: 3 }}>
              Nhân viên <b>{user?.fullname}</b> vui lòng đặt ngón tay lên cảm biến (cần quét 2 lần).
            </Typography>
            <Box sx={{ width: '100%', px: 2 }}>
              <LinearProgress variant="determinate" value={progress} sx={{ height: 4, borderRadius: 2, backgroundColor: alpha('#fff', 0.06), '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #1976D2, #64B5F6)' } }} />
            </Box>
          </Box>
        )}
        {status === FP_STATUS.SUCCESS && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <CheckCircleOutline sx={{ fontSize: 80, color: '#66BB6A', mb: 2, animation: `${checkBounce} 0.5s ease-out` }} />
            <Typography variant="h6" sx={{ color: '#C8E6C9', fontWeight: 700, mb: 0.5 }}>Đăng ký thành công!</Typography>
          </Box>
        )}
        {(status === FP_STATUS.TIMEOUT || status === FP_STATUS.ERROR) && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <ErrorOutline sx={{ fontSize: 80, color: status === FP_STATUS.TIMEOUT ? '#FFA726' : '#EF5350', mb: 2, animation: `${checkBounce} 0.5s ease-out` }} />
            <Typography variant="h6" sx={{ color: status === FP_STATUS.TIMEOUT ? '#FFE0B2' : '#FFCDD2', fontWeight: 700, mb: 0.5 }}>
              {status === FP_STATUS.TIMEOUT ? 'Hết thời gian' : 'Lỗi'}
            </Typography>
            <Typography variant="body2" sx={{ color: alpha('#fff', 0.5), textAlign: 'center', mb: 3 }}>{errorMsg}</Typography>
            <Button variant="outlined" onClick={handleClose} sx={{ borderColor: alpha('#fff', 0.2), color: '#B3D9FF' }}>Đóng</Button>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
});

export default AdminPage;
