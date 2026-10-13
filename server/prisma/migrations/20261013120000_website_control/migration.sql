-- CreateTable
CREATE TABLE "website_job_postings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "requirement_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "department" TEXT,
    "location" TEXT,
    "employment_type" TEXT,
    "public_description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "last_synced_at" TIMESTAMP(3),
    "sync_error" TEXT,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_job_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "form_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "sheet_row" INTEGER,
    "payload" JSONB NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "submitted_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'new',
    "converted_lead_id" UUID,
    "converted_profile_id" UUID,
    "handled_by" UUID,
    "handled_at" TIMESTAMP(3),
    "sheet_status_synced" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "website_job_postings_requirement_id_key" ON "website_job_postings"("requirement_id");

-- CreateIndex
CREATE INDEX "website_job_postings_org_id_status_idx" ON "website_job_postings"("org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "website_submissions_external_id_key" ON "website_submissions"("external_id");

-- CreateIndex
CREATE INDEX "website_submissions_org_id_form_type_status_idx" ON "website_submissions"("org_id", "form_type", "status");

-- CreateIndex
CREATE INDEX "website_submissions_submitted_at_idx" ON "website_submissions"("submitted_at");

-- AddForeignKey
ALTER TABLE "website_job_postings" ADD CONSTRAINT "website_job_postings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_job_postings" ADD CONSTRAINT "website_job_postings_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_submissions" ADD CONSTRAINT "website_submissions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

