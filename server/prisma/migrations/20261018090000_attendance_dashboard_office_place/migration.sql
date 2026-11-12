-- CreateTable
CREATE TABLE "employee_office_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_office_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_place_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "work_place" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "requested_by" UUID,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_place_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_office_assignments_org_membership_id_effective_fro_key" ON "employee_office_assignments"("org_membership_id", "effective_from");

-- CreateIndex
CREATE INDEX "employee_office_assignments_org_id_org_membership_id_idx" ON "employee_office_assignments"("org_id", "org_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_place_days_org_membership_id_date_key" ON "work_place_days"("org_membership_id", "date");

-- CreateIndex
CREATE INDEX "work_place_days_org_id_date_idx" ON "work_place_days"("org_id", "date");

-- AddForeignKey
ALTER TABLE "employee_office_assignments" ADD CONSTRAINT "employee_office_assignments_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_office_assignments" ADD CONSTRAINT "employee_office_assignments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_place_days" ADD CONSTRAINT "work_place_days_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
