-- Salary source per person: 'timesheet' (approved timesheet hours, also null) or 'attendance' (check-in / half day / leave marking).
ALTER TABLE "org_memberships" ADD COLUMN "pay_basis" TEXT;
