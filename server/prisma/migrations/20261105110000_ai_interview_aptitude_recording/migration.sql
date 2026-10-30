-- AI interview: AI-written aptitude section, optional audio + video recording with automatic deletion, and the whole feature
-- off by default (an optional, separate link; nothing in the existing flow depends on it). Additive only.
ALTER TABLE "ai_interview_settings"
  ALTER COLUMN "is_enabled" SET DEFAULT false,
  ADD COLUMN IF NOT EXISTS "aptitude_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "aptitude_question_count" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS "weight_aptitude" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "recording_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "recording_retention_days" INTEGER NOT NULL DEFAULT 2;

ALTER TABLE "ai_interviews"
  ADD COLUMN IF NOT EXISTS "recording_on" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "recording_path" TEXT,
  ADD COLUMN IF NOT EXISTS "recording_mime" TEXT,
  ADD COLUMN IF NOT EXISTS "recording_bytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "recording_chunks" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "recording_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recording_deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "ai_interviews_recording_expires_at_idx" ON "ai_interviews"("recording_expires_at");
