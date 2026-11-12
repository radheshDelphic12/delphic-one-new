-- AI interview: sharing the entire screen is ON by default (the screen is recorded and watched beside the face), and is switched on for companies
-- that have camera watching on and had left it off. An admin can still turn it off in Hiring Setup > AI interview.
ALTER TABLE "ai_interview_settings" ALTER COLUMN "require_screen_share" SET DEFAULT true;
UPDATE "ai_interview_settings" SET "require_screen_share" = true WHERE "proctoring_enabled" = true AND "require_screen_share" = false;
