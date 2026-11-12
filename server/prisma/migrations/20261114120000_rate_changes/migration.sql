-- Rate change history (submission rates, requirement budget). Additive: one new table, no existing row changes.
CREATE TABLE "rate_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" DECIMAL(14,2),
    "new_value" DECIMAL(14,2),
    "currency" TEXT,
    "reason" TEXT,
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rate_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rate_changes_entity_type_entity_id_changed_at_idx" ON "rate_changes"("entity_type", "entity_id", "changed_at");
