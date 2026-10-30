-- A candidate finishing the AI interview notifies the person who sent it. Additive enum value only.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ai_interview_completed';
