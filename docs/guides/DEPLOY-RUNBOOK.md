# Production deploy runbook (VPS)

Deploy paths for the Delphic stack:
- **Automated** — `.github/workflows/deploy.yml` runs on every push to `main` (also `workflow_dispatch`; set repo variable `DEPLOY_ENABLED=false` to pause). SSHes to the box and runs the same `./start-delphic.sh --prod` flow.
- **Manual** — `git pull` + `./start-delphic.sh --prod` on the box (§1–§3).

- **Host path:** `/opt/delphic`
- **Runner:** `./start-delphic.sh --prod` (Docker Compose, both files, service name `server`)
- **Migrations:** `prisma migrate deploy` runs automatically on every `server` container start. It only applies *unapplied* migrations, forward-only — it never resets or drops.
- **Seeding:** never automatic, and the CSV seeds refuse to run against a non-local database (see [PRODUCTION-SEED.md](PRODUCTION-SEED.md)). Prod is bootstrapped with `seed-admin.js` only.

> **Production data is never dropped by a deploy.**
> - `./start-delphic.sh --prod` takes a **verified `pg_dump -Fc` into `./backups/` before it builds or migrates**, and aborts the deploy if that backup cannot be written or read back.
> - There is **no restore flag** on `start-delphic.sh`. A restore is always a deliberate, manual `pg_restore` (§4).
> - The destructive CSV seeds (`seed.js`, `seed-accounts.js`, `seed-jira.js`, `seed-vendors.js`) hard-refuse when `NODE_ENV=production` or `DATABASE_URL` is remote, unless `ALLOW_DESTRUCTIVE_SEED=1` is set.

```bash
cd /opt/delphic
alias dc='docker compose -f docker-compose.yml -f docker-compose.prod.yml'
```

---

## What a deploy touches (and what it never touches)

Every step of the automated deploy (`deploy.yml`) and the manual flow, line by line:

| Step | Effect on the database |
|---|---|
| `git fetch --prune` + `git reset --hard origin/main` | **Files only.** The DB is a Docker named volume, not in git; `.env` and `./backups/` are git-ignored. This discards uncommitted *file* drift on the box — never data. |
| `./start-delphic.sh --prod` → pre-deploy backup | `pg_dump -Fc` → `backups/predeploy-<ts>.dump`, verified with `pg_restore --list`. The deploy **aborts here** if the dump fails or the disk has < `BACKUP_MIN_FREE_GB` free. Guaranteed restore point before any change. |
| `docker compose up -d --build` | Rebuilds the `client` / `server` **images**, recreates containers. The `db` container reattaches the **same volume** — recreating a Postgres container never deletes its volume. No `-v` anywhere in the script. |
| server container start → `prisma migrate deploy` | Applies only *unapplied* migrations, forward-only. **Never resets or drops.** |
| `docker compose build --no-cache client` + `up -d client` | Static nginx assets only. |
| `curl …/health` | Read-only. |

The deploy never runs `docker compose down -v`, `dropdb`, `--restore`, or any CSV seed
(those are also hard-blocked by `server/prisma/_guard.js` on `NODE_ENV=production`).
The `docker compose down -v` you see in `ci.yml` runs on GitHub's throwaway runner
against a scratch DB — never the box.

**The only way an automated deploy can lose data is a migration that contains a `DROP`.** See the hard rule below.

---

## HARD RULE — no `DROP` in a migration that ships with feature code

`prisma migrate deploy` runs automatically on every deploy. A migration that reaches
`main` **must not** contain any of: `DROP TABLE`, `DROP COLUMN`, a destructive
`ALTER COLUMN … TYPE` / `USING`, a table or column `RENAME`, `TRUNCATE`. These are
the *only* operations that turn an ordinary deploy into data loss.

Removing a column or table is a **two-release expand → contract**:

1. **Release N** — stop writing and reading the column in application code. Leave the
   column in the database. Deploy. Confirm stable in prod.
2. **Release N+1** — a migration that drops the now-unused column. Its **own PR**, in a
   **scheduled maintenance window**, with a fresh **hand-taken verified backup** first,
   and the `DROP` **called out explicitly in the PR description**. Never bundled with a
   feature.

Pre-flight check before any deploy (also in §1):

```bash
grep -rIl -E 'DROP (TABLE|COLUMN)|ALTER COLUMN .* (TYPE|USING)|RENAME (TABLE|COLUMN|TO)|TRUNCATE' \
  $(git diff --name-only HEAD origin/main -- server/prisma/migrations/) 2>/dev/null
```

A hit is a **stop-and-review**, not a proceed: pause automated deploy
(`DEPLOY_ENABLED=false`), follow the maintenance-window steps, then re-enable.

---

## 0. Scheduled backups (set up once)

Independent of deploys — so the worst case from any incident is one interval, not hours.

```bash
# every 15 min, as the deploy user
crontab -e
*/15 * * * * cd /opt/delphic && ./scripts/db-backup.sh >> /var/log/delphic-backup.log 2>&1
```

Or a systemd timer:

```ini
# /etc/systemd/system/delphic-backup.service
[Service]
Type=oneshot
WorkingDirectory=/opt/delphic
ExecStart=/opt/delphic/scripts/db-backup.sh

# /etc/systemd/system/delphic-backup.timer
[Timer]
OnCalendar=*:0/15
Persistent=true
[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now delphic-backup.timer
```

Retention (count-based, not age-based — disk will not grow without bound):

| Source | Files | Kept |
|---|---|---|
| Each `./start-delphic.sh --prod` (every push/deploy) | `backups/predeploy-*.dump` | newest **7** (`BACKUP_KEEP`) |
| Cron / systemd timer | `backups/auto-*.dump` | newest **7** (`BACKUP_KEEP`) |

Each run writes one new dump, then deletes anything past the 7 newest of that family. Override with `BACKUP_KEEP=N` if you need more. Both scripts also abort when the backups volume has less than `BACKUP_MIN_FREE_GB` (default **2**) free.

- `./backups/` is git-ignored.
- **Copy them off the box.** Set `BACKUP_OFFSITE_CMD` (e.g. `BACKUP_OFFSITE_CMD='aws s3 cp "$1" s3://delphic-backups/'`) in the service environment.
- Strongly recommended: enable Postgres WAL archiving / use a managed Postgres with **point-in-time recovery** so recovery is to the second, not the last dump.

---

## 1. Pre-flight

```bash
cd /opt/delphic
git fetch origin && git log --oneline HEAD..origin/main       # what's landing

# Does this release contain a destructive migration? A hit is a stop-and-review
# (see the HARD RULE section above), not a proceed.
git diff --stat HEAD origin/main -- server/prisma/migrations/
grep -rIl -E 'DROP (TABLE|COLUMN)|ALTER COLUMN .* (TYPE|USING)|RENAME (TABLE|COLUMN|TO)|TRUNCATE' \
  $(git diff --name-only HEAD origin/main -- server/prisma/migrations/) 2>/dev/null
```

Optional belt-and-braces manual backup (the deploy also does this):

```bash
dc exec -T db pg_dump -U postgres -Fc requirement_dashboard > ~/manual-$(date +%F-%H%M).dump
```

---

## 2. Pull and deploy

```bash
cd /opt/delphic
git pull origin main
./start-delphic.sh --prod
#   → verified pre-deploy backup → ./backups/predeploy-<ts>.dump
#   → docker compose up -d --build   (server container runs `prisma migrate deploy`)
#   → waits for /api/v1/health
```

`--skip-backup` exists only for the very first deploy against an empty DB. Never use it otherwise.

---

## 3. Verify

```bash
cd /opt/delphic
dc ps
dc exec server node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && echo "API OK"
dc logs --tail=100 server
dc logs --tail=100 client
```

Spot-check real data (row counts unchanged, a known record still present):

```bash
dc exec -T db psql -U postgres requirement_dashboard -c \
  "select 'accounts' t, count(*) from accounts union all select 'requirements', count(*) from requirements union all select 'submissions', count(*) from submissions;"
```

Keep the `predeploy-*.dump` until the release is confirmed good.

---

## 4. Rollback

### Code only (no DB change, or only additive migrations in the bad release)

```bash
cd /opt/delphic
git log --oneline -5
git checkout <previous-good-sha>
./start-delphic.sh --prod        # takes a fresh backup, rebuilds; DB untouched
```

Additive migrations are backward-compatible, so old code runs fine against the new schema — no DB action needed.

### Data loss / bad destructive migration

Prefer **point-in-time recovery** to just before the deploy if it's enabled (loses ~0 data).

Otherwise restore the pre-deploy dump manually:

```bash
cd /opt/delphic
ls -lt backups/ | head

dc stop server                                   # stop writes first
dc exec -T db sh -c 'dropdb --if-exists --force requirement_dashboard && createdb requirement_dashboard'
dc exec -T db pg_restore -U postgres -d requirement_dashboard --no-owner --no-privileges \
  < backups/predeploy-<YYYY-MM-DD-HHMMSS>.dump
git checkout <previous-good-sha>                  # match the code to the restored schema
./start-delphic.sh --prod
```

This is the only path that drops the database, and it is a deliberate, manual recovery step — never part of a deploy.

---

## Notes

- Frontend-only commits still need `--build` (assets are baked into the `client` image); no migration step.
- Required prod env vars (no defaults): `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN`. Generate secrets: `openssl rand -hex 32`.
- **`ENABLE_JOBS`** (default `true`): the API runs an in-process `node-cron` job every 15 min for interview reminders (T-24h / T-1h in-app notifications). Leave it on for the single prod container. **If the API is ever scaled to more than one instance, set `ENABLE_JOBS=false` on every instance but one** — otherwise each instance sends duplicate reminders. Always off under `NODE_ENV=test`. Reserved (unused) `NOTIFICATIONS_*` / `MS_GRAPH_*` vars are placeholders for the future email + MS Teams channels.
- Loopback binds in prod: API `127.0.0.1:4000`, client `127.0.0.1:8081` (nginx fronts them).
- Rehearse risky migrations first: restore the latest `auto-*.dump` into a scratch DB, run `prisma migrate deploy`, smoke-test.
