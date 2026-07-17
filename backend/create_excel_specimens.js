/**
 * create_excel_specimens.js
 * Tạo file Excel DanhSachMau_Mau.xlsx với 10 mẫu bệnh phẩm thực tế
 * phù hợp với 4 trạm: Cấp Cứu / Khám Bệnh / Hồi Sức Tích Cực / Xét Nghiệm
 *
 * Chạy: node backend/create_excel_specimens.js
 */

import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 12 mẫu bệnh phẩm — 4 trạm × 3 mẫu, trạm đích đa dạng ──────────────
// Không có cột Priority — người dùng chọn thủ công trên giao diện
const data = [
  // Header row — 5 cột
  ['Barcode', 'PatientName', 'TestType', 'Trạm đích', 'Ghi chú (Nguồn)'],

  // ── TỪ ST-01 CẤP CỨU → 3 trạm đích khác nhau ──────────────────────────
  ['EM-2026-001', 'Nguyễn Văn An',    'Máu toàn phần (Heparin) - Khí máu ABG',   'ST-04', 'Cấp Cứu → Xét Nghiệm'],
  ['EM-2026-002', 'Trần Thị Bích',    'Huyết thanh - Sinh hóa (Troponin I)',     'ST-02', 'Cấp Cứu → Khám Bệnh'],
  ['EM-2026-003', 'Lê Minh Tuấn',     'Huyết tương (Citrate) - Đông máu PT/APTT', 'ST-03', 'Cấp Cứu → ICU'],

  // ── TỪ ST-02 KHÁM BỆNH → 3 trạm đích khác nhau ─────────────────────────
  ['OPD-2026-001', 'Phạm Thị Lan',    'Máu toàn phần (EDTA) - Công thức máu CBC', 'ST-04', 'Khám Bệnh → Xét Nghiệm'],
  ['OPD-2026-002', 'Hoàng Văn Đức',   'Huyết thanh - Sinh hóa (Glucose/HbA1c)',  'ST-01', 'Khám Bệnh → Cấp Cứu'],
  ['OPD-2026-003', 'Vũ Thị Hoa',      'Mẫu nước tiểu - Tổng phân tích 10 thông số','ST-03', 'Khám Bệnh → ICU'],

  // ── TỪ ST-03 HỒI SỨC TÍCH CỰC (ICU) → 3 trạm đích khác nhau ──────────
  ['ICU-2026-001', 'Ngô Thị Minh',    'Huyết thanh - Điện giải đồ (Na, K, Cl)',  'ST-04', 'ICU → Xét Nghiệm'],
  ['ICU-2026-002', 'Bùi Văn Hùng',    'Mẫu cấy - Cấy máu tìm vi khuẩn',          'ST-01', 'ICU → Cấp Cứu'],
  ['ICU-2026-003', 'Lý Thị Thu',      'Mẫu dịch - Sinh hóa dịch não tủy CSF',    'ST-02', 'ICU → Khám Bệnh'],

  // ── TỪ ST-04 XÉT NGHIỆM → 3 trạm đích khác nhau ───────────────────────
  ['LAB-2026-001', 'Đinh Quang Khải', 'Mẫu mô - Sinh thiết tức thì (Frozen)',    'ST-01', 'Xét Nghiệm → Cấp Cứu'],
  ['LAB-2026-002', 'Mai Thị Xuân',    'Huyết thanh - Mỡ máu (Lipid Profile)',    'ST-02', 'Xét Nghiệm → Khám Bệnh'],
  ['LAB-2026-003', 'Võ Minh Khoa',    'Huyết thanh - Miễn dịch (Procalcitonin)',  'ST-03', 'Xét Nghiệm → ICU'],
];

// ── Tạo workbook và worksheet ──────────────────────────────────────────────
const ws = XLSX.utils.aoa_to_sheet(data);

// Căn chỉnh độ rộng cột cho dễ đọc
ws['!cols'] = [
  { wch: 16 },  // Barcode
  { wch: 20 },  // PatientName
  { wch: 45 },  // TestType
  { wch: 10 },  // Trạm đích
  { wch: 26 },  // Ghi chú (Nguồn)
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'DanhSachMau');

// Ghi ra file (ghi đè file cũ)
const outputPath = path.join(__dirname, 'DanhSachMau_Mau.xlsx');
XLSX.writeFile(wb, outputPath);

console.log('✅ Đã tạo file Excel thành công!');
console.log(`📄 Đường dẫn: ${outputPath}`);
console.log(`📊 Tổng số mẫu: ${data.length - 1} mẫu`);
console.log('');
console.log('📋 Danh sách mẫu:');
for (let i = 1; i < data.length; i++) {
  const [barcode, patient, test, dest, note] = data[i];
  console.log(`  📦 ${barcode.padEnd(14)} | ${patient.padEnd(18)} | ${dest} | ${test}`);
}
console.log('');
console.log('💡 Để import vào hệ thống: vào giao diện Admin → Import Excel → chọn file này');
