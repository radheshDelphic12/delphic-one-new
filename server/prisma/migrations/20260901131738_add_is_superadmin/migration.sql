-- AlterTable: add the superadmin flag. NOT NULL with a default is safe on a
-- populated table (constant default, no rewrite lock on modern Postgres).
ALTER TABLE "users" ADD COLUMN     "is_superadmin" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: promote the standing root operator. No-op in any environment where
-- that row is absent. Keep in sync with prisma/team-roster.js.
UPDATE "users" SET "is_superadmin" = true WHERE "email" = 'admin@delphic.in';
