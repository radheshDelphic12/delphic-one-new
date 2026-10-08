-- AlterTable
ALTER TABLE "zx_ledger_entries" ADD COLUMN     "property_id" UUID,
ADD COLUMN     "service_type" TEXT,
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "source_type" TEXT,
ADD COLUMN     "unit_id" UUID;

-- AlterTable
ALTER TABLE "zx_projects" ADD COLUMN     "property_id" UUID;

-- AlterTable
ALTER TABLE "zx_settings" ADD COLUMN     "property_prefix" TEXT NOT NULL DEFAULT 'ZP',
ADD COLUMN     "property_seq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "task_prefix" TEXT NOT NULL DEFAULT 'ZT',
ADD COLUMN     "task_seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "zx_properties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "property_type" TEXT NOT NULL DEFAULT 'other',
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "location" TEXT,
    "area_value" DECIMAL(14,2),
    "area_unit" TEXT NOT NULL DEFAULT 'sqft',
    "current_use" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "purchase_date" DATE,
    "purchase_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "brokerage" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "documentation_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "registration_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "construction_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "renovation_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "other_cost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "valuation" DECIMAL(16,2),
    "valuation_date" DATE,
    "valuation_notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_property_units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "building" TEXT,
    "floor" TEXT,
    "unit_type" TEXT,
    "area_value" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'available',
    "ownership" TEXT NOT NULL DEFAULT 'zephyr',
    "allocated_cost" DECIMAL(16,2),
    "valuation" DECIMAL(16,2),
    "valuation_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_property_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_property_loans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "financing_type" TEXT NOT NULL DEFAULT 'bank_loan',
    "lender" TEXT,
    "loan_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "outstanding_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "emi_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "emi_frequency" TEXT NOT NULL DEFAULT 'monthly',
    "interest_rate" DECIMAL(6,3),
    "start_date" DATE,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_property_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_property_valuations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "unit_id" UUID,
    "value" DECIMAL(16,2) NOT NULL,
    "as_of" DATE NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_property_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_property_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "unit_id" UUID,
    "kind" TEXT NOT NULL,
    "event_date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(16,2),
    "notes" TEXT,
    "source_type" TEXT,
    "source_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_property_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "company_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_leases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "monthly_rent" DECIMAL(16,2) NOT NULL,
    "security_deposit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "due_day" INTEGER NOT NULL DEFAULT 1,
    "payment_method" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "ended_on" DATE,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_rent_dues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lease_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "due_date" DATE NOT NULL,
    "paid_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "waived" BOOLEAN NOT NULL DEFAULT false,
    "waived_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_rent_dues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_rent_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "rent_due_id" UUID NOT NULL,
    "lease_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "collected_by_person_id" UUID,
    "notes" TEXT,
    "ledger_entry_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_rent_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_property_sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "unit_id" UUID,
    "buyer_party_id" UUID,
    "sale_value" DECIMAL(16,2) NOT NULL,
    "sale_date" DATE NOT NULL,
    "selling_costs" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cost_basis" DECIMAL(16,2) NOT NULL,
    "realized_profit" DECIMAL(16,2) NOT NULL,
    "holding_days" INTEGER,
    "notes" TEXT,
    "revenue_entry_id" UUID,
    "cost_entry_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_property_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "person_id" UUID,
    "property_id" UUID,
    "unit_id" UUID,
    "project_id" UUID,
    "task_type" TEXT NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(16,2),
    "completed_on" DATE,
    "rent_due_id" UUID,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zx_properties_org_id_status_idx" ON "zx_properties"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "zx_properties_org_id_code_key" ON "zx_properties"("org_id", "code");

-- CreateIndex
CREATE INDEX "zx_property_units_org_id_property_id_idx" ON "zx_property_units"("org_id", "property_id");

-- CreateIndex
CREATE INDEX "zx_property_loans_org_id_property_id_idx" ON "zx_property_loans"("org_id", "property_id");

-- CreateIndex
CREATE INDEX "zx_property_valuations_org_id_property_id_as_of_idx" ON "zx_property_valuations"("org_id", "property_id", "as_of");

-- CreateIndex
CREATE INDEX "zx_property_events_org_id_property_id_event_date_idx" ON "zx_property_events"("org_id", "property_id", "event_date");

-- CreateIndex
CREATE INDEX "zx_tenants_org_id_idx" ON "zx_tenants"("org_id");

-- CreateIndex
CREATE INDEX "zx_leases_org_id_unit_id_idx" ON "zx_leases"("org_id", "unit_id");

-- CreateIndex
CREATE INDEX "zx_leases_org_id_tenant_id_idx" ON "zx_leases"("org_id", "tenant_id");

-- CreateIndex
CREATE INDEX "zx_rent_dues_org_id_period_idx" ON "zx_rent_dues"("org_id", "period");

-- CreateIndex
CREATE INDEX "zx_rent_dues_org_id_property_id_idx" ON "zx_rent_dues"("org_id", "property_id");

-- CreateIndex
CREATE UNIQUE INDEX "zx_rent_dues_lease_id_period_key" ON "zx_rent_dues"("lease_id", "period");

-- CreateIndex
CREATE INDEX "zx_rent_payments_org_id_property_id_paid_on_idx" ON "zx_rent_payments"("org_id", "property_id", "paid_on");

-- CreateIndex
CREATE INDEX "zx_property_sales_org_id_property_id_idx" ON "zx_property_sales"("org_id", "property_id");

-- CreateIndex
CREATE INDEX "zx_property_sales_org_id_sale_date_idx" ON "zx_property_sales"("org_id", "sale_date");

-- CreateIndex
CREATE INDEX "zx_tasks_org_id_status_idx" ON "zx_tasks"("org_id", "status");

-- CreateIndex
CREATE INDEX "zx_tasks_org_id_person_id_idx" ON "zx_tasks"("org_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "zx_tasks_org_id_code_key" ON "zx_tasks"("org_id", "code");

-- CreateIndex
CREATE INDEX "zx_ledger_entries_org_id_property_id_idx" ON "zx_ledger_entries"("org_id", "property_id");

-- CreateIndex
CREATE INDEX "zx_ledger_entries_org_id_source_type_source_id_idx" ON "zx_ledger_entries"("org_id", "source_type", "source_id");

-- AddForeignKey
ALTER TABLE "zx_properties" ADD CONSTRAINT "zx_properties_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_property_units" ADD CONSTRAINT "zx_property_units_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_property_units" ADD CONSTRAINT "zx_property_units_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "zx_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_property_loans" ADD CONSTRAINT "zx_property_loans_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_property_loans" ADD CONSTRAINT "zx_property_loans_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "zx_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_property_valuations" ADD CONSTRAINT "zx_property_valuations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_property_valuations" ADD CONSTRAINT "zx_property_valuations_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "zx_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_property_events" ADD CONSTRAINT "zx_property_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_property_events" ADD CONSTRAINT "zx_property_events_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "zx_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_tenants" ADD CONSTRAINT "zx_tenants_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_leases" ADD CONSTRAINT "zx_leases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_leases" ADD CONSTRAINT "zx_leases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "zx_tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_leases" ADD CONSTRAINT "zx_leases_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "zx_property_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_rent_dues" ADD CONSTRAINT "zx_rent_dues_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_rent_dues" ADD CONSTRAINT "zx_rent_dues_lease_id_fkey" FOREIGN KEY ("lease_id") REFERENCES "zx_leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_rent_payments" ADD CONSTRAINT "zx_rent_payments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_rent_payments" ADD CONSTRAINT "zx_rent_payments_rent_due_id_fkey" FOREIGN KEY ("rent_due_id") REFERENCES "zx_rent_dues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_property_sales" ADD CONSTRAINT "zx_property_sales_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_tasks" ADD CONSTRAINT "zx_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
