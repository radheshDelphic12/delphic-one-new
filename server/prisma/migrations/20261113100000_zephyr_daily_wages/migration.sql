-- CreateTable
CREATE TABLE "zx_wage_workers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "trade" TEXT,
    "daily_rate" DECIMAL(12,2) NOT NULL,
    "joined_on" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "zx_wage_workers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_wage_attendance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "day_fraction" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "ot_hours" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "payout_id" UUID,
    "marked_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_wage_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_wage_advances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "given_on" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_mode" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_wage_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zx_wage_payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "project_id" UUID,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "days" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "ot_hours" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advance_recovered" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_on" DATE NOT NULL,
    "payment_mode" TEXT,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'paid',
    "notes" TEXT,
    "voided_reason" TEXT,
    "paid_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zx_wage_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "zx_wage_workers_org_id_active_idx" ON "zx_wage_workers"("org_id", "active");

-- CreateIndex
CREATE INDEX "zx_wage_attendance_org_id_work_date_idx" ON "zx_wage_attendance"("org_id", "work_date");

-- CreateIndex
CREATE INDEX "zx_wage_attendance_org_id_project_id_work_date_idx" ON "zx_wage_attendance"("org_id", "project_id", "work_date");

-- CreateIndex
CREATE INDEX "zx_wage_attendance_worker_id_payout_id_idx" ON "zx_wage_attendance"("worker_id", "payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "zx_wage_attendance_worker_id_project_id_work_date_key" ON "zx_wage_attendance"("worker_id", "project_id", "work_date");

-- CreateIndex
CREATE INDEX "zx_wage_advances_org_id_worker_id_idx" ON "zx_wage_advances"("org_id", "worker_id");

-- CreateIndex
CREATE INDEX "zx_wage_payouts_org_id_paid_on_idx" ON "zx_wage_payouts"("org_id", "paid_on");

-- CreateIndex
CREATE INDEX "zx_wage_payouts_worker_id_idx" ON "zx_wage_payouts"("worker_id");

-- AddForeignKey
ALTER TABLE "zx_wage_workers" ADD CONSTRAINT "zx_wage_workers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_wage_attendance" ADD CONSTRAINT "zx_wage_attendance_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_wage_attendance" ADD CONSTRAINT "zx_wage_attendance_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "zx_wage_workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_wage_attendance" ADD CONSTRAINT "zx_wage_attendance_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "zx_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_wage_attendance" ADD CONSTRAINT "zx_wage_attendance_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "zx_wage_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_wage_advances" ADD CONSTRAINT "zx_wage_advances_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_wage_advances" ADD CONSTRAINT "zx_wage_advances_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "zx_wage_workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_wage_payouts" ADD CONSTRAINT "zx_wage_payouts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zx_wage_payouts" ADD CONSTRAINT "zx_wage_payouts_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "zx_wage_workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

