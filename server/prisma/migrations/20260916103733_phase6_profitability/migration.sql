-- CreateTable
CREATE TABLE "daily_employee_profitability" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "cost" DECIMAL(12,2) NOT NULL,
    "margin" DECIMAL(12,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_employee_profitability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_employee_profitability_org_id_date_idx" ON "daily_employee_profitability"("org_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_employee_profitability_org_membership_id_date_key" ON "daily_employee_profitability"("org_membership_id", "date");

-- AddForeignKey
ALTER TABLE "daily_employee_profitability" ADD CONSTRAINT "daily_employee_profitability_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_employee_profitability" ADD CONSTRAINT "daily_employee_profitability_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
