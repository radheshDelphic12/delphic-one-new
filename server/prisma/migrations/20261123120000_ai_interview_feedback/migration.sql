-- A team member's feedback on a finished AI interview (one note per person, amended in place). Additive.
CREATE TABLE "ai_interview_feedback" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "ai_interview_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "feedback" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_interview_feedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_interview_feedback_ai_interview_id_user_id_key" ON "ai_interview_feedback"("ai_interview_id", "user_id");
CREATE INDEX "ai_interview_feedback_ai_interview_id_idx" ON "ai_interview_feedback"("ai_interview_id");
ALTER TABLE "ai_interview_feedback" ADD CONSTRAINT "ai_interview_feedback_ai_interview_id_fkey" FOREIGN KEY ("ai_interview_id") REFERENCES "ai_interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_interview_feedback" ADD CONSTRAINT "ai_interview_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
