-- Delphic One workspace (the company that sells the product): customers, leads with notes, invoices with payments.
CREATE TABLE "dox_customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "gstin" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL DEFAULT 'trial',
    "plan_name" TEXT,
    "users_count" INTEGER NOT NULL DEFAULT 0,
    "monthly_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "trial_ends_on" DATE,
    "started_on" DATE,
    "owner_user_id" UUID,
    "notes" TEXT,
    "lead_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "dox_customers_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dox_customers_org_id_status_idx" ON "dox_customers"("org_id", "status");

CREATE TABLE "dox_leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "source" TEXT NOT NULL DEFAULT 'website',
    "stage" TEXT NOT NULL DEFAULT 'new',
    "expected_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "users_expected" INTEGER,
    "owner_user_id" UUID,
    "next_followup_date" DATE,
    "notes" TEXT,
    "customer_id" UUID,
    "lost_reason" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "dox_leads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dox_leads_org_id_stage_idx" ON "dox_leads"("org_id", "stage");

CREATE TABLE "dox_lead_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "stage_to" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dox_lead_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dox_lead_notes_lead_id_idx" ON "dox_lead_notes"("lead_id");

CREATE TABLE "dox_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "next_followup_date" DATE,
    "description" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "gst_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "cancelled_reason" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dox_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dox_invoices_org_id_number_key" ON "dox_invoices"("org_id", "number");
CREATE INDEX "dox_invoices_org_id_customer_id_idx" ON "dox_invoices"("org_id", "customer_id");

CREATE TABLE "dox_invoice_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'neft',
    "reference" TEXT,
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "dox_invoice_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dox_invoice_payments_invoice_id_idx" ON "dox_invoice_payments"("invoice_id");
