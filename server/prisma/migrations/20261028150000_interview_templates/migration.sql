-- Interview templates per service type, per-skill ratings, Internal Hiring service type.
ALTER TYPE "ReqType" ADD VALUE IF NOT EXISTS 'internal_hiring';
ALTER TYPE "RoundType" ADD VALUE IF NOT EXISTS 'template_internal';
ALTER TYPE "RoundType" ADD VALUE IF NOT EXISTS 'template_client';

CREATE TABLE "interview_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "service_types" TEXT[],
    "hiring_track" TEXT,
    "pass_percentage" INTEGER NOT NULL DEFAULT 60,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interview_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "interview_template_rounds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "conducted_by" TEXT NOT NULL DEFAULT 'delphic',
    "kind" TEXT NOT NULL DEFAULT 'interview',
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "rating_required" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "interview_template_rounds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "interview_round_skill_ratings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "interview_round_id" UUID NOT NULL,
    "skill_name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    CONSTRAINT "interview_round_skill_ratings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "interview_rounds" ADD COLUMN "score_percent" DECIMAL(5,2), ADD COLUMN "template_round_id" UUID;
ALTER TABLE "requirements" ADD COLUMN "hiring_track" TEXT, ADD COLUMN "interview_template_id" UUID, ADD COLUMN "pass_percentage" INTEGER;

CREATE INDEX "interview_template_rounds_template_id_sort_order_idx" ON "interview_template_rounds"("template_id", "sort_order");
CREATE INDEX "interview_round_skill_ratings_interview_round_id_idx" ON "interview_round_skill_ratings"("interview_round_id");

ALTER TABLE "interview_template_rounds" ADD CONSTRAINT "interview_template_rounds_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "interview_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interview_round_skill_ratings" ADD CONSTRAINT "interview_round_skill_ratings_interview_round_id_fkey" FOREIGN KEY ("interview_round_id") REFERENCES "interview_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_interview_template_id_fkey" FOREIGN KEY ("interview_template_id") REFERENCES "interview_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "interview_rounds" ADD CONSTRAINT "interview_rounds_template_round_id_fkey" FOREIGN KEY ("template_round_id") REFERENCES "interview_template_rounds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Default templates (admin-editable afterwards). Fixed ids so the rounds can reference them.
INSERT INTO "interview_templates" ("id", "name", "description", "service_types", "hiring_track", "pass_percentage") VALUES
 ('00000000-0000-4000-8000-0000000000a1', 'Internal Technical Hiring', 'Delphic''s own technical hires', ARRAY['internal_hiring'], 'technical', 60),
 ('00000000-0000-4000-8000-0000000000a2', 'Internal Sales, HR & Operations Hiring', 'Delphic''s own non-technical hires', ARRAY['internal_hiring'], 'non_technical', 60),
 ('00000000-0000-4000-8000-0000000000a3', 'Client Hiring', 'Candidates put forward to a client (Managed Services, Recruitment, Project)', ARRAY['managed_services','recruitment','project'], NULL, 60);

INSERT INTO "interview_template_rounds" ("template_id", "sort_order", "name", "conducted_by", "kind", "is_mandatory", "rating_required") VALUES
 ('00000000-0000-4000-8000-0000000000a1', 1, 'Screening + Behavioural + Reasoning, Aptitude & Mind Test', 'delphic', 'screening_test', true, true),
 ('00000000-0000-4000-8000-0000000000a1', 2, 'Developer 1', 'delphic', 'interview', true, true),
 ('00000000-0000-4000-8000-0000000000a1', 3, 'Developer 2', 'delphic', 'interview', true, true),
 ('00000000-0000-4000-8000-0000000000a1', 4, 'CTO Round', 'delphic', 'interview', true, true),
 ('00000000-0000-4000-8000-0000000000a1', 5, 'MD Round', 'delphic', 'interview', true, false),
 ('00000000-0000-4000-8000-0000000000a2', 1, 'Screening + Behavioural + Reasoning, Aptitude & Mind Test', 'delphic', 'screening_test', true, true),
 ('00000000-0000-4000-8000-0000000000a2', 2, 'VP HR / Sales', 'delphic', 'interview', true, true),
 ('00000000-0000-4000-8000-0000000000a2', 3, 'CEO Round', 'delphic', 'interview', true, true),
 ('00000000-0000-4000-8000-0000000000a2', 4, 'MD Round', 'delphic', 'interview', true, false),
 ('00000000-0000-4000-8000-0000000000a3', 1, 'Screening + Behavioural + Reasoning, Aptitude & Mind Test', 'delphic', 'screening_test', true, true),
 ('00000000-0000-4000-8000-0000000000a3', 2, 'Client Round 1', 'client', 'interview', true, false),
 ('00000000-0000-4000-8000-0000000000a3', 3, 'Client Round 2', 'client', 'interview', false, false),
 ('00000000-0000-4000-8000-0000000000a3', 4, 'Client Round 3', 'client', 'interview', false, false),
 ('00000000-0000-4000-8000-0000000000a3', 5, 'Client Round 4', 'client', 'interview', false, false),
 ('00000000-0000-4000-8000-0000000000a3', 6, 'MD Round', 'delphic', 'interview', true, false);
