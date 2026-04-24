-- Normalize SCADA core model to User/Station/Specimen/TransportRecord/SystemLog design
BEGIN;

-- Rebuild UserRole enum to uppercase values.
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('TECH', 'OPERATOR');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User"
  ALTER COLUMN "role" TYPE "UserRole"
  USING (
    CASE "role"::text
      WHEN 'tech' THEN 'TECH'::"UserRole"
      WHEN 'operator' THEN 'OPERATOR'::"UserRole"
      ELSE 'OPERATOR'::"UserRole"
    END
  );
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'OPERATOR';
DROP TYPE "UserRole_old";

-- Rebuild TransportStatus enum to RUNNING/ARRIVED/ERROR.
ALTER TYPE "TransportStatus" RENAME TO "TransportStatus_old";
CREATE TYPE "TransportStatus" AS ENUM ('RUNNING', 'ARRIVED', 'ERROR');
ALTER TABLE "TransportRecord" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "TransportRecord"
  ALTER COLUMN "status" TYPE "TransportStatus"
  USING (
    CASE "status"::text
      WHEN 'PENDING' THEN 'RUNNING'::"TransportStatus"
      WHEN 'DISPATCHED' THEN 'RUNNING'::"TransportStatus"
      WHEN 'ARRIVED' THEN 'ARRIVED'::"TransportStatus"
      WHEN 'FAILED' THEN 'ERROR'::"TransportStatus"
      WHEN 'CANCELLED' THEN 'ERROR'::"TransportStatus"
      ELSE 'RUNNING'::"TransportStatus"
    END
  );
ALTER TABLE "TransportRecord" ALTER COLUMN "status" SET DEFAULT 'RUNNING';
DROP TYPE "TransportStatus_old";

-- Station primary key and linked foreign keys become String IDs.
ALTER TABLE "TransportRecord" DROP CONSTRAINT IF EXISTS "TransportRecord_fromStationId_fkey";
ALTER TABLE "TransportRecord" DROP CONSTRAINT IF EXISTS "TransportRecord_toStationId_fkey";

ALTER TABLE "Station"
  ALTER COLUMN "id" TYPE TEXT
  USING ('ST-' || LPAD("id"::text, 2, '0'));
ALTER TABLE "Station" ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE IF EXISTS "Station_id_seq";

ALTER TABLE "TransportRecord"
  ALTER COLUMN "fromStationId" TYPE TEXT
  USING ('ST-' || LPAD("fromStationId"::text, 2, '0'));
ALTER TABLE "TransportRecord"
  ALTER COLUMN "toStationId" TYPE TEXT
  USING ('ST-' || LPAD("toStationId"::text, 2, '0'));

-- Normalize dispatch/arrival columns.
ALTER TABLE "TransportRecord" RENAME COLUMN "dispatchedAt" TO "dispatchTime";
ALTER TABLE "TransportRecord" RENAME COLUMN "arrivedAt" TO "arrivalTime";
UPDATE "TransportRecord" SET "dispatchTime" = COALESCE("dispatchTime", NOW());
ALTER TABLE "TransportRecord" ALTER COLUMN "dispatchTime" SET NOT NULL;

-- Add scannedBy user relation for specimens.
ALTER TABLE "Specimen" ADD COLUMN IF NOT EXISTS "scannedById" INTEGER;
UPDATE "Specimen"
SET "scannedById" = (
  SELECT "id"
  FROM "User"
  ORDER BY "id" ASC
  LIMIT 1
)
WHERE "scannedById" IS NULL;
ALTER TABLE "Specimen" ALTER COLUMN "scannedById" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "Specimen_scannedById_idx" ON "Specimen"("scannedById");
ALTER TABLE "Specimen" DROP CONSTRAINT IF EXISTS "Specimen_scannedById_fkey";
ALTER TABLE "Specimen"
  ADD CONSTRAINT "Specimen_scannedById_fkey"
  FOREIGN KEY ("scannedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- System log becomes flexible type + optional user relation.
ALTER TABLE "SystemLog" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "SystemLog" ALTER COLUMN "type" TYPE TEXT USING ("type"::text);
ALTER TABLE "SystemLog" DROP COLUMN IF EXISTS "updatedAt";
ALTER TABLE "SystemLog" ADD COLUMN IF NOT EXISTS "userId" INTEGER;
CREATE INDEX IF NOT EXISTS "SystemLog_userId_idx" ON "SystemLog"("userId");
ALTER TABLE "SystemLog" DROP CONSTRAINT IF EXISTS "SystemLog_userId_fkey";
ALTER TABLE "SystemLog"
  ADD CONSTRAINT "SystemLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
DROP TYPE IF EXISTS "LogType";

-- Re-add station relations.
ALTER TABLE "TransportRecord"
  ADD CONSTRAINT "TransportRecord_fromStationId_fkey"
  FOREIGN KEY ("fromStationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransportRecord"
  ADD CONSTRAINT "TransportRecord_toStationId_fkey"
  FOREIGN KEY ("toStationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
