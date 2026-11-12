-- Employees' requests to correct a day of their attendance, reviewed by an admin. Additive: a new table only.
CREATE TABLE "attendance_regularization_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "requested_status" "AttendanceStatus" NOT NULL,
    "check_in_time" TEXT,
    "check_out_time" TEXT,
    "reason" TEXT NOT NULL,
    "status" "RegularizationTicketStatus" NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_regularization_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_regularization_requests_org_id_status_idx" ON "attendance_regularization_requests"("org_id", "status");
CREATE INDEX "attendance_regularization_requests_org_membership_id_date_idx" ON "attendance_regularization_requests"("org_membership_id", "date");

ALTER TABLE "attendance_regularization_requests" ADD CONSTRAINT "attendance_regularization_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_regularization_requests" ADD CONSTRAINT "attendance_regularization_requests_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
