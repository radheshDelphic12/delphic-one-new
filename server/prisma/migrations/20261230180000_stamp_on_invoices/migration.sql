-- The company stamp can also be printed on the company's invoice PDFs (client invoices, Book Keeping invoices). On by default.
ALTER TABLE "company_stamps" ADD COLUMN IF NOT EXISTS "on_invoices" BOOLEAN NOT NULL DEFAULT true;
