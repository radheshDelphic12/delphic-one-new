-- Cross-functional teams across the group: a team (name, description) that can span several companies, with members from any of them.
CREATE TABLE "cross_functional_teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "company_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "lead_user_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "cross_functional_teams_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cross_functional_teams_org_group_id_idx" ON "cross_functional_teams"("org_group_id");

CREATE TABLE "cross_functional_team_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_id" UUID,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cross_functional_team_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cross_functional_team_members_team_id_user_id_key" ON "cross_functional_team_members"("team_id", "user_id");
CREATE INDEX "cross_functional_team_members_user_id_idx" ON "cross_functional_team_members"("user_id");
ALTER TABLE "cross_functional_team_members" ADD CONSTRAINT "cross_functional_team_members_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "cross_functional_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
