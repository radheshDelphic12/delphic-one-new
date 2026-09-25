-- CreateEnum
CREATE TYPE "LeaveHalfDaySession" AS ENUM ('FIRST_HALF', 'SECOND_HALF');

-- AlterTable
ALTER TABLE "leave_requests"
  ADD COLUMN "is_half_day" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "half_day_session" "LeaveHalfDaySession";

-- Keep non-half-day requests free of a session value.
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_half_day_session_check"
  CHECK ("is_half_day" OR "half_day_session" IS NULL);

-- A half-day request must identify which half of the day it occupies.
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_half_day_requires_session_check"
  CHECK (NOT "is_half_day" OR "half_day_session" IS NOT NULL);
