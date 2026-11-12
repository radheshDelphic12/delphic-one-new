-- Group debt management: loans and credit limits of the group and its companies, one row per EMI, and the loan ratio limit.
CREATE TABLE "group_loans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "org_id" UUID,
    "name" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "loan_type" TEXT NOT NULL DEFAULT 'bank_loan',
    "collateral" TEXT,
    "principal" DECIMAL(16,2) NOT NULL,
    "interest_rate" DECIMAL(7,3) NOT NULL DEFAULT 0,
    "rate_type" TEXT NOT NULL DEFAULT 'fixed',
    "start_date" DATE NOT NULL,
    "tenure_months" INTEGER,
    "emi_amount" DECIMAL(16,2),
    "emi_frequency" TEXT NOT NULL DEFAULT 'monthly',
    "sanctioned_limit" DECIMAL(16,2),
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "group_loans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "group_loans_org_group_id_status_idx" ON "group_loans"("org_group_id", "status");
ALTER TABLE "group_loans" ADD CONSTRAINT "group_loans_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "group_loan_installments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "loan_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "principal_part" DECIMAL(16,2) NOT NULL,
    "interest_part" DECIMAL(16,2) NOT NULL,
    "balance_after" DECIMAL(16,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paid_on" DATE,
    "paid_amount" DECIMAL(16,2),
    "note" TEXT,

    CONSTRAINT "group_loan_installments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "group_loan_installments_loan_id_seq_key" ON "group_loan_installments"("loan_id", "seq");
CREATE INDEX "group_loan_installments_loan_id_status_idx" ON "group_loan_installments"("loan_id", "status");
ALTER TABLE "group_loan_installments" ADD CONSTRAINT "group_loan_installments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "group_loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "group_debt_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "max_debt_ratio_pct" DECIMAL(6,2) NOT NULL DEFAULT 30,
    "ratio_basis" TEXT NOT NULL DEFAULT 'valuation',
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_debt_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "group_debt_settings_org_group_id_key" ON "group_debt_settings"("org_group_id");
ALTER TABLE "group_debt_settings" ADD CONSTRAINT "group_debt_settings_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
