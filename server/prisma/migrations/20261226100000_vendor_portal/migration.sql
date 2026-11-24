-- Vendor portal: a vendor's own sign-in, the requirements shared with it, the profiles it submits and the invoices it uploads.
-- Separate tables on purpose (no foreign keys to the core profile / submission / invoice tables).
CREATE TABLE "vendor_portal_users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "vendor_account_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "last_login_at" TIMESTAMP(3),
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_portal_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendor_portal_users_email_key" ON "vendor_portal_users"("email");
CREATE INDEX "vendor_portal_users_org_id_vendor_account_id_idx" ON "vendor_portal_users"("org_id", "vendor_account_id");

CREATE TABLE "vendor_requirement_shares" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "requirement_id" UUID NOT NULL,
  "vendor_account_id" UUID NOT NULL,
  "shared_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_requirement_shares_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendor_requirement_shares_requirement_id_vendor_account_id_key" ON "vendor_requirement_shares"("requirement_id", "vendor_account_id");
CREATE INDEX "vendor_requirement_shares_org_id_vendor_account_id_idx" ON "vendor_requirement_shares"("org_id", "vendor_account_id");

CREATE TABLE "vendor_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "requirement_id" UUID NOT NULL,
  "vendor_account_id" UUID NOT NULL,
  "portal_user_id" UUID NOT NULL,
  "candidate_name" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "current_company" TEXT,
  "current_location" TEXT,
  "total_experience_years" DECIMAL(4,1) NOT NULL,
  "relevant_experience_years" DECIMAL(4,1),
  "skills" TEXT[],
  "current_ctc" DECIMAL(14,2),
  "expected_ctc" DECIMAL(14,2),
  "notice_period_days" INTEGER,
  "vendor_rate" DECIMAL(14,2),
  "vendor_rate_currency" TEXT NOT NULL DEFAULT 'INR',
  "linkedin_url" TEXT,
  "cv_url" TEXT,
  "cv_file_path" TEXT,
  "cv_file_name" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "decided_by" UUID,
  "decided_at" TIMESTAMP(3),
  "decision_note" TEXT,
  "profile_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_submissions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vendor_submissions_org_id_status_idx" ON "vendor_submissions"("org_id", "status");
CREATE INDEX "vendor_submissions_vendor_account_id_requirement_id_idx" ON "vendor_submissions"("vendor_account_id", "requirement_id");

CREATE TABLE "vendor_portal_invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "vendor_account_id" UUID NOT NULL,
  "portal_user_id" UUID NOT NULL,
  "period_month" INTEGER NOT NULL,
  "period_year" INTEGER NOT NULL,
  "invoice_number" TEXT,
  "invoice_date" DATE,
  "amount" DECIMAL(14,2),
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "notes" TEXT,
  "file_path" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_size" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'uploaded',
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vendor_portal_invoices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "vendor_portal_invoices_org_id_status_idx" ON "vendor_portal_invoices"("org_id", "status");
CREATE INDEX "vendor_portal_invoices_vendor_account_id_period_year_period_month_idx" ON "vendor_portal_invoices"("vendor_account_id", "period_year", "period_month");
