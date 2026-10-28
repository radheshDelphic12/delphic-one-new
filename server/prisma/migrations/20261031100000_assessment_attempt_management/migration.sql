-- Test link management: one live attempt per submission + round, admin delete / retake, an attempt limit per submission.
-- Additive only; existing attempts keep working.
ALTER TABLE "assessment_attempts"
  ADD COLUMN IF NOT EXISTS "template_round_id" UUID,
  ADD COLUMN IF NOT EXISTS "superseded_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by" UUID;

CREATE INDEX IF NOT EXISTS "assessment_attempts_submission_id_template_round_id_idx" ON "assessment_attempts"("submission_id", "template_round_id");

-- Max tests that can be sent per submission (0 = no limit). Admin editable (Hiring setup > Tests).
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "assessment_max_attempts" INTEGER NOT NULL DEFAULT 3;

-- Tie existing attempts to the screening round of their requirement's template.
UPDATE "assessment_attempts" a
SET "template_round_id" = (
  SELECT tr."id"
  FROM "submissions" s
  JOIN "requirement_seats" rs ON rs."id" = s."requirement_seat_id"
  JOIN "requirements" r ON r."id" = rs."requirement_id"
  JOIN "interview_template_rounds" tr ON tr."template_id" = r."interview_template_id" AND tr."kind" = 'screening_test'
  WHERE s."id" = a."submission_id"
  ORDER BY tr."sort_order"
  LIMIT 1
)
WHERE a."template_round_id" IS NULL AND a."submission_id" IS NOT NULL;

-- Old duplicates: an unopened link that a newer link replaced is retired (kept for the record, no longer live).
-- Opened and scored attempts are never touched here; an admin can delete those by hand.
UPDATE "assessment_attempts" a
SET "superseded_at" = NOW()
WHERE a."status" = 'invited'
  AND a."submission_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "assessment_attempts" b
    WHERE b."submission_id" = a."submission_id" AND b."invited_at" > a."invited_at"
  );
