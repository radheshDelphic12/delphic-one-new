-- Phase 3: admin-set leave entitlement, salary-structure edit tracking.
-- Additive only: nullable columns and one nullable foreign key.

-- AlterTable
ALTER TABLE "leave_balances" ADD COLUMN "allocated" DECIMAL(5,1);

-- AlterTable
ALTER TABLE "salary_structures" ADD COLUMN "updated_at" TIMESTAMP(3),
ADD COLUMN "updated_by" UUID;

-- AddForeignKey
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
