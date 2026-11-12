-- Group-wide change log + soft delete (restorable) for employees, expense claims and invoices. Additive only.
CREATE TABLE "change_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID,
    "actor_id" UUID,
    "actor_name" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "entity_label" TEXT,
    "context_id" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "change_logs_org_id_created_at_idx" ON "change_logs"("org_id", "created_at");
CREATE INDEX "change_logs_entity_type_entity_id_idx" ON "change_logs"("entity_type", "entity_id");
CREATE INDEX "change_logs_context_id_idx" ON "change_logs"("context_id");
CREATE INDEX "change_logs_actor_id_idx" ON "change_logs"("actor_id");
CREATE INDEX "change_logs_created_at_idx" ON "change_logs"("created_at");

ALTER TABLE "org_memberships" ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" UUID, ADD COLUMN "delete_reason" TEXT;
ALTER TABLE "expense_claims" ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" UUID, ADD COLUMN "delete_reason" TEXT;
ALTER TABLE "client_invoices" ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" UUID, ADD COLUMN "delete_reason" TEXT;
