-- The CV a candidate attaches on the public apply form (replaces the "link to your CV" there).
ALTER TABLE "job_applicants"
  ADD COLUMN "cv_file" TEXT,
  ADD COLUMN "cv_file_name" TEXT;
