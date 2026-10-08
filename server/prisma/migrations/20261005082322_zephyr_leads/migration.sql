-- CreateTable
CREATE TABLE "zx_leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'client_project',
    "self_project_basis" TEXT,
    "basis_value" TEXT,
    "party_id" UUID,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "source" TEXT,
    "location" TEXT,
    "estimated_value" DECIMAL(16,2),
    "expected_close" DATE,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "lost_reason" TEXT,
    "owner_id" UUID,
    "notes" TEXT,
    "project_id" UUID,
    "closed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_lead_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "summary" TEXT NOT NULL,
    "follow_up_date" DATE,
    "follow_up_done" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zx_leads_org_id_stage_idx" ON "zx_leads"("org_id", "stage");

-- CreateIndex
CREATE INDEX "zx_leads_org_id_owner_id_idx" ON "zx_leads"("org_id", "owner_id");

-- CreateIndex
CREATE INDEX "zx_lead_activities_lead_id_created_at_idx" ON "zx_lead_activities"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "zx_lead_activities_org_id_follow_up_date_idx" ON "zx_lead_activities"("org_id", "follow_up_date");

-- AddForeignKey
ALTER TABLE "zx_leads" ADD CONSTRAINT "zx_leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_leads" ADD CONSTRAINT "zx_leads_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "zx_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_lead_activities" ADD CONSTRAINT "zx_lead_activities_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_lead_activities" ADD CONSTRAINT "zx_lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "zx_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
