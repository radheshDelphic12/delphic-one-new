-- CreateTable
CREATE TABLE "salary_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "paid_on" DATE NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL,
    "payment_mode" TEXT,
    "transaction_id" TEXT,
    "bank_name" TEXT,
    "notes" TEXT,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_payments_org_id_period_year_period_month_idx" ON "salary_payments"("org_id", "period_year", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "salary_payments_org_membership_id_period_year_period_month_key" ON "salary_payments"("org_membership_id", "period_year", "period_month");

-- AddForeignKey
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
