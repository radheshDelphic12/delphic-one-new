-- Per-group switch for Book Keeping > Receivables (invoices to collect from a billing month on). Off until a group admin switches it on. Additive.
CREATE TABLE "group_receivable_settings" (
    "org_group_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "since_month" TEXT NOT NULL DEFAULT '2026-09',
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_receivable_settings_pkey" PRIMARY KEY ("org_group_id")
);
