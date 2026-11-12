-- Marks the existing automatic entries as `auto`. Only rows that are certainly the job's own are touched:
-- written by the job (reason 'auto_daily'), never by a person (no regularised_by), never a real check-in/out.
-- Manual and regularised entries keep source 'manual'. The reason column is left exactly as it was.
-- Reversible: rollback.sql in this folder puts them back (they were all 'manual' before).
UPDATE "attendance_records"
SET "source" = 'auto'
WHERE "source" = 'manual'
  AND "regularized_reason" = 'auto_daily'
  AND "regularized_by" IS NULL
  AND "check_in_at" IS NULL
  AND "check_out_at" IS NULL;
