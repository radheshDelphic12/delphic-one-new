-- CreateTable
CREATE TABLE "org_group_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "org_group_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "org_group_memberships_pkey" PRIMARY KEY ("id")
);

-- Backfill current group superadmins into every existing holding group.
INSERT INTO "org_group_memberships" ("user_id", "org_group_id")
SELECT u."id", g."id"
FROM "users" u CROSS JOIN "org_groups" g
WHERE u."is_group_superadmin" = true;

-- CreateIndex
CREATE UNIQUE INDEX "org_group_memberships_user_id_org_group_id_key"
  ON "org_group_memberships"("user_id", "org_group_id");
CREATE INDEX "org_group_memberships_org_group_id_idx"
  ON "org_group_memberships"("org_group_id");

-- AddForeignKey
ALTER TABLE "org_group_memberships"
  ADD CONSTRAINT "org_group_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "org_group_memberships"
  ADD CONSTRAINT "org_group_memberships_org_group_id_fkey"
  FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
