-- Project Management: releases (versions) and commit tracking. Additive.
CREATE TABLE "pm_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "planned_date" DATE,
    "released_at" TIMESTAMP(3),
    "git_tag" TEXT,
    "commit_sha" TEXT,
    "notes" TEXT,
    "released_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pm_releases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pm_releases_project_id_version_key" ON "pm_releases"("project_id", "version");
CREATE INDEX "pm_releases_org_id_project_id_idx" ON "pm_releases"("org_id", "project_id");
ALTER TABLE "pm_releases" ADD CONSTRAINT "pm_releases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "pm_commits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "release_id" UUID,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "author_name" TEXT,
    "author_email" TEXT,
    "committed_at" TIMESTAMP(3) NOT NULL,
    "branch" TEXT,
    "url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pm_commits_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pm_commits_project_id_sha_key" ON "pm_commits"("project_id", "sha");
CREATE INDEX "pm_commits_project_id_committed_at_idx" ON "pm_commits"("project_id", "committed_at");
CREATE INDEX "pm_commits_release_id_idx" ON "pm_commits"("release_id");
ALTER TABLE "pm_commits" ADD CONSTRAINT "pm_commits_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pm_commits" ADD CONSTRAINT "pm_commits_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "pm_releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "pm_commit_tickets" (
    "commit_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    CONSTRAINT "pm_commit_tickets_pkey" PRIMARY KEY ("commit_id", "ticket_id")
);
CREATE INDEX "pm_commit_tickets_ticket_id_idx" ON "pm_commit_tickets"("ticket_id");
ALTER TABLE "pm_commit_tickets" ADD CONSTRAINT "pm_commit_tickets_commit_id_fkey" FOREIGN KEY ("commit_id") REFERENCES "pm_commits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pm_commit_tickets" ADD CONSTRAINT "pm_commit_tickets_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "pm_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The release a ticket ships in ("fix version").
ALTER TABLE "pm_tickets" ADD COLUMN "release_id" UUID;
CREATE INDEX "pm_tickets_release_id_idx" ON "pm_tickets"("release_id");
ALTER TABLE "pm_tickets" ADD CONSTRAINT "pm_tickets_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "pm_releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
