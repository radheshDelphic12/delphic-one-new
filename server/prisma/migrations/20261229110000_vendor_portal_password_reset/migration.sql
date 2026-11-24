-- Vendor portal: "forgot password". Only a hash of the emailed token is kept, and it expires.
ALTER TABLE "vendor_portal_users" ADD COLUMN IF NOT EXISTS "reset_token_hash" TEXT;
ALTER TABLE "vendor_portal_users" ADD COLUMN IF NOT EXISTS "reset_expires_at" TIMESTAMP(3);
