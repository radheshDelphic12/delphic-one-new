-- Adds the explicit `auto` source for the entries the daily "present" job creates.
-- Additive: nothing existing changes. (Postgres cannot use a new enum value in the same transaction that adds it,
-- so the backfill is the next migration.)
ALTER TYPE "AttendanceSource" ADD VALUE IF NOT EXISTS 'auto';
