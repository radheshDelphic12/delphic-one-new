-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmploymentStatus" ADD VALUE 'pending_onboarding';
ALTER TYPE "EmploymentStatus" ADD VALUE 'notice_period';

-- DropIndex
DROP INDEX "employee_calendars_org_membership_id_key";

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "overtime_minutes" INTEGER;

-- AlterTable
ALTER TABLE "calendars" ADD COLUMN     "location_id" UUID;

-- AlterTable
ALTER TABLE "employee_calendars" ADD COLUMN     "account_id" UUID;

-- AlterTable
ALTER TABLE "org_memberships" ADD COLUMN     "hr_poc_id" UUID,
ADD COLUMN     "location_id" UUID,
ADD COLUMN     "manager_id" UUID,
ADD COLUMN     "notice_end_date" DATE,
ADD COLUMN     "shift_id" UUID,
ADD COLUMN     "sourcing_poc_id" UUID;

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_minutes" INTEGER NOT NULL,
    "end_minutes" INTEGER NOT NULL,
    "grace_minutes" INTEGER NOT NULL DEFAULT 15,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "locations_org_id_idx" ON "locations"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "locations_org_id_name_key" ON "locations"("org_id", "name");

-- CreateIndex
CREATE INDEX "shifts_org_id_idx" ON "shifts"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_org_id_name_key" ON "shifts"("org_id", "name");

-- CreateIndex
CREATE INDEX "calendars_location_id_idx" ON "calendars"("location_id");

-- CreateIndex
CREATE INDEX "employee_calendars_org_membership_id_idx" ON "employee_calendars"("org_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_calendars_org_membership_id_calendar_id_account_id_key" ON "employee_calendars"("org_membership_id", "calendar_id", "account_id");

-- CreateIndex
CREATE INDEX "org_memberships_manager_id_idx" ON "org_memberships"("manager_id");

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_calendars" ADD CONSTRAINT "employee_calendars_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "org_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_hr_poc_id_fkey" FOREIGN KEY ("hr_poc_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_sourcing_poc_id_fkey" FOREIGN KEY ("sourcing_poc_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

