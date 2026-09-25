-- Additive only: manually-entered group-dashboard valuation figure per org.
ALTER TABLE "orgs" ADD COLUMN "valuation" DECIMAL(16,2);
