-- Reconciliations can be corrected or removed (soft delete, audited).
ALTER TABLE "bank_reconciliations" ADD COLUMN "deleted_at" TIMESTAMP(3), ADD COLUMN "deleted_by" UUID;
