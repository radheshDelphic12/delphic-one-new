-- New notification type: a candidate ticket (submission) is closed.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'candidate_closed';
