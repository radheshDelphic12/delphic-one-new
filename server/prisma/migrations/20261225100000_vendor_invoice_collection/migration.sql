-- Vendor invoices get the same payment-collection fields as client invoices: when the vendor has to be paid and when we next follow up
-- (the notes of each follow-up are in invoice_followups, now also with invoice_kind 'vendor_invoice').
ALTER TABLE "project_vendor_invoices" ADD COLUMN "due_date" DATE;
ALTER TABLE "project_vendor_invoices" ADD COLUMN "next_followup_date" DATE;
