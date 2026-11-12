-- Group Dashboard > GST & TDS: refunds of TDS deducted by clients, and challans (money deposited with the government). Additive.
CREATE TABLE "tds_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_group_id" UUID NOT NULL,
  "org_id" UUID,
  "invoice_kind" TEXT NOT NULL,
  "invoice_id" UUID NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "received_on" DATE NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "delete_reason" TEXT,
  CONSTRAINT "tds_receipts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tds_receipts_org_group_id_invoice_kind_invoice_id_idx" ON "tds_receipts"("org_group_id", "invoice_kind", "invoice_id");

CREATE TABLE "tax_challans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_group_id" UUID NOT NULL,
  "org_id" UUID,
  "kind" TEXT NOT NULL,
  "challan_number" TEXT,
  "bsr_code" TEXT,
  "bank" TEXT,
  "period_month" INTEGER NOT NULL,
  "period_year" INTEGER NOT NULL,
  "covers_months" INTEGER NOT NULL DEFAULT 1,
  "amount" DECIMAL(16,2) NOT NULL,
  "paid_on" DATE NOT NULL,
  "parties" JSONB NOT NULL DEFAULT '[]',
  "note" TEXT,
  "file_path" TEXT,
  "file_name" TEXT,
  "file_mime" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "delete_reason" TEXT,
  CONSTRAINT "tax_challans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tax_challans_org_group_id_kind_period_year_period_month_idx" ON "tax_challans"("org_group_id", "kind", "period_year", "period_month");
