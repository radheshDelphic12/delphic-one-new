-- Projects vs. client accounts: both are type 'client' rows in accounts; a
-- project gets is_project = true. Existing projects are the rows Add Project
-- made — the same rule the project Client picker already used: a service
-- category and nothing from the Accounts side (no requirements, contact,
-- industry or classification). A real client that Finance gave a category
-- keeps its Accounts data, so it stays a catalogue account (read-only in Finance).
ALTER TABLE "accounts" ADD COLUMN "is_project" BOOLEAN NOT NULL DEFAULT false;
UPDATE "accounts" a SET "is_project" = true
WHERE a."service_category" IS NOT NULL
  AND a."poc_name" IS NULL
  AND a."industry" IS NULL
  AND a."classified_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "requirements" r WHERE r."account_id" = a."id");

-- Assets can belong to a vendor.
ALTER TYPE "AssetOwner" ADD VALUE 'vendor';
