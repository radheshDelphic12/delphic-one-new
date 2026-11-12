-- Hiring: whether the test link is e-mailed to the candidate (default off: the recruiter copies the link). Additive only.
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "assessment_email_candidate" BOOLEAN NOT NULL DEFAULT false;
