DROP TABLE IF EXISTS "vendor_email_logs";
ALTER TABLE "email_outbox" DROP COLUMN IF EXISTS "cc_email";
