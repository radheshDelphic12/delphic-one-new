-- Backfill legacy departments into the first existing tenant before enforcing ownership.
UPDATE "departments"
SET "org_id" = (SELECT "id" FROM "orgs" ORDER BY "created_at" ASC LIMIT 1)
WHERE "org_id" IS NULL;

-- AlterTable
ALTER TABLE "departments" ALTER COLUMN "org_id" SET NOT NULL;
