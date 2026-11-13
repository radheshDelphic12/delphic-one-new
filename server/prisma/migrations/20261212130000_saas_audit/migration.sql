-- SaaS launch: audit trail of every platform change (module, dependency, price book, setting, switch, platform admin edits).
-- New table only. The three SaaS switches are stored as rows in the existing saas_settings table (keys 'switch.*'); no row = the environment variable decides.
CREATE TABLE "saas_audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saas_audit_entity_entity_id_idx" ON "saas_audit"("entity", "entity_id");
CREATE INDEX "saas_audit_created_at_idx" ON "saas_audit"("created_at");
