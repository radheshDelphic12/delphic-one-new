-- Phase 0 backfill for databases that pre-date multi-company tenancy (production).
--
-- The next migration (scope_departments_to_org) makes departments.org_id NOT NULL
-- by copying the first org's id into legacy rows, and workspace_isolation later
-- flags slug 'delphic' as the master workspace. Both assume the Delphic org
-- already exists, but until now it was only created by prisma/erp/phase0-backfill.js,
-- which runs after migrations. On a database with existing departments and no org
-- the NOT NULL step fails and the deploy stops.
--
-- This does in SQL what phase0-backfill.js does: create Delphic Group / Delphic
-- Global, give every user a membership, and stamp org_id on legacy rows.
-- It runs only when there are users and no org yet. Staging and local databases
-- already have the org (so the backfill already ran there), and an empty database
-- (CI, a new install) has nothing to backfill.
DO $$
DECLARE
  v_group_id UUID;
  v_org_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM "orgs") OR NOT EXISTS (SELECT 1 FROM "users") THEN
    RETURN;
  END IF;

  INSERT INTO "org_groups" ("name") VALUES ('Delphic Group') RETURNING "id" INTO v_group_id;

  INSERT INTO "orgs" ("org_group_id", "name", "slug", "timezone", "default_currency", "status")
  VALUES (v_group_id, 'Delphic Global', 'delphic', 'Asia/Kolkata', 'INR', 'active')
  RETURNING "id" INTO v_org_id;

  INSERT INTO "org_memberships" ("person_id", "org_id", "role", "department_id", "employment_status")
  SELECT u."id", v_org_id, u."role", u."department_id",
         CASE WHEN u."active" THEN 'active'::"EmploymentStatus" ELSE 'terminated'::"EmploymentStatus" END
  FROM "users" u;

  UPDATE "accounts"                 SET "org_id" = v_org_id WHERE "org_id" IS NULL;
  UPDATE "requirements"             SET "org_id" = v_org_id WHERE "org_id" IS NULL;
  UPDATE "profiles"                 SET "org_id" = v_org_id WHERE "org_id" IS NULL;
  UPDATE "submissions"              SET "org_id" = v_org_id WHERE "org_id" IS NULL;
  UPDATE "interview_rounds"         SET "org_id" = v_org_id WHERE "org_id" IS NULL;
  UPDATE "stage_history"            SET "org_id" = v_org_id WHERE "org_id" IS NULL;
  UPDATE "documents"                SET "org_id" = v_org_id WHERE "org_id" IS NULL;
  UPDATE "comments"                 SET "org_id" = v_org_id WHERE "org_id" IS NULL;
  UPDATE "notifications"            SET "org_id" = v_org_id WHERE "org_id" IS NULL;
  UPDATE "notification_preferences" SET "org_id" = v_org_id WHERE "org_id" IS NULL;
  UPDATE "audit_logs"               SET "org_id" = v_org_id WHERE "org_id" IS NULL;
END $$;
