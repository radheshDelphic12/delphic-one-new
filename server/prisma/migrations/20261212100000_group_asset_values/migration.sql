-- Group Dashboard: asset value of a company on a given date. Additive.
CREATE TABLE "group_asset_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "as_of" DATE NOT NULL,
    "asset_value" DECIMAL(16,2) NOT NULL,
    "notes" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_asset_values_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "group_asset_values_org_id_as_of_key" ON "group_asset_values"("org_id", "as_of");
ALTER TABLE "group_asset_values" ADD CONSTRAINT "group_asset_values_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
