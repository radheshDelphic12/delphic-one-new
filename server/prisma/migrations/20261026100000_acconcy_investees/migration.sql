-- Acconcy: the companies it funds or takes over. Each tranche of money is an existing ax_investments row linked by investee_id.
CREATE TABLE "ax_investees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT,
    "website" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'discussion',
    "proposed_amount" DECIMAL(16,2),
    "proposed_stake_pct" DECIMAL(7,3),
    "expected_return_pct" DECIMAL(7,2),
    "stake_pct" DECIMAL(7,3),
    "valuation" DECIMAL(16,2),
    "lead_id" UUID,
    "deal_id" UUID,
    "decided_at" DATE,
    "discussion_notes" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ax_investees_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ax_investees_org_id_stage_idx" ON "ax_investees"("org_id", "stage");
ALTER TABLE "ax_investees" ADD CONSTRAINT "ax_investees_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ax_investments" ADD COLUMN "investee_id" UUID;
CREATE INDEX "ax_investments_investee_id_idx" ON "ax_investments"("investee_id");
ALTER TABLE "ax_investments" ADD CONSTRAINT "ax_investments_investee_id_fkey" FOREIGN KEY ("investee_id") REFERENCES "ax_investees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
