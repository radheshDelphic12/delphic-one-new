-- Phase 4: FnF records, increment reminders, previous-month dues, employee date of birth. Additive only.
ALTER TABLE "org_memberships" ADD COLUMN "date_of_birth" DATE;

CREATE TYPE "FnfStatus" AS ENUM ('pending', 'in_progress', 'settled');

CREATE TABLE "fnf_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "amount" DECIMAL(14,2),
    "start_date" DATE,
    "fnf_date" DATE,
    "status" "FnfStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fnf_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fnf_records_org_membership_id_key" ON "fnf_records"("org_membership_id");
CREATE INDEX "fnf_records_org_id_status_idx" ON "fnf_records"("org_id", "status");
ALTER TABLE "fnf_records" ADD CONSTRAINT "fnf_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fnf_records" ADD CONSTRAINT "fnf_records_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "increment_reminders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "years_completed" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "increment_reminders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "increment_reminders_org_membership_id_years_completed_key" ON "increment_reminders"("org_membership_id", "years_completed");
CREATE INDEX "increment_reminders_org_id_status_idx" ON "increment_reminders"("org_id", "status");
ALTER TABLE "increment_reminders" ADD CONSTRAINT "increment_reminders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "increment_reminders" ADD CONSTRAINT "increment_reminders_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "previous_month_dues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "due_month" INTEGER NOT NULL,
    "due_year" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "added_in_month" INTEGER NOT NULL,
    "added_in_year" INTEGER NOT NULL,
    "adjustment_id" UUID,
    "added_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "previous_month_dues_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "previous_month_dues_org_membership_id_due_year_due_month_key" ON "previous_month_dues"("org_membership_id", "due_year", "due_month");
CREATE INDEX "previous_month_dues_org_id_idx" ON "previous_month_dues"("org_id");
ALTER TABLE "previous_month_dues" ADD CONSTRAINT "previous_month_dues_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "previous_month_dues" ADD CONSTRAINT "previous_month_dues_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
