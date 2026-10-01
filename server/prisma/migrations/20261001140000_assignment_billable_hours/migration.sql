-- Client / project timesheet: hours a day a person can bill on a project (default 8).
ALTER TABLE "project_member_assignments" ADD COLUMN "billable_hours_per_day" DECIMAL(4,2) NOT NULL DEFAULT 8;
