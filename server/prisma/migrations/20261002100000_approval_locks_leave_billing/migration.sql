-- FRD slice 2: approval chain (manager optional, admin mandatory), OT ticket audit history,
-- per-employee month timesheet lock, lock audit trail, leave-type flags, per-resource billing rates.
-- Additive only (no DROP / RENAME).

ALTER TABLE "orgs" ADD COLUMN "timesheet_manager_approval" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "orgs" ADD COLUMN "timesheet_admin_approval" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "timesheet_entries" ADD COLUMN "manager_approved_by" UUID;
ALTER TABLE "timesheet_entries" ADD COLUMN "manager_approved_at" TIMESTAMP(3);

ALTER TABLE "overtime_tickets" ADD COLUMN "manager_approved_by" UUID;
ALTER TABLE "overtime_tickets" ADD COLUMN "manager_approved_at" TIMESTAMP(3);

CREATE TABLE "overtime_ticket_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ticket_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT,
  "actor_id" UUID,
  "reason" TEXT,
  "detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "overtime_ticket_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "overtime_ticket_events_ticket_id_created_at_idx" ON "overtime_ticket_events"("ticket_id", "created_at");
ALTER TABLE "overtime_ticket_events" ADD CONSTRAINT "overtime_ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "overtime_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "timesheet_month_locks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "org_membership_id" UUID NOT NULL,
  "period_month" INTEGER NOT NULL,
  "period_year" INTEGER NOT NULL,
  "locked_by" UUID NOT NULL,
  "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "timesheet_month_locks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "timesheet_month_locks_org_membership_id_period_year_period_month_key" ON "timesheet_month_locks"("org_membership_id", "period_year", "period_month");
CREATE INDEX "timesheet_month_locks_org_id_period_year_period_month_idx" ON "timesheet_month_locks"("org_id", "period_year", "period_month");
ALTER TABLE "timesheet_month_locks" ADD CONSTRAINT "timesheet_month_locks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "lock_audits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "stage" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor_id" UUID NOT NULL,
  "org_membership_id" UUID,
  "account_id" UUID,
  "period_month" INTEGER,
  "period_year" INTEGER,
  "previous_status" TEXT,
  "new_status" TEXT,
  "change" TEXT,
  "reason" TEXT,
  "bulk_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lock_audits_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lock_audits_org_id_stage_period_year_period_month_idx" ON "lock_audits"("org_id", "stage", "period_year", "period_month");
CREATE INDEX "lock_audits_bulk_id_idx" ON "lock_audits"("bulk_id");
ALTER TABLE "lock_audits" ADD CONSTRAINT "lock_audits_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_types" ADD COLUMN "is_applicable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "leave_types" ADD COLUMN "counts_in_balance" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "leave_types" ADD COLUMN "overflow_to_unpaid" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "resource_billing_rates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "org_membership_id" UUID NOT NULL,
  "rate_type" "BillingRateType" NOT NULL,
  "rate" DECIMAL(12,2) NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'INR',
  "effective_from" DATE NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resource_billing_rates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "resource_billing_rates_org_id_account_id_effective_from_idx" ON "resource_billing_rates"("org_id", "account_id", "effective_from");
CREATE INDEX "resource_billing_rates_org_membership_id_idx" ON "resource_billing_rates"("org_membership_id");
ALTER TABLE "resource_billing_rates" ADD CONSTRAINT "resource_billing_rates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "accounts" ADD COLUMN "billing_leave_rules" JSONB;

CREATE TABLE "salary_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "org_membership_id" UUID NOT NULL,
  "period_month" INTEGER NOT NULL,
  "period_year" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "note" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "salary_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "salary_adjustments_org_id_period_year_period_month_idx" ON "salary_adjustments"("org_id", "period_year", "period_month");
CREATE INDEX "salary_adjustments_org_membership_id_period_year_period_month_idx" ON "salary_adjustments"("org_membership_id", "period_year", "period_month");
ALTER TABLE "salary_adjustments" ADD CONSTRAINT "salary_adjustments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_adjustments" ADD CONSTRAINT "salary_adjustments_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_vendor_invoices" ADD COLUMN "sent_at" TIMESTAMP(3);
ALTER TABLE "project_vendor_invoices" ADD COLUMN "tds_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "project_vendor_invoices" ADD COLUMN "adjustment_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "project_vendor_invoices" ADD COLUMN "adjustment_note" TEXT;

-- Lock order, approval chain for day overtime / regularisation, Leave Manager.
ALTER TABLE "orgs" ADD COLUMN "enforce_lock_order" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "timesheet_day_overtime" ADD COLUMN "manager_approved_by" UUID;
ALTER TABLE "timesheet_day_overtime" ADD COLUMN "manager_approved_at" TIMESTAMP(3);
ALTER TABLE "timesheet_regularization_tickets" ADD COLUMN "manager_approved_by" UUID;
ALTER TABLE "timesheet_regularization_tickets" ADD COLUMN "manager_approved_at" TIMESTAMP(3);
ALTER TABLE "org_memberships" ADD COLUMN "is_leave_manager" BOOLEAN NOT NULL DEFAULT false;
