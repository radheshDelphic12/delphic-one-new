-- Career applications routed into a requirement applicant pool (additive)
ALTER TABLE "website_submissions" ADD COLUMN "converted_applicant_id" UUID;
