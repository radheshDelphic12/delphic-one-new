-- Overtime tickets (attendance-paid people): raised by the employee, approved by the manager / admin.
CREATE TABLE "overtime_tickets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "org_membership_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "hours" DECIMAL(4,2) NOT NULL,
  "account_id" UUID,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "decided_by" UUID,
  "decided_at" TIMESTAMP(3),
  "decision_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "overtime_tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "overtime_tickets_org_id_date_idx" ON "overtime_tickets"("org_id", "date");
CREATE INDEX "overtime_tickets_org_membership_id_date_idx" ON "overtime_tickets"("org_membership_id", "date");
CREATE INDEX "overtime_tickets_account_id_date_idx" ON "overtime_tickets"("account_id", "date");

ALTER TABLE "overtime_tickets" ADD CONSTRAINT "overtime_tickets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "overtime_tickets" ADD CONSTRAINT "overtime_tickets_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "overtime_tickets" ADD CONSTRAINT "overtime_tickets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "overtime_tickets" ADD CONSTRAINT "overtime_tickets_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
