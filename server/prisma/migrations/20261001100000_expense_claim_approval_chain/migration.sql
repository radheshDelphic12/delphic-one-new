-- Expense claims: a description (required for the "Other" category), who
-- submitted it (an admin may file for any employee), and the approval chain
-- Manager -> HR -> Finance. Additive only.
CREATE TYPE "ExpenseApprovalStage" AS ENUM ('manager', 'hr', 'finance');

ALTER TABLE "expense_claims" ADD COLUMN "description" TEXT;
ALTER TABLE "expense_claims" ADD COLUMN "submitted_by" UUID;
ALTER TABLE "expense_claims" ADD COLUMN "approval_stage" "ExpenseApprovalStage";
ALTER TABLE "expense_claims" ADD COLUMN "approvals" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Claims already waiting keep their single admin decision: they sit at the
-- last (finance) step rather than being sent back to the manager.
UPDATE "expense_claims" SET "approval_stage" = 'finance' WHERE "status" = 'pending';
