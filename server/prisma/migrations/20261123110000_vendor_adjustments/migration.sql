-- Vendor + / - adjustments (Live Analytics > Vendors). Replaces the per-line amount edit of the previous migration,
-- which was only on staging and never held real data.
DROP TABLE IF EXISTS "vendor_line_adjustments";

CREATE TABLE "vendor_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "vendor_account_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "period_month" INTEGER NOT NULL,
  "period_year" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vendor_adjustments_org_id_vendor_account_id_period_year_period_month_idx" ON "vendor_adjustments"("org_id", "vendor_account_id", "period_year", "period_month");
ALTER TABLE "vendor_adjustments" ADD CONSTRAINT "vendor_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
