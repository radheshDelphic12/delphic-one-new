-- CreateTable
CREATE TABLE "zx_ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "entry_date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "project_id" UUID,
    "party_id" UUID,
    "work_order_id" UUID,
    "milestone_id" UUID,
    "amount" DECIMAL(16,2) NOT NULL,
    "tax" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'actual',
    "payment_mode" TEXT,
    "reference" TEXT,
    "description" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "project_id" UUID,
    "planned_revenue" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "planned_expense" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "planned_salaries" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_period_closes" (
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

    CONSTRAINT "zx_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zx_ledger_entries_org_id_entry_date_idx" ON "zx_ledger_entries"("org_id", "entry_date");

-- CreateIndex
CREATE INDEX "zx_ledger_entries_org_id_project_id_idx" ON "zx_ledger_entries"("org_id", "project_id");

-- CreateIndex
CREATE INDEX "zx_ledger_entries_org_id_party_id_idx" ON "zx_ledger_entries"("org_id", "party_id");

-- CreateIndex
CREATE INDEX "zx_plans_org_id_month_idx" ON "zx_plans"("org_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "zx_period_closes_org_id_month_key" ON "zx_period_closes"("org_id", "month");

-- AddForeignKey
ALTER TABLE "zx_ledger_entries" ADD CONSTRAINT "zx_ledger_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_ledger_entries" ADD CONSTRAINT "zx_ledger_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "zx_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_ledger_entries" ADD CONSTRAINT "zx_ledger_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "zx_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_ledger_entries" ADD CONSTRAINT "zx_ledger_entries_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "zx_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_ledger_entries" ADD CONSTRAINT "zx_ledger_entries_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "zx_work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_ledger_entries" ADD CONSTRAINT "zx_ledger_entries_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "zx_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_plans" ADD CONSTRAINT "zx_plans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_plans" ADD CONSTRAINT "zx_plans_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "zx_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_period_closes" ADD CONSTRAINT "zx_period_closes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
