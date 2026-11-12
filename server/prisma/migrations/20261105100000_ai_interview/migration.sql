-- AI interview: first-round screening by an AI-led interview, scored on an admin-editable rubric. Additive only.
CREATE TABLE IF NOT EXISTS "ai_interviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL,
    "submission_id" UUID NOT NULL,
    "org_id" UUID,
    "template_round_id" UUID,
    "candidate_name" TEXT NOT NULL,
    "candidate_email" TEXT,
    "role_title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "questions" JSONB,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "followups_used" INTEGER NOT NULL DEFAULT 0,
    "scores" JSONB,
    "score_percent" DECIMAL(5,2),
    "outcome" TEXT,
    "pass_percentage" INTEGER NOT NULL,
    "consented_at" TIMESTAMP(3),
    "override_outcome" TEXT,
    "override_reason" TEXT,
    "override_by" UUID,
    "override_at" TIMESTAMP(3),
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "invited_by" UUID,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    CONSTRAINT "ai_interviews_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_interviews_token_key" ON "ai_interviews"("token");
CREATE INDEX IF NOT EXISTS "ai_interviews_submission_id_idx" ON "ai_interviews"("submission_id");
CREATE INDEX IF NOT EXISTS "ai_interviews_org_id_status_idx" ON "ai_interviews"("org_id", "status");

CREATE TABLE IF NOT EXISTS "ai_interview_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "question_count" INTEGER NOT NULL DEFAULT 7,
    "max_followups" INTEGER NOT NULL DEFAULT 3,
    "pass_percentage" INTEGER NOT NULL DEFAULT 60,
    "borderline_margin" INTEGER NOT NULL DEFAULT 10,
    "weight_knowledge" INTEGER NOT NULL DEFAULT 50,
    "weight_communication" INTEGER NOT NULL DEFAULT 25,
    "weight_depth" INTEGER NOT NULL DEFAULT 25,
    "extra_instructions" TEXT,
    "auto_reject" BOOLEAN NOT NULL DEFAULT false,
    "link_valid_days" INTEGER NOT NULL DEFAULT 7,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_interview_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_interview_settings_org_id_key" ON "ai_interview_settings"("org_id");
