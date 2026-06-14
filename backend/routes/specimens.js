// ══════════════════════════════════════════════════════════════════════════════
// routes/specimens.js
// ──────────────────────────────────────────────────────────────────────────────
// Specimen-specific routes: Excel import, barcode lookup, batch scan.
// ══════════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { toDbPriority, toApiPriority } from '../config.js';
import { requireAuth, requireRole, getRequesterId } from '../middleware/auth.js';
import { broadcastSyncRequired } from '../services/sync.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const NON_SCANNABLE_SPECIMEN_STATUSES = new Set(['IN_TRANSIT', 'COMPLETED']);
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

function mapSpecimenForApi(specimen) {
  return {
    ...specimen,
    priority: toApiPriority(specimen.priority),
    status: String(specimen.status || 'PENDING').toLowerCase(),
    destinationStationId: specimen.destinationStationId || specimen.destinationStation?.id || null,
    destinationStationName: specimen.destinationStation?.name || null,
  };
}

export default function createSpecimenRoutes(prisma) {
  const router = Router();

  // ── POST /api/specimens/import — Bulk import from Excel ─────────────────
  router.post('/import', requireAuth, requireRole('tech'), upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Vui lòng chọn file Excel.' });
      }

      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return res.status(400).json({ message: 'File Excel không có sheet nào.' });
      }

      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
      if (!rows.length) {
        return res.status(400).json({ message: 'File Excel không có dữ liệu.' });
      }

      const stations = await prisma.station.findMany({
        select: { id: true, name: true, locationIndex: true },
        orderBy: { locationIndex: 'asc' },
      });
      const stationLookup = buildStationLookup(stations);

      // Normalize rows — support common column name variants
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

        if (!barcode) {
          errors.push({ row: i + 2, reason: 'Thiếu mã vạch (Barcode)' });
          continue;
        }
        if (!patientName) {
          errors.push({ row: i + 2, reason: `Barcode ${barcode}: Thiếu tên bệnh nhân` });
          continue;
        }
        if (!testType) {
          errors.push({ row: i + 2, reason: `Barcode ${barcode}: Thiếu loại xét nghiệm` });
          continue;
        }
        if (!destinationStation) {
          errors.push({
            row: i + 2,
            reason: `Barcode ${barcode}: Thiếu hoặc sai trạm đích (ví dụ: ST-02, Xét Nghiệm, Vi Sinh, PCR)`,
          });
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
        return res.status(400).json({
          message: 'Không có dữ liệu hợp lệ trong file.',
          errors,
        });
      }

      // Upsert all specimens in a transaction
      const results = await prisma.$transaction(
        specimens.map((spec) =>
          prisma.specimen.upsert({
            where: { barcode: spec.barcode },
            create: {
              barcode: spec.barcode,
              patientName: spec.patientName,
              testType: spec.testType,
              priority: spec.priority,
              destinationStationId: spec.destinationStationId,
              status: 'PENDING',
            },
            update: {
              patientName: spec.patientName,
              testType: spec.testType,
              priority: spec.priority,
              destinationStationId: spec.destinationStationId,
              // Don't overwrite status if already SCANNED/IN_TRANSIT/COMPLETED
            },
            select: {
              id: true,
              barcode: true,
              patientName: true,
              testType: true,
              priority: true,
              status: true,
              destinationStationId: true,
              destinationStation: { select: { id: true, name: true } },
            },
          })
        )
      );

      broadcastSyncRequired('specimens-imported');

      return res.status(201).json({
        message: `Đã import ${results.length} mẫu bệnh phẩm.`,
        imported: results.length,
        errors: errors.length > 0 ? errors : undefined,
        specimens: results.map(mapSpecimenForApi),
      });
    } catch (error) {
      console.error('IMPORT_SPECIMENS_ERROR', error);
      return res.status(500).json({ message: 'Lỗi máy chủ khi import.' });
    }
  });

  // ── GET /api/specimens/lookup/:barcode — Lookup specimen by barcode ─────
  router.get('/lookup/:barcode', requireAuth, async (req, res) => {
    try {
      const barcode = String(req.params.barcode || '').trim().toUpperCase();
      if (!barcode) {
        return res.status(400).json({ message: 'Barcode không được để trống.' });
      }

      const specimen = await prisma.specimen.findUnique({
        where: { barcode },
        select: {
          id: true,
          barcode: true,
          patientName: true,
          testType: true,
          priority: true,
          status: true,
          scanTime: true,
          scannedById: true,
          scannedBy: { select: { username: true, fullname: true } },
          destinationStationId: true,
          destinationStation: { select: { id: true, name: true } },
          createdAt: true,
        },
      });

      if (!specimen) {
        return res.status(404).json({ message: `Không tìm thấy mẫu với barcode: ${barcode}` });
      }

      return res.status(200).json({
        specimen: mapSpecimenForApi(specimen),
      });
    } catch (error) {
      console.error('LOOKUP_SPECIMEN_ERROR', error);
      return res.status(500).json({ message: 'Lỗi máy chủ.' });
    }
  });

  // ── POST /api/specimens/batch-scan — Mark multiple specimens as SCANNED ─
  router.post('/batch-scan', requireAuth, async (req, res) => {
    try {
      const { barcodes } = req.body ?? {};
      const requesterId = getRequesterId(req);

      if (!Array.isArray(barcodes) || barcodes.length === 0) {
        return res.status(400).json({ message: 'barcodes[] là bắt buộc.' });
      }

      if (!requesterId) {
        return res.status(401).json({ message: 'Invalid access token.' });
      }

      const normalizedBarcodes = barcodes.map((b) => String(b || '').trim().toUpperCase()).filter(Boolean);
      const uniqueBarcodes = [...new Set(normalizedBarcodes)];
      if (uniqueBarcodes.length !== barcodes.length) {
        return res.status(400).json({ message: 'barcodes[] chứa giá trị trống hoặc bị trùng.' });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.specimen.findMany({
          where: { barcode: { in: uniqueBarcodes } },
          select: { barcode: true, status: true },
        });

        if (existing.length !== uniqueBarcodes.length) {
          const foundBarcodes = new Set(existing.map((spec) => spec.barcode));
          const missingBarcodes = uniqueBarcodes.filter((barcode) => !foundBarcodes.has(barcode));
          const err = new Error(`Không tìm thấy barcode: ${missingBarcodes.join(', ')}`);
          err.statusCode = 404;
          throw err;
        }

        const blocked = existing.filter((spec) => NON_SCANNABLE_SPECIMEN_STATUSES.has(spec.status));
        if (blocked.length) {
          const err = new Error(
            `Không thể quét lại mẫu đã vận chuyển: ${blocked.map((spec) => `${spec.barcode} (${spec.status})`).join(', ')}`
          );
          err.statusCode = 409;
          throw err;
        }

        return Promise.all(uniqueBarcodes.map((barcode) =>
          tx.specimen.update({
            where: { barcode },
            data: {
              status: 'SCANNED',
              scannedById: requesterId,
              scanTime: new Date(),
            },
            select: {
              id: true,
              barcode: true,
              patientName: true,
              testType: true,
              priority: true,
              status: true,
              destinationStationId: true,
              destinationStation: { select: { id: true, name: true } },
            },
          })
        ));
      });

      broadcastSyncRequired('specimens-batch-scanned');

      return res.status(200).json({
        message: `Đã cập nhật ${updated.length} mẫu.`,
        specimens: updated.map(mapSpecimenForApi),
      });
    } catch (error) {
      console.error('BATCH_SCAN_ERROR', error);
      return res.status(error?.statusCode || 500).json({ message: error.message || 'Lỗi máy chủ.' });
    }
  });

  // ── GET /api/specimens/pending — List pending specimens ─────────────────
  router.get('/pending', requireAuth, async (_req, res) => {
    try {
      const specimens = await prisma.specimen.findMany({
        where: { status: 'PENDING' },
        select: {
          id: true,
          barcode: true,
          patientName: true,
          testType: true,
          priority: true,
          status: true,
          destinationStationId: true,
          destinationStation: { select: { id: true, name: true } },
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      return res.status(200).json({
        specimens: specimens.map(mapSpecimenForApi),
      });
    } catch (error) {
      console.error('LIST_PENDING_ERROR', error);
      return res.status(500).json({ message: 'Lỗi máy chủ.' });
    }
  });

  return router;
}
