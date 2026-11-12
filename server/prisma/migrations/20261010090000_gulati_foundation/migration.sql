-- CreateTable
CREATE TABLE "fx_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "campaign_prefix" TEXT NOT NULL DEFAULT 'GF',
    "campaign_seq" INTEGER NOT NULL DEFAULT 0,
    "block_overspend" BOOLEAN NOT NULL DEFAULT true,
    "forecast_method" TEXT NOT NULL DEFAULT 'plan',
    "run_rate_months" INTEGER NOT NULL DEFAULT 3,
    "ending_soon_days" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fx_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_audit" (
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

    CONSTRAINT "fx_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_people" (
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

    CONSTRAINT "fx_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "objective" TEXT,
    "category_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "area" TEXT,
    "address" TEXT,
    "planned_start" DATE,
    "planned_end" DATE,
    "actual_start" DATE,
    "actual_end" DATE,
    "allocated_budget" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "planned_investment" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "financial_notes" TEXT,
    "manager_id" UUID,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fx_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_campaign_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "planned_amount" DECIMAL(16,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_campaign_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_budget_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "previous_allocated" DECIMAL(16,2) NOT NULL,
    "new_allocated" DECIMAL(16,2) NOT NULL,
    "previous_planned" DECIMAL(16,2) NOT NULL,
    "new_planned" DECIMAL(16,2) NOT NULL,
    "reason" TEXT,
    "effective_date" DATE NOT NULL,
    "changed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_budget_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "campaign_id" UUID,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expense_class" TEXT,
    "category_id" UUID,
    "entry_date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "payment_method" TEXT,
    "party_name" TEXT,
    "reference" TEXT,
    "description" TEXT,
    "override_reason" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "fx_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fx_period_closes" (
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

    CONSTRAINT "fx_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fx_settings_org_id_key" ON "fx_settings"("org_id");

-- CreateIndex
CREATE INDEX "fx_categories_org_id_scope_idx" ON "fx_categories"("org_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "fx_categories_org_id_scope_name_key" ON "fx_categories"("org_id", "scope", "name");

-- CreateIndex
CREATE INDEX "fx_audit_org_id_entity_entity_id_idx" ON "fx_audit"("org_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "fx_audit_org_id_created_at_idx" ON "fx_audit"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "fx_people_org_id_idx" ON "fx_people"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_people_org_id_user_id_key" ON "fx_people"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "fx_campaigns_org_id_status_idx" ON "fx_campaigns"("org_id", "status");

-- CreateIndex
CREATE INDEX "fx_campaigns_org_id_category_id_idx" ON "fx_campaigns"("org_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_campaigns_org_id_code_key" ON "fx_campaigns"("org_id", "code");

-- CreateIndex
CREATE INDEX "fx_campaign_plans_org_id_idx" ON "fx_campaign_plans"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "fx_campaign_plans_campaign_id_month_key" ON "fx_campaign_plans"("campaign_id", "month");

-- CreateIndex
CREATE INDEX "fx_budget_history_campaign_id_idx" ON "fx_budget_history"("campaign_id");

-- CreateIndex
CREATE INDEX "fx_budget_history_org_id_idx" ON "fx_budget_history"("org_id");

-- CreateIndex
CREATE INDEX "fx_entries_org_id_entry_date_idx" ON "fx_entries"("org_id", "entry_date");

-- CreateIndex
CREATE INDEX "fx_entries_org_id_campaign_id_idx" ON "fx_entries"("org_id", "campaign_id");

-- CreateIndex
CREATE INDEX "fx_entries_org_id_kind_status_idx" ON "fx_entries"("org_id", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "fx_period_closes_org_id_month_key" ON "fx_period_closes"("org_id", "month");

-- AddForeignKey
ALTER TABLE "fx_settings" ADD CONSTRAINT "fx_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_categories" ADD CONSTRAINT "fx_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_audit" ADD CONSTRAINT "fx_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_people" ADD CONSTRAINT "fx_people_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_people" ADD CONSTRAINT "fx_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_campaigns" ADD CONSTRAINT "fx_campaigns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_campaigns" ADD CONSTRAINT "fx_campaigns_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fx_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_campaigns" ADD CONSTRAINT "fx_campaigns_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "fx_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_campaign_plans" ADD CONSTRAINT "fx_campaign_plans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_campaign_plans" ADD CONSTRAINT "fx_campaign_plans_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "fx_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_budget_history" ADD CONSTRAINT "fx_budget_history_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_budget_history" ADD CONSTRAINT "fx_budget_history_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "fx_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_entries" ADD CONSTRAINT "fx_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_entries" ADD CONSTRAINT "fx_entries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "fx_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_entries" ADD CONSTRAINT "fx_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "fx_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fx_period_closes" ADD CONSTRAINT "fx_period_closes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
