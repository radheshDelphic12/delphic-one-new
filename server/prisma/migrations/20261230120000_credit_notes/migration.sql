-- Finance > Credit notes: a numbered credit of an amount to a client (reduces what they owe on an invoice) or from a vendor (reduces
-- what we owe on a vendor invoice). Cancelled, never deleted.
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "party_type" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "invoice_kind" TEXT,
    "invoice_id" UUID,
    "issue_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "credit_notes_org_id_number_key" ON "credit_notes"("org_id", "number");
CREATE INDEX "credit_notes_org_id_party_type_idx" ON "credit_notes"("org_id", "party_type");
CREATE INDEX "credit_notes_invoice_id_idx" ON "credit_notes"("invoice_id");
