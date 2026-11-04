-- Group Debt: a loan can be against a Zephyr property or a Gulati / Acconcy deal of the borrowing company, so that company shows it too.
ALTER TABLE "group_loans" ADD COLUMN "linked_type" TEXT, ADD COLUMN "linked_id" UUID;
CREATE INDEX "group_loans_linked_type_linked_id_idx" ON "group_loans"("linked_type", "linked_id");
