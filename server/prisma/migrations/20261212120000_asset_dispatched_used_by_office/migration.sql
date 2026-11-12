-- People > Assets: a new status "Dispatched", the people who use the asset (several, active or exited) and the office it is at. Additive.
ALTER TYPE "AssetStatus" ADD VALUE IF NOT EXISTS 'dispatched';
ALTER TABLE "assets" ADD COLUMN "location_id" UUID;
ALTER TABLE "assets" ADD COLUMN "used_by_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
CREATE INDEX "assets_location_id_idx" ON "assets"("location_id");
ALTER TABLE "assets" ADD CONSTRAINT "assets_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
