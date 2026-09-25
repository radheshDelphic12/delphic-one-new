-- CreateEnum
CREATE TYPE "TimesheetEntryStatus" AS ENUM ('submitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "RegularizationTicketStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "timesheet_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "account_id" UUID NOT NULL,
    "requirement_id" UUID,
    "hours" DECIMAL(4,1) NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "status" "TimesheetEntryStatus" NOT NULL DEFAULT 'submitted',
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_locks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "locked_by" UUID NOT NULL,
    "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_regularization_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "timesheet_entry_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "requested_change" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RegularizationTicketStatus" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_regularization_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timesheet_entries_org_id_date_idx" ON "timesheet_entries"("org_id", "date");

-- CreateIndex
CREATE INDEX "timesheet_entries_org_membership_id_date_idx" ON "timesheet_entries"("org_membership_id", "date");

-- CreateIndex
CREATE INDEX "timesheet_entries_account_id_idx" ON "timesheet_entries"("account_id");

-- CreateIndex
CREATE INDEX "timesheet_locks_org_id_date_idx" ON "timesheet_locks"("org_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_locks_org_id_date_key" ON "timesheet_locks"("org_id", "date");

-- CreateIndex
CREATE INDEX "timesheet_regularization_tickets_timesheet_entry_id_idx" ON "timesheet_regularization_tickets"("timesheet_entry_id");

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entries" ADD CONSTRAINT "timesheet_entries_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_locks" ADD CONSTRAINT "timesheet_locks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_locks" ADD CONSTRAINT "timesheet_locks_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_regularization_tickets" ADD CONSTRAINT "timesheet_regularization_tickets_timesheet_entry_id_fkey" FOREIGN KEY ("timesheet_entry_id") REFERENCES "timesheet_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_regularization_tickets" ADD CONSTRAINT "timesheet_regularization_tickets_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_regularization_tickets" ADD CONSTRAINT "timesheet_regularization_tickets_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
