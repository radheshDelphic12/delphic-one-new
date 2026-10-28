-- Resignation requests (Settings > Account > Resign). Additive only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'resignation_submitted';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'resignation_manager_updated';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'resignation_decided';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'resignation';

CREATE TYPE "ResignationStatus" AS ENUM ('submitted', 'approved', 'rejected', 'withdrawn', 'retained');

ALTER TABLE "orgs"
  ADD COLUMN IF NOT EXISTS "resignation_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "resignation_notice_days" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "resignation_manager_required" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "resignation_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "org_membership_id" UUID NOT NULL,
  "manager_membership_id" UUID,
  "reason" TEXT NOT NULL,
  "reason_category" TEXT,
  "proposed_lwd" DATE NOT NULL,
  "status" "ResignationStatus" NOT NULL DEFAULT 'submitted',
  "meeting_done" BOOLEAN NOT NULL DEFAULT false,
  "meeting_date" DATE,
  "manager_notes" TEXT,
  "manager_outcome" TEXT,
  "manager_updated_by" UUID,
  "manager_updated_at" TIMESTAMP(3),
  "approved_lwd" DATE,
  "decided_by" UUID,
  "decided_at" TIMESTAMP(3),
  "decision_remarks" TEXT,
  "fnf_started_at" TIMESTAMP(3),
  "fnf_started_by" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "resignation_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "resignation_requests_org_id_status_idx" ON "resignation_requests"("org_id", "status");
CREATE INDEX "resignation_requests_org_membership_id_idx" ON "resignation_requests"("org_membership_id");
CREATE INDEX "resignation_requests_manager_membership_id_idx" ON "resignation_requests"("manager_membership_id");
ALTER TABLE "resignation_requests" ADD CONSTRAINT "resignation_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resignation_requests" ADD CONSTRAINT "resignation_requests_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
