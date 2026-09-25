-- Superadmin soft-delete: additive columns on the 5 deletable entities + an
-- append-only audit trail. Expand-only, idempotent — safe to re-run.

-- AlterTable: soft-delete columns
ALTER TABLE "accounts"         ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "accounts"         ADD COLUMN IF NOT EXISTS "deleted_by" UUID;
ALTER TABLE "accounts"         ADD COLUMN IF NOT EXISTS "delete_reason" TEXT;

ALTER TABLE "requirements"     ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "requirements"     ADD COLUMN IF NOT EXISTS "deleted_by" UUID;
ALTER TABLE "requirements"     ADD COLUMN IF NOT EXISTS "delete_reason" TEXT;

ALTER TABLE "profiles"         ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "profiles"         ADD COLUMN IF NOT EXISTS "deleted_by" UUID;
ALTER TABLE "profiles"         ADD COLUMN IF NOT EXISTS "delete_reason" TEXT;

ALTER TABLE "submissions"      ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "submissions"      ADD COLUMN IF NOT EXISTS "deleted_by" UUID;
ALTER TABLE "submissions"      ADD COLUMN IF NOT EXISTS "delete_reason" TEXT;

ALTER TABLE "interview_rounds" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "interview_rounds" ADD COLUMN IF NOT EXISTS "deleted_by" UUID;
ALTER TABLE "interview_rounds" ADD COLUMN IF NOT EXISTS "delete_reason" TEXT;

-- CreateIndex: partial-friendly plain index on deleted_at
CREATE INDEX IF NOT EXISTS "accounts_deleted_at_idx"         ON "accounts"("deleted_at");
CREATE INDEX IF NOT EXISTS "requirements_deleted_at_idx"      ON "requirements"("deleted_at");
CREATE INDEX IF NOT EXISTS "profiles_deleted_at_idx"          ON "profiles"("deleted_at");
CREATE INDEX IF NOT EXISTS "submissions_deleted_at_idx"       ON "submissions"("deleted_at");
CREATE INDEX IF NOT EXISTS "interview_rounds_deleted_at_idx"  ON "interview_rounds"("deleted_at");

-- CreateTable: audit_logs
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "actor_id"    UUID NOT NULL,
  "action"      TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id"   UUID NOT NULL,
  "reason"      TEXT NOT NULL,
  "snapshot"    JSONB NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");
