-- People > Seating: the desks of each office and who sits at which one.
CREATE TABLE "office_seats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "zone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "org_membership_id" UUID,
    "assigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "office_seats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "office_seats_location_id_label_key" ON "office_seats"("location_id", "label");
CREATE UNIQUE INDEX "office_seats_org_membership_id_key" ON "office_seats"("org_membership_id");
CREATE INDEX "office_seats_org_id_location_id_idx" ON "office_seats"("org_id", "location_id");
