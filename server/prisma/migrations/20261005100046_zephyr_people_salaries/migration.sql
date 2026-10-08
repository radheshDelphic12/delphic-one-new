-- AlterTable
ALTER TABLE "zx_people" ADD COLUMN     "designation" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "joining_date" DATE,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'employee',
ADD COLUMN     "leaving_date" DATE,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "pay_basis" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "rate" DECIMAL(14,2),
ADD COLUMN     "vendor_party_id" UUID;

-- CreateTable
CREATE TABLE "zx_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "role" TEXT,
    "from_date" DATE,
    "to_date" DATE,
    "allocation_pct" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_salary_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "pay_basis" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "days" DECIMAL(6,2),
    "gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "project_split" JSONB,
    "paid_on" DATE,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_salary_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zx_assignments_person_id_idx" ON "zx_assignments"("person_id");

-- CreateIndex
CREATE INDEX "zx_assignments_project_id_idx" ON "zx_assignments"("project_id");

-- CreateIndex
CREATE INDEX "zx_salary_records_org_id_month_idx" ON "zx_salary_records"("org_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "zx_salary_records_person_id_month_key" ON "zx_salary_records"("person_id", "month");

-- AddForeignKey
ALTER TABLE "zx_people" ADD CONSTRAINT "zx_people_vendor_party_id_fkey" FOREIGN KEY ("vendor_party_id") REFERENCES "zx_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_assignments" ADD CONSTRAINT "zx_assignments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_assignments" ADD CONSTRAINT "zx_assignments_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "zx_people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_assignments" ADD CONSTRAINT "zx_assignments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "zx_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_salary_records" ADD CONSTRAINT "zx_salary_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_salary_records" ADD CONSTRAINT "zx_salary_records_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "zx_people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
