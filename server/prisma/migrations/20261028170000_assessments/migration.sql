-- Assessment tests (custom questions, public-link attempts, auto scoring); screening rounds can default to a test.
ALTER TABLE "interview_template_rounds" ADD COLUMN     "assessment_test_id" UUID;


-- CreateTable
CREATE TABLE "assessment_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_tests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pass_percentage" INTEGER NOT NULL DEFAULT 60,
    "duration_minutes" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_test_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "test_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "assessment_test_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "token" TEXT NOT NULL,
    "test_id" UUID NOT NULL,
    "submission_id" UUID,
    "candidate_name" TEXT NOT NULL,
    "candidate_email" TEXT,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "answers" JSONB,
    "score_percent" DECIMAL(5,2),
    "passed" BOOLEAN,
    "pass_percentage" INTEGER NOT NULL,
    "invited_by" UUID,
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),

    CONSTRAINT "assessment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assessment_questions_category_is_active_idx" ON "assessment_questions"("category", "is_active");

-- CreateIndex
CREATE INDEX "assessment_test_questions_test_id_sort_order_idx" ON "assessment_test_questions"("test_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_test_questions_test_id_question_id_key" ON "assessment_test_questions"("test_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_attempts_token_key" ON "assessment_attempts"("token");

-- CreateIndex
CREATE INDEX "assessment_attempts_submission_id_idx" ON "assessment_attempts"("submission_id");

-- CreateIndex
CREATE INDEX "assessment_attempts_test_id_idx" ON "assessment_attempts"("test_id");

-- AddForeignKey
ALTER TABLE "interview_template_rounds" ADD CONSTRAINT "interview_template_rounds_assessment_test_id_fkey" FOREIGN KEY ("assessment_test_id") REFERENCES "assessment_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_test_questions" ADD CONSTRAINT "assessment_test_questions_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "assessment_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_test_questions" ADD CONSTRAINT "assessment_test_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "assessment_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_test_id_fkey" FOREIGN KEY ("test_id") REFERENCES "assessment_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

