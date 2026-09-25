-- AlterTable
ALTER TABLE "interview_rounds" ADD COLUMN IF NOT EXISTS "scheduled_by" UUID;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interview_rounds_scheduled_by_fkey'
  ) THEN
    ALTER TABLE "interview_rounds"
      ADD CONSTRAINT "interview_rounds_scheduled_by_fkey"
      FOREIGN KEY ("scheduled_by") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "interview_rounds_scheduled_by_idx" ON "interview_rounds"("scheduled_by");
