-- Fixed-bid projects: the billing rate is a one-time contract total.
ALTER TYPE "BillingRateType" ADD VALUE IF NOT EXISTS 'one_time';

-- A fixed-bid project can raise several invoices in a month. One invoice per
-- project and month stays enforced in code for monthly / hourly projects.
DROP INDEX IF EXISTS "client_invoices_client_account_id_period_month_period_year_key";
CREATE INDEX "client_invoices_client_account_id_period_year_period_month_idx" ON "client_invoices"("client_account_id", "period_year", "period_month");

-- Financials -> Valuation: the asset value recorded per month.
CREATE TABLE "financial_asset_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "asset_value" DECIMAL(16,2) NOT NULL,
    "notes" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_asset_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "financial_asset_values_org_id_period_year_period_month_key" ON "financial_asset_values"("org_id", "period_year", "period_month");

ALTER TABLE "financial_asset_values" ADD CONSTRAINT "financial_asset_values_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
