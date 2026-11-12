-- Book Keeping invoices: TDS the buyer deducts (rate on the taxable value, and the amount). Additive, default 0.
ALTER TABLE "group_invoices" ADD COLUMN "tds_rate" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "group_invoices" ADD COLUMN "tds_amount" DECIMAL(16,2) NOT NULL DEFAULT 0;
