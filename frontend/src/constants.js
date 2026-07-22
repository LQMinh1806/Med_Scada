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
// Dựa trên bản vẽ SolidWorks thực tế:
//   - Tổng chiều dài ray: 4000mm
//   - Khuỷu 1: góc 30° (atan(dy/dx) = atan(90/156) ≈ 30°)
//   - Khuỷu 2: góc 40° (atan(dy/dx) = atan(110/131) ≈ 40°)
//   - Bán kính cung: 60mm → SVG bo tròn 55px
//   - Đoạn cuối: 500mm flat trước ST-04
//   - Tỉ lệ thời gian: ST-01=0s  ST-02=11s  ST-03=19s  ST-04=30s
//
// Tổng chiều dài hình học SVG ≈ 1523px → scale: 1460px / 4000mm = 0.365 px/mm
//
// idx  Toạ độ SVG        Vị trí thực (mm)
//  0   (40,  130)        Đầu ray trái
//  1   (120, 130)        ST-01 Cấp Cứu (dịch chuyển vào trong)
//  2   (270, 130)        Khuỷu 1 bắt đầu (đoạn nằm ngang)
//  3   (430, 220)        Khuỷu 1 kết thúc (30°: dx=160, dy=90)
//  4   (620, 220)        ST-02 Khám Bệnh
//  5   (1010,220)        ST-03 Hồi Sức Tích Cực
//  6   (1100,220)        Khuỷu 2 bắt đầu
//  7   (1235,330)        Khuỷu 2 kết thúc (40°: dx=135, dy=110)
//  8   (1500,330)        ST-04 Xét Nghiệm (dịch chuyển vào trong)
//  9   (1580,330)        Cuối ray phải
export const RAIL_POINTS = [
  { x: 40,   y: 130 },   // 0: Đầu ray trái
  { x: 120,  y: 130 },   // 1: ST-01 — Cấp Cứu
  { x: 270,  y: 130 },   // 2: Khuỷu 1 — đầu đoạn chéo
  { x: 430,  y: 220 },   // 3: Khuỷu 1 — cuối đoạn chéo (30°)
  { x: 620,  y: 220 },   // 4: ST-02 — Khám Bệnh
  { x: 1010, y: 220 },   // 5: ST-03 — Hồi Sức Tích Cực
  { x: 1100, y: 220 },   // 6: Khuỷu 2 — đầu đoạn chéo
  { x: 1235, y: 330 },   // 7: Khuỷu 2 — cuối đoạn chéo (40°)
  { x: 1500, y: 330 },   // 8: ST-04 — Xét Nghiệm
  { x: 1580, y: 330 },   // 9: Cuối ray phải
];

export const STATIONS = [
  { id: 'ST-01', name: 'Cấp Cứu',           idx: 1, samples: 0, ready: true },
  { id: 'ST-02', name: 'Khám Bệnh',          idx: 4, samples: 0, ready: true },
  { id: 'ST-03', name: 'Hồi Sức Tích Cực',  idx: 5, samples: 0, ready: true },
  { id: 'ST-04', name: 'Xét Nghiệm',         idx: 8, samples: 0, ready: true },
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
