-- Group Dashboard > Travel (additive)
CREATE TABLE "group_travel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_group_id" UUID NOT NULL,
    "org_id" UUID,
    "title" TEXT NOT NULL,
    "origin" TEXT,
    "destination" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "purpose" TEXT,
    "budget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "actual_spent" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "notes" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "group_travel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "group_travel_travelers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "travel_id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "org_id" UUID,
    CONSTRAINT "group_travel_travelers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "group_travel_meetings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "travel_id" UUID NOT NULL,
    "meeting_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "group_travel_meetings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "group_travel_org_group_id_start_date_idx" ON "group_travel"("org_group_id", "start_date");
CREATE INDEX "group_travel_travelers_travel_id_idx" ON "group_travel_travelers"("travel_id");
CREATE UNIQUE INDEX "group_travel_meetings_travel_id_meeting_key_key" ON "group_travel_meetings"("travel_id", "meeting_key");
CREATE INDEX "group_travel_meetings_meeting_key_idx" ON "group_travel_meetings"("meeting_key");

ALTER TABLE "group_travel" ADD CONSTRAINT "group_travel_org_group_id_fkey" FOREIGN KEY ("org_group_id") REFERENCES "org_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_travel_travelers" ADD CONSTRAINT "group_travel_travelers_travel_id_fkey" FOREIGN KEY ("travel_id") REFERENCES "group_travel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_travel_meetings" ADD CONSTRAINT "group_travel_meetings_travel_id_fkey" FOREIGN KEY ("travel_id") REFERENCES "group_travel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
