-- Vendor portal: the point of contact is told when a vendor puts a candidate forward. (An enum value cannot be used in the transaction that adds it.)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'vendor_candidate_submitted';
ALTER TYPE "NotificationEntityType" ADD VALUE IF NOT EXISTS 'vendor_submission';
