-- Payments against a record, with part payments, the rate asked at payment time, bank charges / deductions and an optional wallet entry.
-- Additive: one new table.
CREATE TABLE IF NOT EXISTS "payment_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "reference_id" UUID NOT NULL,
  "direction" TEXT NOT NULL,
  "paid_on" DATE NOT NULL,
  "amount" DECIMAL(16,2) NOT NULL,
  "currency" "Currency" NOT NULL,
  "exchange_rate" DECIMAL(14,6),
  "inr_amount" DECIMAL(16,2) NOT NULL,
  "bank_charges" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "other_deductions" DECIMAL(16,2) NOT NULL DEFAULT 0,
  "deduction_notes" TEXT,
  "notes" TEXT,
  "wallet_transaction_id" UUID,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" UUID,
  "delete_reason" TEXT,
  CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "payment_records_org_id_kind_reference_id_idx" ON "payment_records"("org_id", "kind", "reference_id");
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
