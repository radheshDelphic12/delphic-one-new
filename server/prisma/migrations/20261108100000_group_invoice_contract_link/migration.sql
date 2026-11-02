-- Optional link from an issued group invoice to a contract and the month it bills. Additive, nullable columns only.
ALTER TABLE "group_invoices" ADD COLUMN IF NOT EXISTS "contract_id" UUID;
ALTER TABLE "group_invoices" ADD COLUMN IF NOT EXISTS "contract_month" INTEGER;
ALTER TABLE "group_invoices" ADD COLUMN IF NOT EXISTS "contract_year" INTEGER;
CREATE INDEX IF NOT EXISTS "group_invoices_contract_id_idx" ON "group_invoices"("contract_id");
