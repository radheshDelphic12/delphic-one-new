-- Vendor auto email: a CC column on the outbox and a log of every send. Additive.
ALTER TABLE "email_outbox" ADD COLUMN IF NOT EXISTS "cc_email" TEXT;

CREATE TABLE IF NOT EXISTS "vendor_email_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "sent_by" UUID NOT NULL,
  "sent_by_name" TEXT,
  "requirement_ids" JSONB NOT NULL DEFAULT '[]',
  "subject" TEXT NOT NULL,
  "body_text" TEXT NOT NULL,
  "recipients" JSONB NOT NULL DEFAULT '[]',
  "skipped" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_email_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "vendor_email_logs_org_id_created_at_idx" ON "vendor_email_logs"("org_id", "created_at");
DO $$ BEGIN
  ALTER TABLE "vendor_email_logs" ADD CONSTRAINT "vendor_email_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
