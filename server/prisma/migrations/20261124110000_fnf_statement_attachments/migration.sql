-- FnF statement: the lines added by hand, and one attachment on an outgoing email (the documents package). Additive.
ALTER TABLE "fnf_records" ADD COLUMN "items" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "email_outbox" ADD COLUMN "attachment_path" TEXT;
ALTER TABLE "email_outbox" ADD COLUMN "attachment_name" TEXT;
