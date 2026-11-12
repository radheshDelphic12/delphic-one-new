-- CreateTable
CREATE TABLE "zk_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "investment_prefix" TEXT NOT NULL DEFAULT 'ZK',
    "investment_seq" INTEGER NOT NULL DEFAULT 0,
    "opening_balance" DECIMAL(16,2),
    "opening_date" DATE,
    "fy_start_month" INTEGER NOT NULL DEFAULT 4,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zk_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zk_categories" (
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

    CONSTRAINT "zk_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zk_audit" (
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

    CONSTRAINT "zk_audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zk_people" (
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

    CONSTRAINT "zk_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zk_investments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "category_id" UUID,
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

    CONSTRAINT "zk_investments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zk_returns" (
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

    CONSTRAINT "zk_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zk_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "category_id" UUID,
    "person_id" UUID,
    "investment_id" UUID,
    "entry_date" DATE NOT NULL,
    "due_date" DATE,
    "amount" DECIMAL(16,2) NOT NULL,
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

    CONSTRAINT "zk_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zk_projections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "category_id" UUID,
    "investment_id" UUID,
    "amount" DECIMAL(16,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zk_projections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zk_period_closes" (
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

    CONSTRAINT "zk_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zk_settings_org_id_key" ON "zk_settings"("org_id");

-- CreateIndex
CREATE INDEX "zk_categories_org_id_scope_idx" ON "zk_categories"("org_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "zk_categories_org_id_scope_name_key" ON "zk_categories"("org_id", "scope", "name");

-- CreateIndex
CREATE INDEX "zk_audit_org_id_entity_entity_id_idx" ON "zk_audit"("org_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "zk_audit_org_id_created_at_idx" ON "zk_audit"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "zk_people_org_id_idx" ON "zk_people"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "zk_people_org_id_user_id_key" ON "zk_people"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "zk_investments_org_id_investment_date_idx" ON "zk_investments"("org_id", "investment_date");

-- CreateIndex
CREATE INDEX "zk_investments_org_id_status_idx" ON "zk_investments"("org_id", "status");

-- CreateIndex
CREATE INDEX "zk_returns_org_id_return_date_idx" ON "zk_returns"("org_id", "return_date");

-- CreateIndex
CREATE INDEX "zk_returns_investment_id_idx" ON "zk_returns"("investment_id");

-- CreateIndex
CREATE INDEX "zk_entries_org_id_entry_date_idx" ON "zk_entries"("org_id", "entry_date");

-- CreateIndex
CREATE INDEX "zk_entries_org_id_kind_payment_status_idx" ON "zk_entries"("org_id", "kind", "payment_status");

-- CreateIndex
CREATE INDEX "zk_projections_org_id_month_idx" ON "zk_projections"("org_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "zk_period_closes_org_id_month_key" ON "zk_period_closes"("org_id", "month");



-- AddForeignKey
ALTER TABLE "zk_settings" ADD CONSTRAINT "zk_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_categories" ADD CONSTRAINT "zk_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_audit" ADD CONSTRAINT "zk_audit_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_people" ADD CONSTRAINT "zk_people_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_people" ADD CONSTRAINT "zk_people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_investments" ADD CONSTRAINT "zk_investments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_investments" ADD CONSTRAINT "zk_investments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "zk_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_returns" ADD CONSTRAINT "zk_returns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_returns" ADD CONSTRAINT "zk_returns_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "zk_investments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_entries" ADD CONSTRAINT "zk_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_entries" ADD CONSTRAINT "zk_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "zk_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_entries" ADD CONSTRAINT "zk_entries_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "zk_people"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_entries" ADD CONSTRAINT "zk_entries_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "zk_investments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_projections" ADD CONSTRAINT "zk_projections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_projections" ADD CONSTRAINT "zk_projections_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "zk_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_projections" ADD CONSTRAINT "zk_projections_investment_id_fkey" FOREIGN KEY ("investment_id") REFERENCES "zk_investments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zk_period_closes" ADD CONSTRAINT "zk_period_closes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
