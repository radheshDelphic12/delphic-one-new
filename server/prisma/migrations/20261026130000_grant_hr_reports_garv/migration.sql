-- Reports > HR reports is now its own permission (reports.hr). Garv Gulati already holds the Reports permissions and was asked to use
-- the HR report, so give it to him up front. Nobody else gets it automatically: an admin ticks it for anyone else in
-- Settings > Roles & permissions. Adds a row only; does nothing where the user does not exist (local / test databases) and can be
-- run again safely.
INSERT INTO "permission_grants" ("org_id", "org_membership_id", "key", "scope", "effect", "label")
SELECT m."org_id", m."id", 'reports.hr', 'true', 'grant', 'HR reports'
FROM "org_memberships" m
JOIN "users" u ON u."id" = m."person_id"
JOIN "orgs" o ON o."id" = m."org_id"
WHERE lower(u."email") = 'garv@delphic.in'
  AND o."is_master_workspace" = true
ON CONFLICT ("org_membership_id", "key") DO NOTHING;
