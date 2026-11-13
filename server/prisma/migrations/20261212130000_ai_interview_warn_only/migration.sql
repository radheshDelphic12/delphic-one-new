-- The interview is no longer ended after the warnings: they are shown to the candidate and recorded, and the team reviews the recording.
-- 0 = only warn and log. An admin can still set a limit in Hiring Setup.
ALTER TABLE "ai_interview_settings" ALTER COLUMN "max_tab_switches" SET DEFAULT 0;
ALTER TABLE "ai_interview_settings" ALTER COLUMN "max_proctor_warnings" SET DEFAULT 0;
UPDATE "ai_interview_settings" SET "max_tab_switches" = 0, "max_proctor_warnings" = 0;
