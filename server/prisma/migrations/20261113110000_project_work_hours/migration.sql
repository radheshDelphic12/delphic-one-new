-- Project working hours (HH:MM), for reporting and the 24-hour day schedule only. Additive; no existing row changes.
ALTER TABLE "accounts" ADD COLUMN "work_start_time" TEXT, ADD COLUMN "work_end_time" TEXT;
