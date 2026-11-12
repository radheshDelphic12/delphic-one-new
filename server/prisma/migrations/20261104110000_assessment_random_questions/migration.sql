-- Assessment tests: give each candidate a random, shuffled subset of the test's questions. Additive and nullable (null = every question, as before).
ALTER TABLE "assessment_tests" ADD COLUMN IF NOT EXISTS "questions_per_candidate" INTEGER;
ALTER TABLE "assessment_attempts" ADD COLUMN IF NOT EXISTS "question_ids" JSONB;
