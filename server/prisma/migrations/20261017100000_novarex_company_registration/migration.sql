-- Registers Novarex Pharmaceuticals as a company of the holding group, so the Group Dashboard lists it beside the other companies.
-- It creates ONLY the company row and gives the group Super Admin(s) access to it. No site, investment, category, setting or any other
-- data is created (those are made lazily, by the company's own users). Safe to run again: nothing is created twice. On a database
-- without the Delphic company (a fresh test database) it does nothing.

INSERT INTO "orgs" ("org_group_id", "name", "slug", "timezone", "default_currency", "enabled_modules")
SELECT a."org_group_id", 'Novarex Pharmaceuticals', 'novarex', 'Asia/Kolkata', 'INR'::"Currency", ARRAY['novarex']::TEXT[]
FROM (
    SELECT "org_group_id"
    FROM "orgs"
    WHERE "slug" = 'delphic' OR "is_master_workspace" = true
    ORDER BY ("slug" = 'delphic') DESC, "created_at" ASC
    LIMIT 1
) a
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "org_memberships" ("person_id", "org_id", "role")
SELECT u."id", o."id", 'admin'::"UserRole"
FROM "orgs" o
JOIN "org_group_memberships" gm ON gm."org_group_id" = o."org_group_id"
JOIN "users" u ON u."id" = gm."user_id"
WHERE o."slug" = 'novarex'
  AND u."is_group_superadmin" = true
  AND u."active" = true
  AND NOT EXISTS (SELECT 1 FROM "org_memberships" m WHERE m."person_id" = u."id" AND m."org_id" = o."id");
