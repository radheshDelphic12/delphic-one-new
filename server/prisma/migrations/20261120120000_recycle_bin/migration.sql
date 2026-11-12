-- Additive only: the recycle bin. A deleted record is archived here (whole row as JSON) so it can be restored.
CREATE TABLE "deleted_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID,
    "model" TEXT NOT NULL,
    "row_id" TEXT,
    "label" TEXT,
    "data" JSONB NOT NULL,
    "reason" TEXT,
    "deleted_by" UUID,
    "deleted_by_name" TEXT,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restored_at" TIMESTAMP(3),
    "restored_by" UUID,
    CONSTRAINT "deleted_records_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "deleted_records_org_id_deleted_at_idx" ON "deleted_records"("org_id", "deleted_at");
CREATE INDEX "deleted_records_model_row_id_idx" ON "deleted_records"("model", "row_id");
