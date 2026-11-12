-- New notification type. (An enum value cannot be used in the transaction that adds it, so tables come in the next migration.)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'increment_review_due';
