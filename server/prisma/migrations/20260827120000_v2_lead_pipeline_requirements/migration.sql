-- V2 (step 2 of 2): lead capture, candidate pipeline round taxonomy, requirement types,
-- candidate bench flag. Depends on 20260827115000_v2_add_enum_values having already
-- committed the new enum values used by the UPDATE statements below.

-- ProfileSource: internal -> direct (vendor/linkedin unchanged)
UPDATE "profiles" SET "source" = 'direct' WHERE "source" = 'internal';

-- AlterEnum
BEGIN;
CREATE TYPE "ProfileSource_new" AS ENUM ('direct', 'vendor', 'linkedin');
ALTER TABLE "profiles" ALTER COLUMN "source" TYPE "ProfileSource_new" USING ("source"::text::"ProfileSource_new");
ALTER TYPE "ProfileSource" RENAME TO "ProfileSource_old";
ALTER TYPE "ProfileSource_new" RENAME TO "ProfileSource";
DROP TYPE "ProfileSource_old";
COMMIT;

-- ReqType: developer -> recruitment (project unchanged, managed_services is new/additive)
UPDATE "requirements" SET "req_type" = 'recruitment' WHERE "req_type" = 'developer';

-- AlterEnum
BEGIN;
CREATE TYPE "ReqType_new" AS ENUM ('managed_services', 'recruitment', 'project');
ALTER TABLE "requirements" ALTER COLUMN "req_type" TYPE "ReqType_new" USING ("req_type"::text::"ReqType_new");
ALTER TYPE "ReqType" RENAME TO "ReqType_old";
ALTER TYPE "ReqType_new" RENAME TO "ReqType";
DROP TYPE "ReqType_old";
COMMIT;

-- RoundType: internal->internal_r1, client_l1->client_r1, client_l2->client_r2,
-- client_hr and client_final BOTH collapse into hr_cto_ceo (combined HR/CTO/CEO round).
-- internal_r2 and client_r3 are brand new values with no legacy data to remap.
UPDATE "interview_rounds" SET "round_type" = 'internal_r1' WHERE "round_type" = 'internal';
UPDATE "interview_rounds" SET "round_type" = 'client_r1' WHERE "round_type" = 'client_l1';
UPDATE "interview_rounds" SET "round_type" = 'client_r2' WHERE "round_type" = 'client_l2';
UPDATE "interview_rounds" SET "round_type" = 'hr_cto_ceo' WHERE "round_type" IN ('client_hr', 'client_final');

-- AlterEnum
BEGIN;
CREATE TYPE "RoundType_new" AS ENUM ('internal_r1', 'internal_r2', 'client_r1', 'client_r2', 'client_r3', 'hr_cto_ceo');
ALTER TABLE "interview_rounds" ALTER COLUMN "round_type" TYPE "RoundType_new" USING ("round_type"::text::"RoundType_new");
ALTER TYPE "RoundType" RENAME TO "RoundType_old";
ALTER TYPE "RoundType_new" RENAME TO "RoundType";
DROP TYPE "RoundType_old";
COMMIT;

-- SubmissionStage: offer -> offer_sent (all other values unchanged)
UPDATE "submissions" SET "stage" = 'offer_sent' WHERE "stage" = 'offer';

-- AlterEnum
BEGIN;
CREATE TYPE "SubmissionStage_new" AS ENUM ('sourced', 'internal_screening', 'submitted_to_client', 'interview_scheduled', 'interview_result', 'offer_sent', 'bgv', 'closed', 'backout', 'rejected');
ALTER TABLE "submissions" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "submissions" ALTER COLUMN "stage" TYPE "SubmissionStage_new" USING ("stage"::text::"SubmissionStage_new");
ALTER TYPE "SubmissionStage" RENAME TO "SubmissionStage_old";
ALTER TYPE "SubmissionStage_new" RENAME TO "SubmissionStage";
DROP TYPE "SubmissionStage_old";
ALTER TABLE "submissions" ALTER COLUMN "stage" SET DEFAULT 'sourced';
COMMIT;

-- stage_history.from_stage/to_stage are plain text, not enum-typed - sweep them to match
-- the SubmissionStage rename above (only submission-entity rows can carry 'offer').
UPDATE "stage_history" SET "to_stage" = 'offer_sent' WHERE "entity_type" = 'submission' AND "to_stage" = 'offer';
UPDATE "stage_history" SET "from_stage" = 'offer_sent' WHERE "entity_type" = 'submission' AND "from_stage" = 'offer';

-- Account: lead capture fields + nullable type (BDA may not know client/vendor yet) +
-- meeting location + classification audit columns.
-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "classified_at" TIMESTAMP(3),
ADD COLUMN     "classified_by" UUID,
ADD COLUMN     "lead_generated_date" DATE,
ADD COLUMN     "linkedin_url" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "meeting_location" TEXT,
ALTER COLUMN "type" DROP NOT NULL;

-- Profile: on-bench flag for internal/direct-sourced candidates.
-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "on_bench" BOOLEAN NOT NULL DEFAULT false;

-- Meeting attendees: multiple Sales users can be tagged to an account meeting.
-- CreateTable
CREATE TABLE "account_meeting_attendees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_meeting_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_meeting_attendees_account_id_idx" ON "account_meeting_attendees"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_meeting_attendees_account_id_user_id_key" ON "account_meeting_attendees"("account_id", "user_id");

-- CreateIndex
CREATE INDEX "accounts_lead_generated_date_idx" ON "accounts"("lead_generated_date");

-- CreateIndex
CREATE INDEX "profiles_source_on_bench_idx" ON "profiles"("source", "on_bench");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_classified_by_fkey" FOREIGN KEY ("classified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_meeting_attendees" ADD CONSTRAINT "account_meeting_attendees_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_meeting_attendees" ADD CONSTRAINT "account_meeting_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
