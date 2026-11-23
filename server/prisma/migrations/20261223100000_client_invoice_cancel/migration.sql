-- A cancelled client invoice: soft-deleted (drops out of every total, the month can be invoiced again) and marked, so the Cancelled list
-- can show which invoice, month and contracts it was, who cancelled it, when and why.
ALTER TABLE "client_invoices" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "client_invoices" ADD COLUMN "cancelled_by" UUID;
ALTER TABLE "client_invoices" ADD COLUMN "cancel_reason" TEXT;
ALTER TABLE "client_invoices" ADD COLUMN "cancelled_number" TEXT;
