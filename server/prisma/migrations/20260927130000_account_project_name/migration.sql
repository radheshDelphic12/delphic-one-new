-- Project name separate from the account name: Finance renames a project by
-- writing project_name, never accounts.name, so editing a project can't rename
-- a client account (or the client name every linked project shows). Additive
-- and nullable — null means "same as the account name".

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "project_name" TEXT;
