-- Accounts > Vendor type (assets | bgv). Additive: one nullable column, every existing account starts empty.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "vendor_type" TEXT;
