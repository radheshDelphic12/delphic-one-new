-- Client invoices: the company's own (editable) invoice number, invoice date and notes.
ALTER TABLE "client_invoices" ADD COLUMN "invoice_number" TEXT,
ADD COLUMN "invoice_date" DATE,
ADD COLUMN "notes" TEXT;

CREATE UNIQUE INDEX "client_invoices_org_id_invoice_number_key" ON "client_invoices"("org_id", "invoice_number");

-- Vendor invoices generated from Live Analytics → Vendors keep their calculation details.
ALTER TABLE "project_vendor_invoices" ADD COLUMN "invoice_date" DATE,
ADD COLUMN "details" JSONB;
