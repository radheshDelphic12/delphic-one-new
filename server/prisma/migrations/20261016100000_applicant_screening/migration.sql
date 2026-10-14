-- Screening answers a candidate gives when applying (notice period, CTC, joiner status, work mode, ...), so recruiters can filter the pool.
-- Old applicants simply keep these empty.
ALTER TABLE "job_applicants"
  ADD COLUMN "linkedin_url" TEXT,
  ADD COLUMN "cv_url" TEXT,
  ADD COLUMN "currently_working" BOOLEAN,
  ADD COLUMN "joiner_status" TEXT,
  ADD COLUMN "notice_period_days" INTEGER,
  ADD COLUMN "last_working_day" DATE,
  ADD COLUMN "current_ctc_lpa" DECIMAL(7,2),
  ADD COLUMN "expected_ctc_lpa" DECIMAL(7,2),
  ADD COLUMN "work_mode" TEXT,
  ADD COLUMN "extra_skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "job_applicants_joiner_status_idx" ON "job_applicants"("joiner_status");
