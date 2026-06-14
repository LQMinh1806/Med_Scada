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
  { x: 150, y: 100 },   // 0: Trạm Trung Tâm (Đầu đoạn nằm ngang trên cùng)
  { x: 350, y: 100 },   // 1: Cuối đoạn nằm ngang trên cùng
  { x: 550, y: 210 },   // 2: Trạm Xét Nghiệm (Đầu đoạn nằm ngang ở giữa)
  { x: 1050, y: 210 },  // 3: Trạm Vi Sinh (Cuối đoạn nằm ngang ở giữa)
  { x: 1250, y: 320 },  // 4: Đầu đoạn nằm ngang dưới cùng
  { x: 1450, y: 320 },  // 5: Trạm PCR (Cuối đoạn nằm ngang dưới cùng)
];

export const STATIONS = [
  { id: 'ST-01', name: 'Trung Tâm', idx: 0, samples: 0, ready: true },
  { id: 'ST-02', name: 'Xét Nghiệm', idx: 2, samples: 0, ready: true },
  { id: 'ST-03', name: 'Vi Sinh', idx: 3, samples: 0, ready: true },
  { id: 'ST-04', name: 'PCR', idx: 5, samples: 0, ready: true },
];

// === Default users ===
export const INITIAL_USERS = [
  { id: 1, username: 'tech_01', fullname: 'Kỹ Thuật Viên', role: 'tech', active: true },
  { id: 2, username: 'operator_01', fullname: 'Vận Hành Viên', role: 'operator', active: true },
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

// === Robot status strings (centralized source of truth) ===
export const ROBOT_STATUS = {
  READY: 'Sẵn sàng',
  MOVING: 'Đang di chuyển',
  ESTOP: 'Dừng khẩn cấp',
  MAINTENANCE: 'Bảo trì',
};
