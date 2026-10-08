# Going live with Acconcy Finance (staging / production)

`server/prisma/acconcy/seed-admin.js` is **non-destructive**. It creates the `acconcy` org if it is missing (with its own holding group), or, when the org already exists, enables the `acconcy` module on it and removes only the `coming_soon` marker (that marker is what shows Acconcy as "coming soon" on the Group Dashboard; removing it is the switch that makes the workspace live). It also creates one admin login, the org membership and the default settings. It deletes nothing, overwrites no password unless asked, and loads no demo data. Categories are created by the app the first time they are needed.

Do these in order. Nothing here is pushed or deployed by an agent.

## 1. Ship the code and the migration

The Acconcy tables arrive with the additive migration `20261008120000_acconcy_foundation` (17 new `ax_*` tables, no DROP or RENAME). Deploy the build that contains it, then check it is applied.

- **Render staging:** deploy as usual, then run `npx prisma migrate deploy` against the Neon database.
- **Production Docker host:** the app only exists inside the container.

```bash
sudo -i
C=delphic-server-1
docker exec -w /app/server $C npx prisma migrate status   # must say "up to date" (rebuild the server image from main first if it lists pending migrations)
```

## 2. Create the Acconcy admin

Choose the real admin email and a strong password. The script has no default password on purpose.

```bash
# copy server/prisma/acconcy/seed-admin.js to /root/acconcy-admin-tmp.js, then:
docker cp /root/acconcy-admin-tmp.js $C:/app/server/acconcy-admin-tmp.js
docker exec -w /app/server -e ACCONCY_ADMIN_EMAIL='admin@acconcy.in' -e ACCONCY_ADMIN_PASSWORD='<strong password>' $C node acconcy-admin-tmp.js
docker exec $C rm /app/server/acconcy-admin-tmp.js && rm /root/acconcy-admin-tmp.js
history -c
```

Expected: `+ org` or `~ enabled module "acconcy" (coming_soon marker removed)`, `+ admin user`, `+ org membership`, `Acconcy admin seed done.`

If it prints "The Acconcy tables are missing", the image is older than the migration: rebuild from the branch that contains it and run `prisma migrate deploy`.

## 3. Give the group super admin access (existing setup)

A group super admin already sees every org of the holding group through `org_group_memberships`. If Acconcy was created in a **new** holding group by the script, add that group to the super admin, or move the org into the existing group:

```sql
-- from inside delphic-db-1: psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
UPDATE orgs SET org_group_id = (SELECT org_group_id FROM orgs WHERE slug = 'delphic') WHERE slug = 'acconcy';
```

(Only when the existing Acconcy org is not already in the Delphic group; check with `SELECT slug, org_group_id FROM orgs;`.)

## 4. Verify

```bash
curl -s -X POST http://localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@acconcy.in","password":"<password>"}' | head -c 200      # "success":true
```

Sign in at the production URL: you land on the Acconcy dashboard. As the group super admin, Acconcy now appears on the Group Dashboard with its own figures instead of "coming soon".

## 5. Afterwards

The admin creates the other logins and roles (Employee / Contractor), sets monthly salaries, adds clients and assets, and starts recording leads, deals, revenue and expenses. Change the initial password after the first sign-in. Old generic Acconcy rows in the shared `leads` / `contracts` tables are untouched and not shown in this workspace.
