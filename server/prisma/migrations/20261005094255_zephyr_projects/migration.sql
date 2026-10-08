-- AlterTable
ALTER TABLE "zx_settings" ADD COLUMN     "project_seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "zx_projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'client',
    "party_id" UUID,
    "lead_id" UUID,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planning',
    "start_date" DATE,
    "end_date" DATE,
    "contract_value" DECIMAL(16,2),
    "budget" DECIMAL(16,2),
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "manager_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "due_date" DATE,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "percent_done" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "billing_amount" DECIMAL(16,2),
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_work_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "wo_number" TEXT,
    "scope" TEXT NOT NULL,
    "value" DECIMAL(16,2) NOT NULL,
    "billed_to_date" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "issued_on" DATE,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zx_projects_org_id_status_idx" ON "zx_projects"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "zx_projects_org_id_code_key" ON "zx_projects"("org_id", "code");

-- CreateIndex
CREATE INDEX "zx_milestones_project_id_sort_order_idx" ON "zx_milestones"("project_id", "sort_order");

-- CreateIndex
CREATE INDEX "zx_work_orders_project_id_idx" ON "zx_work_orders"("project_id");

-- CreateIndex
CREATE INDEX "zx_work_orders_org_id_vendor_id_idx" ON "zx_work_orders"("org_id", "vendor_id");

-- AddForeignKey
ALTER TABLE "zx_projects" ADD CONSTRAINT "zx_projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_projects" ADD CONSTRAINT "zx_projects_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "zx_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_milestones" ADD CONSTRAINT "zx_milestones_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_milestones" ADD CONSTRAINT "zx_milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "zx_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_work_orders" ADD CONSTRAINT "zx_work_orders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_work_orders" ADD CONSTRAINT "zx_work_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "zx_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_work_orders" ADD CONSTRAINT "zx_work_orders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "zx_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
