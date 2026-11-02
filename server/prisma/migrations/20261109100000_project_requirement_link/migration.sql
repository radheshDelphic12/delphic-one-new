-- A project (contract) in Finance > Projects can be linked to the requirement it is for. Additive: one nullable column, its foreign key and an index.
ALTER TABLE "accounts" ADD COLUMN "requirement_id" UUID;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "accounts_requirement_id_idx" ON "accounts"("requirement_id");
