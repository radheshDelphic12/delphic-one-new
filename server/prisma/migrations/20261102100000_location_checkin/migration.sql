-- Location check-in (Delphic Global only): three new tables, nothing existing is changed. Additive only.
CREATE TABLE IF NOT EXISTS "office_geofences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "latitude" DECIMAL(9,6) NOT NULL,
  "longitude" DECIMAL(9,6) NOT NULL,
  "radius_m" INTEGER NOT NULL DEFAULT 150,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "office_geofences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "office_geofences_org_id_location_id_key" ON "office_geofences"("org_id", "location_id");
CREATE INDEX IF NOT EXISTS "office_geofences_org_id_idx" ON "office_geofences"("org_id");

CREATE TABLE IF NOT EXISTS "location_checkin_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "selfie_mode" TEXT NOT NULL DEFAULT 'required',
  "full_time_only" BOOLEAN NOT NULL DEFAULT true,
  "default_cutoff_minutes" INTEGER NOT NULL DEFAULT 600,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_checkin_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "location_checkin_settings_org_id_key" ON "location_checkin_settings"("org_id");

CREATE TABLE IF NOT EXISTS "location_checkins" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "org_membership_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "location_id" UUID,
  "planned_place" TEXT NOT NULL,
  "check_in_at" TIMESTAMP(3) NOT NULL,
  "check_in_lat" DECIMAL(9,6),
  "check_in_lng" DECIMAL(9,6),
  "check_in_accuracy_m" INTEGER,
  "check_in_distance_m" INTEGER,
  "check_in_at_office" BOOLEAN,
  "check_in_result" TEXT NOT NULL,
  "check_in_photo" TEXT,
  "cutoff_minutes" INTEGER,
  "late_minutes" INTEGER NOT NULL DEFAULT 0,
  "check_out_at" TIMESTAMP(3),
  "check_out_lat" DECIMAL(9,6),
  "check_out_lng" DECIMAL(9,6),
  "check_out_accuracy_m" INTEGER,
  "check_out_distance_m" INTEGER,
  "check_out_at_office" BOOLEAN,
  "check_out_result" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_checkins_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "location_checkins_org_membership_id_date_key" ON "location_checkins"("org_membership_id", "date");
CREATE INDEX IF NOT EXISTS "location_checkins_org_id_date_idx" ON "location_checkins"("org_id", "date");

CREATE TABLE IF NOT EXISTS "location_checkin_shift_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "shift_id" UUID NOT NULL,
  "late_after_minutes" INTEGER NOT NULL,
  "updated_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "location_checkin_shift_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "location_checkin_shift_rules_org_id_shift_id_key" ON "location_checkin_shift_rules"("org_id", "shift_id");
