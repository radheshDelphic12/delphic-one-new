-- The proposed last working day is optional: HR fixes the date on approval.
ALTER TABLE "resignation_requests" ALTER COLUMN "proposed_lwd" DROP NOT NULL;
