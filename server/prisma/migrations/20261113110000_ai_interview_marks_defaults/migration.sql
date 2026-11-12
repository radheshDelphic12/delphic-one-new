-- AI interview: the default marking scheme is out of 100 (knowledge 30, communication 20, depth 15, problem solving 15, experience fit 10, aptitude 10).
-- Only the defaults for NEW settings rows change; a company that already saved its weights keeps them.
ALTER TABLE "ai_interview_settings" ALTER COLUMN "weight_knowledge" SET DEFAULT 30, ALTER COLUMN "weight_communication" SET DEFAULT 20, ALTER COLUMN "weight_depth" SET DEFAULT 15, ALTER COLUMN "weight_aptitude" SET DEFAULT 10;
