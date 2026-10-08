-- Employee notice period start (LWD is notice_end_date) and hourly projects'
-- committed minimum monthly hours. Additive, nullable.

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "minimum_monthly_hours" DECIMAL(7,2);

-- AlterTable
ALTER TABLE "org_memberships" ADD COLUMN     "notice_start_date" DATE;

