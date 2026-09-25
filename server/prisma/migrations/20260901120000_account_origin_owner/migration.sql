-- AlterTable: add immutable "brought by" owner. Nullable so the migration is
-- safe on a populated production table (no default backfill lock, no data loss).
ALTER TABLE "accounts" ADD COLUMN "origin_owner_id" UUID;

-- Backfill: every existing account was brought by its current owner.
UPDATE "accounts" SET "origin_owner_id" = "owner_id" WHERE "origin_owner_id" IS NULL;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_origin_owner_id_fkey" FOREIGN KEY ("origin_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "accounts_origin_owner_id_idx" ON "accounts"("origin_owner_id");
