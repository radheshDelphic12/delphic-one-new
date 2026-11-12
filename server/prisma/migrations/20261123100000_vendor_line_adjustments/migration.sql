-- An admin's edit of one contractor-on-project vendor line for a month (Live Analytics > Vendors).
CREATE TABLE "vendor_line_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "org_membership_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "period_month" INTEGER NOT NULL,
  "period_year" INTEGER NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "calculated_amount" DECIMAL(14,2),
  "currency" TEXT,
  "reason" TEXT NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_line_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendor_line_adjustments_org_id_org_membership_id_account_id_period_year_period_month_key" ON "vendor_line_adjustments"("org_id", "org_membership_id", "account_id", "period_year", "period_month");
CREATE INDEX "vendor_line_adjustments_org_id_period_year_period_month_idx" ON "vendor_line_adjustments"("org_id", "period_year", "period_month");
