-- HR letters: admin-editable templates, a gap-safe serial number counter and every letter issued.
CREATE TABLE "letter_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'any',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "signatory_name" TEXT,
    "signatory_title" TEXT,
    "serial_format" TEXT NOT NULL DEFAULT '{PREFIX}/{FY}/{SEQ:4}',
    "serial_prefix" TEXT NOT NULL DEFAULT 'LTR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "letter_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "letter_templates_org_id_kind_idx" ON "letter_templates"("org_id", "kind");

CREATE TABLE "letter_counters" (
    "org_id" UUID NOT NULL,
    "series" TEXT NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "letter_counters_pkey" PRIMARY KEY ("org_id", "series")
);

CREATE TABLE "letters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "template_id" UUID,
    "template_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "serial_number" TEXT NOT NULL,
    "serial_series" TEXT NOT NULL,
    "serial_seq" INTEGER NOT NULL,
    "recipient_type" TEXT NOT NULL,
    "org_membership_id" UUID,
    "account_id" UUID,
    "recipient_name" TEXT NOT NULL,
    "recipient_email" TEXT,
    "recipient_address" TEXT,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "signatory_name" TEXT,
    "signatory_title" TEXT,
    "issued_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "cancelled_reason" TEXT,
    "cancelled_by" UUID,
    "cancelled_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "letters_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "letters_org_id_serial_number_key" ON "letters"("org_id", "serial_number");
CREATE INDEX "letters_org_id_issued_on_idx" ON "letters"("org_id", "issued_on");
CREATE INDEX "letters_org_membership_id_idx" ON "letters"("org_membership_id");
CREATE INDEX "letters_account_id_idx" ON "letters"("account_id");
