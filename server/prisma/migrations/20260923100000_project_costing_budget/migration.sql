-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "budget_amount" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "project_member_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "cost_rate_per_hr" DECIMAL(10,2) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_member_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_member_assignments_org_id_idx" ON "project_member_assignments"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_member_assignments_account_id_org_membership_id_key" ON "project_member_assignments"("account_id", "org_membership_id");

-- AddForeignKey
ALTER TABLE "project_member_assignments" ADD CONSTRAINT "project_member_assignments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member_assignments" ADD CONSTRAINT "project_member_assignments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member_assignments" ADD CONSTRAINT "project_member_assignments_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member_assignments" ADD CONSTRAINT "project_member_assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

