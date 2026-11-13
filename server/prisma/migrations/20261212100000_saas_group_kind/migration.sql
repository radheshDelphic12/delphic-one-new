-- SaaS launch, phase 1: every group says what it is. Existing groups are all ours, so they stay 'owner'.
-- owner = our own group, customer = a paying customer, trial = a customer on trial, demo = a demo/sandbox group.
ALTER TABLE "org_groups" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE "org_groups" ADD CONSTRAINT "org_groups_kind_check" CHECK ("kind" IN ('owner', 'customer', 'trial', 'demo'));
