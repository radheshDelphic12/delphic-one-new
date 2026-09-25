-- Add a third requirement-assignment role: vendor_team. Unlike sales/recruiter,
-- it is not matched against the target user's account role (any active user can
-- be tagged as working the vendor-sourcing side of a requirement).
ALTER TYPE "AssignmentRole" ADD VALUE IF NOT EXISTS 'vendor_team';
