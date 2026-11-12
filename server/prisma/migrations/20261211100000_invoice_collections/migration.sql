-- Payment collection: due date and next follow-up date on client invoices, next follow-up date on group invoices, and a log of every chase.
ALTER TABLE "client_invoices" ADD COLUMN "due_date" DATE;
ALTER TABLE "client_invoices" ADD COLUMN "next_followup_date" DATE;
ALTER TABLE "group_invoices" ADD COLUMN "next_followup_date" DATE;

CREATE TABLE "invoice_followups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_kind" TEXT NOT NULL,
    "invoice_id" UUID NOT NULL,
    "org_id" UUID,
    "org_group_id" UUID,
    "followed_on" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "next_followup_date" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_followups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "invoice_followups_invoice_kind_invoice_id_idx" ON "invoice_followups"("invoice_kind", "invoice_id");
