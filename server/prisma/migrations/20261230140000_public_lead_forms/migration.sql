-- Delphic One: a shareable lead form. Anyone with the link can send their details; each submission becomes a lead (source website).
CREATE TABLE "public_lead_forms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Talk to us',
    "intro" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_lead_forms_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "public_lead_forms_token_key" ON "public_lead_forms"("token");
CREATE INDEX "public_lead_forms_org_id_idx" ON "public_lead_forms"("org_id");
