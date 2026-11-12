-- Project Management: ticket notifications and ticket attachments. Additive only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'pm_ticket_assigned';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'pm_ticket_status_changed';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'pm_ticket_commented';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'pm_ticket_due_soon';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'pm_ticket';

CREATE TABLE "pm_ticket_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "ticket_id" UUID NOT NULL,
  "filename" TEXT NOT NULL,
  "stored_name" TEXT NOT NULL,
  "mime_type" TEXT,
  "size_bytes" INTEGER NOT NULL,
  "uploaded_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_ticket_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pm_ticket_attachments_ticket_id_idx" ON "pm_ticket_attachments"("ticket_id");
ALTER TABLE "pm_ticket_attachments" ADD CONSTRAINT "pm_ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "pm_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
