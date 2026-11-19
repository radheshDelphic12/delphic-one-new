-- Who the owner (POC from our end) of a client / vendor account was on each date. accounts.owner_id stays the CURRENT owner (the latest
-- row here); anything about a past date reads this history, so changing a POC never rewrites the past.
CREATE TABLE "account_owner_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "account_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "effective_from" DATE NOT NULL,
  "created_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_owner_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "account_owner_history_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "account_owner_history_account_id_effective_from_key" ON "account_owner_history"("account_id", "effective_from");
CREATE INDEX "account_owner_history_account_id_idx" ON "account_owner_history"("account_id");

-- Backfill: every existing account starts with its current owner from the day it was created (IST), so nothing in any report changes today.
INSERT INTO "account_owner_history" ("account_id", "owner_id", "effective_from")
SELECT "id", "owner_id", ("created_at" AT TIME ZONE 'Asia/Kolkata')::date FROM "accounts" WHERE "owner_id" IS NOT NULL;
