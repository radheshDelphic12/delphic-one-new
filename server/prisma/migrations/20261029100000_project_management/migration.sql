-- Project Management (Delphic Global): projects + tickets, optional contract links. Additive only.
CREATE TYPE "PmProjectStatus" AS ENUM ('planning', 'active', 'on_hold', 'completed', 'cancelled');
CREATE TYPE "PmStatusCategory" AS ENUM ('todo', 'in_progress', 'blocked', 'done');

CREATE TABLE "pm_projects" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "PmProjectStatus" NOT NULL DEFAULT 'planning',
  "owner_membership_id" UUID,
  "start_date" DATE,
  "end_date" DATE,
  "ticket_seq" INTEGER NOT NULL DEFAULT 0,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_projects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pm_projects_org_id_code_key" ON "pm_projects"("org_id", "code");
CREATE INDEX "pm_projects_org_id_status_idx" ON "pm_projects"("org_id", "status");

CREATE TABLE "pm_project_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_project_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pm_project_members_project_id_membership_id_key" ON "pm_project_members"("project_id", "membership_id");
CREATE INDEX "pm_project_members_org_id_membership_id_idx" ON "pm_project_members"("org_id", "membership_id");

CREATE TABLE "pm_statuses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" "PmStatusCategory" NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_statuses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pm_statuses_org_id_key_key" ON "pm_statuses"("org_id", "key");

CREATE TABLE "pm_tickets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL DEFAULT 'task',
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "status_key" TEXT NOT NULL DEFAULT 'open',
  "assignee_membership_id" UUID,
  "reporter_membership_id" UUID,
  "contract_id" UUID,
  "due_date" DATE,
  "resolution" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_tickets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pm_tickets_project_id_number_key" ON "pm_tickets"("project_id", "number");
CREATE INDEX "pm_tickets_org_id_assignee_membership_id_idx" ON "pm_tickets"("org_id", "assignee_membership_id");
CREATE INDEX "pm_tickets_project_id_status_key_idx" ON "pm_tickets"("project_id", "status_key");

CREATE TABLE "pm_ticket_comments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "ticket_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_ticket_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pm_ticket_comments_ticket_id_created_at_idx" ON "pm_ticket_comments"("ticket_id", "created_at");

CREATE TABLE "pm_activity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "ticket_id" UUID,
  "actor_user_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "from_value" TEXT,
  "to_value" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_activity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pm_activity_project_id_created_at_idx" ON "pm_activity"("project_id", "created_at");
CREATE INDEX "pm_activity_ticket_id_created_at_idx" ON "pm_activity"("ticket_id", "created_at");

CREATE TABLE "pm_project_contracts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "contract_id" UUID NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "linked_by" UUID NOT NULL,
  "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_project_contracts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pm_project_contracts_contract_id_key" ON "pm_project_contracts"("contract_id");
CREATE INDEX "pm_project_contracts_project_id_idx" ON "pm_project_contracts"("project_id");

ALTER TABLE "pm_project_members" ADD CONSTRAINT "pm_project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pm_tickets" ADD CONSTRAINT "pm_tickets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pm_ticket_comments" ADD CONSTRAINT "pm_ticket_comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "pm_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pm_activity" ADD CONSTRAINT "pm_activity_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pm_activity" ADD CONSTRAINT "pm_activity_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "pm_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pm_project_contracts" ADD CONSTRAINT "pm_project_contracts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
