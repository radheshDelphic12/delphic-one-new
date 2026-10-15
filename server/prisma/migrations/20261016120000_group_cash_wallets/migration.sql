-- Group cash: legal entities, bank accounts, wallets, transactions, transfers, reconciliations. Additive only.
-- CreateTable
CREATE TABLE "legal_entities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "workspace_id" UUID,
    "name" TEXT NOT NULL,
    "gstin" TEXT,
    "pan" TEXT,
    "address" TEXT,
    "invoice_prefix" TEXT,
    "logo_url" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "legal_entity_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bank_name" TEXT,
    "account_last4" TEXT,
    "currency" TEXT NOT NULL,
    "declared_opening_balance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "opening_date" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bank_account_id" UUID NOT NULL,
    "owner_org_id" UUID,
    "owner_legal_entity_id" UUID,
    "purpose" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "opening_balance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wallet_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "mode" TEXT NOT NULL,
    "category" TEXT,
    "party" TEXT,
    "reference_type" TEXT NOT NULL DEFAULT 'manual',
    "reference_id" UUID,
    "transfer_id" UUID,
    "notes" TEXT,
    "attachment_url" TEXT,
    "attachment_name" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,

    CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "from_wallet_id" UUID NOT NULL,
    "to_wallet_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "kind" TEXT NOT NULL,
    "is_intercompany" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,

    CONSTRAINT "wallet_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "bank_account_id" UUID NOT NULL,
    "statement_date" DATE NOT NULL,
    "statement_balance" DECIMAL(16,2) NOT NULL,
    "system_balance" DECIMAL(16,2) NOT NULL,
    "difference" DECIMAL(16,2) NOT NULL,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_audit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_entities_workspace_id_idx" ON "legal_entities"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "legal_entities_org_group_id_name_key" ON "legal_entities"("org_group_id", "name");

-- CreateIndex
CREATE INDEX "bank_accounts_legal_entity_id_idx" ON "bank_accounts"("legal_entity_id");

-- CreateIndex
CREATE INDEX "wallets_bank_account_id_idx" ON "wallets"("bank_account_id");

-- CreateIndex
CREATE INDEX "wallets_owner_org_id_idx" ON "wallets"("owner_org_id");

-- CreateIndex
CREATE INDEX "wallets_owner_legal_entity_id_idx" ON "wallets"("owner_legal_entity_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_wallet_id_date_idx" ON "wallet_transactions"("wallet_id", "date");

-- CreateIndex
CREATE INDEX "wallet_transactions_transfer_id_idx" ON "wallet_transactions"("transfer_id");

-- CreateIndex
CREATE INDEX "wallet_transactions_reference_type_reference_id_idx" ON "wallet_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "wallet_transfers_from_wallet_id_idx" ON "wallet_transfers"("from_wallet_id");

-- CreateIndex
CREATE INDEX "wallet_transfers_to_wallet_id_idx" ON "wallet_transfers"("to_wallet_id");

-- CreateIndex
CREATE INDEX "bank_reconciliations_bank_account_id_statement_date_idx" ON "bank_reconciliations"("bank_account_id", "statement_date");

-- CreateIndex
CREATE INDEX "wallet_audit_entity_type_entity_id_idx" ON "wallet_audit"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "wallet_audit_org_group_id_created_at_idx" ON "wallet_audit"("org_group_id", "created_at");

-- AddForeignKey
ALTER TABLE "gx_tasks" ADD CONSTRAINT "gx_tasks_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "gx_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gx_period_closes" ADD CONSTRAINT "gx_period_closes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_owner_org_id_fkey" FOREIGN KEY ("owner_org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_owner_legal_entity_id_fkey" FOREIGN KEY ("owner_legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "wallet_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_from_wallet_id_fkey" FOREIGN KEY ("from_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_to_wallet_id_fkey" FOREIGN KEY ("to_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "billing_adjustments_org_id_account_id_period_year_period_month_" RENAME TO "billing_adjustments_org_id_account_id_period_year_period_mo_idx";

-- RenameIndex
ALTER INDEX "salary_adjustments_org_membership_id_period_year_period_month_i" RENAME TO "salary_adjustments_org_membership_id_period_year_period_mon_idx";

-- RenameIndex
ALTER INDEX "timesheet_month_locks_org_membership_id_period_year_period_mont" RENAME TO "timesheet_month_locks_org_membership_id_period_year_period__key";


-- Rules the database itself keeps, whatever the code does.
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_type_check" CHECK ("type" IN ('current', 'savings', 'cash'));
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_currency_check" CHECK ("currency" IN ('INR', 'USD'));
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_one_owner_check" CHECK (("owner_org_id" IS NULL) <> ("owner_legal_entity_id" IS NULL));
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_purpose_check" CHECK ("purpose" IN ('general', 'salary', 'travel', 'unallocated'));
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_amount_check" CHECK ("amount" > 0);
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_direction_check" CHECK ("direction" IN ('in', 'out'));
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_amount_check" CHECK ("amount" > 0);
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_kind_check" CHECK ("kind" IN ('bank_transfer', 'reallocation'));
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_distinct_check" CHECK ("from_wallet_id" <> "to_wallet_id");
