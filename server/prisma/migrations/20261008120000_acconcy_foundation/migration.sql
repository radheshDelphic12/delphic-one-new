-- CreateTable
CREATE TABLE "ax_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "profit_multiplier" DECIMAL(10,2) NOT NULL DEFAULT 240,
    "asset_multiplier" DECIMAL(10,2) NOT NULL DEFAULT 3,
    "include_investments_in_assets" BOOLEAN NOT NULL DEFAULT true,
    "lead_prefix" TEXT NOT NULL DEFAULT 'AL',
    "lead_seq" INTEGER NOT NULL DEFAULT 0,
    "deal_prefix" TEXT NOT NULL DEFAULT 'AD',
    "deal_seq" INTEGER NOT NULL DEFAULT 0,
    "task_prefix" TEXT NOT NULL DEFAULT 'AT',
    "task_seq" INTEGER NOT NULL DEFAULT 0,
    "investment_prefix" TEXT NOT NULL DEFAULT 'AI',
    "investment_seq" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ax_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ax_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_audit" (
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

    CONSTRAINT "ax_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_people" (
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
    "monthly_salary" DECIMAL(14,2),
    "joining_date" DATE,
    "leaving_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ax_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_parties" (
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

    CONSTRAINT "ax_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_documents" (
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

    CONSTRAINT "ax_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "service_type" TEXT NOT NULL,
    "party_id" UUID,
    "vendor_id" UUID,
    "contact_name" TEXT,
    "company_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "location" TEXT,
    "source" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "lost_reason" TEXT,
    "owner_id" UUID,
    "assignee_id" UUID,
    "contractor_id" UUID,
    "expected_amount" DECIMAL(16,2),
    "expected_revenue" DECIMAL(16,2),
    "expected_profit" DECIMAL(16,2),
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

    CONSTRAINT "ax_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_lead_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "summary" TEXT NOT NULL,
    "follow_up_date" DATE,
    "follow_up_done" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ax_lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_deals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "lead_id" UUID,
    "service_type" TEXT NOT NULL,
    "party_id" UUID,
    "vendor_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "start_date" DATE,
    "expected_end" DATE,
    "actual_end" DATE,
    "deal_amount" DECIMAL(16,2),
    "location" TEXT,
    "assignee_id" UUID,
    "contractor_id" UUID,
    "description" TEXT,
    "notes" TEXT,
    "details" JSONB,
    "cancel_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ax_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "deal_id" UUID,
    "party_id" UUID,
    "vendor_id" UUID,
    "amount" DECIMAL(16,2) NOT NULL,
    "tax" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "payment_mode" TEXT,
    "reference" TEXT,
    "description" TEXT,
    "source_type" TEXT,
    "source_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ax_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_investments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "deal_id" UUID,
    "service_type" TEXT,
    "investment_date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "current_value" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(16,3),
    "purchase_price" DECIMAL(16,2),
    "current_price" DECIMAL(16,2),
    "unit" TEXT,
    "purity" TEXT,
    "storage_location" TEXT,
    "startup_name" TEXT,
    "equity_pct" DECIMAL(7,3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ax_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_investment_realisations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "investment_id" UUID NOT NULL,
    "realised_date" DATE NOT NULL,
    "amount_received" DECIMAL(16,2) NOT NULL,
    "cost_released" DECIMAL(16,2) NOT NULL,
    "ledger_entry_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ax_investment_realisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "value" DECIMAL(16,2) NOT NULL,
    "as_of_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ax_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_tasks" (
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

    CONSTRAINT "ax_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_salaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "gross" DECIMAL(14,2) NOT NULL,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paid_on" DATE,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ax_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_period_closes" (
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

    CONSTRAINT "ax_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ax_valuation_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "valuation_date" DATE NOT NULL,
    "month" TEXT NOT NULL,
    "profit" DECIMAL(16,2) NOT NULL,
    "asset_value" DECIMAL(16,2) NOT NULL,
    "profit_multiplier" DECIMAL(10,2) NOT NULL,
    "asset_multiplier" DECIMAL(10,2) NOT NULL,
    "profit_component" DECIMAL(18,2) NOT NULL,
    "asset_component" DECIMAL(18,2) NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ax_valuation_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ax_settings_org_id_key" ON "ax_settings"("org_id");

-- CreateIndex
CREATE INDEX "ax_categories_org_id_kind_idx" ON "ax_categories"("org_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ax_categories_org_id_kind_name_key" ON "ax_categories"("org_id", "kind", "name");

-- CreateIndex
CREATE INDEX "ax_audit_org_id_entity_entity_id_idx" ON "ax_audit"("org_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "ax_audit_org_id_created_at_idx" ON "ax_audit"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "ax_people_org_id_idx" ON "ax_people"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ax_people_org_id_user_id_key" ON "ax_people"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "ax_parties_org_id_kind_status_idx" ON "ax_parties"("org_id", "kind", "status");

-- CreateIndex
CREATE INDEX "ax_parties_org_id_name_idx" ON "ax_parties"("org_id", "name");

-- CreateIndex
CREATE INDEX "ax_documents_org_id_owner_type_owner_id_idx" ON "ax_documents"("org_id", "owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "ax_leads_org_id_stage_idx" ON "ax_leads"("org_id", "stage");

-- CreateIndex
CREATE INDEX "ax_leads_org_id_service_type_idx" ON "ax_leads"("org_id", "service_type");

-- CreateIndex
CREATE INDEX "ax_lead_activities_lead_id_created_at_idx" ON "ax_lead_activities"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "ax_lead_activities_org_id_follow_up_date_idx" ON "ax_lead_activities"("org_id", "follow_up_date");

-- CreateIndex
CREATE INDEX "ax_deals_org_id_status_idx" ON "ax_deals"("org_id", "status");

-- CreateIndex
CREATE INDEX "ax_deals_org_id_service_type_idx" ON "ax_deals"("org_id", "service_type");

-- CreateIndex
CREATE INDEX "ax_ledger_entries_org_id_entry_date_idx" ON "ax_ledger_entries"("org_id", "entry_date");

-- CreateIndex
CREATE INDEX "ax_ledger_entries_org_id_deal_id_idx" ON "ax_ledger_entries"("org_id", "deal_id");

-- CreateIndex
CREATE INDEX "ax_investments_org_id_type_idx" ON "ax_investments"("org_id", "type");

-- CreateIndex
CREATE INDEX "ax_investments_org_id_status_idx" ON "ax_investments"("org_id", "status");

-- CreateIndex
CREATE INDEX "ax_investment_realisations_org_id_realised_date_idx" ON "ax_investment_realisations"("org_id", "realised_date");

-- CreateIndex
CREATE INDEX "ax_investment_realisations_investment_id_idx" ON "ax_investment_realisations"("investment_id");

-- CreateIndex
CREATE INDEX "ax_assets_org_id_status_idx" ON "ax_assets"("org_id", "status");

-- CreateIndex
CREATE INDEX "ax_tasks_org_id_status_idx" ON "ax_tasks"("org_id", "status");

-- CreateIndex
CREATE INDEX "ax_tasks_org_id_due_date_idx" ON "ax_tasks"("org_id", "due_date");

-- CreateIndex
CREATE INDEX "ax_salaries_org_id_month_idx" ON "ax_salaries"("org_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ax_salaries_org_id_person_id_month_key" ON "ax_salaries"("org_id", "person_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "ax_period_closes_org_id_month_key" ON "ax_period_closes"("org_id", "month");

-- CreateIndex
CREATE INDEX "ax_valuation_history_org_id_valuation_date_idx" ON "ax_valuation_history"("org_id", "valuation_date");

-- AddForeignKey
ALTER TABLE "ax_settings" ADD CONSTRAINT "ax_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_categories" ADD CONSTRAINT "ax_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_audit" ADD CONSTRAINT "ax_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_people" ADD CONSTRAINT "ax_people_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_people" ADD CONSTRAINT "ax_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_parties" ADD CONSTRAINT "ax_parties_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_documents" ADD CONSTRAINT "ax_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_leads" ADD CONSTRAINT "ax_leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_lead_activities" ADD CONSTRAINT "ax_lead_activities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_lead_activities" ADD CONSTRAINT "ax_lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "ax_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_deals" ADD CONSTRAINT "ax_deals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_ledger_entries" ADD CONSTRAINT "ax_ledger_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_ledger_entries" ADD CONSTRAINT "ax_ledger_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ax_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_ledger_entries" ADD CONSTRAINT "ax_ledger_entries_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "ax_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_investments" ADD CONSTRAINT "ax_investments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_investments" ADD CONSTRAINT "ax_investments_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "ax_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_investment_realisations" ADD CONSTRAINT "ax_investment_realisations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_investment_realisations" ADD CONSTRAINT "ax_investment_realisations_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "ax_investments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_assets" ADD CONSTRAINT "ax_assets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_tasks" ADD CONSTRAINT "ax_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_tasks" ADD CONSTRAINT "ax_tasks_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "ax_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_salaries" ADD CONSTRAINT "ax_salaries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_salaries" ADD CONSTRAINT "ax_salaries_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "ax_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_period_closes" ADD CONSTRAINT "ax_period_closes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ax_valuation_history" ADD CONSTRAINT "ax_valuation_history_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

