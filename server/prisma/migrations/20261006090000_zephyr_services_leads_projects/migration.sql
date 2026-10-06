-- Zephyr R0-R2: service types, richer leads / projects / parties.
-- Additive columns plus a data move of the old lead stages and project status onto the new sets.

-- AlterTable
ALTER TABLE "zx_settings" ADD COLUMN "lead_prefix" TEXT NOT NULL DEFAULT 'ZL',
ADD COLUMN "lead_seq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "zx_parties" ADD COLUMN "state" TEXT,
ADD COLUMN "country" TEXT,
ADD COLUMN "company_name" TEXT,
ADD COLUMN "interested_services" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "vendor_category" TEXT,
ADD COLUMN "materials_services" TEXT;

-- AlterTable
ALTER TABLE "zx_leads" ADD COLUMN "code" TEXT,
ADD COLUMN "service_type" TEXT,
ADD COLUMN "company" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "assignee_id" UUID,
ADD COLUMN "contractor_id" UUID,
ADD COLUMN "expected_start" DATE,
ADD COLUMN "expected_end" DATE,
ADD COLUMN "expected_profit" DECIMAL(16,2),
ADD COLUMN "property_ref" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "details" JSONB;

-- AlterTable
ALTER TABLE "zx_projects" ALTER COLUMN "status" SET DEFAULT 'planned',
ADD COLUMN "service_type" TEXT,
ADD COLUMN "actual_end" DATE,
ADD COLUMN "agreement_ref" TEXT,
ADD COLUMN "expected_profit" DECIMAL(16,2),
ADD COLUMN "assignee_id" UUID,
ADD COLUMN "contractor_id" UUID,
ADD COLUMN "description" TEXT,
ADD COLUMN "details" JSONB;

-- CreateTable
CREATE TABLE "zx_service_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_service_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "zx_service_types_org_id_key_key" ON "zx_service_types"("org_id", "key");

-- CreateIndex
CREATE INDEX "zx_leads_org_id_service_type_idx" ON "zx_leads"("org_id", "service_type");

-- CreateIndex
CREATE INDEX "zx_projects_org_id_service_type_idx" ON "zx_projects"("org_id", "service_type");

-- AddForeignKey
ALTER TABLE "zx_service_types" ADD CONSTRAINT "zx_service_types_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: old lead stages -> new set (contacted / site_visit -> in_discussion, proposal -> negotiation, lost -> dropped)
UPDATE "zx_leads" SET "stage" = 'in_discussion' WHERE "stage" IN ('contacted', 'site_visit');
UPDATE "zx_leads" SET "stage" = 'negotiation' WHERE "stage" = 'proposal';
UPDATE "zx_leads" SET "stage" = 'dropped' WHERE "stage" = 'lost';

-- Data: project status planning -> planned
UPDATE "zx_projects" SET "status" = 'planned' WHERE "status" = 'planning';

-- Data: give existing leads a code (ZL-0001 ...) in creation order per org and move the counter
WITH numbered AS (
  SELECT id, org_id, ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY created_at, id) AS n FROM "zx_leads" WHERE "code" IS NULL
)
UPDATE "zx_leads" l SET "code" = 'ZL-' || LPAD(numbered.n::text, 4, '0') FROM numbered WHERE l.id = numbered.id;
UPDATE "zx_settings" s SET "lead_seq" = c.n FROM (SELECT org_id, COUNT(*)::int AS n FROM "zx_leads" GROUP BY org_id) c WHERE s.org_id = c.org_id;
