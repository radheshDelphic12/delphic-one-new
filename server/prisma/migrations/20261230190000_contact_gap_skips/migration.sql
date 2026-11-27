-- Reports > Missing contact details: accounts set aside ("skipped") for now. Skipped accounts leave the main list and wait in a Skipped list,
-- from where they can be brought back at any time. One row per account.
CREATE TABLE IF NOT EXISTS "contact_gap_skips" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "reason" TEXT,
  "skipped_by" UUID,
  "skipped_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_gap_skips_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "contact_gap_skips_org_id_account_id_key" ON "contact_gap_skips"("org_id", "account_id");
