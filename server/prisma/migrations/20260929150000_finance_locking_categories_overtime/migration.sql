-- Finance: project codes (project name is no longer an identifier), per-project
-- overtime billing, timesheet overtime hours, admin-managed Group Charge /
-- Expense categories, group-charge payment dates + office, expense dates, and
-- the reusable calculation lock / version / change-detection tables.
-- Additive only: no existing column is dropped or rewritten.

-- CreateEnum
CREATE TYPE "FinanceCategoryKind" AS ENUM ('group_charge', 'expense');

-- CreateEnum
CREATE TYPE "CalculationKind" AS ENUM ('billing', 'salary', 'resource_revenue', 'vendor_payment', 'financials');

-- CreateEnum
CREATE TYPE "CalculationStatus" AS ENUM ('draft', 'reviewed', 'locked', 'change_detected', 'reopened');

-- CreateEnum
CREATE TYPE "CalculationChangeStatus" AS ENUM ('open', 'accepted', 'dismissed');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "overtime_billable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overtime_multiplier" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "project_code" TEXT;

-- AlterTable
ALTER TABLE "client_invoices" ADD COLUMN     "calculation_version_id" UUID;

-- AlterTable
ALTER TABLE "expense_claims" ADD COLUMN     "category_id" UUID,
ADD COLUMN     "expense_date" DATE;

-- AlterTable
ALTER TABLE "group_billing_charges" ADD COLUMN     "category_id" UUID,
ADD COLUMN     "location_id" UUID,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "payment_date" DATE;

-- AlterTable
ALTER TABLE "timesheet_entries" ADD COLUMN     "overtime_hours" DECIMAL(4,1) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "vendor_payments" ADD COLUMN     "calculation_version_id" UUID,
ADD COLUMN     "vendor_account_id" UUID;

-- CreateTable
CREATE TABLE "finance_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" "FinanceCategoryKind" NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_calculations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" "CalculationKind" NOT NULL,
    "scope_key" TEXT NOT NULL,
    "scope_label" TEXT,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "status" "CalculationStatus" NOT NULL DEFAULT 'draft',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "locked_by" UUID,
    "locked_at" TIMESTAMP(3),
    "reopened_by" UUID,
    "reopened_at" TIMESTAMP(3),
    "change_detected_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_calculation_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "calculation_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "snapshot" JSONB NOT NULL,
    "reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_calculation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_calculation_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "calculation_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT,
    "org_membership_id" UUID,
    "account_id" UUID,
    "date" DATE,
    "description" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "previous_amount" DECIMAL(16,2),
    "potential_amount" DECIMAL(16,2),
    "changed_by" UUID,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CalculationChangeStatus" NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolved_version" INTEGER,
    "resolution_note" TEXT,

    CONSTRAINT "financial_calculation_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_categories_org_id_kind_idx" ON "finance_categories"("org_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "finance_categories_org_id_kind_name_key" ON "finance_categories"("org_id", "kind", "name");

-- CreateIndex
CREATE INDEX "financial_calculations_org_id_period_year_period_month_idx" ON "financial_calculations"("org_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "financial_calculations_org_id_status_idx" ON "financial_calculations"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "financial_calculations_org_id_kind_scope_key_period_year_pe_key" ON "financial_calculations"("org_id", "kind", "scope_key", "period_year", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "financial_calculation_versions_calculation_id_version_key" ON "financial_calculation_versions"("calculation_id", "version");

-- CreateIndex
CREATE INDEX "financial_calculation_changes_calculation_id_status_idx" ON "financial_calculation_changes"("calculation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_org_id_project_code_key" ON "accounts"("org_id", "project_code");

-- CreateIndex
CREATE INDEX "group_billing_charges_org_id_payment_date_idx" ON "group_billing_charges"("org_id", "payment_date");

-- AddForeignKey
ALTER TABLE "group_billing_charges" ADD CONSTRAINT "group_billing_charges_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_billing_charges" ADD CONSTRAINT "group_billing_charges_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "finance_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_categories" ADD CONSTRAINT "finance_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_calculations" ADD CONSTRAINT "financial_calculations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_calculation_versions" ADD CONSTRAINT "financial_calculation_versions_calculation_id_fkey" FOREIGN KEY ("calculation_id") REFERENCES "financial_calculations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_calculation_changes" ADD CONSTRAINT "financial_calculation_changes_calculation_id_fkey" FOREIGN KEY ("calculation_id") REFERENCES "financial_calculations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: give every existing client account (a Finance "project") an
-- internal project code, numbered per org in creation order — P0001, P0002 …
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY created_at, id) AS n
  FROM "accounts"
  WHERE "type" = 'client' AND "org_id" IS NOT NULL AND "project_code" IS NULL
)
UPDATE "accounts" a
SET "project_code" = 'P' || LPAD(numbered.n::text, 4, '0')
FROM numbered
WHERE a.id = numbered.id;
