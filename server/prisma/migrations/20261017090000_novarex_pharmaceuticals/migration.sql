-- CreateTable
CREATE TABLE "nx_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "investment_prefix" TEXT NOT NULL DEFAULT 'NX',
    "investment_seq" INTEGER NOT NULL DEFAULT 0,
    "outlet_prefix" TEXT NOT NULL DEFAULT 'NO',
    "outlet_seq" INTEGER NOT NULL DEFAULT 0,
    "opening_balance" DECIMAL(16,2),
    "opening_date" DATE,
    "fy_start_month" INTEGER NOT NULL DEFAULT 4,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nx_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_audit" (
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

    CONSTRAINT "nx_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_outlets" (
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
    "ownership_type_id" UUID,
    "format_id" UUID,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "gstin" TEXT,
    "drug_licence_no" TEXT,
    "drug_licence_expiry" DATE,
    "legal_entity" TEXT,
    "agreement_ref" TEXT,
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

    CONSTRAINT "nx_outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_people" (
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

    CONSTRAINT "nx_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_investments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "category_id" UUID,
    "outlet_id" UUID,
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

    CONSTRAINT "nx_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_returns" (
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

    CONSTRAINT "nx_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "category_id" UUID,
    "outlet_id" UUID,
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

    CONSTRAINT "nx_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "category_id" UUID,
    "outlet_id" UUID,
    "investment_id" UUID,
    "amount" DECIMAL(16,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "nx_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nx_period_closes" (
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

    CONSTRAINT "nx_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nx_settings_org_id_key" ON "nx_settings"("org_id");

-- CreateIndex
CREATE INDEX "nx_categories_org_id_scope_idx" ON "nx_categories"("org_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "nx_categories_org_id_scope_name_key" ON "nx_categories"("org_id", "scope", "name");

-- CreateIndex
CREATE INDEX "nx_audit_org_id_entity_entity_id_idx" ON "nx_audit"("org_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "nx_audit_org_id_created_at_idx" ON "nx_audit"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "nx_outlets_org_id_status_idx" ON "nx_outlets"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "nx_outlets_org_id_code_key" ON "nx_outlets"("org_id", "code");

-- CreateIndex
CREATE INDEX "nx_people_org_id_idx" ON "nx_people"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "nx_people_org_id_user_id_key" ON "nx_people"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "nx_investments_org_id_investment_date_idx" ON "nx_investments"("org_id", "investment_date");

-- CreateIndex
CREATE INDEX "nx_investments_outlet_id_idx" ON "nx_investments"("outlet_id");

-- CreateIndex
CREATE INDEX "nx_investments_org_id_status_idx" ON "nx_investments"("org_id", "status");

-- CreateIndex
CREATE INDEX "nx_returns_org_id_return_date_idx" ON "nx_returns"("org_id", "return_date");

-- CreateIndex
CREATE INDEX "nx_returns_investment_id_idx" ON "nx_returns"("investment_id");

-- CreateIndex
CREATE INDEX "nx_entries_org_id_entry_date_idx" ON "nx_entries"("org_id", "entry_date");

-- CreateIndex
CREATE INDEX "nx_entries_org_id_kind_payment_status_idx" ON "nx_entries"("org_id", "kind", "payment_status");

-- CreateIndex
CREATE INDEX "nx_entries_outlet_id_idx" ON "nx_entries"("outlet_id");

-- CreateIndex
CREATE INDEX "nx_projections_org_id_month_idx" ON "nx_projections"("org_id", "month");

-- CreateIndex
CREATE INDEX "nx_projections_outlet_id_idx" ON "nx_projections"("outlet_id");

-- CreateIndex
CREATE UNIQUE INDEX "nx_period_closes_org_id_month_key" ON "nx_period_closes"("org_id", "month");

-- AddForeignKey
ALTER TABLE "nx_settings" ADD CONSTRAINT "nx_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_categories" ADD CONSTRAINT "nx_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_audit" ADD CONSTRAINT "nx_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_outlets" ADD CONSTRAINT "nx_outlets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_outlets" ADD CONSTRAINT "nx_outlets_ownership_type_id_fkey" FOREIGN KEY ("ownership_type_id") REFERENCES "nx_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_outlets" ADD CONSTRAINT "nx_outlets_format_id_fkey" FOREIGN KEY ("format_id") REFERENCES "nx_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_people" ADD CONSTRAINT "nx_people_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_people" ADD CONSTRAINT "nx_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_investments" ADD CONSTRAINT "nx_investments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_investments" ADD CONSTRAINT "nx_investments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "nx_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_investments" ADD CONSTRAINT "nx_investments_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "nx_outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_returns" ADD CONSTRAINT "nx_returns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_returns" ADD CONSTRAINT "nx_returns_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "nx_investments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_entries" ADD CONSTRAINT "nx_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_entries" ADD CONSTRAINT "nx_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "nx_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_entries" ADD CONSTRAINT "nx_entries_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "nx_outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_entries" ADD CONSTRAINT "nx_entries_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "nx_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_entries" ADD CONSTRAINT "nx_entries_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "nx_investments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_projections" ADD CONSTRAINT "nx_projections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_projections" ADD CONSTRAINT "nx_projections_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "nx_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_projections" ADD CONSTRAINT "nx_projections_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "nx_outlets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_projections" ADD CONSTRAINT "nx_projections_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "nx_investments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nx_period_closes" ADD CONSTRAINT "nx_period_closes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

