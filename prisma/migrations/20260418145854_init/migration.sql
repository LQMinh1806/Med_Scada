-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('tech', 'operator');

-- CreateEnum
CREATE TYPE "SpecimenPriority" AS ENUM ('ROUTINE', 'STAT');

-- CreateEnum
CREATE TYPE "TransportStatus" AS ENUM ('PENDING', 'DISPATCHED', 'ARRIVED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LogType" AS ENUM ('info', 'success', 'warning', 'error');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullname" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'operator',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Station" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "locationIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specimen" (
    "id" SERIAL NOT NULL,
    "barcode" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "testType" TEXT NOT NULL,
    "priority" "SpecimenPriority" NOT NULL DEFAULT 'ROUTINE',
    "scanTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Specimen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportRecord" (
    "id" SERIAL NOT NULL,
    "cabinId" TEXT NOT NULL,
    "status" "TransportStatus" NOT NULL DEFAULT 'PENDING',
    "dispatchedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "specimenId" INTEGER NOT NULL,
    "fromStationId" INTEGER NOT NULL,
    "toStationId" INTEGER NOT NULL,

    CONSTRAINT "TransportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" SERIAL NOT NULL,
    "event" TEXT NOT NULL,
    "type" "LogType" NOT NULL DEFAULT 'info',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Station_locationIndex_key" ON "Station"("locationIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Specimen_barcode_key" ON "Specimen"("barcode");

-- CreateIndex
CREATE INDEX "TransportRecord_specimenId_idx" ON "TransportRecord"("specimenId");

-- CreateIndex
CREATE INDEX "TransportRecord_fromStationId_idx" ON "TransportRecord"("fromStationId");

-- CreateIndex
CREATE INDEX "TransportRecord_toStationId_idx" ON "TransportRecord"("toStationId");

-- CreateIndex
CREATE INDEX "TransportRecord_status_idx" ON "TransportRecord"("status");

-- CreateIndex
CREATE INDEX "SystemLog_type_idx" ON "SystemLog"("type");

-- CreateIndex
CREATE INDEX "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");

-- AddForeignKey
ALTER TABLE "TransportRecord" ADD CONSTRAINT "TransportRecord_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "Specimen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRecord" ADD CONSTRAINT "TransportRecord_fromStationId_fkey" FOREIGN KEY ("fromStationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportRecord" ADD CONSTRAINT "TransportRecord_toStationId_fkey" FOREIGN KEY ("toStationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
