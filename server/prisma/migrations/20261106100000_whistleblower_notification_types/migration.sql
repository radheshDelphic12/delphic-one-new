-- Whistleblower: new notification kinds. (An enum value cannot be used in the transaction that adds it; the tables come in the next migration.)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'whistleblower_new';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'whistleblower_update';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'whistle_case';
