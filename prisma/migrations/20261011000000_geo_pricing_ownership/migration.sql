ALTER TABLE "Shipment"
  ADD COLUMN "driverUserId" TEXT,
  ADD COLUMN "originLat" DOUBLE PRECISION,
  ADD COLUMN "originLng" DOUBLE PRECISION,
  ADD COLUMN "destLat" DOUBLE PRECISION,
  ADD COLUMN "destLng" DOUBLE PRECISION,
  ADD COLUMN "priceKobo" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "distanceKm" DOUBLE PRECISION,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "customerName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "customerEmail" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "customerPhone" TEXT,
  ADD COLUMN "driverName" TEXT,
  ADD COLUMN "driverPhone" TEXT;

CREATE INDEX "Shipment_driverUserId_status_idx" ON "Shipment"("driverUserId", "status");
CREATE INDEX "Shipment_status_createdAt_idx" ON "Shipment"("status", "createdAt");
