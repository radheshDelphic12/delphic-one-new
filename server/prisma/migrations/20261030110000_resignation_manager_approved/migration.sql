-- A resignation the reporting manager approved after the meeting and sent on to HR. Additive only.
ALTER TYPE "ResignationStatus" ADD VALUE IF NOT EXISTS 'manager_approved';
