-- AI interview: 12 role questions and 12 aptitude questions by default. New settings rows get 12 / 12; a company that never changed the old defaults
-- (7 role, 4 aptitude) is moved to 12 / 12; a company that set its own numbers keeps them.
ALTER TABLE "ai_interview_settings" ALTER COLUMN "question_count" SET DEFAULT 12, ALTER COLUMN "aptitude_question_count" SET DEFAULT 12;
UPDATE "ai_interview_settings" SET "question_count" = 12, "aptitude_question_count" = 12 WHERE "question_count" = 7 AND "aptitude_question_count" = 4;
