-- Leave: a separate, admin-edited mailing list that is mailed (with the reporting manager) when someone applies for leave.
ALTER TABLE "orgs" ADD COLUMN "leave_mailing_list" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
