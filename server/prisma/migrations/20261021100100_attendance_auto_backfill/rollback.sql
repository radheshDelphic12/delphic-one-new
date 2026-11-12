-- Not run by Prisma. Undo of migration.sql: every 'auto' row was a 'manual' row before it (the job wrote 'manual').
-- The `auto` enum value itself can stay; Postgres cannot drop an enum value, and nothing needs it gone.
UPDATE "attendance_records" SET "source" = 'manual' WHERE "source" = 'auto';
