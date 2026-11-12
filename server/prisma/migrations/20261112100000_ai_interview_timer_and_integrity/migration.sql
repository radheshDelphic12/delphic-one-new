-- AI interview: per-question timer, tab-switch limit (admin-editable settings) and the integrity log per interview. Additive only; no existing row is changed.
ALTER TABLE "ai_interview_settings" ADD COLUMN "answer_time_seconds" INTEGER NOT NULL DEFAULT 180, ADD COLUMN "max_tab_switches" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "ai_interviews" ADD COLUMN "integrity_events" JSONB NOT NULL DEFAULT '[]';
