-- Registers Delphic One (the company that sells the product) as a company of the holding group, so the Group Dashboard lists it beside the others.
-- It creates ONLY the company row and gives the group Super Admin(s) access to it. No customer, lead or invoice is created. Safe to run again:
-- nothing is created twice. On a database without the Delphic company (a fresh test database) it does nothing.

INSERT INTO "orgs" ("org_group_id", "name", "slug", "timezone", "default_currency", "enabled_modules")
SELECT a."org_group_id", 'Delphic One', 'delphic-one', 'Asia/Kolkata', 'INR'::"Currency", ARRAY['delphic_one']::TEXT[]
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
WHERE o."slug" = 'delphic-one'
  AND u."is_group_superadmin" = true
  AND u."active" = true
  AND NOT EXISTS (SELECT 1 FROM "org_memberships" m WHERE m."person_id" = u."id" AND m."org_id" = o."id");
