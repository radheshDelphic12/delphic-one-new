-- Monthly-rate projects: periods the contract was on hold ([{ from, resume }]); no billing for those days.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "contract_hold_periods" JSONB;
