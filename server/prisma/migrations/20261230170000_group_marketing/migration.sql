-- Group Dashboard > Marketing: campaigns across the group's companies (channel, dates, budget, target), what was spent on them, and what
-- they brought (leads, deals won, revenue).
CREATE TABLE "group_campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'other',
    "company_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "status" TEXT NOT NULL DEFAULT 'planned',
    "start_date" DATE,
    "end_date" DATE,
    "budget" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "target_leads" INTEGER,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "deals_won" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "owner_name" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "group_campaigns_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "group_campaigns_org_group_id_status_idx" ON "group_campaigns"("org_group_id", "status");

CREATE TABLE "group_campaign_spends" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "spent_on" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_campaign_spends_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "group_campaign_spends_campaign_id_idx" ON "group_campaign_spends"("campaign_id");
ALTER TABLE "group_campaign_spends" ADD CONSTRAINT "group_campaign_spends_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "group_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
