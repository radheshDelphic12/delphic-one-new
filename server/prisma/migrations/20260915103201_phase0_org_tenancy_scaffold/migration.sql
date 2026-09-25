-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('active', 'on_leave', 'terminated');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "interview_rounds" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "requirements" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "stage_history" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "org_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_group_superadmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "org_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orgs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "default_currency" "Currency" NOT NULL DEFAULT 'INR',
    "status" "OrgStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "person_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "role" "UserRole" NOT NULL,
    "employee_code" TEXT,
    "department_id" UUID,
    "employment_status" "EmploymentStatus" NOT NULL DEFAULT 'active',
    "joined_at" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orgs_slug_key" ON "orgs"("slug");

-- CreateIndex
CREATE INDEX "orgs_org_group_id_idx" ON "orgs"("org_group_id");

-- CreateIndex
CREATE INDEX "org_memberships_org_id_idx" ON "org_memberships"("org_id");

-- CreateIndex
CREATE INDEX "org_memberships_person_id_idx" ON "org_memberships"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_person_id_org_id_key" ON "org_memberships"("person_id", "org_id");

-- CreateIndex
CREATE INDEX "accounts_org_id_idx" ON "accounts"("org_id");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_idx" ON "audit_logs"("org_id");

-- CreateIndex
CREATE INDEX "comments_org_id_idx" ON "comments"("org_id");

-- CreateIndex
CREATE INDEX "documents_org_id_idx" ON "documents"("org_id");

-- CreateIndex
CREATE INDEX "interview_rounds_org_id_idx" ON "interview_rounds"("org_id");

-- CreateIndex
CREATE INDEX "notification_preferences_org_id_idx" ON "notification_preferences"("org_id");

-- CreateIndex
CREATE INDEX "notifications_org_id_idx" ON "notifications"("org_id");

-- CreateIndex
CREATE INDEX "profiles_org_id_idx" ON "profiles"("org_id");

-- CreateIndex
CREATE INDEX "requirements_org_id_idx" ON "requirements"("org_id");

-- CreateIndex
CREATE INDEX "stage_history_org_id_idx" ON "stage_history"("org_id");

-- CreateIndex
CREATE INDEX "submissions_org_id_idx" ON "submissions"("org_id");

-- AddForeignKey
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_rounds" ADD CONSTRAINT "interview_rounds_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
