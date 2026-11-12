-- AI interview: the candidate must stay in full screen and on one display (admin-editable in Hiring setup; on by default).
ALTER TABLE "ai_interview_settings" ADD COLUMN "require_fullscreen" BOOLEAN NOT NULL DEFAULT true;
