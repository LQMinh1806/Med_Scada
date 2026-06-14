-- Add optional destination station per specimen.
ALTER TABLE "Specimen" ADD COLUMN IF NOT EXISTS "destinationStationId" TEXT;

CREATE INDEX IF NOT EXISTS "Specimen_destinationStationId_idx"
  ON "Specimen"("destinationStationId");

ALTER TABLE "Specimen"
  DROP CONSTRAINT IF EXISTS "Specimen_destinationStationId_fkey";

ALTER TABLE "Specimen"
  ADD CONSTRAINT "Specimen_destinationStationId_fkey"
  FOREIGN KEY ("destinationStationId")
  REFERENCES "Station"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
