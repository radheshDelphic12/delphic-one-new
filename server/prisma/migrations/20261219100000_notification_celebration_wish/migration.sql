-- New notification type (the table comes in the next migration: an enum value cannot be used in the transaction that adds it).
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'celebration_wish';
