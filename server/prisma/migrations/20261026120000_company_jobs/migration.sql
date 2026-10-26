-- Career portals for the companies other than Delphic Global: their own jobs and the applications that come in.
CREATE TABLE "company_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "job_code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "location" TEXT,
    "employment_kind" "JobEmploymentKind",
    "employment_type" TEXT,
    "openings" INTEGER,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "company_jobs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "company_jobs_slug_key" ON "company_jobs"("slug");
CREATE UNIQUE INDEX "company_jobs_org_id_job_code_key" ON "company_jobs"("org_id", "job_code");
CREATE INDEX "company_jobs_org_id_status_idx" ON "company_jobs"("org_id", "status");
ALTER TABLE "company_jobs" ADD CONSTRAINT "company_jobs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "company_job_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "experience_years" DECIMAL(4,1),
    "cv_url" TEXT,
    "linkedin_url" TEXT,
    "message" TEXT,
    "channel" TEXT,
    "referred_by" TEXT,
    "answers" JSONB,
    "status" TEXT NOT NULL DEFAULT 'new',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "company_job_applications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "company_job_applications_org_id_job_id_status_idx" ON "company_job_applications"("org_id", "job_id", "status");
CREATE INDEX "company_job_applications_org_id_created_at_idx" ON "company_job_applications"("org_id", "created_at");
CREATE INDEX "company_job_applications_job_id_email_idx" ON "company_job_applications"("job_id", "email");
ALTER TABLE "company_job_applications" ADD CONSTRAINT "company_job_applications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_job_applications" ADD CONSTRAINT "company_job_applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "company_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
