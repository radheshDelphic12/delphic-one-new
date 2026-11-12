-- Additive only: work sites (client / project places), dated work-location assignments, and the check-in link to them.
CREATE TABLE "work_sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "radius_m" INTEGER NOT NULL DEFAULT 150,
    "client_account_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_sites_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "work_sites_org_id_idx" ON "work_sites"("org_id");

CREATE TABLE "work_location_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "location_id" UUID,
    "work_site_id" UUID,
    "purpose" TEXT NOT NULL DEFAULT 'project',
    "account_id" UUID,
    "deployment_person_id" UUID,
    "note" TEXT,
    "created_by" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "work_location_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_location_assignments_one_place" CHECK (("location_id" IS NOT NULL AND "work_site_id" IS NULL) OR ("location_id" IS NULL AND "work_site_id" IS NOT NULL)),
    CONSTRAINT "work_location_assignments_dates" CHECK ("to_date" >= "from_date")
);
CREATE INDEX "work_location_assignments_org_membership_id_from_date_idx" ON "work_location_assignments"("org_membership_id", "from_date");
CREATE INDEX "work_location_assignments_org_id_from_date_idx" ON "work_location_assignments"("org_id", "from_date");

ALTER TABLE "location_checkins" ADD COLUMN "work_site_id" UUID, ADD COLUMN "assignment_id" UUID;
