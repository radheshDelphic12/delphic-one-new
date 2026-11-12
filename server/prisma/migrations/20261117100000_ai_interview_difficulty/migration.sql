-- AI interview: how hard the questions are and how strictly answers are marked (admin-editable in Hiring setup; easy + lenient by default).
ALTER TABLE "ai_interview_settings" ADD COLUMN "difficulty" TEXT NOT NULL DEFAULT 'easy', ADD COLUMN "marking" TEXT NOT NULL DEFAULT 'lenient';
