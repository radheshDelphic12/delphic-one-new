-- Additive only: the billing address printed on invoices for client and vendor accounts.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "billing_address" TEXT;
