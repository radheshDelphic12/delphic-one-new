-- V2 (step 1 of 2): add new enum values needed to remap existing rows.
-- Split into its own migration so these ADD VALUEs are committed before the next
-- migration UPDATEs rows to use them - Postgres forbids using a new enum value in the
-- same transaction that added it.

ALTER TYPE "ProfileSource" ADD VALUE IF NOT EXISTS 'direct';
ALTER TYPE "ReqType" ADD VALUE IF NOT EXISTS 'recruitment';
ALTER TYPE "RoundType" ADD VALUE IF NOT EXISTS 'internal_r1';
ALTER TYPE "RoundType" ADD VALUE IF NOT EXISTS 'client_r1';
ALTER TYPE "RoundType" ADD VALUE IF NOT EXISTS 'client_r2';
ALTER TYPE "RoundType" ADD VALUE IF NOT EXISTS 'hr_cto_ceo';
ALTER TYPE "SubmissionStage" ADD VALUE IF NOT EXISTS 'offer_sent';
