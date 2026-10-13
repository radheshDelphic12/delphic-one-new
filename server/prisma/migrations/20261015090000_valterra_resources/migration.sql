-- Valterra Resources (additive): vt_* tables incl. vt_sites
-- CreateTable
CREATE TABLE "vt_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "investment_prefix" TEXT NOT NULL DEFAULT 'VT',
    "investment_seq" INTEGER NOT NULL DEFAULT 0,
    "site_prefix" TEXT NOT NULL DEFAULT 'VS',
    "site_seq" INTEGER NOT NULL DEFAULT 0,
    "opening_balance" DECIMAL(16,2),
    "opening_date" DATE,
    "fy_start_month" INTEGER NOT NULL DEFAULT 4,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "vt_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vt_categories" (
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

CONSTRAINT "vt_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vt_audit" (
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

CONSTRAINT "vt_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vt_sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "state" TEXT,
    "district" TEXT,
    "country" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "mining_type_id" UUID,
    "material_id" UUID,
    "additional_materials" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "start_date" DATE,
    "expected_closure_date" DATE,
    "manager_name" TEXT,
    "notes" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "vt_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vt_people" (
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

CONSTRAINT "vt_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vt_investments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "category_id" UUID,
    "site_id" UUID,
    "investor" TEXT,
    "investment_date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "expected_return_amount" DECIMAL(16,2),
    "expected_return_date" DATE,
    "expected_return_rate" DECIMAL(7,3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "reference" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

CONSTRAINT "vt_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vt_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "investment_id" UUID NOT NULL,
    "return_date" DATE NOT NULL,
    "principal" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "earnings" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'received',
    "payment_method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

CONSTRAINT "vt_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vt_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "category_id" UUID,
    "site_id" UUID,
    "person_id" UUID,
    "investment_id" UUID,
    "entry_date" DATE NOT NULL,
    "due_date" DATE,
    "amount" DECIMAL(16,2) NOT NULL,
    "expense_class" TEXT,
    "payment_status" TEXT NOT NULL DEFAULT 'paid',
    "payment_method" TEXT,
    "party_name" TEXT,
    "reference" TEXT,
    "description" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

CONSTRAINT "vt_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vt_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "category_id" UUID,
    "site_id" UUID,
    "investment_id" UUID,
    "amount" DECIMAL(16,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

CONSTRAINT "vt_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vt_period_closes" (
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

CONSTRAINT "vt_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vt_settings_org_id_key" ON "vt_settings"("org_id");

-- CreateIndex
CREATE INDEX "vt_categories_org_id_scope_idx" ON "vt_categories"("org_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "vt_categories_org_id_scope_name_key" ON "vt_categories"("org_id", "scope", "name");

-- CreateIndex
CREATE INDEX "vt_audit_org_id_entity_entity_id_idx" ON "vt_audit"("org_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "vt_audit_org_id_created_at_idx" ON "vt_audit"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "vt_sites_org_id_status_idx" ON "vt_sites"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vt_sites_org_id_code_key" ON "vt_sites"("org_id", "code");

-- CreateIndex
CREATE INDEX "vt_people_org_id_idx" ON "vt_people"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "vt_people_org_id_user_id_key" ON "vt_people"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "vt_investments_org_id_investment_date_idx" ON "vt_investments"("org_id", "investment_date");

-- CreateIndex
CREATE INDEX "vt_investments_site_id_idx" ON "vt_investments"("site_id");

-- CreateIndex
CREATE INDEX "vt_investments_org_id_status_idx" ON "vt_investments"("org_id", "status");

-- CreateIndex
CREATE INDEX "vt_returns_org_id_return_date_idx" ON "vt_returns"("org_id", "return_date");

-- CreateIndex
CREATE INDEX "vt_returns_investment_id_idx" ON "vt_returns"("investment_id");

-- CreateIndex
CREATE INDEX "vt_entries_org_id_entry_date_idx" ON "vt_entries"("org_id", "entry_date");

-- CreateIndex
CREATE INDEX "vt_entries_org_id_kind_payment_status_idx" ON "vt_entries"("org_id", "kind", "payment_status");

-- CreateIndex
CREATE INDEX "vt_entries_site_id_idx" ON "vt_entries"("site_id");

-- CreateIndex
CREATE INDEX "vt_projections_org_id_month_idx" ON "vt_projections"("org_id", "month");

-- CreateIndex
CREATE INDEX "vt_projections_site_id_idx" ON "vt_projections"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "vt_period_closes_org_id_month_key" ON "vt_period_closes"("org_id", "month");

-- AddForeignKey
ALTER TABLE "vt_settings" ADD CONSTRAINT "vt_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_categories" ADD CONSTRAINT "vt_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_audit" ADD CONSTRAINT "vt_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_sites" ADD CONSTRAINT "vt_sites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_sites" ADD CONSTRAINT "vt_sites_mining_type_id_fkey" FOREIGN KEY ("mining_type_id") REFERENCES "vt_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_sites" ADD CONSTRAINT "vt_sites_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "vt_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_people" ADD CONSTRAINT "vt_people_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_people" ADD CONSTRAINT "vt_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_investments" ADD CONSTRAINT "vt_investments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_investments" ADD CONSTRAINT "vt_investments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "vt_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_investments" ADD CONSTRAINT "vt_investments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "vt_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_returns" ADD CONSTRAINT "vt_returns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_returns" ADD CONSTRAINT "vt_returns_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "vt_investments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_entries" ADD CONSTRAINT "vt_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_entries" ADD CONSTRAINT "vt_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "vt_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_entries" ADD CONSTRAINT "vt_entries_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "vt_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_entries" ADD CONSTRAINT "vt_entries_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "vt_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_entries" ADD CONSTRAINT "vt_entries_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "vt_investments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_projections" ADD CONSTRAINT "vt_projections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_projections" ADD CONSTRAINT "vt_projections_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "vt_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_projections" ADD CONSTRAINT "vt_projections_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "vt_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_projections" ADD CONSTRAINT "vt_projections_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "vt_investments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vt_period_closes" ADD CONSTRAINT "vt_period_closes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
