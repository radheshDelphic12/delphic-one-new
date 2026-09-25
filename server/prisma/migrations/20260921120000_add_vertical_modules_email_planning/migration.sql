-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('queued', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "PartnerKind" AS ENUM ('supplier', 'consumer');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('lead', 'onboarding', 'active', 'inactive');

-- CreateEnum
CREATE TYPE "TradingStatus" AS ENUM ('not_trading', 'trading', 'paused');

-- CreateEnum
CREATE TYPE "TradeTxnType" AS ENUM ('purchase', 'sale');

-- CreateEnum
CREATE TYPE "TradeTxnStatus" AS ENUM ('open', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "LeadCategory" AS ENUM ('self_project', 'client_project', 'other');

-- CreateEnum
CREATE TYPE "SelfProjectBasis" AS ENUM ('investor', 'customer_deal', 'project_type');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost');

-- CreateEnum
CREATE TYPE "ContractKind" AS ENUM ('construction', 'recurring', 'service');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('draft', 'active', 'completed', 'terminated');

-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('one_time', 'monthly', 'quarterly', 'annual');

-- CreateEnum
CREATE TYPE "SelfProjectStatus" AS ENUM ('planning', 'active', 'on_hold', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "FinanceEntryType" AS ENUM ('revenue', 'expense', 'salary', 'other');

-- CreateEnum
CREATE TYPE "ProjectDocCategory" AS ENUM ('legal', 'site', 'permit', 'approval', 'title', 'other');

-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "enabled_modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "valuation_method" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "valuation_multiple" DECIMAL(8,2);

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID,
    "kind" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "to_name" TEXT,
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "body_html" TEXT,
    "ics" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trading_partners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" "PartnerKind" NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "gst_or_tax_id" TEXT,
    "status" "PartnerStatus" NOT NULL DEFAULT 'lead',
    "trading_status" "TradingStatus" NOT NULL DEFAULT 'not_trading',
    "onboarding_checklist" JSONB NOT NULL DEFAULT '{}',
    "onboarded_at" TIMESTAMP(3),
    "owner_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trading_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "category" TEXT,
    "hsn_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_item_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_item_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "txn_type" "TradeTxnType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "status" "TradeTxnStatus" NOT NULL DEFAULT 'open',
    "txn_date" DATE NOT NULL,
    "reference" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LeadCategory" NOT NULL DEFAULT 'other',
    "self_project_basis" "SelfProjectBasis",
    "investor_name" TEXT,
    "customer_deal_ref" TEXT,
    "project_type" TEXT,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "source" TEXT,
    "estimated_value" DECIMAL(16,2),
    "expected_monthly" DECIMAL(14,2),
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "stage" "LeadStage" NOT NULL DEFAULT 'new',
    "owner_id" UUID,
    "notes" TEXT,
    "converted_project_id" UUID,
    "converted_contract_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" "ContractKind" NOT NULL,
    "title" TEXT NOT NULL,
    "counterparty_name" TEXT NOT NULL,
    "lead_id" UUID,
    "project_id" UUID,
    "value" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "status" "ContractStatus" NOT NULL DEFAULT 'draft',
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "billing_frequency" "BillingFrequency" NOT NULL DEFAULT 'one_time',
    "recurring_amount" DECIMAL(14,2),
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "billed_to_date" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "site_location" TEXT,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "project_type" TEXT,
    "status" "SelfProjectStatus" NOT NULL DEFAULT 'planning',
    "location" TEXT,
    "investor_name" TEXT,
    "customer_deal_ref" TEXT,
    "lead_id" UUID,
    "budget" DECIMAL(16,2),
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "start_date" DATE,
    "end_date" DATE,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_finance_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "entry_type" "FinanceEntryType" NOT NULL,
    "category" TEXT,
    "amount" DECIMAL(16,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "entry_date" DATE NOT NULL,
    "description" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_finance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "category" "ProjectDocCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "reference_no" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "notes" TEXT,
    "file_url" TEXT,
    "file_type" TEXT,
    "file_size_bytes" INTEGER,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "line_kind" "FinanceEntryType" NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "planned_amount" DECIMAL(16,2) NOT NULL,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "face_membership_id" UUID NOT NULL,
    "working_membership_id" UUID NOT NULL,
    "account_id" UUID,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_outbox_status_created_at_idx" ON "email_outbox"("status", "created_at");

-- CreateIndex
CREATE INDEX "email_outbox_org_id_idx" ON "email_outbox"("org_id");

-- CreateIndex
CREATE INDEX "trading_partners_org_id_kind_status_idx" ON "trading_partners"("org_id", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trade_items_org_id_name_key" ON "trade_items"("org_id", "name");

-- CreateIndex
CREATE INDEX "partner_item_rates_org_id_partner_id_item_id_effective_from_idx" ON "partner_item_rates"("org_id", "partner_id", "item_id", "effective_from");

-- CreateIndex
CREATE INDEX "trade_transactions_org_id_txn_date_idx" ON "trade_transactions"("org_id", "txn_date");

-- CreateIndex
CREATE INDEX "trade_transactions_org_id_partner_id_idx" ON "trade_transactions"("org_id", "partner_id");

-- CreateIndex
CREATE INDEX "leads_org_id_stage_idx" ON "leads"("org_id", "stage");

-- CreateIndex
CREATE INDEX "leads_org_id_category_idx" ON "leads"("org_id", "category");

-- CreateIndex
CREATE INDEX "contracts_org_id_status_idx" ON "contracts"("org_id", "status");

-- CreateIndex
CREATE INDEX "contracts_org_id_kind_idx" ON "contracts"("org_id", "kind");

-- CreateIndex
CREATE INDEX "self_projects_org_id_status_idx" ON "self_projects"("org_id", "status");

-- CreateIndex
CREATE INDEX "project_finance_entries_org_id_entry_date_idx" ON "project_finance_entries"("org_id", "entry_date");

-- CreateIndex
CREATE INDEX "project_finance_entries_project_id_entry_type_idx" ON "project_finance_entries"("project_id", "entry_type");

-- CreateIndex
CREATE INDEX "project_documents_org_id_project_id_idx" ON "project_documents"("org_id", "project_id");

-- CreateIndex
CREATE INDEX "project_documents_org_id_expires_on_idx" ON "project_documents"("org_id", "expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "financial_plans_org_id_period_year_period_month_line_kind_c_key" ON "financial_plans"("org_id", "period_year", "period_month", "line_kind", "category");

-- CreateIndex
CREATE INDEX "resource_mappings_org_id_working_membership_id_idx" ON "resource_mappings"("org_id", "working_membership_id");

-- CreateIndex
CREATE INDEX "resource_mappings_org_id_face_membership_id_idx" ON "resource_mappings"("org_id", "face_membership_id");

-- AddForeignKey
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trading_partners" ADD CONSTRAINT "trading_partners_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_items" ADD CONSTRAINT "trade_items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_item_rates" ADD CONSTRAINT "partner_item_rates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_item_rates" ADD CONSTRAINT "partner_item_rates_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "trading_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_item_rates" ADD CONSTRAINT "partner_item_rates_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "trade_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_transactions" ADD CONSTRAINT "trade_transactions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_transactions" ADD CONSTRAINT "trade_transactions_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "trading_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_transactions" ADD CONSTRAINT "trade_transactions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "trade_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "self_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_projects" ADD CONSTRAINT "self_projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_finance_entries" ADD CONSTRAINT "project_finance_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_finance_entries" ADD CONSTRAINT "project_finance_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "self_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "self_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_plans" ADD CONSTRAINT "financial_plans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_mappings" ADD CONSTRAINT "resource_mappings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

