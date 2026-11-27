-- Group Dashboard > Directory: the people the group knows (clients' and vendors' contacts, customers, employees, contractors ...) across all
-- companies, with status, source, follow-ups and when they were last contacted. New people found in any company wait in a pipeline until
-- they are added to the directory or skipped.
CREATE TABLE "group_directory_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "organisation" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "company_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "status" TEXT NOT NULL DEFAULT 'fresh',
    "source" TEXT,
    "linkedin_url" TEXT,
    "last_connected_on" DATE,
    "next_followup_date" DATE,
    "notes" TEXT,
    "pipeline_key" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "group_directory_contacts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "group_directory_contacts_org_group_id_status_idx" ON "group_directory_contacts"("org_group_id", "status");
CREATE INDEX "group_directory_contacts_org_group_id_email_idx" ON "group_directory_contacts"("org_group_id", "email");

CREATE TABLE "group_directory_followups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contact_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "contacted_on" DATE NOT NULL,
    "next_followup_date" DATE,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_directory_followups_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "group_directory_followups_contact_id_idx" ON "group_directory_followups"("contact_id");
ALTER TABLE "group_directory_followups" ADD CONSTRAINT "group_directory_followups_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "group_directory_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- people from the pipeline the group admin chose not to add (they do not come back)
CREATE TABLE "group_directory_skips" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "pipeline_key" TEXT NOT NULL,
    "skipped_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_directory_skips_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "group_directory_skips_org_group_id_pipeline_key_key" ON "group_directory_skips"("org_group_id", "pipeline_key");
