-- Bench period on an employee. Additive and nullable: nothing existing changes.
ALTER TABLE "org_memberships" ADD COLUMN IF NOT EXISTS "bench_start_date" DATE;
ALTER TABLE "org_memberships" ADD COLUMN IF NOT EXISTS "bench_end_date" DATE;
