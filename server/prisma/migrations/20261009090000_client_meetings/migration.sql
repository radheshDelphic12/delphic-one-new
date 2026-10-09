-- CreateEnum
CREATE TYPE "ClientMeetingStatus" AS ENUM ('scheduled', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "client_meetings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID,
    "account_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "mode" "MeetingMode" NOT NULL DEFAULT 'online',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "location" TEXT,
    "link" TEXT,
    "notes" TEXT,
    "status" "ClientMeetingStatus" NOT NULL DEFAULT 'scheduled',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_meeting_attendees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meeting_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "client_meeting_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_meetings_account_id_scheduled_at_idx" ON "client_meetings"("account_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "client_meetings_scheduled_at_idx" ON "client_meetings"("scheduled_at");

-- CreateIndex
CREATE INDEX "client_meeting_attendees_user_id_idx" ON "client_meeting_attendees"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_meeting_attendees_meeting_id_user_id_key" ON "client_meeting_attendees"("meeting_id", "user_id");

-- AddForeignKey
ALTER TABLE "client_meetings" ADD CONSTRAINT "client_meetings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_meetings" ADD CONSTRAINT "client_meetings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_meeting_attendees" ADD CONSTRAINT "client_meeting_attendees_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "client_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_meeting_attendees" ADD CONSTRAINT "client_meeting_attendees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
