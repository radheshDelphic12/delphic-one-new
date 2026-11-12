-- Office locations: complete street address. Additive.
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "address" TEXT;
