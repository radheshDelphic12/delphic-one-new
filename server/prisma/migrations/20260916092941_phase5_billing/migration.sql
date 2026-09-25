-- CreateEnum
CREATE TYPE "BillingRateType" AS ENUM ('hourly', 'monthly');

-- CreateEnum
CREATE TYPE "ClientInvoiceStatus" AS ENUM ('draft', 'sent', 'paid');

-- CreateTable
CREATE TABLE "billing_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "requirement_id" UUID,
    "rate_type" "BillingRateType" NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "effective_from" DATE NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_project_revenues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "requirement_id" UUID,
    "date" DATE NOT NULL,
    "billable_hours" DECIMAL(6,2) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_project_revenues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "client_account_id" UUID NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "status" "ClientInvoiceStatus" NOT NULL DEFAULT 'draft',
    "line_items" JSONB NOT NULL,
    "sent_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_billing_charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "raised_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_billing_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billing_rates_org_id_idx" ON "billing_rates"("org_id");

-- CreateIndex
CREATE INDEX "billing_rates_account_id_requirement_id_effective_from_idx" ON "billing_rates"("account_id", "requirement_id", "effective_from");

-- CreateIndex
CREATE INDEX "daily_project_revenues_org_id_date_idx" ON "daily_project_revenues"("org_id", "date");

-- CreateIndex
CREATE INDEX "daily_project_revenues_account_id_requirement_id_date_idx" ON "daily_project_revenues"("account_id", "requirement_id", "date");

-- CreateIndex
CREATE INDEX "client_invoices_org_id_idx" ON "client_invoices"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_invoices_client_account_id_period_month_period_year_key" ON "client_invoices"("client_account_id", "period_month", "period_year");

-- CreateIndex
CREATE INDEX "group_billing_charges_org_group_id_idx" ON "group_billing_charges"("org_group_id");

-- CreateIndex
CREATE INDEX "group_billing_charges_org_id_period_month_period_year_idx" ON "group_billing_charges"("org_id", "period_month", "period_year");

-- AddForeignKey
ALTER TABLE "billing_rates" ADD CONSTRAINT "billing_rates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rates" ADD CONSTRAINT "billing_rates_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rates" ADD CONSTRAINT "billing_rates_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_rates" ADD CONSTRAINT "billing_rates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_project_revenues" ADD CONSTRAINT "daily_project_revenues_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_project_revenues" ADD CONSTRAINT "daily_project_revenues_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_project_revenues" ADD CONSTRAINT "daily_project_revenues_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_client_account_id_fkey" FOREIGN KEY ("client_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_invoices" ADD CONSTRAINT "client_invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_billing_charges" ADD CONSTRAINT "group_billing_charges_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_billing_charges" ADD CONSTRAINT "group_billing_charges_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_billing_charges" ADD CONSTRAINT "group_billing_charges_raised_by_fkey" FOREIGN KEY ("raised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
