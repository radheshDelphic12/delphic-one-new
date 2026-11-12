-- Speak Up - Confidential Reporting: a confidential channel to raise complaints, routed to the handlers an admin sets per category.
-- Six new tables, nothing existing is changed. Additive only. Off for every company until an admin enables it.
CREATE TABLE IF NOT EXISTS "whistle_settings" (
  "org_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "allow_anonymous" BOOLEAN NOT NULL DEFAULT true,
  "sla_days" INTEGER NOT NULL DEFAULT 7,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whistle_settings_pkey" PRIMARY KEY ("org_id")
);

CREATE TABLE IF NOT EXISTS "whistle_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "examples" TEXT NOT NULL DEFAULT '',
  "restricted" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "handler_membership_ids" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whistle_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "whistle_categories_org_id_number_key" ON "whistle_categories"("org_id", "number");
CREATE INDEX IF NOT EXISTS "whistle_categories_org_id_idx" ON "whistle_categories"("org_id");

CREATE TABLE IF NOT EXISTS "whistle_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "seq" INTEGER NOT NULL,
  "case_no" TEXT NOT NULL,
  "category_id" UUID NOT NULL,
  "subject" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "incident_date" DATE,
  "location_id" UUID,
  "department_id" UUID,
  "people_involved" TEXT,
  "involved_membership_ids" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'new',
  "reporter_membership_id" UUID,
  "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
  "access_code_hash" TEXT,
  "assigned_membership_id" UUID,
  "resolution" TEXT,
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whistle_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whistle_cases_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "whistle_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "whistle_cases_org_id_case_no_key" ON "whistle_cases"("org_id", "case_no");
CREATE UNIQUE INDEX IF NOT EXISTS "whistle_cases_org_id_seq_key" ON "whistle_cases"("org_id", "seq");
CREATE INDEX IF NOT EXISTS "whistle_cases_org_id_status_idx" ON "whistle_cases"("org_id", "status");
CREATE INDEX IF NOT EXISTS "whistle_cases_reporter_membership_id_idx" ON "whistle_cases"("reporter_membership_id");

CREATE TABLE IF NOT EXISTS "whistle_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "case_id" UUID NOT NULL,
  "author_kind" TEXT NOT NULL,
  "author_membership_id" UUID,
  "body" TEXT NOT NULL,
  "internal" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whistle_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whistle_messages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "whistle_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "whistle_messages_case_id_created_at_idx" ON "whistle_messages"("case_id", "created_at");

CREATE TABLE IF NOT EXISTS "whistle_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "case_id" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "actor_membership_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whistle_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whistle_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "whistle_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "whistle_events_case_id_created_at_idx" ON "whistle_events"("case_id", "created_at");

CREATE TABLE IF NOT EXISTS "whistle_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "case_id" UUID NOT NULL,
  "message_id" UUID,
  "file_name" TEXT NOT NULL,
  "stored_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whistle_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whistle_attachments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "whistle_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whistle_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "whistle_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "whistle_attachments_case_id_idx" ON "whistle_attachments"("case_id");
