-- Aadhaar and PAN printed on the payslip (employee-editable, like the bank details).
ALTER TABLE "org_memberships" ADD COLUMN "aadhaar_number" TEXT,
ADD COLUMN "pan_number" TEXT;
