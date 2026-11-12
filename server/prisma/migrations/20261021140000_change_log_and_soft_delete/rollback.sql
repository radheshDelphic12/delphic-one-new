-- Not run by Prisma. Undo of migration.sql (soft-deleted rows would become visible again after the columns go: restore or purge them first).
ALTER TABLE "client_invoices" DROP COLUMN IF EXISTS "delete_reason", DROP COLUMN IF EXISTS "deleted_by", DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "expense_claims" DROP COLUMN IF EXISTS "delete_reason", DROP COLUMN IF EXISTS "deleted_by", DROP COLUMN IF EXISTS "deleted_at";
ALTER TABLE "org_memberships" DROP COLUMN IF EXISTS "delete_reason", DROP COLUMN IF EXISTS "deleted_by", DROP COLUMN IF EXISTS "deleted_at";
DROP TABLE IF EXISTS "change_logs";
