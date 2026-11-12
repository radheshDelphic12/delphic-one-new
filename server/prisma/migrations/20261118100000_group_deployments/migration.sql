-- CreateTable
CREATE TABLE "group_deployments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "org_id" UUID,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'deployment',
    "client_name" TEXT NOT NULL,
    "client_account_id" UUID,
    "client_location" TEXT,
    "client_supervisor_name" TEXT,
    "client_supervisor_phone" TEXT,
    "client_supervisor_email" TEXT,
    "pm_project_id" UUID,
    "purpose" TEXT,
    "start_date" DATE NOT NULL,
    "expected_end_date" DATE NOT NULL,
    "actual_end_date" DATE,
    "working_arrangement" TEXT NOT NULL DEFAULT 'client_office',
    "reporting_manager_user_id" UUID,
    "reporting_manager_name" TEXT,
    "delivery_manager_user_id" UUID,
    "delivery_manager_name" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "emergency_reason" TEXT,
    "started_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "close_reason" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "group_deployments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_deployment_people" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "org_id" UUID,
    "role" TEXT,
    "arrangement" TEXT NOT NULL DEFAULT 'inherit',
    "start_date" DATE,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "released_on" DATE,
    "release_reason" TEXT,
    "replaces_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_deployment_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_deployment_budget_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'one_time',
    "funding" TEXT NOT NULL DEFAULT 'company',
    "client_share_pct" DECIMAL(5,2),
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_deployment_budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_deployment_travel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "person_id" UUID,
    "mode" TEXT NOT NULL,
    "from_place" TEXT,
    "to_place" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "vendor" TEXT,
    "booking_ref" TEXT,
    "estimated_cost" DECIMAL(14,2),
    "status" TEXT NOT NULL DEFAULT 'planned',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_deployment_travel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_deployment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "detail" JSONB,
    "by_user" UUID,
    "by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_deployment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_deployment_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "emergency_reason" TEXT,
    "requested_by" UUID,
    "requested_by_name" TEXT,
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "group_deployment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_deployment_request_steps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_by_name" TEXT,
    "decided_at" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "group_deployment_request_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_deployment_expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "person_id" UUID,
    "expense_date" DATE NOT NULL,
    "month" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "funding" TEXT NOT NULL DEFAULT 'company',
    "client_share_pct" DECIMAL(5,2),
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "client_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bill_url" TEXT,
    "bill_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "submitted_by" UUID,
    "submitted_by_name" TEXT,
    "verified_by" UUID,
    "verified_by_name" TEXT,
    "verified_at" TIMESTAMP(3),
    "verify_note" TEXT,
    "settled_on" DATE,
    "settlement_ref" TEXT,
    "recovery_status" TEXT NOT NULL DEFAULT 'none',
    "recovered_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "recovered_on" DATE,
    "over_budget" BOOLEAN NOT NULL DEFAULT false,
    "overrun_request_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "group_deployment_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_deployment_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "user_id" UUID,
    "log_date" DATE NOT NULL,
    "location_mode" TEXT NOT NULL DEFAULT 'client_office',
    "hours" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "activities" TEXT NOT NULL,
    "deliverables" TEXT,
    "pending_tasks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_deployment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_deployment_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deployment_id" UUID NOT NULL,
    "person_id" UUID,
    "kind" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "rating" INTEGER,
    "summary" TEXT NOT NULL,
    "client_contact" TEXT,
    "created_by" UUID,
    "created_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_deployment_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_deployment_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "approval_steps" TEXT[] DEFAULT ARRAY['reporting_manager', 'delivery_manager', 'finance', 'admin']::TEXT[],
    "emergency_allowed" BOOLEAN NOT NULL DEFAULT true,
    "extension_needs_approval" BOOLEAN NOT NULL DEFAULT true,
    "allocation_needs_approval" BOOLEAN NOT NULL DEFAULT true,
    "overrun_tolerance_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "ending_soon_days" INTEGER NOT NULL DEFAULT 14,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_deployment_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_deployments_org_group_id_status_idx" ON "group_deployments"("org_group_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "group_deployments_org_group_id_code_key" ON "group_deployments"("org_group_id", "code");

-- CreateIndex
CREATE INDEX "group_deployment_people_deployment_id_idx" ON "group_deployment_people"("deployment_id");

-- CreateIndex
CREATE INDEX "group_deployment_people_user_id_idx" ON "group_deployment_people"("user_id");

-- CreateIndex
CREATE INDEX "group_deployment_budget_lines_deployment_id_idx" ON "group_deployment_budget_lines"("deployment_id");

-- CreateIndex
CREATE INDEX "group_deployment_travel_deployment_id_idx" ON "group_deployment_travel"("deployment_id");

-- CreateIndex
CREATE INDEX "group_deployment_events_deployment_id_created_at_idx" ON "group_deployment_events"("deployment_id", "created_at");

-- CreateIndex
CREATE INDEX "group_deployment_requests_deployment_id_status_idx" ON "group_deployment_requests"("deployment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "group_deployment_request_steps_request_id_seq_key" ON "group_deployment_request_steps"("request_id", "seq");

-- CreateIndex
CREATE INDEX "group_deployment_expenses_deployment_id_month_idx" ON "group_deployment_expenses"("deployment_id", "month");

-- CreateIndex
CREATE INDEX "group_deployment_logs_deployment_id_log_date_idx" ON "group_deployment_logs"("deployment_id", "log_date");

-- CreateIndex
CREATE UNIQUE INDEX "group_deployment_logs_person_id_log_date_key" ON "group_deployment_logs"("person_id", "log_date");

-- CreateIndex
CREATE INDEX "group_deployment_reviews_deployment_id_kind_period_start_idx" ON "group_deployment_reviews"("deployment_id", "kind", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "group_deployment_settings_org_group_id_key" ON "group_deployment_settings"("org_group_id");

-- AddForeignKey
ALTER TABLE "group_deployments" ADD CONSTRAINT "group_deployments_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_deployment_people" ADD CONSTRAINT "group_deployment_people_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "group_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_deployment_budget_lines" ADD CONSTRAINT "group_deployment_budget_lines_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "group_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_deployment_travel" ADD CONSTRAINT "group_deployment_travel_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "group_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_deployment_events" ADD CONSTRAINT "group_deployment_events_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "group_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_deployment_requests" ADD CONSTRAINT "group_deployment_requests_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "group_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_deployment_request_steps" ADD CONSTRAINT "group_deployment_request_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "group_deployment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_deployment_expenses" ADD CONSTRAINT "group_deployment_expenses_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "group_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_deployment_logs" ADD CONSTRAINT "group_deployment_logs_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "group_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_deployment_reviews" ADD CONSTRAINT "group_deployment_reviews_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "group_deployments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_deployment_settings" ADD CONSTRAINT "group_deployment_settings_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

