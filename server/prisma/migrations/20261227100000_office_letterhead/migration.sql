-- Letters on the company letterhead: each office has its own legal name, letter serial prefix and registration line; a letter keeps the office it was issued for and the letterhead details of that day.
ALTER TABLE "locations" ADD COLUMN "legal_name" TEXT;
ALTER TABLE "locations" ADD COLUMN "letter_prefix" TEXT;
ALTER TABLE "locations" ADD COLUMN "registration_info" TEXT;
ALTER TABLE "letters" ADD COLUMN "location_id" UUID;
ALTER TABLE "letters" ADD COLUMN "letterhead" JSONB;
