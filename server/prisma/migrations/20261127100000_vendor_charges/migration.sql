-- Vendor GST / TDS / other charges, set up like a contract's charges; the invoice keeps GST and other amounts. Additive.
CREATE TABLE "vendor_charges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "vendor_account_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'percent',
    "value" DECIMAL(14,4) NOT NULL,
    "effect" TEXT NOT NULL DEFAULT 'add',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "vendor_charges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vendor_charges_org_id_vendor_account_id_idx" ON "vendor_charges"("org_id", "vendor_account_id");
ALTER TABLE "vendor_charges" ADD CONSTRAINT "vendor_charges_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_charges" ADD CONSTRAINT "vendor_charges_vendor_account_id_fkey" FOREIGN KEY ("vendor_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_charges" ADD CONSTRAINT "vendor_charges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_vendor_invoices" ADD COLUMN "gst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "project_vendor_invoices" ADD COLUMN "other_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
