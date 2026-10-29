-- Account meeting duration (minutes), editable like other meetings. Additive only.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "meeting_duration_minutes" INTEGER NOT NULL DEFAULT 60;
