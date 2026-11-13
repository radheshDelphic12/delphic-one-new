-- SaaS launch: SOFT delete of customers (nothing is ever physically removed). Additive columns, one widened status check, and a record of exactly what a
-- delete changed so a restore can put back the same state.

ALTER TABLE "dox_customers" ADD COLUMN "deleted_by" UUID;
ALTER TABLE "dox_customers" ADD COLUMN "deleted_reason" TEXT;

ALTER TABLE "saas_customers" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "saas_customers" ADD COLUMN "deleted_by" UUID;
ALTER TABLE "saas_customers" ADD COLUMN "deleted_reason" TEXT;
ALTER TABLE "saas_customers" DROP CONSTRAINT "saas_customers_status_check";
ALTER TABLE "saas_customers" ADD CONSTRAINT "saas_customers_status_check" CHECK ("status" IN ('trial', 'active', 'read_only', 'suspended', 'churned', 'deleted'));

-- One row per delete: who, when, what was changed (customer status, company status, users deactivated) and, once restored, who restored it.
CREATE TABLE "saas_customer_deletions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "dox_customer_id" UUID,
    "saas_customer_id" UUID,
    "deleted_by" UUID,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "counts" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "restored_at" TIMESTAMP(3),
    "restored_by" UUID,
    CONSTRAINT "saas_customer_deletions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saas_customer_deletions_dox_customer_id_idx" ON "saas_customer_deletions"("dox_customer_id");
CREATE INDEX "saas_customer_deletions_saas_customer_id_idx" ON "saas_customer_deletions"("saas_customer_id");
