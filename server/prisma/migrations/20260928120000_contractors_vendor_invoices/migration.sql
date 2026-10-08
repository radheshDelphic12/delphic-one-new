-- People: full-time vs contractor (vendor + vendor rate), project allocation %,
-- and per-project monthly vendor invoices. Additive only.

-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('full_time_employee', 'contractor');

-- AlterTable
ALTER TABLE "org_memberships" ADD COLUMN     "vendor_account_id" UUID,
ADD COLUMN     "vendor_rate" DECIMAL(14,2),
ADD COLUMN     "vendor_rate_currency" "Currency",
ADD COLUMN     "worker_type" "WorkerType" NOT NULL DEFAULT 'full_time_employee';

-- AlterTable
ALTER TABLE "project_member_assignments" ADD COLUMN     "allocation_percent" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "project_vendor_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "vendor_account_id" UUID NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "invoice_number" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_vendor_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_vendor_invoices_org_id_period_year_period_month_idx" ON "project_vendor_invoices"("org_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "project_vendor_invoices_account_id_period_year_period_month_idx" ON "project_vendor_invoices"("account_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "project_vendor_invoices_vendor_account_id_idx" ON "project_vendor_invoices"("vendor_account_id");

-- CreateIndex
CREATE INDEX "org_memberships_vendor_account_id_idx" ON "org_memberships"("vendor_account_id");

-- AddForeignKey
ALTER TABLE "project_vendor_invoices" ADD CONSTRAINT "project_vendor_invoices_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_vendor_invoices" ADD CONSTRAINT "project_vendor_invoices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_vendor_invoices" ADD CONSTRAINT "project_vendor_invoices_vendor_account_id_fkey" FOREIGN KEY ("vendor_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_vendor_invoices" ADD CONSTRAINT "project_vendor_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_vendor_account_id_fkey" FOREIGN KEY ("vendor_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

