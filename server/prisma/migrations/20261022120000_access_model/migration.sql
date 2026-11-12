-- Roles & permissions restructure (docs/features/ROLES-PERMISSIONS-RESTRUCTURE.md). Additive only: no DROP, no rewrite of existing rows.
-- Every company starts in access_mode 'legacy' (exactly today's behaviour); the Super Admin flips one company at a time.
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "access_mode" TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "access_applied_at" TIMESTAMP(3);
ALTER TABLE "orgs" ADD COLUMN IF NOT EXISTS "access_applied_by" UUID;

ALTER TABLE "org_memberships" ADD COLUMN IF NOT EXISTS "legacy_role" "UserRole";
ALTER TABLE "org_memberships" ADD COLUMN IF NOT EXISTS "legacy_custom_role_id" UUID;
ALTER TABLE "org_memberships" ADD COLUMN IF NOT EXISTS "legacy_was_superadmin" BOOLEAN;
ALTER TABLE "org_memberships" ADD COLUMN IF NOT EXISTS "legacy_locked_until" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "permission_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'true',
    "effect" TEXT NOT NULL DEFAULT 'grant',
    "label" TEXT,
    "granted_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permission_grants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "permission_grants_org_membership_id_key_key" ON "permission_grants"("org_membership_id", "key");
CREATE INDEX IF NOT EXISTS "permission_grants_org_id_idx" ON "permission_grants"("org_id");
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "access_backups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "taken_by" UUID,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "access_backups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "access_backups_org_id_idx" ON "access_backups"("org_id");
ALTER TABLE "access_backups" ADD CONSTRAINT "access_backups_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
