-- Per-contract invoice charges (GST, TDS, other): percentage or fixed, added or deducted.
CREATE TABLE "contract_charges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'percent',
  "value" DECIMAL(14,4) NOT NULL,
  "effect" TEXT NOT NULL DEFAULT 'add',
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contract_charges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_charges_org_id_account_id_idx" ON "contract_charges"("org_id", "account_id");

ALTER TABLE "contract_charges" ADD CONSTRAINT "contract_charges_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_charges" ADD CONSTRAINT "contract_charges_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contract_charges" ADD CONSTRAINT "contract_charges_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
