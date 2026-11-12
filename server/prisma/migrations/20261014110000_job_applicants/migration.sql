-- Applicant pool for requirements (additive)
CREATE TABLE "job_applicants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirement_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "experience_years" DECIMAL(4,1),
    "source" TEXT NOT NULL DEFAULT 'website',
    "status" TEXT NOT NULL DEFAULT 'new',
    "assigned_to" UUID,
    "assigned_at" TIMESTAMP(3),
    "profile_id" UUID,
    "notes" TEXT,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_applicants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_applicants_requirement_id_status_idx" ON "job_applicants"("requirement_id", "status");
CREATE INDEX "job_applicants_assigned_to_idx" ON "job_applicants"("assigned_to");

ALTER TABLE "job_applicants" ADD CONSTRAINT "job_applicants_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
