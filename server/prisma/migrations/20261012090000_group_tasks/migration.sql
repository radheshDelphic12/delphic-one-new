-- CreateTable
CREATE TABLE "group_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "org_id" UUID,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "kind" TEXT NOT NULL DEFAULT 'one_time',
    "due_date" DATE,
    "frequency" TEXT,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "day_of_month" INTEGER,
    "start_date" DATE,
    "end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "assignee_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "group_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_task_done" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "occurrence_date" DATE NOT NULL,
    "done_by" UUID,
    "done_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "group_task_done_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_company_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "note" TEXT,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_company_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_tasks_org_group_id_kind_status_idx" ON "group_tasks"("org_group_id", "kind", "status");

-- CreateIndex
CREATE INDEX "group_tasks_org_group_id_due_date_idx" ON "group_tasks"("org_group_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "group_task_done_task_id_occurrence_date_key" ON "group_task_done"("task_id", "occurrence_date");

-- CreateIndex
CREATE INDEX "group_company_days_org_group_id_idx" ON "group_company_days"("org_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_company_days_org_id_weekday_key" ON "group_company_days"("org_id", "weekday");

-- AddForeignKey
ALTER TABLE "group_tasks" ADD CONSTRAINT "group_tasks_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_task_done" ADD CONSTRAINT "group_task_done_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "group_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_company_days" ADD CONSTRAINT "group_company_days_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
