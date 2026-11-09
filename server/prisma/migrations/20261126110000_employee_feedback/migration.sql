-- Employee Feedback: feedback from any employee (named or anonymous), read only by the board; the board is a list of people an admin names. Additive.
CREATE TABLE "employee_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "submitter_membership_id" UUID,
    "category" TEXT NOT NULL DEFAULT 'suggestion',
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "board_note" TEXT,
    "handled_by_membership_id" UUID,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_feedback_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employee_feedback_org_id_created_at_idx" ON "employee_feedback"("org_id", "created_at");
CREATE INDEX "employee_feedback_submitter_membership_id_idx" ON "employee_feedback"("submitter_membership_id");

CREATE TABLE "employee_feedback_board" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "org_membership_id" UUID NOT NULL,
    "added_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_feedback_board_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_feedback_board_org_id_org_membership_id_key" ON "employee_feedback_board"("org_id", "org_membership_id");
