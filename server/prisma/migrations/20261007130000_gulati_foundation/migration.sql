-- CreateTable
CREATE TABLE "gx_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "valuation_method" TEXT NOT NULL DEFAULT 'revenue_multiple',
    "valuation_multiple" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "valuation_manual" DECIMAL(16,2),
    "lead_prefix" TEXT NOT NULL DEFAULT 'GL',
    "lead_seq" INTEGER NOT NULL DEFAULT 0,
    "deal_prefix" TEXT NOT NULL DEFAULT 'GD',
    "deal_seq" INTEGER NOT NULL DEFAULT 0,
    "task_prefix" TEXT NOT NULL DEFAULT 'GT',
    "task_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gx_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_trading_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gx_trading_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gx_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_people" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "user_id" UUID,
    "access_role" TEXT NOT NULL DEFAULT 'none',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "kind" TEXT NOT NULL DEFAULT 'employee',
    "designation" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "joining_date" DATE,
    "leaving_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_parties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'client',
    "name" TEXT NOT NULL,
    "company_name" TEXT,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "vendor_category" TEXT,
    "materials_services" TEXT,
    "payment_terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "ref_no" TEXT,
    "issue_date" DATE,
    "expiry_date" DATE,
    "file_url" TEXT NOT NULL,
    "file_name" TEXT,
    "size_bytes" INTEGER,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "trading_type" TEXT NOT NULL,
    "party_id" UUID,
    "vendor_id" UUID,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "location" TEXT,
    "source" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "lost_reason" TEXT,
    "owner_id" UUID,
    "assignee_id" UUID,
    "contractor_id" UUID,
    "product" TEXT,
    "material_type" TEXT,
    "quantity" DECIMAL(16,3),
    "unit" TEXT,
    "expected_purchase_amount" DECIMAL(16,2),
    "expected_sale_amount" DECIMAL(16,2),
    "expected_margin" DECIMAL(16,2),
    "expected_start" DATE,
    "expected_end" DATE,
    "description" TEXT,
    "notes" TEXT,
    "details" JSONB,
    "deal_id" UUID,
    "closed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_lead_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "summary" TEXT NOT NULL,
    "follow_up_date" DATE,
    "follow_up_done" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gx_lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_deals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "lead_id" UUID,
    "trading_type" TEXT NOT NULL,
    "party_id" UUID,
    "vendor_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "start_date" DATE,
    "expected_end" DATE,
    "actual_end" DATE,
    "location" TEXT,
    "assignee_id" UUID,
    "contractor_id" UUID,
    "product" TEXT,
    "material_type" TEXT,
    "ordered_quantity" DECIMAL(16,3),
    "unit" TEXT,
    "expected_purchase_amount" DECIMAL(16,2),
    "expected_sale_amount" DECIMAL(16,2),
    "description" TEXT,
    "notes" TEXT,
    "cancel_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_purchases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "vendor_id" UUID,
    "purchase_date" DATE NOT NULL,
    "quantity" DECIMAL(16,3),
    "rate" DECIMAL(16,2),
    "amount" DECIMAL(16,2) NOT NULL,
    "tax" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "client_id" UUID,
    "sale_date" DATE NOT NULL,
    "quantity" DECIMAL(16,3),
    "rate" DECIMAL(16,2),
    "amount" DECIMAL(16,2) NOT NULL,
    "tax" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "reference" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "side" TEXT NOT NULL,
    "purchase_id" UUID,
    "sale_id" UUID,
    "amount" DECIMAL(16,2) NOT NULL,
    "paid_date" DATE NOT NULL,
    "mode" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "deal_id" UUID,
    "party_id" UUID,
    "amount" DECIMAL(16,2) NOT NULL,
    "tax" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "payment_mode" TEXT,
    "reference" TEXT,
    "description" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT,
    "title" TEXT NOT NULL,
    "task_type" TEXT NOT NULL DEFAULT 'other',
    "deal_id" UUID,
    "lead_id" UUID,
    "party_id" UUID,
    "assignee_id" UUID,
    "contractor_id" UUID,
    "due_date" DATE,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completed_on" DATE,
    "description" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "gx_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gx_period_closes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "snapshot" JSONB,
    "closed_by" UUID,
    "closed_at" TIMESTAMP(3),
    "reopen_reason" TEXT,
    "reopened_at" TIMESTAMP(3),
    "stale" BOOLEAN NOT NULL DEFAULT false,
    "stale_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gx_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gx_settings_org_id_key" ON "gx_settings"("org_id");

-- CreateIndex
CREATE INDEX "gx_categories_org_id_kind_idx" ON "gx_categories"("org_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "gx_categories_org_id_kind_name_key" ON "gx_categories"("org_id", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "gx_units_org_id_name_key" ON "gx_units"("org_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "gx_trading_types_org_id_key_key" ON "gx_trading_types"("org_id", "key");

-- CreateIndex
CREATE INDEX "gx_audit_org_id_entity_entity_id_idx" ON "gx_audit"("org_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "gx_audit_org_id_created_at_idx" ON "gx_audit"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "gx_people_org_id_idx" ON "gx_people"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "gx_people_org_id_user_id_key" ON "gx_people"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "gx_parties_org_id_kind_status_idx" ON "gx_parties"("org_id", "kind", "status");

-- CreateIndex
CREATE INDEX "gx_parties_org_id_name_idx" ON "gx_parties"("org_id", "name");

-- CreateIndex
CREATE INDEX "gx_documents_org_id_owner_type_owner_id_idx" ON "gx_documents"("org_id", "owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "gx_leads_org_id_stage_idx" ON "gx_leads"("org_id", "stage");

-- CreateIndex
CREATE INDEX "gx_leads_org_id_trading_type_idx" ON "gx_leads"("org_id", "trading_type");

-- CreateIndex
CREATE INDEX "gx_lead_activities_lead_id_created_at_idx" ON "gx_lead_activities"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "gx_lead_activities_org_id_follow_up_date_idx" ON "gx_lead_activities"("org_id", "follow_up_date");

-- CreateIndex
CREATE INDEX "gx_deals_org_id_status_idx" ON "gx_deals"("org_id", "status");

-- CreateIndex
CREATE INDEX "gx_deals_org_id_trading_type_idx" ON "gx_deals"("org_id", "trading_type");

-- CreateIndex
CREATE INDEX "gx_purchases_org_id_purchase_date_idx" ON "gx_purchases"("org_id", "purchase_date");

-- CreateIndex
CREATE INDEX "gx_purchases_deal_id_idx" ON "gx_purchases"("deal_id");

-- CreateIndex
CREATE INDEX "gx_sales_org_id_sale_date_idx" ON "gx_sales"("org_id", "sale_date");

-- CreateIndex
CREATE INDEX "gx_sales_deal_id_idx" ON "gx_sales"("deal_id");

-- CreateIndex
CREATE INDEX "gx_payments_org_id_paid_date_idx" ON "gx_payments"("org_id", "paid_date");

-- CreateIndex
CREATE INDEX "gx_payments_deal_id_idx" ON "gx_payments"("deal_id");

-- CreateIndex
CREATE INDEX "gx_ledger_entries_org_id_entry_date_idx" ON "gx_ledger_entries"("org_id", "entry_date");

-- CreateIndex
CREATE INDEX "gx_ledger_entries_org_id_deal_id_idx" ON "gx_ledger_entries"("org_id", "deal_id");

-- CreateIndex
CREATE INDEX "gx_tasks_org_id_status_idx" ON "gx_tasks"("org_id", "status");

-- CreateIndex
CREATE INDEX "gx_tasks_org_id_due_date_idx" ON "gx_tasks"("org_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "gx_period_closes_org_id_month_key" ON "gx_period_closes"("org_id", "month");

-- AddForeignKey
ALTER TABLE "gx_settings" ADD CONSTRAINT "gx_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_categories" ADD CONSTRAINT "gx_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_units" ADD CONSTRAINT "gx_units_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_trading_types" ADD CONSTRAINT "gx_trading_types_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_audit" ADD CONSTRAINT "gx_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_people" ADD CONSTRAINT "gx_people_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_people" ADD CONSTRAINT "gx_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_parties" ADD CONSTRAINT "gx_parties_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_documents" ADD CONSTRAINT "gx_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_leads" ADD CONSTRAINT "gx_leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_lead_activities" ADD CONSTRAINT "gx_lead_activities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_lead_activities" ADD CONSTRAINT "gx_lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "gx_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_deals" ADD CONSTRAINT "gx_deals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_purchases" ADD CONSTRAINT "gx_purchases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_purchases" ADD CONSTRAINT "gx_purchases_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "gx_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_sales" ADD CONSTRAINT "gx_sales_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_sales" ADD CONSTRAINT "gx_sales_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "gx_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_payments" ADD CONSTRAINT "gx_payments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_payments" ADD CONSTRAINT "gx_payments_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "gx_deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_payments" ADD CONSTRAINT "gx_payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "gx_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_payments" ADD CONSTRAINT "gx_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "gx_sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_ledger_entries" ADD CONSTRAINT "gx_ledger_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_ledger_entries" ADD CONSTRAINT "gx_ledger_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "gx_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_ledger_entries" ADD CONSTRAINT "gx_ledger_entries_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "gx_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_tasks" ADD CONSTRAINT "gx_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
