-- Project Management: per-project custom fields, tickets hidden from client shares, public / guest comments. Additive.
CREATE TABLE "pm_custom_fields" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "options" JSONB NOT NULL DEFAULT '[]',
  "required" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pm_custom_fields_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pm_custom_fields_project_id_key_key" ON "pm_custom_fields"("project_id", "key");
ALTER TABLE "pm_custom_fields" ADD CONSTRAINT "pm_custom_fields_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "pm_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pm_tickets" ADD COLUMN "custom_values" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "pm_tickets" ADD COLUMN "internal_only" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "pm_ticket_comments" ALTER COLUMN "author_user_id" DROP NOT NULL;
ALTER TABLE "pm_ticket_comments" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pm_ticket_comments" ADD COLUMN "external_label" TEXT;
