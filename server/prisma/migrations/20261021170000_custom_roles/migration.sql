-- Custom roles and permissions. Additive: no existing row changes, memberships keep their plain role until a custom role is assigned.
CREATE TABLE IF NOT EXISTS "custom_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "base_role" "UserRole" NOT NULL DEFAULT 'employee',
  "permissions" JSONB NOT NULL DEFAULT '{}',
  "is_starter" BOOLEAN NOT NULL DEFAULT false,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "custom_roles_org_id_name_key" ON "custom_roles"("org_id", "name");
CREATE INDEX IF NOT EXISTS "custom_roles_org_id_idx" ON "custom_roles"("org_id");
DO $$ BEGIN
  ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "org_memberships" ADD COLUMN IF NOT EXISTS "custom_role_id" UUID;
CREATE INDEX IF NOT EXISTS "org_memberships_custom_role_id_idx" ON "org_memberships"("custom_role_id");
DO $$ BEGIN
  ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_custom_role_id_fkey" FOREIGN KEY ("custom_role_id") REFERENCES "custom_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
