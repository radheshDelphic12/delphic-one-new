-- Job IDs, referral tracking and job data clean-up. Additive only: no column or table is dropped or retyped.

-- 1. Job ID ("DLP-0001"): a sequence-backed default, so every insert path gets one. Existing postings are numbered by age.
CREATE SEQUENCE IF NOT EXISTS "website_job_code_seq" START 1;
ALTER TABLE "website_job_postings" ADD COLUMN "job_code" TEXT;

WITH ordered AS (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS n FROM "website_job_postings"
)
UPDATE "website_job_postings" p
SET "job_code" = 'DLP-' || LPAD(o.n::text, 4, '0')
FROM ordered o
WHERE p."id" = o."id";

-- the next new job continues after the last backfilled one (an empty table starts at 1)
SELECT SETVAL('website_job_code_seq', GREATEST((SELECT COUNT(*) FROM "website_job_postings"), 1), (SELECT COUNT(*) FROM "website_job_postings") > 0);

ALTER TABLE "website_job_postings" ALTER COLUMN "job_code" SET DEFAULT ('DLP-'::text || LPAD((NEXTVAL('website_job_code_seq'::regclass))::text, 4, '0'::text));
ALTER TABLE "website_job_postings" ALTER COLUMN "job_code" SET NOT NULL;
CREATE UNIQUE INDEX "website_job_postings_job_code_key" ON "website_job_postings"("job_code");

-- A Job ID never changes once given.
CREATE OR REPLACE FUNCTION "website_job_code_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."job_code" IS DISTINCT FROM OLD."job_code" THEN
    RAISE EXCEPTION 'job_code is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "website_job_code_immutable" BEFORE UPDATE ON "website_job_postings"
  FOR EACH ROW EXECUTE FUNCTION "website_job_code_immutable"();

-- 2. Employment type as an enum (new column; the old text column stays and carries the display label).
CREATE TYPE "JobEmploymentKind" AS ENUM ('full_time', 'part_time', 'contract', 'internship');
ALTER TABLE "website_job_postings" ADD COLUMN "employment_kind" "JobEmploymentKind";

UPDATE "website_job_postings"
SET "employment_kind" = (CASE
  WHEN "employment_type" ~* 'part' THEN 'part_time'
  WHEN "employment_type" ~* '(contract|temp|freelanc|consult)' THEN 'contract'
  WHEN "employment_type" ~* 'intern' THEN 'internship'
  WHEN "employment_type" ~* '(full|perm)' THEN 'full_time'
END)::"JobEmploymentKind"
WHERE "employment_type" IS NOT NULL AND BTRIM("employment_type") <> '';

-- a posting without any type takes the one of its requirement
UPDATE "website_job_postings" p
SET "employment_kind" = r."engagement_type"::text::"JobEmploymentKind"
FROM "requirements" r
WHERE r."id" = p."requirement_id" AND p."employment_kind" IS NULL AND r."engagement_type" IS NOT NULL;

UPDATE "website_job_postings"
SET "employment_type" = CASE "employment_kind"
  WHEN 'full_time' THEN 'Full-time'
  WHEN 'part_time' THEN 'Part-time'
  WHEN 'contract' THEN 'Contract'
  WHEN 'internship' THEN 'Internship'
END
WHERE "employment_kind" IS NOT NULL;

-- 3. Department is required: take the requirement's, else "General" (an admin can change it from the listing).
UPDATE "website_job_postings" p
SET "department" = BTRIM(r."department")
FROM "requirements" r
WHERE r."id" = p."requirement_id" AND (p."department" IS NULL OR BTRIM(p."department") = '') AND r."department" IS NOT NULL AND BTRIM(r."department") <> '';
UPDATE "website_job_postings" SET "department" = 'General' WHERE "department" IS NULL OR BTRIM("department") = '';

-- 4. Titles: no trailing punctuation, no ALL-CAPS titles (known acronyms stay upper case).
UPDATE "website_job_postings"
SET "title" = BTRIM(REGEXP_REPLACE("title", '[[:space:].,;:!–—-]+$', ''))
WHERE "title" ~ '[[:space:].,;:!–—-]+$';

CREATE TEMP TABLE "_caps_titles" AS
  SELECT "id" FROM "website_job_postings" WHERE "title" = UPPER("title") AND "title" ~ '[A-Z]{3,}';
UPDATE "website_job_postings" SET "title" = INITCAP(LOWER("title")) WHERE "id" IN (SELECT "id" FROM "_caps_titles");
DO $$
DECLARE a text;
BEGIN
  FOREACH a IN ARRAY ARRAY['AI','ML','QA','HR','IT','UI','UX','SQL','API','SAP','ERP','CRM','BI','SEO','SDET','AWS','ETL','RPA','CTO','CFO','CEO','VP','iOS','PHP','DBA','SRE','GCP','SaaS','DevOps','QC','PMO','BPO','KYC','AML']
  LOOP
    UPDATE "website_job_postings"
    SET "title" = REGEXP_REPLACE("title", '\y' || INITCAP(LOWER(a)) || '\y', a, 'g')
    WHERE "id" IN (SELECT "id" FROM "_caps_titles") AND "title" ~ ('\y' || INITCAP(LOWER(a)) || '\y');
  END LOOP;
END $$;
DROP TABLE "_caps_titles";

CREATE INDEX "website_job_postings_org_id_status_created_at_idx" ON "website_job_postings"("org_id", "status", "created_at");

-- 5. Referral tracking on applications (nullable: every older application is simply "Direct").
ALTER TABLE "job_applicants" ADD COLUMN "referrer_id" UUID;
ALTER TABLE "job_applicants" ADD COLUMN "referrer_name" TEXT;
ALTER TABLE "job_applicants" ADD COLUMN "referrer_code" TEXT;
ALTER TABLE "job_applicants" ADD COLUMN "referrer_text" TEXT;
CREATE INDEX "job_applicants_referrer_id_idx" ON "job_applicants"("referrer_id");

-- Referrals made before this release: the employee who referred is the row's creator.
UPDATE "job_applicants" a
SET "referrer_id" = a."created_by", "referrer_name" = u."name"
FROM "users" u
WHERE a."source" = 'referral' AND a."created_by" = u."id" AND a."referrer_id" IS NULL;
