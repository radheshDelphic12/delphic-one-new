-- Employee bank + emergency contact (self-service), project contract end date
-- + hold/completed override, and org-chart team fields (reports-to manager,
-- open positions, display order). Additive only.

-- CreateEnum
CREATE TYPE "ProjectContractStatus" AS ENUM ('on_hold', 'completed');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "agreement_end_date" DATE,
ADD COLUMN     "contract_status" "ProjectContractStatus";

-- AlterTable
ALTER TABLE "org_memberships" ADD COLUMN     "bank_account_holder" TEXT,
ADD COLUMN     "bank_account_number" TEXT,
ADD COLUMN     "bank_branch" TEXT,
ADD COLUMN     "bank_ifsc" TEXT,
ADD COLUMN     "bank_name" TEXT,
ADD COLUMN     "emergency_contact_email" TEXT,
ADD COLUMN     "emergency_contact_name" TEXT,
ADD COLUMN     "emergency_contact_phone" TEXT,
ADD COLUMN     "emergency_contact_relation" TEXT,
ADD COLUMN     "personal_details_updated_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "manager_membership_id" UUID,
ADD COLUMN     "open_positions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_manager_membership_id_fkey" FOREIGN KEY ("manager_membership_id") REFERENCES "org_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

