-- Wishes on a colleague's birthday / work anniversary. They only live for that one day (on_date): reads are limited to today and a nightly job deletes older rows.
CREATE TABLE "celebration_wishes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "org_id" UUID NOT NULL,
  "org_membership_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "on_date" DATE NOT NULL,
  "from_membership_id" UUID NOT NULL,
  "message" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "celebration_wishes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "celebration_wishes_kind_check" CHECK ("kind" IN ('birthday', 'anniversary')),
  CONSTRAINT "celebration_wishes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "celebration_wishes_org_membership_id_fkey" FOREIGN KEY ("org_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "celebration_wishes_from_membership_id_fkey" FOREIGN KEY ("from_membership_id") REFERENCES "org_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "celebration_wishes_once_per_sender" ON "celebration_wishes"("org_membership_id", "kind", "on_date", "from_membership_id");
CREATE INDEX "celebration_wishes_org_id_on_date_idx" ON "celebration_wishes"("org_id", "on_date");
