-- Phase 2: project profile, Project <-> Calendar mapping, agreement start date.
-- Additive only: new nullable columns, one column with a default, one new table.

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "client_name" TEXT,
ADD COLUMN "service_category" "ReqType",
ADD COLUMN "agreement_start_date" DATE,
ADD COLUMN "benchmark_hours" INTEGER NOT NULL DEFAULT 160;

-- CreateTable
CREATE TABLE "project_calendars" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_calendars_account_id_key" ON "project_calendars"("account_id");

-- CreateIndex
CREATE INDEX "project_calendars_org_id_idx" ON "project_calendars"("org_id");

-- CreateIndex
CREATE INDEX "project_calendars_calendar_id_idx" ON "project_calendars"("calendar_id");

-- AddForeignKey
ALTER TABLE "project_calendars" ADD CONSTRAINT "project_calendars_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_calendars" ADD CONSTRAINT "project_calendars_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_calendars" ADD CONSTRAINT "project_calendars_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "calendars"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
