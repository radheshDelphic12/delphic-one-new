-- AI interview: camera / microphone / screen watching (warnings, then the interview ends) and an optional screen share. Additive.
ALTER TABLE "ai_interview_settings" ADD COLUMN "proctoring_enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ai_interview_settings" ADD COLUMN "max_proctor_warnings" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "ai_interview_settings" ADD COLUMN "require_screen_share" BOOLEAN NOT NULL DEFAULT false;
