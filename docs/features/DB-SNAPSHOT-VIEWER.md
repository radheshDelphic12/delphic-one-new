# Database snapshot viewer

Super admin only, **separate from the application**. Open a database dump from a point in time, see its tables exactly as stored, compare it with another dump (or with "now"), and download tables or the comparison.

Built 2026-11-05 (branch `super_admin_branch`, local, not pushed). Plan, decisions and the measured prod numbers are in the sections below.

## Why

Answering "what changed between 4 Nov and now" needed SSH, scp, a local Docker restore and hand-written SQL, and prod dumps vanish fast (`auto-*` the newest 7 = about 1 h 45 min, `predeploy-*` the last 7 deploys, nothing kept off the box).

## How it works

There is **no second database**. The viewer reads table data straight from the `.dump` files:

- `pg_restore --data-only [--table=X] -f -` streams one table's COPY rows (decoded in `dbviewer/server/dumpReader.js`: `\N`, tabs, newlines, backslashes, octal / hex).
- `pg_restore --schema-only -f -` gives columns, types and primary keys.
- Disk: nothing beyond the dump files and small JSON result files. Memory: one table at a time (largest is `notifications`, about 51k rows), behind a 40 MB table cache. No load on the app's Postgres.

```
host nginx --- /            -> client container (app, unchanged)
           `-- /dbviewer/   -> dbviewer container (127.0.0.1:8090)
                                 reads  ./backups (read-only mount)
                                 writes ./backups/viewer (now-*.dump, comparison results, audit.log)
                                 pg_dump -> db:5432 as dump_reader (read-only, only for "compare with now")
                                 auth: asks the app "is this token a super admin?"
```

Code: `dbviewer/` (own `package.json`, Express API in `server/`, Vite + React UI in `web/`, image `node:22-alpine` + `postgresql16-client`). It shares no code with `server/` or `client/`.

## Access (super admin only, reusing the app login)

- App endpoint `GET /api/v1/superadmin/whoami` (`authenticate` + `authorizeSuperadmin`, `server/src/modules/superadmin/`), returns `{ id, name, email }`; route rule `open` in `lib/access/routeRules.js` (the handler is the gate). Test: `server/tests/superadmin-whoami.test.js`.
- The viewer UI is served on the same domain, so it reads the app's access token (`sessionStorage`, else the shared copy in `localStorage`, key `access_token`; see `client/src/lib/sessionStore.js`) and forwards it as `Authorization: Bearer`. The viewer holds **no JWT secret and no app database access**. Answers are cached 60 s per token; 401 / 403 mean no access; an unreachable app is a 502 and is never cached.
- The access token lives 1 h. If it has expired the viewer says so: open Delphic once, then reload the viewer.
- App menu: "Database snapshots" (`DB_SNAPSHOTS_NAV_ITEM` in `client/src/components/layout/navItems.js`), shown only to `is_superadmin`, opens `/dbviewer/` in a new tab.

## What you can do

- **Snapshots**: a timeline grouped by day (IST) with kind (Scheduled / Before deploy / Taken now / Manual), size and migration count (read lazily from `_prisma_migrations`). Times come from the file name (the server clock is UTC) and are shown in IST.
- **View**: table list with row counts, a grid with sticky header, paging (100 per page, up to 500), filter, sort, **Download CSV**, **Download whole snapshot (XLSX)** (one sheet per non-empty table, streamed).
- **Compare**: pick two snapshots (the older is always A) or "Now". Summary of every changed table with +added / -removed / ~changed, schema changes (tables and columns added or removed, migrations added), per table the rows (added green, removed red, changed with old -> new per column), **Download comparison (XLSX)** (a Summary sheet, then one sheet per changed table; changed cells show `old -> new` and are shaded).
  - Rows are keyed by primary key. A table with no primary key is compared as whole rows (only added / removed).
  - A table whose rows are byte-identical in both dumps (content hash) is skipped without being read.
  - Results are cached as JSON in `backups/viewer/compare/<key>/` and deleted with either dump. One comparison runs at a time; exports and comparisons never run together.
- **Compare with now**: takes a fresh `pg_dump -Fc` as `dump_reader` into `backups/viewer/now-<UTC time>.dump`, checked with `pg_restore --list`. Refused when free space is under `BACKUP_MIN_FREE_GB + 1` GB, one every 5 minutes, one at a time; the newest 5 `now-*` dumps are kept. The viewer never queries the live database for anything else.

## Masking and audit

Column-name rules mirror `SECRET` in `server/src/config/changeCapture.js` (`dbviewer/server/mask.js`):

| Class | Columns (regex) | Behaviour |
|---|---|---|
| always | `pass|secret|token|hash|otp|api_?key` | masked on screen, in CSV / XLSX and in comparisons (a change only shows as "changed"); never revealable; not searchable |
| sensitive | `account_number|aadhaar|pan_number|ifsc` | masked unless "Show personal identifiers" is ticked; every reveal is audit-logged; not searchable unless revealed |

`MASK_ALWAYS_EXTRA` / `MASK_SENSITIVE_EXTRA` (env, regex alternatives) add columns without a code change, e.g. `salary|phone`. Everything else is shown as stored. **Known limit:** masking is by column name, so a personal field with an unusual name is shown until it is added there.

Audit: `backups/viewer/audit.log`, one JSON line per view, compare, download and reveal with the super admin's name and email, the action, the snapshot / comparison and the table. Rotated at 5 MB, 3 files kept.

## Retention (`scripts/backup-prune.sh`)

Called by `scripts/db-backup.sh` and by `start-delphic.sh` after each new dump (replaces the old `BACKUP_KEEP` rotation).

| Files | Kept |
|---|---|
| `auto-*.dump` | every dump for 6 h, then one per hour for 48 h, one per day for 30 days, one per month for 12 months |
| `predeploy-*.dump` | 30 days |
| `viewer/now-*.dump` | newest 5 |

The newest 7 auto and newest 7 predeploy dumps are never pruned. Hard caps: `BACKUP_MAX_TOTAL_MB` (default 1500) and `BACKUP_MIN_FREE_GB` (default 3). When either is breached the oldest go first: hourly, daily, predeploy, monthly. Every deletion is logged as `rotated out ...`. `scripts/backup-prune.sh --dry-run` shows what would go. Self-test: `bash scripts/test-backup-prune.sh`. Estimate at about 6 MB per dump: about 0.8 GB, under the cap.

## Resource limits (prod box: t3.small, about 927 MB RAM available, 6.1 GB disk free on 28 GB)

Compose service `dbviewer`: `mem_limit: 192m`, `memswap_limit: 256m`, `cpus: 0.5`, `restart: unless-stopped`, port `127.0.0.1:8090` (prod overlay), logs capped like the other services. Inside the image: `NODE_OPTIONS=--max-old-space-size=96`, `TABLE_CACHE_MB=40`, heavy work under `nice`. It runs as the owner of `./backups` (`start-delphic.sh` exports `DBVIEWER_UID` / `DBVIEWER_GID`). `start-delphic.sh` starts it **after** the app is healthy and a failure to build or start it only warns, so it can never fail a deploy of the app.

Measured locally (Windows, no cgroup) on two real 1.3 / 1.5 MB dumps, 188 tables, 166 changed: a whole comparison in about 25 s, process peak about 100-210 MB depending on the heap cap, whole-snapshot XLSX 2.2 MB in 3.4 s. **Still to verify on the box with `docker stats` during a compare and an XLSX export** (Docker was not available where this was built).

## Rollout on prod (steps the human runs; an agent never touches prod)

0. **Disk first.** 22 GB is used on a database of about 6 MB. Find out why before enabling anything: `docker system df`, `sudo du -sh /var/lib/docker /var/log /home/ubuntu /opt/delphic`. If old images or build cache are the bulk: `docker builder prune` and `docker image prune -a` (only after confirming the running images stay). `start-delphic.sh` now also runs `docker builder prune --filter until=168h` once a week. Target: at least 8 GB free before enabling the tiered retention.
1. Merge and deploy as usual (the compose build adds the `dbviewer` container; the human pushes `main`).
2. On the box: `bash scripts/create-dump-reader-role.sh` (creates `dump_reader`: LOGIN, CONNECTION LIMIT 1, `pg_read_all_data`, `default_transaction_read_only = on`; writes `DUMP_READER_PASSWORD` to `.env`; proves read works and write fails), then `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d dbviewer`. Without the password the viewer works and only "Compare with now" is switched off.
3. Add the `/dbviewer/` location from `nginx.conf.example` to the live nginx file (it is a copy; certbot has rewritten it), `sudo nginx -t && sudo systemctl reload nginx`.
4. The first prune run applies the tiers to everything that exists now. Check `/var/log/delphic-backup.log` for `rotated out` lines.
5. Check `docker stats` while running a compare and an XLSX export; memory must stay under 192 MB.

## Tests

- `cd dbviewer && PG_RESTORE=<path to a Postgres 16 pg_restore> npx jest --runInBand` (38 tests on two tiny committed fixture dumps; rebuild them with `dbviewer/test/make-fixtures.sh`). Covers COPY decoding (NULLs, escapes, tabs / newlines), diff (added / removed / changed, no primary key, added / removed columns and tables), masking (always-masked values never appear, even with reveal), CSV / XLSX shape, auth (401 / 403 / cache expiry / app down), the "now" dump guards, audit rotation.
- `server/tests/superadmin-whoami.test.js`, `server/tests/access-model.test.js`.
- `bash scripts/test-backup-prune.sh` (tiers, caps, protected dumps, dry run).
- CI job `dbviewer` in `.github/workflows/ci.yml` runs the viewer tests, the UI build and the prune test.

No Prisma migration and no `DROP`: the app's schema is untouched.
