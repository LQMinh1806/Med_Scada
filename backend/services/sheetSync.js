import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { toDbPriority, GOOGLE_SHEET_ID } from '../config.js';
import { broadcastSyncRequired } from './sync.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DESTINATION_COLUMN_KEYS = [
  'DestinationStationId', 'destinationStationId', 'DestinationStation', 'destinationStation',
  'ToStationId', 'toStationId', 'ToStation', 'toStation', 'Destination', 'destination',
  'Trạm đích', 'Tram dich', 'Trạm đến', 'Tram den', 'Nơi nhận', 'Noi nhan'
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

function buildStationLookup(stations) {
  const lookup = new Map();
  for (const station of stations) {
    lookup.set(normalizeLookupText(station.id), station);
    lookup.set(normalizeLookupText(station.name), station);
    lookup.set(normalizeLookupText(String(station.locationIndex + 1)), station);
    lookup.set(normalizeLookupText(String(station.locationIndex)), station);
  }
  return lookup;
}

function resolveStation(rawValue, stationLookup) {
  const normalized = normalizeLookupText(rawValue);
  if (!normalized) return null;
  return stationLookup.get(normalized) || null;
}

/**
 * Không cần lưu cấu hình nữa vì ID đã cố định
 */
export function saveSheetConfig(sheetId) {
  // Bỏ qua không lưu file
}

/**
 * Trả về Sheet ID cố định được cấu hình trong config.js
 */
export function getSavedSheetId() {
  return GOOGLE_SHEET_ID;
}

/**
 * Thực hiện đồng bộ dữ liệu từ Google Sheets
 * @returns {Promise<{success: boolean, imported: number, errors: Array, specimens?: Array, message?: string}>}
 */
export async function syncGoogleSheet(prisma, sheetId) {
  if (!sheetId) return { success: false, imported: 0, errors: [], message: 'Không có Sheet ID.' };

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId.trim()}/export?format=csv&gid=0`;

  try {
    const response = await fetch(csvUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      return { success: false, imported: 0, errors: [], message: `Không thể tải Google Sheet (HTTP ${response.status})` };
    }
    const csvText = await response.text();

    const workbook = XLSX.read(csvText, { type: 'string' });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

    if (!rows.length) {
      return { success: false, imported: 0, errors: [], message: 'Google Sheet rỗng hoặc thiếu tiêu đề.' };
    }

    const stations = await prisma.station.findMany({
      select: { id: true, name: true, locationIndex: true },
      orderBy: { locationIndex: 'asc' },
    });
    const stationLookup = buildStationLookup(stations);

    const specimens = [];
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

      const priorityRaw = String(
        row.Priority || row.priority || row['Ưu tiên'] || row['Uu tien'] || 'routine'
      ).trim().toLowerCase();

      const destinationRaw = readFirstValue(row, DESTINATION_COLUMN_KEYS);
      const destinationStation = resolveStation(destinationRaw, stationLookup);

      if (!barcode) { errors.push({ row: i + 2, reason: 'Thiếu mã vạch (Barcode)' }); continue; }
      if (!patientName) { errors.push({ row: i + 2, reason: `Barcode ${barcode}: Thiếu tên bệnh nhân` }); continue; }
      if (!testType) { errors.push({ row: i + 2, reason: `Barcode ${barcode}: Thiếu loại xét nghiệm` }); continue; }
      if (!destinationStation) {
        errors.push({ row: i + 2, reason: `Barcode ${barcode}: Thiếu hoặc sai trạm đích` });
        continue;
      }

      specimens.push({
        barcode,
        patientName,
        testType,
        priority: toDbPriority(priorityRaw),
        destinationStationId: destinationStation.id,
        status: 'PENDING',
      });
    }

    if (specimens.length === 0) {
      return { success: false, imported: 0, errors, message: 'Không tìm thấy dòng dữ liệu nào hợp lệ.' };
    }

    // ── TỐI ƯU HÓA: So sánh với dữ liệu hiện tại trong DB ─────────────────────
    const currentDbSpecimens = await prisma.specimen.findMany({
      where: { barcode: { in: specimens.map(s => s.barcode) } },
      select: {
        barcode: true,
        patientName: true,
        testType: true,
        priority: true,
        destinationStationId: true,
      }
    });

    const dbLookup = new Map(currentDbSpecimens.map(s => [s.barcode, s]));
    let hasChanges = false;

    // Nếu số lượng mẫu tải về khác số lượng mẫu hiện tại trong DB
    if (specimens.length !== currentDbSpecimens.length) {
      hasChanges = true;
    } else {
      // Hoặc nếu có bất cứ thông tin mẫu nào bị khác biệt
      for (const spec of specimens) {
        const dbSpec = dbLookup.get(spec.barcode);
        if (!dbSpec ||
            dbSpec.patientName !== spec.patientName ||
            dbSpec.testType !== spec.testType ||
            dbSpec.priority !== spec.priority ||
            dbSpec.destinationStationId !== spec.destinationStationId) {
          hasChanges = true;
          break;
        }
      }
    }

    // Nếu không có bất kỳ thay đổi nào, dừng xử lý ngầm tại đây (không ghi đè DB & không bắn socket)
    if (!hasChanges) {
      return {
        success: true,
        imported: 0,
        errors: errors.length > 0 ? errors : [],
        specimens: [],
        noChangesDetected: true,
      };
    }

    // Thực hiện upsert trong database transaction khi thực sự có thay đổi
    const results = await prisma.$transaction(
      specimens.map((spec) =>
        prisma.specimen.upsert({
          where: { barcode: spec.barcode },
          create: { ...spec },
          update: {
            patientName: spec.patientName,
            testType: spec.testType,
            priority: spec.priority,
            destinationStationId: spec.destinationStationId,
          },
          select: {
            id: true, barcode: true, patientName: true, testType: true,
            priority: true, status: true, destinationStationId: true,
            destinationStation: { select: { id: true, name: true } },
          },
        })
      )
    );

    // Kích hoạt phát sóng đồng bộ dữ liệu theo thời gian thực tới tất cả Client
    broadcastSyncRequired('specimens-synced-sheet');

    return {
      success: true,
      imported: results.length,
      errors: errors.length > 0 ? errors : [],
      specimens: results,
    };
  } catch (err) {
    console.error('[SheetSync] Lỗi trong lúc xử lý đồng bộ Google Sheets:', err);
    return { success: false, imported: 0, errors: [], message: err.message };
  }
}
