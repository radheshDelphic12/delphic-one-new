ALTER TABLE "requirements" ADD COLUMN "tat_hours" INTEGER,
  ADD COLUMN "tat_ends_at" TIMESTAMP(3);
CREATE INDEX "requirements_tat_ends_at_idx" ON "requirements"("tat_ends_at");
