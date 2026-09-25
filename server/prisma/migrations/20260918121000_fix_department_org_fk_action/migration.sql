-- Metadata-only: aligns the FK's ON UPDATE action with Prisma's default for
-- a required relation, left mismatched by the earlier org_id NOT NULL migration.
ALTER TABLE "departments" DROP CONSTRAINT "departments_org_id_fkey";
ALTER TABLE "departments" ADD CONSTRAINT "departments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
