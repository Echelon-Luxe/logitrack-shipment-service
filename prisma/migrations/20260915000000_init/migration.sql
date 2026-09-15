
-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('CREATED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "driverId" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'CREATED',
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "partitionKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "envelope" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_reference_key" ON "Shipment"("reference");

-- CreateIndex
CREATE INDEX "Shipment_customerId_status_idx" ON "Shipment"("customerId", "status");

-- CreateIndex
CREATE INDEX "Shipment_driverId_idx" ON "Shipment"("driverId");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

