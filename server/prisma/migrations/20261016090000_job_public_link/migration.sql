-- A public link per published job (/careers/<slug>) and where each applicant came from (linkedin, website, ...).
ALTER TABLE "website_job_postings" ADD COLUMN "slug" TEXT;
ALTER TABLE "job_applicants" ADD COLUMN "channel" TEXT;

-- Existing postings get a slug from their title plus the first characters of their id (unique and stable).
UPDATE "website_job_postings"
SET "slug" = LEFT(TRIM(BOTH '-' FROM REGEXP_REPLACE(LOWER("title"), '[^a-z0-9]+', '-', 'g')), 60) || '-' || LEFT("id"::text, 4)
WHERE "slug" IS NULL;

CREATE UNIQUE INDEX "website_job_postings_slug_key" ON "website_job_postings"("slug");
CREATE INDEX "job_applicants_channel_idx" ON "job_applicants"("channel");
