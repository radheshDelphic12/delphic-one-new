-- SaaS launch, phases 1.5 and 2.1: customers (one per customer group), slots, credit days per module, the credit ledger and the daily counter runs.
-- New tables only; nothing existing is changed. Nothing reads them unless the SaaS switches (SAAS_CUSTOMER_PROVISIONING, SAAS_COUNTER_ENABLED,
-- SAAS_ENFORCE_ENTITLEMENTS) are turned on, and all three are off by default.

CREATE TABLE "saas_customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dox_customer_id" UUID,
    "org_group_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'trial',
    "plan_name" TEXT,
    "trial_starts_on" DATE,
    "trial_ends_on" DATE,
    "max_users" INTEGER NOT NULL DEFAULT 2,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_customers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saas_customers_status_check" CHECK ("status" IN ('trial', 'active', 'read_only', 'suspended', 'churned'))
);
CREATE UNIQUE INDEX "saas_customers_dox_customer_id_key" ON "saas_customers"("dox_customer_id");
CREATE UNIQUE INDEX "saas_customers_org_id_key" ON "saas_customers"("org_id");
CREATE INDEX "saas_customers_org_group_id_idx" ON "saas_customers"("org_group_id");
CREATE INDEX "saas_customers_status_idx" ON "saas_customers"("status");

CREATE TABLE "saas_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "email" TEXT,
    "user_id" UUID,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_moved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_slots_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saas_slots_status_check" CHECK ("status" IN ('active', 'paused'))
);
CREATE INDEX "saas_slots_customer_id_idx" ON "saas_slots"("customer_id");
ALTER TABLE "saas_slots" ADD CONSTRAINT "saas_slots_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "saas_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "saas_slot_credits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slot_id" UUID NOT NULL,
    "module_code" VARCHAR(8) NOT NULL,
    "days_left" INTEGER NOT NULL DEFAULT 0,
    "alerted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_slot_credits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saas_slot_credits_days_check" CHECK ("days_left" >= 0)
);
CREATE UNIQUE INDEX "saas_slot_credits_slot_id_module_code_key" ON "saas_slot_credits"("slot_id", "module_code");
CREATE INDEX "saas_slot_credits_module_code_idx" ON "saas_slot_credits"("module_code");
ALTER TABLE "saas_slot_credits" ADD CONSTRAINT "saas_slot_credits_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "saas_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saas_slot_credits" ADD CONSTRAINT "saas_slot_credits_module_code_fkey" FOREIGN KEY ("module_code") REFERENCES "saas_modules"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "saas_credit_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slot_id" UUID NOT NULL,
    "module_code" VARCHAR(8) NOT NULL,
    "change_days" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_credit_ledger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saas_credit_ledger_slot_id_module_code_idx" ON "saas_credit_ledger"("slot_id", "module_code");
ALTER TABLE "saas_credit_ledger" ADD CONSTRAINT "saas_credit_ledger_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "saas_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One row per day the counter has run: the primary key is what makes a second run on the same day do nothing.
CREATE TABLE "saas_counter_runs" (
    "run_date" DATE NOT NULL,
    "credits_touched" INTEGER NOT NULL DEFAULT 0,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saas_counter_runs_pkey" PRIMARY KEY ("run_date")
);
