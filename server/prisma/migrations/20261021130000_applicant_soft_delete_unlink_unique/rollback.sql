-- Not run by Prisma. Undo of migration.sql (nothing else depends on these columns).
DROP INDEX IF EXISTS "job_applicants_requirement_id_dedupe_key_key";
ALTER TABLE "job_applicants" DROP COLUMN IF EXISTS "dedupe_key";
ALTER TABLE "job_applicants" DROP COLUMN IF EXISTS "unlinked_at";
ALTER TABLE "job_applicants" DROP COLUMN IF EXISTS "delete_reason";
ALTER TABLE "job_applicants" DROP COLUMN IF EXISTS "deleted_by";
ALTER TABLE "job_applicants" DROP COLUMN IF EXISTS "deleted_at";
