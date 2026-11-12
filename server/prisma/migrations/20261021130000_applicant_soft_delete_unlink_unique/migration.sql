-- Applicants: soft delete, "unlink from job", and one application per (email, requirement) enforced by the database.
ALTER TABLE "job_applicants" ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "job_applicants" ADD COLUMN "deleted_by" UUID;
ALTER TABLE "job_applicants" ADD COLUMN "delete_reason" TEXT;
ALTER TABLE "job_applicants" ADD COLUMN "unlinked_at" TIMESTAMP(3);
ALTER TABLE "job_applicants" ADD COLUMN "dedupe_key" TEXT;

-- Backfill: the OLDEST application of a person on a requirement gets the key; any later duplicate of the same email on
-- the same requirement keeps a NULL key, so nothing is deleted or merged and the unique index below can always be built.
-- (Run `npm run applicants:duplicates` before deploying to see which rows those are.)
UPDATE "job_applicants" a
SET "dedupe_key" = lower(btrim(a."email"))
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "requirement_id", lower(btrim("email")) ORDER BY "applied_at", "id") AS rn
  FROM "job_applicants"
  WHERE "email" IS NOT NULL AND btrim("email") <> ''
) r
WHERE a."id" = r."id" AND r.rn = 1;

CREATE UNIQUE INDEX "job_applicants_requirement_id_dedupe_key_key" ON "job_applicants"("requirement_id", "dedupe_key");
