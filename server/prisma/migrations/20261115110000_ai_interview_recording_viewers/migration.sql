-- AI interview: people (besides admins) who can open every candidate's recording, chosen by an admin in Hiring setup.
ALTER TABLE "ai_interview_settings" ADD COLUMN "recording_viewer_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
