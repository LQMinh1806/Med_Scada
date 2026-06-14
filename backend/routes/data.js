// ══════════════════════════════════════════════════════════════════════════════
// routes/data.js
// ──────────────────────────────────────────────────────────────────────────────
// Data routes: bootstrap, stations sync, specimen scan, transport complete,
// system logs, SSE events, and health check.
// ══════════════════════════════════════════════════════════════════════════════

import { Router } from 'express';
import {
  mapUserForApi,
  toApiPriority,
  toDbPriority,
  toDbTransportStatus,
  toIsoOrNull,
  toIsoOrNow,
  parseLogType,
  ARCHIVED_USERNAME_PREFIX,
  DELETED_OWNER_USERNAME,
} from '../config.js';
import { requireAuth, requireRole, getRequesterId } from '../middleware/auth.js';
import { broadcastSyncRequired, addSseClient, removeSseClient } from '../services/sync.js';

const NON_SCANNABLE_SPECIMEN_STATUSES = new Set(['IN_TRANSIT', 'COMPLETED']);

function canConfirmStationDelivery(req, user, stationId) {
  const role = String(user?.role || req.user?.role || '').toLowerCase();
  if (role === 'tech') return true;
  if (role !== 'operator') return false;
  return String(user?.stationId || req.user?.stationId || '') === String(stationId || '');
}

function getSpecimenStatusForTransport(transportStatus) {
  if (transportStatus === 'ARRIVED') return 'COMPLETED';
  if (transportStatus === 'RUNNING') return 'IN_TRANSIT';
  return undefined;
}

export default function createDataRoutes(prisma) {
  const router = Router();

  // ── GET /api/health ────────────────────────────────────────────────────
  router.get('/health', (_, res) => {
    res.status(200).json({ ok: true, service: 'scada-backend' });
  });

  // ── GET /api/events (SSE) ──────────────────────────────────────────────
  router.get('/events', requireAuth, (_req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    addSseClient(res);
    res.write(`data: ${JSON.stringify({ type: 'connected', ts: Date.now() })}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        removeSseClient(res);
      }
    }, 25000);

    res.on('close', () => {
      clearInterval(heartbeat);
      removeSseClient(res);
    });
  });

  // ── GET /api/bootstrap ─────────────────────────────────────────────────
  router.get('/bootstrap', requireAuth, async (_, res) => {
    try {
      const [users, stations, specimens, transportRecords, systemLogs] = await Promise.all([
        prisma.user.findMany({
          where: {
            AND: [
              { username: { not: { startsWith: ARCHIVED_USERNAME_PREFIX } } },
              { username: { not: DELETED_OWNER_USERNAME } },
            ],
          },
          select: {
            id: true,
            username: true,
            fullname: true,
            role: true,
            active: true,
            fingerprintId: true,
            stationId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        prisma.station.findMany({
          select: { id: true, name: true, locationIndex: true },
          orderBy: { locationIndex: 'asc' },
        }),
        prisma.specimen.findMany({
          select: {
            id: true,
            barcode: true,
            patientName: true,
            testType: true,
            priority: true,
            status: true,
            scanTime: true,
            scannedById: true,
            scannedBy: { select: { username: true } },
            destinationStationId: true,
            destinationStation: { select: { id: true, name: true } },
          },
          orderBy: { scanTime: 'desc' },
          take: 300,
        }),
        prisma.transportRecord.findMany({
          select: {
            id: true,
            cabinId: true,
            status: true,
            dispatchTime: true,
            arrivalTime: true,
            specimen: {
              select: {
                id: true,
                barcode: true,
                patientName: true,
                testType: true,
                priority: true,
                scanTime: true,
              },
            },
            fromStation: { select: { id: true, name: true } },
            toStation: { select: { id: true, name: true } },
          },
          orderBy: { dispatchTime: 'desc' },
          take: 500,
        }),
        prisma.systemLog.findMany({
          select: {
            id: true,
            event: true,
            type: true,
            createdAt: true,
            userId: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 300,
        }),
      ]);

      return res.status(200).json({
        users: users.map(mapUserForApi),
        stations,
        scannedSpecimens: specimens.map((item) => ({
          id: item.id,
          barcode: item.barcode,
          patientName: item.patientName,
          testType: item.testType,
          priority: toApiPriority(item.priority),
          status: String(item.status || 'PENDING').toLowerCase(),
          scanTime: item.scanTime,
          scannedById: item.scannedById,
          scannedByUsername: item.scannedBy?.username || null,
          destinationStationId: item.destinationStationId || item.destinationStation?.id || null,
          destinationStationName: item.destinationStation?.name || null,
        })),
        transportedSpecimens: transportRecords.map((item) => ({
          transportId: item.id,
          specimenId: item.specimen.id,
          barcode: item.specimen.barcode,
          patientName: item.specimen.patientName,
          testType: item.specimen.testType,
          priority: toApiPriority(item.specimen.priority),
          scanTime: item.specimen.scanTime,
          dispatchTime: item.dispatchTime,
          arrivalTime: item.arrivalTime,
          fromStationId: item.fromStation.id,
          fromStationName: item.fromStation.name,
          toStationId: item.toStation.id,
          toStationName: item.toStation.name,
          cabinId: item.cabinId,
          status: String(item.status || '').toLowerCase(),
        })),
        systemLogs,
      });
    } catch (error) {
      console.error('BOOTSTRAP_ERROR', error);
      return res.status(500).json({ message: 'Internal server error.' });
    }
  });

  // ── POST /api/stations/sync ────────────────────────────────────────────
  router.post('/stations/sync', requireAuth, requireRole('tech'), async (req, res) => {
    try {
      const stations = Array.isArray(req.body?.stations) ? req.body.stations : [];
      if (!stations.length) {
        return res.status(400).json({ message: 'stations is required.' });
      }

      const payload = stations.map((station, index) => ({
        id: String(station?.id || '').trim(),
        name: String(station?.name || '').trim(),
        locationIndex: typeof station?.locationIndex === 'number' ? station.locationIndex : index,
      }));

      if (payload.some((station) => !station.id || !station.name)) {
        return res.status(400).json({ message: 'Each station must include id and name.' });
      }

      await prisma.$transaction(
        payload.map((station) =>
          prisma.station.upsert({
            where: { id: station.id },
            create: station,
            update: {
              name: station.name,
              locationIndex: station.locationIndex,
            },
          })
        )
      );

      broadcastSyncRequired('stations-synced');

      return res.status(200).json({ message: 'Stations synced.', count: payload.length });
    } catch (error) {
      console.error('SYNC_STATIONS_ERROR', error);
      return res.status(500).json({ message: 'Internal server error.' });
    }
  });

  // ── POST /api/specimens/scan ───────────────────────────────────────────
  router.post('/specimens/scan', requireAuth, async (req, res) => {
    try {
      const {
        barcode,
        patientName,
        testType,
        priority = 'routine',
        scanTime,
        destinationStationId,
      } = req.body ?? {};

      const normalizedBarcode = String(barcode || '').trim().toUpperCase();
      const normalizedPatientName = String(patientName || '').trim();
      const normalizedTestType = String(testType || '').trim();
      const normalizedDestinationStationId = String(destinationStationId || '').trim();
      const requesterId = getRequesterId(req);

      if (!normalizedBarcode || !normalizedPatientName || !normalizedTestType) {
        return res.status(400).json({ message: 'barcode, patientName, testType are required.' });
      }

      if (!requesterId) {
        return res.status(401).json({ message: 'Invalid access token payload.' });
      }

      const scannedBy = await prisma.user.findUnique({ where: { id: requesterId } });
      if (!scannedBy || !scannedBy.active) {
        return res.status(403).json({ message: 'Authenticated user is inactive or missing.' });
      }

      let destinationStation = null;
      if (normalizedDestinationStationId) {
        destinationStation = await prisma.station.findUnique({ where: { id: normalizedDestinationStationId } });
        if (!destinationStation) {
          return res.status(404).json({ message: 'destinationStationId not found. Please sync stations first.' });
        }
      }

      const existingSpecimen = await prisma.specimen.findUnique({
        where: { barcode: normalizedBarcode },
        select: { status: true },
      });

      if (existingSpecimen && NON_SCANNABLE_SPECIMEN_STATUSES.has(existingSpecimen.status)) {
        return res.status(409).json({
          message: `Specimen ${normalizedBarcode} is already ${existingSpecimen.status.toLowerCase()}.`,
        });
      }

      const destinationUpdate = destinationStation ? { destinationStationId: destinationStation.id } : {};

      const specimen = await prisma.specimen.upsert({
        where: { barcode: normalizedBarcode },
        create: {
          barcode: normalizedBarcode,
          patientName: normalizedPatientName,
          testType: normalizedTestType,
          priority: toDbPriority(priority),
          status: 'SCANNED',
          scanTime: toIsoOrNow(scanTime),
          scannedById: scannedBy.id,
          destinationStationId: destinationStation?.id || null,
        },
        update: {
          patientName: normalizedPatientName,
          testType: normalizedTestType,
          priority: toDbPriority(priority),
          status: 'SCANNED',
          scanTime: toIsoOrNow(scanTime),
          scannedById: scannedBy.id,
          ...destinationUpdate,
        },
        select: {
          id: true,
          barcode: true,
          patientName: true,
          testType: true,
          priority: true,
          scanTime: true,
          scannedById: true,
          destinationStationId: true,
          destinationStation: { select: { id: true, name: true } },
        },
      });

      broadcastSyncRequired('specimen-scanned');

      return res.status(201).json({
        specimen: {
          ...specimen,
          priority: toApiPriority(specimen.priority),
          destinationStationId: specimen.destinationStationId || specimen.destinationStation?.id || null,
          destinationStationName: specimen.destinationStation?.name || null,
        },
      });
    } catch (error) {
      console.error('SCAN_SPECIMEN_ERROR', error);
      return res.status(500).json({ message: 'Internal server error.' });
    }
  });

  // ── POST /api/transports/complete ──────────────────────────────────────
  router.post('/transports/complete', requireAuth, async (req, res) => {
    try {
      const {
        cabinId,
        status = 'arrived',
        barcode,
        patientName,
        testType,
        priority,
        scanTime,
        dispatchTime,
        arrivalTime,
        fromStationId,
        toStationId,
      } = req.body ?? {};

      const normalizedBarcode = String(barcode || '').trim().toUpperCase();
      const normalizedCabinId = String(cabinId || '').trim();
      const normalizedFromStationId = String(fromStationId || '').trim();
      const normalizedToStationId = String(toStationId || '').trim();
      const requesterId = getRequesterId(req);

      if (!normalizedBarcode || !normalizedCabinId || !normalizedFromStationId || !normalizedToStationId) {
        return res.status(400).json({ message: 'cabinId, barcode, fromStationId, toStationId are required.' });
      }

      if (!requesterId) {
        return res.status(401).json({ message: 'Invalid access token payload.' });
      }

      const [fromStation, toStation, scannedBy] = await Promise.all([
        prisma.station.findUnique({ where: { id: normalizedFromStationId } }),
        prisma.station.findUnique({ where: { id: normalizedToStationId } }),
        prisma.user.findUnique({ where: { id: requesterId } }),
      ]);

      if (!fromStation || !toStation) {
        return res.status(404).json({ message: 'from/to station not found. Please sync stations first.' });
      }

      if (!scannedBy || !scannedBy.active) {
        return res.status(403).json({ message: 'Authenticated user is inactive or missing.' });
      }

      if (!canConfirmStationDelivery(req, scannedBy, toStation.id)) {
        return res.status(403).json({
          message: `Account is not allowed to confirm delivery at station ${toStation.id}.`,
        });
      }

      const normalizedPatientName = String(patientName || 'Unknown').trim() || 'Unknown';
      const normalizedTestType = String(testType || 'Unknown').trim() || 'Unknown';
      const parsedScanTime = toIsoOrNull(scanTime) || new Date();
      const parsedDispatchTime = toIsoOrNull(dispatchTime);
      const parsedArrivalTime = arrivalTime == null ? null : toIsoOrNull(arrivalTime);
      const normalizedStatus = toDbTransportStatus(status);
      const specimenStatus = getSpecimenStatusForTransport(normalizedStatus);

      if (!parsedDispatchTime) {
        return res.status(400).json({ message: 'dispatchTime must be a valid ISO datetime.' });
      }

      if (arrivalTime != null && !parsedArrivalTime) {
        return res.status(400).json({ message: 'arrivalTime must be a valid ISO datetime.' });
      }

      if (parsedArrivalTime && parsedArrivalTime < parsedDispatchTime) {
        return res.status(400).json({ message: 'arrivalTime must be greater than or equal to dispatchTime.' });
      }

      const record = await prisma.$transaction(async (tx) => {
        const specimen = await tx.specimen.upsert({
          where: { barcode: normalizedBarcode },
          create: {
            barcode: normalizedBarcode,
            patientName: normalizedPatientName,
            testType: normalizedTestType,
            priority: toDbPriority(priority),
            ...(specimenStatus ? { status: specimenStatus } : {}),
            scanTime: parsedScanTime,
            scannedById: scannedBy.id,
            destinationStationId: toStation.id,
          },
          update: {
            patientName: normalizedPatientName,
            testType: normalizedTestType,
            priority: toDbPriority(priority),
            scanTime: parsedScanTime,
            scannedById: scannedBy.id,
            destinationStationId: toStation.id,
            ...(specimenStatus ? { status: specimenStatus } : {}),
          },
          select: { id: true, barcode: true },
        });

        if (specimenStatus) {
          await tx.specimen.update({
            where: { id: specimen.id },
            data: { status: specimenStatus },
          });
        }

        const resolvedArrivalTime = normalizedStatus === 'ARRIVED'
          ? (parsedArrivalTime || new Date())
          : parsedArrivalTime;

        return tx.transportRecord.create({
          data: {
            cabinId: normalizedCabinId,
            status: normalizedStatus,
            dispatchTime: parsedDispatchTime,
            arrivalTime: resolvedArrivalTime,
            specimenId: specimen.id,
            fromStationId: fromStation.id,
            toStationId: toStation.id,
          },
          select: {
            id: true,
            cabinId: true,
            status: true,
            dispatchTime: true,
            arrivalTime: true,
            specimenId: true,
            fromStationId: true,
            toStationId: true,
          },
        });
      });

      broadcastSyncRequired('transport-completed');

      return res.status(201).json({
        record: {
          ...record,
          status: String(record.status || '').toLowerCase(),
        },
      });
    } catch (error) {
      console.error('COMPLETE_TRANSPORT_ERROR', error);
      return res.status(500).json({ message: 'Internal server error.' });
    }
  });

  // ── POST /api/transports/batch-complete ─────────────────────────────────
  router.post('/transports/batch-complete', requireAuth, async (req, res) => {
    try {
      const {
        cabinId,
        status = 'arrived',
        barcodes,
        dispatchTime,
        arrivalTime,
        fromStationId,
        toStationId,
      } = req.body ?? {};

      const normalizedCabinId = String(cabinId || '').trim();
      const normalizedFromStationId = String(fromStationId || '').trim();
      const normalizedToStationId = String(toStationId || '').trim();
      const requesterId = getRequesterId(req);

      if (!Array.isArray(barcodes) || barcodes.length === 0) {
        return res.status(400).json({ message: 'barcodes[] là bắt buộc.' });
      }

      if (!normalizedCabinId || !normalizedFromStationId || !normalizedToStationId) {
        return res.status(400).json({ message: 'cabinId, fromStationId, toStationId là bắt buộc.' });
      }

      if (!requesterId) {
        return res.status(401).json({ message: 'Invalid access token.' });
      }

      const [fromStation, toStation, requester] = await Promise.all([
        prisma.station.findUnique({ where: { id: normalizedFromStationId } }),
        prisma.station.findUnique({ where: { id: normalizedToStationId } }),
        prisma.user.findUnique({ where: { id: requesterId } }),
      ]);

      if (!fromStation || !toStation) {
        return res.status(404).json({ message: 'from/to station not found.' });
      }

      if (!requester || !requester.active) {
        return res.status(403).json({ message: 'Authenticated user is inactive or missing.' });
      }

      if (!canConfirmStationDelivery(req, requester, toStation.id)) {
        return res.status(403).json({
          message: `Account is not allowed to confirm delivery at station ${toStation.id}.`,
        });
      }

      const parsedDispatchTime = toIsoOrNull(dispatchTime);
      const parsedArrivalTime = arrivalTime == null ? null : toIsoOrNull(arrivalTime);
      const normalizedStatus = toDbTransportStatus(status);

      if (!parsedDispatchTime) {
        return res.status(400).json({ message: 'dispatchTime là bắt buộc.' });
      }

      if (arrivalTime != null && !parsedArrivalTime) {
        return res.status(400).json({ message: 'arrivalTime must be a valid ISO datetime.' });
      }

      if (parsedArrivalTime && parsedArrivalTime < parsedDispatchTime) {
        return res.status(400).json({ message: 'arrivalTime must be greater than or equal to dispatchTime.' });
      }

      const resolvedArrivalTime = normalizedStatus === 'ARRIVED'
        ? (parsedArrivalTime || new Date())
        : parsedArrivalTime;

      const normalizedBarcodes = barcodes.map((b) => String(b || '').trim().toUpperCase()).filter(Boolean);
      const uniqueBarcodes = [...new Set(normalizedBarcodes)];
      if (uniqueBarcodes.length !== barcodes.length) {
        return res.status(400).json({ message: 'barcodes[] contains empty or duplicate values.' });
      }
      const specimenStatus = normalizedStatus === 'ARRIVED' ? 'COMPLETED' : 'IN_TRANSIT';

      const records = await prisma.$transaction(async (tx) => {
        // Find all specimens by barcode
        const specimens = await tx.specimen.findMany({
          where: { barcode: { in: uniqueBarcodes } },
          select: { id: true, barcode: true },
        });

        if (specimens.length !== uniqueBarcodes.length) {
          const foundBarcodes = new Set(specimens.map((spec) => spec.barcode));
          const missingBarcodes = uniqueBarcodes.filter((barcode) => !foundBarcodes.has(barcode));
          const err = new Error(`Không tìm thấy barcode: ${missingBarcodes.join(', ')}`);
          err.statusCode = 404;
          throw err;
        }

        // Update specimen statuses
        await tx.specimen.updateMany({
          where: { id: { in: specimens.map((s) => s.id) } },
          data: {
            status: specimenStatus,
            destinationStationId: toStation.id,
          },
        });

        // Create transport records for each specimen
        const transportRecords = [];
        for (const spec of specimens) {
          const record = await tx.transportRecord.create({
            data: {
              cabinId: normalizedCabinId,
              status: normalizedStatus,
              dispatchTime: parsedDispatchTime,
              arrivalTime: resolvedArrivalTime,
              specimenId: spec.id,
              fromStationId: fromStation.id,
              toStationId: toStation.id,
            },
            select: {
              id: true,
              cabinId: true,
              status: true,
              dispatchTime: true,
              arrivalTime: true,
              specimenId: true,
              fromStationId: true,
              toStationId: true,
            },
          });
          transportRecords.push(record);
        }

        return transportRecords;
      });

      broadcastSyncRequired('batch-transport-completed');

      return res.status(201).json({
        message: `Đã tạo ${records.length} bản ghi vận chuyển.`,
        records: records.map((r) => ({
          ...r,
          status: String(r.status || '').toLowerCase(),
        })),
      });
    } catch (error) {
      console.error('BATCH_COMPLETE_TRANSPORT_ERROR', error);
      return res.status(error?.statusCode || 500).json({ message: error.message || 'Internal server error.' });
    }
  });

  // ── POST /api/system-logs ──────────────────────────────────────────────
  router.post('/system-logs', requireAuth, async (req, res) => {
    try {
      const { event, type = 'info' } = req.body ?? {};
      const normalizedEvent = String(event || '').trim();
      const normalizedType = parseLogType(type);
      const requesterId = getRequesterId(req);

      if (!normalizedEvent) {
        return res.status(400).json({ message: 'event is required.' });
      }

      if (!requesterId) {
        return res.status(401).json({ message: 'Invalid access token payload.' });
      }

      const log = await prisma.systemLog.create({
        data: {
          event: normalizedEvent,
          type: normalizedType,
          userId: requesterId,
        },
        select: {
          id: true,
          event: true,
          type: true,
          userId: true,
          createdAt: true,
        },
      });

      broadcastSyncRequired('system-log-created');

      return res.status(201).json({ log });
    } catch (error) {
      console.error('CREATE_SYSTEM_LOG_ERROR', error);
      return res.status(500).json({ message: 'Internal server error.' });
    }
  });

  return router;
}
