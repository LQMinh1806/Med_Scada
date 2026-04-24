// ========================================
// SCADA System Constants
// Centralized configuration for the entire application
// ========================================

// === Route identifiers ===
export const ROUTES = {
  LOGIN: 'login',
  HUB: 'hub',
  MONITORING: 'monitoring',
  CONTROL: 'control',
  ADMIN: 'admin',
};

// === Rail & Station topology ===
export const RAIL_POINTS = [
  { x: 100, y: 250 },
  { x: 400, y: 100 },
  { x: 700, y: 250 },
  { x: 1000, y: 100 },
  { x: 1200, y: 200 },
  { x: 1500, y: 100 },
];

export const STATIONS = [
  { id: 'ST-01', name: 'Trung tam', idx: 0, samples: 0, ready: true },
  { id: 'ST-02', name: 'Xet nghiem', idx: 2, samples: 3, ready: true },
  { id: 'ST-03', name: 'Vi sinh', idx: 3, samples: 2, ready: true },
  { id: 'ST-04', name: 'PCR', idx: 5, samples: 1, ready: true },
];

// === Default users ===
export const INITIAL_USERS = [
  { id: 1, username: 'tech_01', password: '123456', fullname: 'Kỹ Thuật Viên', role: 'tech', active: true },
  { id: 2, username: 'operator_01', password: '123456', fullname: 'Vận Hành Viên', role: 'operator', active: true },
];

export const USER_ROLES = {
  TECH: 'tech',
  OPERATOR: 'operator',
};

// === Simulation & animation tuning ===
export const MAX_LOGS = 300;
export const MAX_SPECIMEN_HISTORY = 500;
export const SPEED_PX_PER_SEC = 200;
export const MIN_MOVE_DURATION_SEC = 0.6;
export const MIN_ANIMATION_DURATION_MS = 200;
export const BEZIER_SAMPLES_PER_SEG = 36;

// === Specimen data for simulation ===
export const TEST_TYPES = ['CBC', 'PCR', 'Sinh hóa máu', 'Vi sinh nuôi cấy', 'Đông máu'];
export const PATIENT_NAMES = ['Nguyễn Văn A', 'Trần Thị B', 'Lê Quốc C', 'Phạm Mai D', 'Đoàn Minh E'];

// === Priority levels ===
export const PRIORITY = {
  ROUTINE: 'routine',
  STAT: 'stat',
};

export const PRIORITY_LABELS = {
  [PRIORITY.ROUTINE]: 'Routine',
  [PRIORITY.STAT]: 'STAT — Khẩn cấp',
};
