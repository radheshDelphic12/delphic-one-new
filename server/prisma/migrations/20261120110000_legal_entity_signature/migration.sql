-- Additive only: the default invoice signature (image data URL) and signatory name of a legal entity.
ALTER TABLE "legal_entities" ADD COLUMN IF NOT EXISTS "signature_image" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN IF NOT EXISTS "signatory_name" TEXT;
