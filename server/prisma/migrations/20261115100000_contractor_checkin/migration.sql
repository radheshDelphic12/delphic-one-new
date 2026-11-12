-- Contractor check-in / check-out (Delphic Global). Additive: one new table, no foreign keys, no location data.
CREATE TABLE IF NOT EXISTS "contractor_checkins" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "org_membership_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "in_at" TIMESTAMP(3) NOT NULL,
  "out_at" TIMESTAMP(3),
  "edited_by" UUID,
  "edited_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contractor_checkins_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "contractor_checkins_org_membership_id_date_idx" ON "contractor_checkins"("org_membership_id", "date");
CREATE INDEX IF NOT EXISTS "contractor_checkins_org_id_date_idx" ON "contractor_checkins"("org_id", "date");
