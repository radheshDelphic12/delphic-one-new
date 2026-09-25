-- CreateEnum
CREATE TYPE "VendorCommissionStatus" AS ENUM ('pending', 'approved', 'paid', 'rejected');

-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "is_master_workspace" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: Delphic Global is the only workspace that keeps the recruitment/
-- strategic layer (accounts/requirements/profiles/submissions/pipeline,
-- reports, analytics, financials). Every other org defaults to false above.
UPDATE "orgs" SET "is_master_workspace" = true WHERE "slug" = 'delphic';

-- CreateTable
CREATE TABLE "vendor_commissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "vendor_account_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'INR',
    "status" "VendorCommissionStatus" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_commissions_submission_id_key" ON "vendor_commissions"("submission_id");

-- CreateIndex
CREATE INDEX "vendor_commissions_org_id_idx" ON "vendor_commissions"("org_id");

-- CreateIndex
CREATE INDEX "vendor_commissions_vendor_account_id_idx" ON "vendor_commissions"("vendor_account_id");

-- AddForeignKey
ALTER TABLE "vendor_commissions" ADD CONSTRAINT "vendor_commissions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_commissions" ADD CONSTRAINT "vendor_commissions_vendor_account_id_fkey" FOREIGN KEY ("vendor_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_commissions" ADD CONSTRAINT "vendor_commissions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_commissions" ADD CONSTRAINT "vendor_commissions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_commissions" ADD CONSTRAINT "vendor_commissions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
