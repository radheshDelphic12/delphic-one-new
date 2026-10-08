-- Project billing / vendor payout configuration + admin billing adjustments.
ALTER TABLE "accounts"
  ADD COLUMN "client_billing_basis" TEXT NOT NULL DEFAULT 'contract',
  ADD COLUMN "vendor_payout_basis" TEXT NOT NULL DEFAULT 'approved_hours',
  ADD COLUMN "billable_day_hours" DECIMAL(4,2) NOT NULL DEFAULT 8;

CREATE TABLE "billing_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "period_month" INTEGER NOT NULL,
  "period_year" INTEGER NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_adjustments_org_id_account_id_period_year_period_month_idx" ON "billing_adjustments"("org_id", "account_id", "period_year", "period_month");

ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "billing_adjustments" ADD CONSTRAINT "billing_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
