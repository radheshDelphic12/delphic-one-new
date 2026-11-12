-- Project Management: which release is on which environment (dev / beta / prod). Additive.
CREATE TABLE "pm_deployments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'deployed',
    "deployed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commit_sha" TEXT,
    "note" TEXT,
    "deployed_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pm_deployments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pm_deployments_project_id_environment_deployed_at_idx" ON "pm_deployments"("project_id", "environment", "deployed_at");
CREATE INDEX "pm_deployments_release_id_idx" ON "pm_deployments"("release_id");
ALTER TABLE "pm_deployments" ADD CONSTRAINT "pm_deployments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pm_deployments" ADD CONSTRAINT "pm_deployments_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "pm_releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
