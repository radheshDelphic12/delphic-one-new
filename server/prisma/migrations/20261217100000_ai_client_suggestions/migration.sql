-- AI client suggestions: companies that could become clients, the service each could take, who to approach. Additive: one new table.
CREATE TABLE "ai_client_suggestions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "company_size" TEXT,
    "location" TEXT,
    "why_fit" TEXT NOT NULL,
    "services" JSONB NOT NULL DEFAULT '[]',
    "decision_makers" JSONB NOT NULL DEFAULT '[]',
    "approach" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "account_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_client_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ai_client_suggestions_org_id_status_idx" ON "ai_client_suggestions"("org_id", "status");
CREATE INDEX "ai_client_suggestions_org_id_batch_id_idx" ON "ai_client_suggestions"("org_id", "batch_id");
