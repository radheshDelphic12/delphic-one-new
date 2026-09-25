-- Additive only: lateness (past shift start + grace) recorded at check-in.
ALTER TABLE "attendance_records" ADD COLUMN "late_minutes" INTEGER;
