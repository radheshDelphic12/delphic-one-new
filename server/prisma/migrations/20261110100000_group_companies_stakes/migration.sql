-- Group Dashboard > Companies & Stakes: the register of the group's businesses (current and planned) and who holds how much of each. Additive: two new tables.
CREATE TABLE "group_companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "org_id" UUID,
    "name" TEXT NOT NULL,
    "short_code" TEXT,
    "sector" TEXT,
    "tagline" TEXT,
    "foundation_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'operational',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "group_company_stakes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "held_company_id" UUID NOT NULL,
    "holder_kind" TEXT NOT NULL,
    "holder_company_id" UUID,
    "holder_name" TEXT,
    "pct" DECIMAL(7,3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_company_stakes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "group_companies_org_id_key" ON "group_companies"("org_id");
CREATE UNIQUE INDEX "group_companies_org_group_id_name_key" ON "group_companies"("org_group_id", "name");
CREATE INDEX "group_companies_org_group_id_status_idx" ON "group_companies"("org_group_id", "status");
CREATE INDEX "group_company_stakes_held_company_id_idx" ON "group_company_stakes"("held_company_id");
CREATE INDEX "group_company_stakes_holder_company_id_idx" ON "group_company_stakes"("holder_company_id");
CREATE INDEX "group_company_stakes_org_group_id_idx" ON "group_company_stakes"("org_group_id");

ALTER TABLE "group_companies" ADD CONSTRAINT "group_companies_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_companies" ADD CONSTRAINT "group_companies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "group_company_stakes" ADD CONSTRAINT "group_company_stakes_held_company_id_fkey" FOREIGN KEY ("held_company_id") REFERENCES "group_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_company_stakes" ADD CONSTRAINT "group_company_stakes_holder_company_id_fkey" FOREIGN KEY ("holder_company_id") REFERENCES "group_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
