-- Payment Tracker: a vendor resource can be marked paid on its own (a vendor payment is recorded once per vendor and month).
CREATE TABLE "vendor_resource_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "vendor_account_id" UUID NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "paid_on" DATE NOT NULL,
    "amount" DECIMAL(14,2),
    "note" TEXT,
    "marked_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_resource_payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendor_resource_payments_resource_month_key" ON "vendor_resource_payments"("org_membership_id", "project_id", "period_month", "period_year");
CREATE INDEX "vendor_resource_payments_org_id_period_year_period_month_idx" ON "vendor_resource_payments"("org_id", "period_year", "period_month");
