-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('bda', 'sales', 'recruiter', 'admin');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('client', 'vendor');

-- CreateEnum
CREATE TYPE "AccountStage" AS ENUM ('lead', 'meeting_scheduled', 'active', 'rescheduled', 'dropped');

-- CreateEnum
CREATE TYPE "CompanySize" AS ENUM ('startup', 'small', 'mid', 'enterprise');

-- CreateEnum
CREATE TYPE "MeetingMode" AS ENUM ('online', 'offline');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP');

-- CreateEnum
CREATE TYPE "ProfileCurrency" AS ENUM ('INR', 'USD', 'AED', 'SAR');

-- CreateEnum
CREATE TYPE "ReqType" AS ENUM ('project', 'developer');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('open', 'in_progress', 'on_hold', 'closed', 'dropped');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('remote', 'onsite', 'hybrid');

-- CreateEnum
CREATE TYPE "EngagementType" AS ENUM ('full_time', 'part_time', 'contract');

-- CreateEnum
CREATE TYPE "BudgetType" AS ENUM ('monthly', 'hourly', 'annual', 'fixed_project');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "SeatStatus" AS ENUM ('open', 'interviewing', 'offer', 'bgv', 'closed', 'dropped');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('sales', 'recruiter');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "ProfileSource" AS ENUM ('internal', 'vendor', 'linkedin');

-- CreateEnum
CREATE TYPE "SubmissionStage" AS ENUM ('sourced', 'internal_screening', 'submitted_to_client', 'interview_scheduled', 'interview_result', 'offer', 'bgv', 'closed', 'backout', 'rejected');

-- CreateEnum
CREATE TYPE "RateType" AS ENUM ('monthly', 'hourly', 'annual');

-- CreateEnum
CREATE TYPE "BgvStatus" AS ENUM ('pending', 'in_progress', 'cleared', 'failed');

-- CreateEnum
CREATE TYPE "RoundType" AS ENUM ('internal', 'client_l1', 'client_l2', 'client_hr', 'client_final');

-- CreateEnum
CREATE TYPE "RoundResult" AS ENUM ('pending', 'pass', 'fail', 'no_show', 'rescheduled');

-- CreateEnum
CREATE TYPE "HistoryEntityType" AS ENUM ('account', 'requirement', 'seat', 'submission');

-- CreateEnum
CREATE TYPE "DocumentEntityType" AS ENUM ('account', 'requirement', 'profile', 'submission');

-- CreateEnum
CREATE TYPE "CommentEntityType" AS ENUM ('account', 'requirement', 'submission');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "stage" "AccountStage" NOT NULL DEFAULT 'lead',
    "industry" TEXT,
    "company_size" "CompanySize",
    "website" TEXT,
    "location_city" TEXT,
    "location_country" TEXT,
    "gst_or_tax_id" TEXT,
    "poc_name" TEXT,
    "poc_email" TEXT,
    "poc_phone" TEXT,
    "poc_designation" TEXT,
    "additional_contacts" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT,
    "meeting_mode" "MeetingMode",
    "meeting_date" TIMESTAMP(3),
    "meeting_notes" TEXT,
    "vendor_specializations" TEXT[],
    "vendor_rate_range" JSONB,
    "vendor_payment_terms" TEXT,
    "vendor_agreement_url" TEXT,
    "client_billing_currency" "Currency",
    "client_payment_terms" TEXT,
    "client_agreement_url" TEXT,
    "owner_id" UUID NOT NULL,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "req_type" "ReqType" NOT NULL,
    "status" "RequirementStatus" NOT NULL DEFAULT 'open',
    "description" TEXT,
    "jd_document_url" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "seats_total" INTEGER NOT NULL DEFAULT 1,
    "primary_tech_stack" TEXT[],
    "secondary_tech_stack" TEXT[],
    "domain_experience" TEXT,
    "experience_min" DECIMAL(4,1),
    "experience_max" DECIMAL(4,1),
    "certifications_required" TEXT[],
    "work_mode" "WorkMode",
    "work_location" TEXT,
    "time_zone_preference" TEXT,
    "engagement_type" "EngagementType",
    "contract_duration_months" INTEGER,
    "start_date_target" DATE,
    "notice_period_max_days" INTEGER,
    "budget_min" DECIMAL(14,2),
    "budget_max" DECIMAL(14,2),
    "budget_currency" "Currency" NOT NULL DEFAULT 'INR',
    "budget_type" "BudgetType",
    "billing_notes" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'medium',
    "sla_days" INTEGER,
    "sales_owner_id" UUID NOT NULL,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_seats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirement_id" UUID NOT NULL,
    "seat_label" TEXT,
    "seat_status" "SeatStatus" NOT NULL DEFAULT 'open',
    "closed_at" TIMESTAMP(3),
    "joined_at" DATE,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "requirement_seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requirement_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirement_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_on_req" "AssignmentRole" NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMP(3),
    "assigned_by" UUID NOT NULL,

    CONSTRAINT "requirement_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "date_of_birth" DATE,
    "gender" "Gender",
    "current_location" TEXT,
    "willing_to_relocate" BOOLEAN,
    "preferred_locations" TEXT[],
    "current_company" TEXT,
    "current_designation" TEXT,
    "total_experience_years" DECIMAL(4,1) NOT NULL,
    "relevant_experience_years" DECIMAL(4,1),
    "primary_skills" TEXT[],
    "secondary_skills" TEXT[],
    "certifications" TEXT[],
    "domain_experience" TEXT[],
    "education" JSONB,
    "current_ctc" DECIMAL(14,2),
    "current_ctc_currency" "ProfileCurrency" NOT NULL DEFAULT 'INR',
    "expected_ctc" DECIMAL(14,2),
    "expected_ctc_currency" "ProfileCurrency" NOT NULL DEFAULT 'INR',
    "ctc_negotiable" BOOLEAN NOT NULL DEFAULT false,
    "ctc_notes" TEXT,
    "notice_period_days" INTEGER,
    "is_serving_notice" BOOLEAN NOT NULL DEFAULT false,
    "last_working_day" DATE,
    "earliest_join_date" DATE,
    "preferred_work_mode" "WorkMode",
    "resume_url" TEXT,
    "linkedin_url" TEXT,
    "portfolio_url" TEXT,
    "other_documents" JSONB NOT NULL DEFAULT '[]',
    "source" "ProfileSource" NOT NULL,
    "vendor_account_id" UUID,
    "vendor_profile_id" TEXT,
    "added_by" UUID NOT NULL,
    "recruiter_notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirement_seat_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "stage" "SubmissionStage" NOT NULL DEFAULT 'sourced',
    "proposed_rate" DECIMAL(14,2),
    "proposed_rate_type" "RateType",
    "proposed_rate_currency" "ProfileCurrency" DEFAULT 'INR',
    "vendor_rate" DECIMAL(14,2),
    "vendor_rate_type" "RateType",
    "vendor_rate_currency" "ProfileCurrency",
    "margin" DECIMAL(14,2),
    "margin_percentage" DECIMAL(6,2),
    "final_agreed_rate" DECIMAL(14,2),
    "final_agreed_rate_type" "RateType",
    "submission_notes" TEXT,
    "client_feedback" TEXT,
    "relevancy_score" INTEGER,
    "backout_stage" TEXT,
    "backout_reason" TEXT,
    "rejection_stage" TEXT,
    "rejection_reason" TEXT,
    "offer_date" DATE,
    "offer_ctc" DECIMAL(14,2),
    "offer_ctc_currency" "ProfileCurrency",
    "expected_joining_date" DATE,
    "actual_joining_date" DATE,
    "bgv_initiated_date" DATE,
    "bgv_status" "BgvStatus",
    "bgv_completed_date" DATE,
    "bgv_notes" TEXT,
    "submitted_by" UUID NOT NULL,
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "round_number" INTEGER NOT NULL,
    "round_type" "RoundType" NOT NULL,
    "round_name" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "interviewer_name" TEXT,
    "interviewer_email" TEXT,
    "meeting_link" TEXT,
    "result" "RoundResult" NOT NULL DEFAULT 'pending',
    "feedback" TEXT,
    "rating" INTEGER,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "interview_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" "HistoryEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "from_stage" TEXT,
    "to_stage" TEXT NOT NULL,
    "changed_by" UUID NOT NULL,
    "reason" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" "DocumentEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_type" TEXT,
    "file_size_bytes" INTEGER,
    "uploaded_by" UUID NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" "CommentEntityType" NOT NULL,
    "entity_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "accounts_type_stage_idx" ON "accounts"("type", "stage");

-- CreateIndex
CREATE INDEX "accounts_owner_id_idx" ON "accounts"("owner_id");

-- CreateIndex
CREATE INDEX "requirements_account_id_idx" ON "requirements"("account_id");

-- CreateIndex
CREATE INDEX "requirements_status_priority_idx" ON "requirements"("status", "priority");

-- CreateIndex
CREATE INDEX "requirements_sales_owner_id_idx" ON "requirements"("sales_owner_id");

-- CreateIndex
CREATE INDEX "requirement_seats_requirement_id_idx" ON "requirement_seats"("requirement_id");

-- CreateIndex
CREATE INDEX "requirement_seats_seat_status_idx" ON "requirement_seats"("seat_status");

-- CreateIndex
CREATE INDEX "requirement_assignments_requirement_id_idx" ON "requirement_assignments"("requirement_id");

-- CreateIndex
CREATE INDEX "requirement_assignments_user_id_idx" ON "requirement_assignments"("user_id");

-- CreateIndex
CREATE INDEX "profiles_source_idx" ON "profiles"("source");

-- CreateIndex
CREATE INDEX "profiles_added_by_idx" ON "profiles"("added_by");

-- CreateIndex
CREATE INDEX "profiles_is_active_idx" ON "profiles"("is_active");

-- CreateIndex
CREATE INDEX "submissions_requirement_seat_id_idx" ON "submissions"("requirement_seat_id");

-- CreateIndex
CREATE INDEX "submissions_profile_id_idx" ON "submissions"("profile_id");

-- CreateIndex
CREATE INDEX "submissions_stage_idx" ON "submissions"("stage");

-- CreateIndex
CREATE INDEX "interview_rounds_submission_id_idx" ON "interview_rounds"("submission_id");

-- CreateIndex
CREATE INDEX "stage_history_entity_type_entity_id_idx" ON "stage_history"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "documents_entity_type_entity_id_idx" ON "documents"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "comments_entity_type_entity_id_idx" ON "comments"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_sales_owner_id_fkey" FOREIGN KEY ("sales_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_seats" ADD CONSTRAINT "requirement_seats_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_assignments" ADD CONSTRAINT "requirement_assignments_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_assignments" ADD CONSTRAINT "requirement_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requirement_assignments" ADD CONSTRAINT "requirement_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_vendor_account_id_fkey" FOREIGN KEY ("vendor_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_requirement_seat_id_fkey" FOREIGN KEY ("requirement_seat_id") REFERENCES "requirement_seats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_rounds" ADD CONSTRAINT "interview_rounds_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
