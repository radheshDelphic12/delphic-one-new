-- Location check-in: several check-in / check-out pairs per day (breaks = the gaps). Additive: one new table, existing rows are copied in as session one.
CREATE TABLE IF NOT EXISTS "location_checkin_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "checkin_id" UUID NOT NULL,
  "org_membership_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "in_at" TIMESTAMP(3) NOT NULL,
  "in_lat" DECIMAL(9,6),
  "in_lng" DECIMAL(9,6),
  "in_accuracy_m" INTEGER,
  "in_distance_m" INTEGER,
  "in_at_office" BOOLEAN,
  "in_result" TEXT NOT NULL,
  "in_photo" TEXT,
  "out_at" TIMESTAMP(3),
  "out_lat" DECIMAL(9,6),
  "out_lng" DECIMAL(9,6),
  "out_accuracy_m" INTEGER,
  "out_distance_m" INTEGER,
  "out_at_office" BOOLEAN,
  "out_result" TEXT,
  "out_reason" TEXT,
  "edited_by" UUID,
  "edited_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_checkin_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "location_checkin_sessions_checkin_id_fkey" FOREIGN KEY ("checkin_id") REFERENCES "location_checkins"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "location_checkin_sessions_checkin_id_in_at_idx" ON "location_checkin_sessions"("checkin_id", "in_at");
CREATE INDEX IF NOT EXISTS "location_checkin_sessions_org_id_date_idx" ON "location_checkin_sessions"("org_id", "date");

-- Every day recorded so far becomes its first session.
INSERT INTO "location_checkin_sessions" (
  "org_id", "checkin_id", "org_membership_id", "date",
  "in_at", "in_lat", "in_lng", "in_accuracy_m", "in_distance_m", "in_at_office", "in_result", "in_photo",
  "out_at", "out_lat", "out_lng", "out_accuracy_m", "out_distance_m", "out_at_office", "out_result"
)
SELECT
  c."org_id", c."id", c."org_membership_id", c."date",
  c."check_in_at", c."check_in_lat", c."check_in_lng", c."check_in_accuracy_m", c."check_in_distance_m", c."check_in_at_office", c."check_in_result", c."check_in_photo",
  c."check_out_at", c."check_out_lat", c."check_out_lng", c."check_out_accuracy_m", c."check_out_distance_m", c."check_out_at_office", c."check_out_result"
FROM "location_checkins" c
WHERE NOT EXISTS (SELECT 1 FROM "location_checkin_sessions" s WHERE s."checkin_id" = c."id");
