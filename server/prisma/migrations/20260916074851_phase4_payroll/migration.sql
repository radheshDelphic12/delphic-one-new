-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('draft', 'processed');

-- AlterEnum
ALTER TYPE "DocumentEntityType" ADD VALUE 'payslip';

-- CreateTable
CREATE TABLE "salary_structures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "ctc" DECIMAL(12,2) NOT NULL,
    "components" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'draft',
    "run_at" TIMESTAMP(3),
    "processed_by" UUID,
    "skipped" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "payroll_run_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "deductions" DECIMAL(12,2) NOT NULL,
    "net" DECIMAL(12,2) NOT NULL,
    "breakdown" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_structures_org_id_idx" ON "salary_structures"("org_id");

-- CreateIndex
CREATE INDEX "salary_structures_org_membership_id_effective_from_idx" ON "salary_structures"("org_membership_id", "effective_from");

-- CreateIndex
CREATE INDEX "payroll_runs_org_id_idx" ON "payroll_runs"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_org_id_period_month_period_year_key" ON "payroll_runs"("org_id", "period_month", "period_year");

-- CreateIndex
CREATE INDEX "payslips_org_id_idx" ON "payslips"("org_id");

-- CreateIndex
CREATE INDEX "payslips_org_membership_id_idx" ON "payslips"("org_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_payroll_run_id_org_membership_id_key" ON "payslips"("payroll_run_id", "org_membership_id");

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
