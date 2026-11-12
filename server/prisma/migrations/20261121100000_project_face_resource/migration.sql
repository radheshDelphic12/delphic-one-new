-- Additive only: the resource a project shows to its client (the "face" of the team), printed on the client invoice.
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "face_resource" TEXT;
