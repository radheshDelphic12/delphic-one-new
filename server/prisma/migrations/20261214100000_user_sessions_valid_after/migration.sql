-- Password reset by an admin ends the person's existing sessions: a sign-in token (access or refresh) issued before this moment is no longer accepted.
-- Nullable, so nothing changes for anyone until a reset sets it.
ALTER TABLE "users" ADD COLUMN "sessions_valid_after" TIMESTAMP(3);
