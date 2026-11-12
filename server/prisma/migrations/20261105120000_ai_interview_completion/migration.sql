-- AI interview: recording parts (a candidate who returns records a new part), auto-reject note, per-requirement switch. Additive only.
ALTER TABLE "ai_interviews"
  ADD COLUMN IF NOT EXISTS "recording_files" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "auto_rejected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "auto_reject_note" TEXT;

-- Recordings saved before parts existed become part 1.
UPDATE "ai_interviews" SET "recording_files" = jsonb_build_array(jsonb_build_object('name', "recording_path", 'mime', COALESCE("recording_mime", 'video/webm'), 'bytes', "recording_bytes", 'chunks', "recording_chunks")) WHERE "recording_path" IS NOT NULL;

ALTER TABLE "requirements" ADD COLUMN IF NOT EXISTS "ai_interview_enabled" BOOLEAN;
