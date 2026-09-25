-- CreateTable
CREATE TABLE "interview_round_interviewers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "interview_round_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_round_interviewers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interview_round_interviewers_interview_round_id_idx" ON "interview_round_interviewers"("interview_round_id");

-- CreateIndex
CREATE UNIQUE INDEX "interview_round_interviewers_interview_round_id_user_id_key" ON "interview_round_interviewers"("interview_round_id", "user_id");

-- AddForeignKey
ALTER TABLE "interview_round_interviewers" ADD CONSTRAINT "interview_round_interviewers_interview_round_id_fkey" FOREIGN KEY ("interview_round_id") REFERENCES "interview_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_round_interviewers" ADD CONSTRAINT "interview_round_interviewers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
