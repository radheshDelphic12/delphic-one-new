-- Overtime gets its own approval (per employee-day), separate from the
-- timesheet entries so billing hours are never rewritten. Additive only.
CREATE TYPE "TimesheetOvertimeStatus" AS ENUM ('pending', 'approved', 'rejected', 'comp_off');

CREATE TABLE "timesheet_day_overtime" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(4,1) NOT NULL,
    "status" "TimesheetOvertimeStatus" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "timesheet_day_overtime_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "timesheet_day_overtime_org_membership_id_date_key" ON "timesheet_day_overtime"("org_membership_id", "date");
CREATE INDEX "timesheet_day_overtime_org_id_date_idx" ON "timesheet_day_overtime"("org_id", "date");

ALTER TABLE "timesheet_day_overtime" ADD CONSTRAINT "timesheet_day_overtime_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "timesheet_day_overtime" ADD CONSTRAINT "timesheet_day_overtime_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "timesheet_day_overtime" ADD CONSTRAINT "timesheet_day_overtime_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Client/project working-day exceptions (e.g. a client working Sunday).
ALTER TABLE "calendar_holidays" ADD COLUMN "is_working_day" BOOLEAN NOT NULL DEFAULT false;
