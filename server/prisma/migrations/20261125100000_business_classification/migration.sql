-- Business classification: the group's sector > industry > sub-industry list and where each business sits in it. Additive.
CREATE TABLE "business_sectors" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_group_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_sectors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "business_sectors_org_group_id_name_key" ON "business_sectors"("org_group_id", "name");

CREATE TABLE "business_industries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_group_id" UUID NOT NULL,
  "sector_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_industries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "business_industries_sector_id_name_key" ON "business_industries"("sector_id", "name");
ALTER TABLE "business_industries" ADD CONSTRAINT "business_industries_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "business_sectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "business_sub_industries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_group_id" UUID NOT NULL,
  "industry_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_sub_industries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "business_sub_industries_industry_id_name_key" ON "business_sub_industries"("industry_id", "name");
ALTER TABLE "business_sub_industries" ADD CONSTRAINT "business_sub_industries_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "business_industries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "business_classifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_group_id" UUID NOT NULL,
  "entity_kind" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "sector_id" UUID NOT NULL,
  "industry_id" UUID,
  "sub_industry_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_classifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "business_classifications_entity_kind_entity_id_idx" ON "business_classifications"("entity_kind", "entity_id");
CREATE INDEX "business_classifications_org_group_id_sector_id_idx" ON "business_classifications"("org_group_id", "sector_id");
ALTER TABLE "business_classifications" ADD CONSTRAINT "business_classifications_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "business_sectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_classifications" ADD CONSTRAINT "business_classifications_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "business_industries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_classifications" ADD CONSTRAINT "business_classifications_sub_industry_id_fkey" FOREIGN KEY ("sub_industry_id") REFERENCES "business_sub_industries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
