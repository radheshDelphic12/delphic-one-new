-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('pending', 'in_progress', 'completed');

-- AlterTable
ALTER TABLE "timesheet_entries" ADD COLUMN     "holiday_label" TEXT,
ADD COLUMN     "is_holiday_overtime" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "assigned_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "assignee_membership_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "module_name" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'pending',
    "due_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assigned_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assigned_tasks_assignee_membership_id_status_idx" ON "assigned_tasks"("assignee_membership_id", "status");

-- CreateIndex
CREATE INDEX "assigned_tasks_org_id_idx" ON "assigned_tasks"("org_id");

-- AddForeignKey
ALTER TABLE "assigned_tasks" ADD CONSTRAINT "assigned_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assigned_tasks" ADD CONSTRAINT "assigned_tasks_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assigned_tasks" ADD CONSTRAINT "assigned_tasks_assignee_membership_id_fkey" FOREIGN KEY ("assignee_membership_id") REFERENCES "org_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assigned_tasks" ADD CONSTRAINT "assigned_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

