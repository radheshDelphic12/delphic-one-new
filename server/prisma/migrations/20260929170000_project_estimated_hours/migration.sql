-- Hourly projects: the client's approximate monthly hours, used only to show
-- estimated revenue next to actual billing. Additive, nullable.

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "estimated_monthly_hours" DECIMAL(7,2);
