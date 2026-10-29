-- Requirements created before interview templates existed (or while none matched) have no template, so their candidates get no
-- screening-test link. Attach the active template for the service type (+ hiring track); a track-specific template wins.
UPDATE "requirements" r
SET "interview_template_id" = (
  SELECT t."id" FROM "interview_templates" t
  WHERE t."is_active" AND r."req_type"::text = ANY(t."service_types")
    AND (t."hiring_track" IS NULL OR t."hiring_track" IS NOT DISTINCT FROM r."hiring_track")
  ORDER BY (t."hiring_track" IS NOT NULL) DESC, t."created_at" ASC
  LIMIT 1
)
WHERE r."interview_template_id" IS NULL;
