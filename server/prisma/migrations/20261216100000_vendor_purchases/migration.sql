-- Normal purchases: a vendor bill that is not tied to a client project (Finance > Vendor Invoices). Additive only: one new table and one new
-- document entity type. The expense side is a linked row in group_billing_charges (vendor_purchases.charge_id), no column is added there.

-- AlterEnum
ALTER TYPE "DocumentEntityType" ADD VALUE 'vendor_purchase';

-- CreateTable
CREATE TABLE "vendor_purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "vendor_account_id" UUID NOT NULL,
    "bill_number" TEXT NOT NULL,
    "bill_date" DATE NOT NULL,
    "due_date" DATE,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "description" TEXT,
    "category_id" UUID,
    "category_name" TEXT,
    "location_id" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "gst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tds_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "adjustment_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "adjustment_note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" UUID,
    "cancel_reason" TEXT,
    "paid_on" DATE,
    "paid_amount" DECIMAL(14,2),
    "payment_mode" TEXT,
    "payment_reference" TEXT,
    "charge_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_purchases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendor_purchases_status_check" CHECK ("status" IN ('active', 'cancelled'))
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_purchases_charge_id_key" ON "vendor_purchases"("charge_id");

-- CreateIndex
CREATE INDEX "vendor_purchases_org_id_period_year_period_month_idx" ON "vendor_purchases"("org_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "vendor_purchases_vendor_account_id_idx" ON "vendor_purchases"("vendor_account_id");

-- AddForeignKey
ALTER TABLE "vendor_purchases" ADD CONSTRAINT "vendor_purchases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_purchases" ADD CONSTRAINT "vendor_purchases_vendor_account_id_fkey" FOREIGN KEY ("vendor_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_purchases" ADD CONSTRAINT "vendor_purchases_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "group_billing_charges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_purchases" ADD CONSTRAINT "vendor_purchases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
