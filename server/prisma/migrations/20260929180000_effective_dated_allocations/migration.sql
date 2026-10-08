-- People: effective-dated project allocations, team membership history and
-- configurable project capacity. Existing allocations become open-ended
-- periods (start/end null = "always"), so no past calculation changes.

-- Org / team capacity per resource
ALTER TABLE "orgs" ADD COLUMN "projects_per_resource" DECIMAL(4,2) NOT NULL DEFAULT 1.5;
ALTER TABLE "teams" ADD COLUMN "projects_per_resource" DECIMAL(4,2);

-- Allocation periods (a person may now hold several periods on one project)
ALTER TABLE "project_member_assignments" ADD COLUMN "start_date" DATE, ADD COLUMN "end_date" DATE;
DROP INDEX IF EXISTS "project_member_assignments_account_id_org_membership_id_key";
CREATE INDEX "project_member_assignments_account_id_org_membership_id_idx" ON "project_member_assignments"("account_id", "org_membership_id");
CREATE INDEX "project_member_assignments_org_membership_id_start_date_idx" ON "project_member_assignments"("org_membership_id", "start_date");

-- Team membership history
CREATE TABLE "team_membership_periods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_membership_periods_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "team_membership_periods_org_id_team_id_idx" ON "team_membership_periods"("org_id", "team_id");
CREATE INDEX "team_membership_periods_org_membership_id_idx" ON "team_membership_periods"("org_membership_id");
ALTER TABLE "team_membership_periods" ADD CONSTRAINT "team_membership_periods_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_membership_periods" ADD CONSTRAINT "team_membership_periods_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_membership_periods" ADD CONSTRAINT "team_membership_periods_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Everyone currently on a team gets an open period (history starts now).
INSERT INTO "team_membership_periods" ("org_id", "org_membership_id", "team_id")
SELECT "org_id", "id", "team_id" FROM "org_memberships" WHERE "team_id" IS NOT NULL;
