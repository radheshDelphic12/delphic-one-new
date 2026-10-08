# Zephyr -> main release (8 additive migrations)

Status as of 2026-10-06: `origin/staging` == `zephyr-bug-fix-new-implementation` (fd121d1), 10 commits ahead of `origin/main` (165e9fa), 0 behind. Merge is a fast-forward. **Agents never push `main`** (see AGENTS.md "Working conventions"); a human runs the steps below.

## Migrations main is missing (all additive, only `zx_*` tables)

1. `20261001121426_zephyr_foundation`
2. `20261005073534_zephyr_parties_documents`
3. `20261005082322_zephyr_leads`
4. `20261005094255_zephyr_projects`
5. `20261005100046_zephyr_people_salaries`
6. `20261005103414_zephyr_money`
7. `20261006090000_zephyr_services_leads_projects` - adds columns AND rewrites rows: lead stages (contacted/site_visit -> in_discussion, proposal -> negotiation, lost -> dropped), project status planning -> planned, backfills `ZL-0001` lead codes + `lead_seq`.
8. `20261006120000_zephyr_real_estate` - new property/lease/rent/task tables; adds columns to `zx_ledger_entries`, `zx_projects`, `zx_settings`.

No drops, renames or type changes on existing Delphic tables. Only links to them are FKs to `orgs` / `users`.

## Safe sequence

1. **Commit the pending working-tree edits** (Zephyr settings/tasks pages + services) and push them to `staging` first; confirm staging is green.
2. **Check the prod DB state before deploying:** `cd server && npx prisma migrate status` against the main DB (read-only). Expect exactly the 8 above as pending. If it reports drift or "table zx_* already exists", STOP - the schema was applied outside migrations; resolve with `prisma migrate resolve --applied <name>` only after diffing.
3. **Rehearse on a copy:** `start-delphic.sh --prod` already takes a verified `pg_dump -Fc`, restores it into a throwaway Postgres and runs `prisma migrate deploy` there before touching the live DB (rehearsal at start-delphic.sh ~L225-258). Do not bypass it. Keep the dump until step 5 passes.
4. **Merge (human):**
   ```
   git fetch origin
   git checkout main && git pull --ff-only origin main
   git merge --ff-only origin/staging
   git push origin main        # triggers CI + deploy workflow
   ```
5. **Verify after deploy:** `prisma migrate status` shows up to date; `/api/v1/zephyr` responds; open Zephyr workspace as admin; lead stage counts match pre-deploy; no 500s in logs.
6. **Admin login (first deploy only):** `cd server && DATABASE_URL=<prod> node prisma/zephyr/seed-admin.js` (or `npm run zephyr:seed-admin`). Non-destructive: creates only the missing `zephyr` org, settings, categories and `admin@zephyrinfra.in` (initial password `Zephyr@2026!`, override via `ZEPHYR_ADMIN_EMAIL/PASSWORD`; existing users keep their password unless `ZEPHYR_ADMIN_RESET_PASSWORD=1`). Change the password after first sign-in; the admin then creates other users in-app.
7. **Module gate:** the Zephyr org must have the `zephyr` module enabled (seed script now creates it with `modules: ['zephyr']`, but an existing org keeps its old `leads/contracts/projects`). Enable it in admin settings.
8. **Rollback:** migrations are additive, so app rollback = redeploy previous image (old code ignores `zx_*`). Data rollback of the stage/status rewrite = restore the step-3 dump. Do not hand-drop tables.

## Do not
- Run `zephyr:seed` (demo data, guarded against prod) or the ERP verticals seed on production.
- Use `prisma migrate dev` / `db push` / `migrate reset` against prod.
- Deploy from local `staging-deploy` (stale, lacks all 8 migrations).

## Shared-infra touched (run full suite once before release)
`app.js` (route), `config/db.js` (28 `Zx*` models in ORG_SCOPED_ON_CREATE), `uploads.service.js` (Zephyr document lookup + role check).
