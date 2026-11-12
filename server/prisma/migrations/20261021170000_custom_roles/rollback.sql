-- Memberships fall back to their plain role; nothing else is touched.
ALTER TABLE "org_memberships" DROP CONSTRAINT IF EXISTS "org_memberships_custom_role_id_fkey";
DROP INDEX IF EXISTS "org_memberships_custom_role_id_idx";
ALTER TABLE "org_memberships" DROP COLUMN IF EXISTS "custom_role_id";
DROP TABLE IF EXISTS "custom_roles";
