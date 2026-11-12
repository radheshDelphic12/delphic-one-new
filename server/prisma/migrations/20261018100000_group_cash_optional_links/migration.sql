-- Bank accounts and wallets carry their holding group directly, so neither needs a legal entity / bank account to be scoped.
ALTER TABLE "bank_accounts" ADD COLUMN "org_group_id" UUID;
UPDATE "bank_accounts" b SET "org_group_id" = e."org_group_id" FROM "legal_entities" e WHERE e."id" = b."legal_entity_id";
ALTER TABLE "bank_accounts" ALTER COLUMN "org_group_id" SET NOT NULL;
ALTER TABLE "bank_accounts" ALTER COLUMN "legal_entity_id" DROP NOT NULL;

ALTER TABLE "wallets" ADD COLUMN "org_group_id" UUID, ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR';
UPDATE "wallets" w SET "org_group_id" = a."org_group_id", "currency" = a."currency" FROM "bank_accounts" a WHERE a."id" = w."bank_account_id";
ALTER TABLE "wallets" ALTER COLUMN "org_group_id" SET NOT NULL;
ALTER TABLE "wallets" ALTER COLUMN "bank_account_id" DROP NOT NULL;
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currency_check" CHECK ("currency" IN ('INR', 'USD'));

-- a wallet may now have no owner at all
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_one_owner_check";
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_one_owner_check" CHECK ("owner_org_id" IS NULL OR "owner_legal_entity_id" IS NULL);

-- CreateIndex
CREATE INDEX "bank_accounts_org_group_id_idx" ON "bank_accounts"("org_group_id");
CREATE INDEX "wallets_org_group_id_idx" ON "wallets"("org_group_id");
