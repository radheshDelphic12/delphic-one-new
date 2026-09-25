-- CreateEnum
CREATE TYPE "ProjectResourceType" AS ENUM ('company_employee', 'contractor', 'vendor_resource');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'timesheet_submitted';
ALTER TYPE "NotificationType" ADD VALUE 'timesheet_entry_decided';
ALTER TYPE "NotificationType" ADD VALUE 'timesheet_regularization_requested';
ALTER TYPE "NotificationType" ADD VALUE 'timesheet_regularization_decided';

-- DropForeignKey
ALTER TABLE "timesheet_entries" DROP CONSTRAINT "timesheet_entries_account_id_fkey";

-- DropForeignKey
ALTER TABLE "timesheet_locks" DROP CONSTRAINT "timesheet_locks_locked_by_fkey";

-- AlterTable
ALTER TABLE "project_member_assignments" ADD COLUMN     "resource_type" "ProjectResourceType" NOT NULL DEFAULT 'company_employee',
ALTER COLUMN "cost_rate_per_hr" DROP NOT NULL;

-- AlterTable
ALTER TABLE "timesheet_entries" ALTER COLUMN "account_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "timesheet_locks" ADD COLUMN     "is_auto" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "locked_by" DROP NOT NULL;

-- AlterTable
ALTER TABLE "timesheet_regularization_tickets" ADD COLUMN     "account_id" UUID,
ADD COLUMN     "date" DATE,
ADD COLUMN     "org_id" UUID,
ADD COLUMN     "org_membership_id" UUID,
ADD COLUMN     "target_hours" DECIMAL(4,1),
ALTER COLUMN "timesheet_entry_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "timesheet_regularization_tickets_org_id_status_idx" ON "timesheet_regularization_tickets"("org_id", "status");

-- CreateIndex
CREATE INDEX "timesheet_regularization_tickets_org_membership_id_idx" ON "timesheet_regularization_tickets"("org_membership_id");

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_locks" ADD CONSTRAINT "timesheet_locks_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_regularization_tickets" ADD CONSTRAINT "timesheet_regularization_tickets_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_regularization_tickets" ADD CONSTRAINT "timesheet_regularization_tickets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
