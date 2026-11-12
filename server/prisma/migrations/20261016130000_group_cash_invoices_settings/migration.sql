-- Group cash: go-live setting, invoices issued by legal entities, their number series and payments. Additive only.
-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "payment_instructions" TEXT;

-- AlterTable
ALTER TABLE "legal_entities" ADD COLUMN     "lut_note" TEXT,
ADD COLUMN     "state_code" TEXT;

-- CreateTable
CREATE TABLE "group_cash_settings" (
    "org_group_id" UUID NOT NULL,
    "go_live_date" DATE,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_cash_settings_pkey" PRIMARY KEY ("org_group_id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "legal_entity_id" UUID NOT NULL,
    "series" TEXT NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("legal_entity_id","series")
);

-- CreateTable
CREATE TABLE "group_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "legal_entity_id" UUID NOT NULL,
    "workspace_id" UUID,
    "series" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "currency" TEXT NOT NULL,
    "seller" JSONB NOT NULL,
    "buyer_name" TEXT NOT NULL,
    "buyer_gstin" TEXT,
    "buyer_address" TEXT,
    "buyer_state_code" TEXT,
    "place_of_supply" TEXT,
    "lines" JSONB NOT NULL,
    "subtotal" DECIMAL(16,2) NOT NULL,
    "cgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(16,2) NOT NULL,
    "receiving_wallet_id" UUID NOT NULL,
    "notes" TEXT,
    "payment_instructions" TEXT,
    "lut_note" TEXT,
    "cancelled_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_invoice_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "mode" TEXT NOT NULL,
    "notes" TEXT,
    "wallet_transaction_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,

    CONSTRAINT "group_invoice_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_invoices_org_group_id_invoice_date_idx" ON "group_invoices"("org_group_id", "invoice_date");

-- CreateIndex
CREATE UNIQUE INDEX "group_invoices_legal_entity_id_number_key" ON "group_invoices"("legal_entity_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "group_invoices_legal_entity_id_series_seq_key" ON "group_invoices"("legal_entity_id", "series", "seq");

-- CreateIndex
CREATE INDEX "group_invoice_payments_invoice_id_idx" ON "group_invoice_payments"("invoice_id");

-- AddForeignKey
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_invoices" ADD CONSTRAINT "group_invoices_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_invoice_payments" ADD CONSTRAINT "group_invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "group_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

