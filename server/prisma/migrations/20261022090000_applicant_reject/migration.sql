-- Applicants: "Reject" at screening. A rejected applicant leaves the Pool / My candidates / All lists and is listed under Rejected.
-- Additive and nullable: nothing existing changes (status is a plain text column, so the new value "rejected" needs no type change).
ALTER TABLE "job_applicants" ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3);
ALTER TABLE "job_applicants" ADD COLUMN IF NOT EXISTS "rejected_by" UUID;
ALTER TABLE "job_applicants" ADD COLUMN IF NOT EXISTS "reject_reason" TEXT;
