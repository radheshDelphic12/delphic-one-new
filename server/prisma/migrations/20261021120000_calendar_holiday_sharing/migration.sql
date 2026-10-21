-- A holiday can be shared with every calendar of the company (copies point back to the original). Additive only.
ALTER TABLE "calendar_holidays" ADD COLUMN "applies_to_all" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "calendar_holidays" ADD COLUMN "copy_of_id" UUID;
CREATE INDEX "calendar_holidays_copy_of_id_idx" ON "calendar_holidays"("copy_of_id");
