# AGENTS.md

Context for any AI agent (or human) picking up work on the Requirement Management Dashboard.

## What this project is

Internal requirement/recruitment pipeline dashboard for Delphic. Tracks client accounts → requirements → candidate profiles → submissions → interview rounds, with role-based dashboards and reporting.

## Docs layout

| Folder | Contents |
|---|---|
| [`architecture/`](architecture/) | Diagrams, HLD, field model, API contracts |
| [`features/`](features/) | Feature-level design + build specs (one doc per feature) |
| [`ui/`](ui/) | Jira UX rule, RD-115 walkthrough, reference screenshots |
| [`testing/`](testing/) | Demo seed + ticket test guides |
| [`progress/`](progress/) | PROGRESS, TODO, SPRINT-PLAN |
| [`guides/`](guides/) | Operator guides (e.g. backend logging) |
| **This file** | Repo layout, local setup, standing conventions |

### Architecture / diagrams

- [ARCHITECTURE-OVERVIEW.md](architecture/ARCHITECTURE-OVERVIEW.md) — shareable diagrams, feature map, journeys
- [HLD.md](architecture/HLD.md)
- [Requirement-Dashboard-System-Design-v2.md](architecture/Requirement-Dashboard-System-Design-v2.md) — historical, an earlier already-shipped milestone despite the name
- [V2-LEAD-PIPELINE-REQUIREMENTS.md](architecture/V2-LEAD-PIPELINE-REQUIREMENTS.md) — lead classification, meeting attendees, candidate round taxonomy, requirement types, candidate bench flag, client-performance report
- [API-Spec-and-Build-Plan.md](architecture/API-Spec-and-Build-Plan.md)
- [MULTI-COMPANY-ERP-PLATFORM-HLD.md](architecture/MULTI-COMPANY-ERP-PLATFORM-HLD.md) — design + client product brief for evolving to a multi-company group platform ("Delphic One"): `Org`/`OrgGroup`/`OrgMembership` tenancy, shared-DB row-level isolation, HR/attendance/calendar/leave/timesheet/payroll/billing modules, expense/vendor/accounting/org-chart/external-access modules, cross-org super dashboard. Phased, additive-only migration plan; §11 has the full phase-by-phase shipped/planned status table. **Phases 0-10 built (backend)** (tenancy, auth, directory/calendar/attendance/leave, project-centric timesheets, payroll, billing, profitability + super dashboard, expenses + vendor payments, accounting ledger/tax, external CA/Legal access, org chart) — see the Implementation Plan.
- [MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md) — **in progress, Phase 0-10 shipped (backend); frontend + a full cross-suite regression re-run next**, branch `feature/multi-company-erp` (off `main`, never merged by an agent) against its own local DB `requirement_dashboard_erp` (`server/.env.erp.example`, current `requirement_dashboard`/`.env` untouched). Has a "Current status" table near the top for a one-screen summary; workstream split, day-by-day schedule, local demo script, DB connection pooling notes.

### Features

- [features/README.md](features/README.md) — index of feature specs
- [RD-NOTIFICATIONS-AND-CALENDAR.md](features/RD-NOTIFICATIONS-AND-CALENDAR.md) — role-aware in-app notifications, interview calendar (month + agenda), interviewer feedback, reminder cron; email + MS Teams extension points (Built 2026-09-04, branch feature/notifications-calendar)

### UI

- [UI-UX-JIRA.md](ui/UI-UX-JIRA.md) — product must feel like Jira (dense filters + list). Reference: [jira-like-dashboard-reference.png](ui/references/jira-like-dashboard-reference.png)
- [UI-REDESIGN.md](ui/UI-REDESIGN.md) — drawers, list peeks, pipeline KPIs, reports tabs, interview date
- [RD-115-SPEC-WALKTHROUGH.md](ui/RD-115-SPEC-WALKTHROUGH.md)

### Testing

- [TESTING-DEMO-SEED.md](testing/TESTING-DEMO-SEED.md) — team roster + LeadMinds/Jira/vendor seed walkthrough
- [TESTING-RD-103-104.md](testing/TESTING-RD-103-104.md) — requirements UI
- [TESTING-RD-107-108.md](testing/TESTING-RD-107-108.md) — submissions UI
- [TESTING-RD-111-125-112.md](testing/TESTING-RD-111-125-112.md) — pipeline / interviews / kanban
- [TESTING-RD-114-128.md](testing/TESTING-RD-114-128.md) — reports UI (incl. BDA + Sales) + change password

### Progress

- [PROGRESS.md](progress/PROGRESS.md) · [TODO.md](progress/TODO.md) · [SPRINT-PLAN.md](progress/SPRINT-PLAN.md)

### Guides

- [DATABASE-CONNECTION-POOLING.md](guides/DATABASE-CONNECTION-POOLING.md) — Prisma pool sizing (`DB_POOL_SIZE`/`DB_POOL_TIMEOUT`), why every `DATABASE_URL` now has `connection_limit`/`pool_timeout`, and the concrete triggers (+ gotchas) for PgBouncer / a read replica later
- [BACKEND-LOGGING.md](guides/BACKEND-LOGGING.md)
- [PRODUCTION-SEED.md](guides/PRODUCTION-SEED.md) — VPS / post-pull seed commands (`seed` → `seed:accounts` → `seed:jira` → `seed:vendors`; `seed-admin` = safe prod bootstrap)
- [DEPLOY-RUNBOOK.md](guides/DEPLOY-RUNBOOK.md) — VPS manual deploy: backup → `git pull` → `./start-delphic.sh --prod` → verify → rollback

## Stack

- **Client:** React + Vite + Tailwind CSS (`client/`)
- **Server:** Node.js / Express + Prisma ORM on PostgreSQL (`server/`)
- **Deploy:** Docker Compose (`docker-compose.yml` + `docker-compose.prod.yml`), `start-delphic.sh` / `setup-vm.sh`, host nginx + Let's Encrypt (`nginx.conf.example`). Deploy workflow SSHs and runs `./start-delphic.sh --prod`. GitHub Actions on push to `main`.

## Repo layout

```
client/src/
  app/App.jsx           # router + layout shell
  pages/<domain>/        # one folder per domain (accounts, requirements, profiles, submissions, reports, dashboard, auth)
  components/ui/         # DataTable, StatCard, Badge, shared primitives
  components/layout/     # AppLayout (nav/shell)
  lib/apiClient.js       # fetch wrapper
  lib/authContext.jsx    # auth/session context

server/src/
  modules/<domain>/      # <domain>.routes.js, .controller.js, .service.js, .validation.js
                         # domains include accounts, requirements, profiles, submissions, pipeline
                         # (GET /pipeline/board), admin, comments, documents, dashboard, reports, …
  utils/closureProgress.js  # pure closure % + step breakdown for submissions/profiles/matrix
  middleware/            # auth, requestLogger, errorHandler, lockCheck
  config/                # db.js, env.js, logger.js (structured stdout logging)

server/prisma/
  schema.prisma          # single schema — all domain tables as Prisma models
  team-roster.js         # Delphic @delphic.in users + Jira name/id maps
  client-aliases.js      # Jira client name → LeadMinds canonical name
  seed.js                # wipe + departments + team roster only
  seed-accounts.js       # LeadMinds client accounts CSV
  seed-jira.js           # Jira_all.csv requirements (JD, assignees, comments)
  seed-vendors.js        # active vendor accounts from tracker sheet
  seed-admin.js          # non-destructive prod admin bootstrap

docs/
  AGENTS.md              # this file
  jira/                  # Jira_all.csv, LeadMinds-Accounts.csv
  architecture/          # diagrams + HLD + specs
  ui/                    # UX rules + walkthroughs + references/
  testing/               # how-to-test guides
  progress/              # PROGRESS, TODO, SPRINT-PLAN
  guides/                # logging, production seed, other operator guides
```

Domain modules follow a consistent 4-file pattern: `routes` → `controller` → `service` → `validation` (including `admin`, `comments`, `documents`, and `dashboard` which has routes + service).

## Branching

- `main` — production; pushes trigger CI + deploy workflow
- `staging` — pre-production integration
- `dev` — trunk for feature work before promotion to `staging`
- `feature/multi-company-erp` — long-lived branch for the [multi-company ERP build](architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md), isolated from `dev`/`staging`/`main` so its bugs/schema churn don't affect ongoing recruitment-dashboard work; runs against its own local DB (`requirement_dashboard_erp`), not the shared `requirement_dashboard`.

## Local setup

**Docker (recommended):**

```bash
docker compose up -d --build
```

Full CSV seed (PowerShell-safe). From **repo root** after containers are up:

```powershell
docker compose exec server mkdir -p /app/docs/jira
docker compose cp docs/jira/Jira_all.csv server:/app/docs/jira/Jira_all.csv
docker compose cp docs/jira/LeadMinds-Accounts.csv server:/app/docs/jira/LeadMinds-Accounts.csv
docker compose exec server node prisma/seed.js
docker compose exec server node prisma/seed-accounts.js
docker compose exec server node prisma/seed-jira.js
docker compose exec server node prisma/seed-vendors.js
```

Client: http://localhost:8081 · API: http://localhost:4000 · Postgres: `localhost:5434`.

**One command — Postgres in Docker, server + client with hot reload** (`start-platform.sh` / `start-platform.ps1` at repo root):

```bash
./start-platform.sh              # db (compose) + migrate deploy, then API :4000 + client :5173
./start-platform.sh --restore    # restore newest backup-*.dump (real-like data) → migrate → run
./start-platform.sh --restore=backup-2026-09-01-113412.dump   # a specific pg_dump -Fc file
./start-platform.sh --seed       # instead: run the synthetic CSV seed chain
./start-platform.sh --fresh      # wipe the db volume, migrate, CSV-seed, run
./start-platform.sh --db-only    # set the DB up (with --restore/--seed) then exit
./start-platform.sh --down       # stop the db container
```

`--restore` drops & recreates `requirement_dashboard`, `pg_restore`s the dump inside the `db`
container, writes a `pre-restore-safety-<ts>.dump` first, then `prisma migrate deploy` brings
the schema up to head (the committed dumps predate the last few migrations). `--restore` and
`--seed`/`--fresh` are mutually exclusive. Dumps live in the repo root and are git-ignored (`*.dump`).

PowerShell: `.\start-platform.ps1` — same flags (`-Restore` / `-RestoreFile` / `-Seed` / `-Fresh` /
`-DbOnly` / `-Down`); opens the API and client each in their own window. Client on **:5173** here
(Vite dev) proxies `/api` → `:4000`; the `:8081` client is the Docker-only build.

**Without Docker (hot reload):**

```bash
npm install --workspaces
cp server/.env.example server/.env   # DATABASE_URL → localhost:5434; JWT secrets; optional LOG_LEVEL
npm run migrate
npm run seed
npm run seed:accounts
npm run seed:jira
npm run seed:vendors
npm run lint
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173
```

Seeded users (password `Password123!`): `admin@delphic.in`, `diksha.yadav@delphic.in`, `paras.gulati@delphic.in`, `chahak.pandya@delphic.in`, `dheeraj.kumar@delphic.in`, `tanvi.saxena@delphic.in`, `Garv@delphic.in`, `prashant.hada@delphic.in`, `sarthak.solanki@delphic.in`, and the rest of the roster in `server/prisma/team-roster.js`.

`npm run seed` wipes everything and loads **team only**. Domain data comes from `seed:accounts` (LeadMinds clients), `seed:jira` (requirements + JDs + assignments), and optional `seed:vendors`. VPS steps: [guides/PRODUCTION-SEED.md](guides/PRODUCTION-SEED.md). Walkthrough: [testing/TESTING-DEMO-SEED.md](testing/TESTING-DEMO-SEED.md).

**Prod data is never dropped by tooling.** `seed.js` / `seed-accounts.js` / `seed-jira.js` / `seed-vendors.js` call `prisma/_guard.js` and exit 1 if `NODE_ENV=production` or `DATABASE_URL` is a non-local host (override: `ALLOW_DESTRUCTIVE_SEED=1`, only with a fresh verified backup). `start-platform.sh --restore` / `--fresh` refuse the same way. `start-delphic.sh --prod` takes a **verified `pg_dump -Fc` into `./backups/` before it builds or migrates** and aborts if that fails or if free space is under `BACKUP_MIN_FREE_GB` (default 2); it keeps the newest `BACKUP_KEEP` (default **7**) `predeploy-*.dump` files (one per push) and has no `--restore` flag — restores are a deliberate manual `pg_restore` (DEPLOY-RUNBOOK §4). `scripts/db-backup.sh` likewise keeps 7 `auto-*.dump` files. `prisma migrate deploy` (auto on `server` start, and on every GitHub Actions deploy) only applies pending migrations, never resets. Schedule `scripts/db-backup.sh` (cron / systemd timer) so incident loss is one interval, not hours.

**HARD RULE — a migration that ships with feature code must contain no `DROP`.** `prisma migrate deploy` runs on every deploy, so a migration on `main` must never contain `DROP TABLE`, `DROP COLUMN`, a destructive `ALTER COLUMN … TYPE`/`USING`, a table/column `RENAME`, or `TRUNCATE` — these are the only ways an ordinary deploy loses data. Removing a column/table is a **two-release expand → contract**: (N) stop reading/writing it in code, leave it in the DB, ship, confirm stable; (N+1) a migration that drops it — its own PR, a scheduled maintenance window, a hand-taken verified backup first, the `DROP` called out in the PR description. Never bundled with a feature. Full detail + pre-flight grep: [guides/DEPLOY-RUNBOOK.md](guides/DEPLOY-RUNBOOK.md) ("HARD RULE" and "What a deploy touches").

## Backend logging

Zero-dependency structured logger. Full guide: [guides/BACKEND-LOGGING.md](guides/BACKEND-LOGGING.md).

- Env: `LOG_LEVEL=debug|info|warn|error` (defaults: debug in development, info in production, error in tests).
- Production (`NODE_ENV=production`) emits one JSON object per line; development prints a readable line.
- Automatic: HTTP access (`requestLogger`), validation/errors (`errorHandler`), start/shutdown/crash hooks (`index.js`).
- Health checks (`GET /api/v1/health`) are not access-logged. Tests do not emit access logs.
- In modules: `const logger = require('../../config/logger');` then `logger.info('event_name', { … })`. Never log passwords, JWTs, or upload bodies.
- Docker: `docker compose logs -f server` (optional root `.env` `LOG_LEVEL`).

**Temporary testing:** the login page has one-click buttons for Admin / BDA / Sales / Recruiter. Hide with `VITE_DISABLE_QUICK_LOGIN=true` when moving to real auth. Only **admin** can create new users (Users page in the nav); share email + password with BDA / Sales / Recruiter / other admins.

**This dev machine specifically** already runs native (non-Docker) Postgres services on `localhost:5432` and `localhost:5433`, and a native Apache/XAMPP on `localhost:8080`. `docker-compose.yml`'s default host ports (5434 for Postgres, 8081 for the client) were chosen to avoid these — if ports still collide, check `netstat -ano | grep <port>` and cross-reference the PID before assuming a Docker container is what you're talking to.

**Generating a new migration** (`prisma migrate dev --name ...`) must be run from the *host* (not `docker compose run`) with `DATABASE_URL` pointed at the compose-mapped Postgres port (`localhost:5434`) — `prisma migrate dev` writes the new `migrations/<timestamp>_name/` folder to disk, and if you run it inside an ephemeral `docker compose run --rm` container that folder is written into the container's throwaway layer and lost the moment the container exits (this happened once already — see [progress/PROGRESS.md](progress/PROGRESS.md)). Applying already-committed migrations (`prisma migrate deploy`, done automatically on `server` container startup) doesn't have this problem since it only reads.

## Working conventions

- **STRICT — an AI agent must never `git push` to `main` (or open/merge a PR into `main`).** `main` auto-deploys to production (`.github/workflows/deploy.yml`). An agent may push only to (a) local feature branches and (b) `staging`. For anything destined for `main`, the agent stops after committing and **hands the human the exact manual push/merge commands to run** — it does not run them, even if asked to "push", "deploy", or "ship". The human is the only one who advances `main`.
- Keep [progress/PROGRESS.md](progress/PROGRESS.md) and [progress/TODO.md](progress/TODO.md) up to date as work lands — check them at the start of a session and update them at the end.
- Prefer `logger` over bare `console.*` in server code. See [guides/BACKEND-LOGGING.md](guides/BACKEND-LOGGING.md).
- **Frontend must follow Jira-like UX** ([ui/UI-UX-JIRA.md](ui/UI-UX-JIRA.md)). Dense tables, filter bar, Create, inline status, avatar stacks — not a generic CRUD admin look. Compare list/dashboard work to the reference screenshot before calling UI tickets done.
- All frontend role checks go through `can()` / `usePermissions()` / `<Can>` in `client/src/lib/permissions.js`. Do not add new scattered `user?.role ===` gates for nav, routes, or panels. See [ui/UI-REDESIGN.md](ui/UI-REDESIGN.md).
- **Superadmin** is `role: 'admin'` **plus** `User.is_superadmin = true` (never a new role value — every `authorize('admin')` gate keeps working, the flag only *adds* powers). `admin@delphic.in` is the seeded superadmin. Server-side, the extra powers are gated by `authorizeSuperadmin` / `loadSuperadminFlag` in `middleware/auth.js`, which **re-read the flag from the DB each request** — never trust an `is_superadmin` JWT claim (there isn't one). Frontend gating goes through `userCan(user, cap)` / `usePermissions(user).isSuperadmin`; superadmin-only caps: `overrideStage`, `editAnyUser`, `deleteRecords`. **Admin + BDA** share account-flow caps (`editAccount`, `editBroughtBy`, `unlockAccount`). Current superadmin-only surface: edit any user field incl. role / email / password / `is_superadmin` (`PATCH /users/:id`), edit locked accounts in place, `POST /accounts/:id/stage/override` / `POST /submissions/:id/stage/override` / `POST /requirements/:id/status/override` (free-form stage/status moves), and **record deletion** (see the soft-delete bullet below). Ordinary admins may also step a submission back one stage or reactivate `rejected`/`backout` via the normal stage endpoint (reason required). Deletion is soft-only — never a hard `DELETE`.
- Leads keep a current POC on **`account.owner_id`** (reassignable by BDA/admin) and acquisition credit on **`origin_owner_id`** (“Brought by”). **BDA runs the full account flow on all accounts** (view/edit/stage/meeting/type/brought-by/unlock accounts) and may **view** all requirements but not mutate them. Requirements stay Sales-owned (`sales_owner_id`). Admin reports: `bda-performance` vs `sales-performance` must stay separate.
- Product forms (create candidate, put forward, create account/requirement/user, assign recruiters, interview rounds) open in an RHS `Drawer` only — never a page-wide centered modal. List row click opens a peek drawer with actions, not a full-page navigate.
- **Form-in-drawer layout:** the four `*FormPage` / `SubmissionCreatePage` components render two-column (`sm:grid-cols-2`) in **both** `asPanel` and standalone-route mode, in a `Drawer size="xl"` (~46rem). In `asPanel` mode their Save/Cancel live in a `<FormActionsBar>` (`components/ui/FormActionsBar.jsx`) as the **first child of the `<form>`** — it's `sticky top-0` inside the Drawer's scrolling body so the CTAs never scroll away; the bottom button row renders only when `!asPanel`. New drawer-hosted forms should follow this (xl drawer + `FormActionsBar` first, no bottom buttons in panel mode).
- **List tables:** `DataTable` takes `maxHeight` (e.g. `"calc(100dvh - 18rem)"`) — the four list pages pass it so the body scrolls inside that height while the `thead` (`sticky top-0`) and the filter bar above the table stay fixed. Omit `maxHeight` for embedded/preview tables (reports, dashboard, detail-page sub-tables) — they scroll with the page.
- Pipeline board filters + `view` are URL-synced (`usePipelineFilters` / `PipelineFilters` write to `useSearchParams`); the 4 list pages (`{Accounts,Profiles,Submissions,Requirements}ListPage`) both mirror filter state → URL and re-hydrate state ← URL on `searchParams` change, so Back / reload / shared link / new tab keep filters. **Clearing filters is only via the "Clear all filters" button** (`PipelineFilters` + each list toolbar) — never implicitly. `OpenInNewTabButton` (`components/OpenInNewTabButton.jsx`) is a real `<a target="_blank" href={path+search}>` in every board header. Board cards + `CardActionsMenu` nav items (`to`/`href` props) are `<Link>`s so cmd/ctrl-click opens the exact entity in a new tab. The `RequirementDetailPage` "Tagged profiles" table is `GET /submissions?requirement_id=<id>` (recruiter-scoped, `limit` max 100 — same cap as the submissions list).
- Dropdowns: use `components/ui/SearchableSelect.jsx` (single-select, `options`/`onChange(value)`) for any data-driven or ~6-plus-option picker, and `MultiSelectDropdown.jsx` for multi-select. Plain `<select>` is only for small fixed enums (gender, currency, work mode, stage-transition pickers, etc.).
- Submission stage moves (`POST /submissions/:id/stage`): **recruiter, sales and admin** all do any valid **forward** transition on **any** submission (no requirement-ownership check). **Backward** moves / reactivating a `rejected`/`backout` candidate stay **admin/superadmin-only** (`forbidden_backward`, reason required) — `submissions.service.changeStage` `backward` guard. `rejected`/`backout` need their reason regardless of role. Client: `canMoveSubmissionStage(user)` (`recruiter|sales|admin`) gates the move UI on every board + `SubmissionDetailPage`; `canMutateSubmission(user)` (`recruiter|admin`) still gates **field edits** (`PATCH /submissions/:id`). (History: sales was previously limited to just `internal_screening → submitted_to_client` on an owned requirement; widened 2026-09-09.)
- **Put forward** (`POST /submissions`, `authorize('recruiter','sales','admin')`): recruiter/admin may submit any active candidate; **sales is bench-only** — `submissions.service.create` rejects with `sales_bench_only` (403) unless `profile.source === 'direct' && profile.on_bench`, enforced again after the vendor-rate check. Client: `canCreateSubmission(user)` (`recruiter|sales|admin`) gates the "Put forward" CTA; `canOnlyPutForwardBench(user)` (`sales`) locks `SubmissionCreatePage`'s "On bench only" checkbox on and filters the candidate picker, both in `lib/submissionStages.js`. The candidate and (in-progress) requirement pickers page through `fetchAllPages()` (`lib/fetchAllPages.js`) instead of stopping at the first `limit=100` page, so every active candidate / in-progress requirement is selectable regardless of count.
- **Superadmin stage override**: `POST /accounts/:id/stage/override`, `POST /submissions/:id/stage/override`, and `POST /requirements/:id/status/override` (all `authorizeSuperadmin`) force any stage/status, ignoring the transition map / lock / gates (the requirement one also skips the seats-closed gate and clears `closed_at` unless the target is `closed`); reason required, audited as `[override] …` in `stage_history`. Client boards route a disallowed drag to the matching override drawer (`AccountStageOverrideDrawer` / `SubmissionStageOverrideDrawer` / `RequirementStatusOverrideDrawer`) for a superadmin instead of the "Cannot move from X to Y" toast; `RequirementDetailPage` also carries an "Override status…" button. `JobPipelineBoard` lets superadmins drag locked / terminal requirement cards.
- **Account meeting attendees are not role-restricted** — anyone in `/users/directory` (sales, BDA, recruiter, admin) can be added, via the shared `AccountAttendeesPicker` (`pages/accounts/`) used by `AccountStageMoveDrawer`, `AccountStageOverrideDrawer`, and `AccountMeetingEditDrawer`. **Editable after the fact**: `POST /accounts/:id/meeting` (`authorize('bda','admin')`, `accounts.service.updateMeeting`) updates `meeting_mode`/`meeting_date`/`meeting_location`/`meeting_notes`/attendees **without a stage change** (works whether the account is still `meeting_scheduled` or has since moved to `active`/`rescheduled`; blocked if locked), audited as `[stage_history to_stage === from_stage]` reason `"Meeting details updated"`. `AccountDetailPage`'s "Meeting information" card carries an "Edit meeting" action (`canMutateAccount`, unlocked, `meeting_date` set) opening it. Because attendees can now be anyone, `reports.service.salesReports.meetings_attended` filters attendees to `role IN (sales, admin)` so a BDA/recruiter tagged along doesn't inflate the "Sales POC" report.
- **Superadmin soft-delete** (for cleaning up duplicate / mistaken records without DB surgery). `account`, `requirement`, `submission`, `profile`, `interview_round` each carry `deleted_at` / `deleted_by` / `delete_reason`. `POST /admin/:entity_type/:entity_id/delete` (`authorizeSuperadmin`, body `{ password, reason }` — the caller re-enters their **own** login password, bcrypt-checked) stamps those columns and writes an `audit_logs` row with a full JSON `snapshot`. `POST /admin/:entity_type/:entity_id/restore` (`{ reason }`) clears them. `GET /admin/deleted?entity_type=` lists the stamped rows; `GET /admin/audit?entity_type=&limit=` is the full delete+restore trail. A single `prisma.$use` middleware in `config/db.js` injects `deleted_at: null` into every `findMany/findFirst/findUnique/count/aggregate/groupBy` on those five models, so soft-deleted rows vanish from lists, boards, dashboard and reports. **Limitation:** the middleware does *not* filter nested relation reads (`include: { account: true }`) — a deleted parent can still surface through a live child's include. Client: superadmin-only `DeleteRecordButton` on the four detail pages + per-round in `InterviewRoundsPanel` (cap `deleteRecords`); **Settings → Deleted records** tab (`DeletedRecordsPanel`, superadmin only) lists current deletions with a Restore action + the audit trail; deletions/restores also appear in the dashboard Recent-activity feed (`dashboard.service.recentActivity` merges `stage_history` + `audit_logs`).
- **Coverage-gap reports are present-state, no date range** (the `date_from`/`date_to` params still parse but the UI stopped sending them). **CWR** (`clients-without-requirements`) with a `bucket` is strictly `type = 'client'`, `stage = 'active'`; tabs: `all` / `with_requirements` (≥1 req open/in-progress/on-hold) / `no_active` (no such req — closed-only or never had one). `with_requirements` + `no_active` partition the set; `without_active_requirements` (`requirements: { none: {} }`) and `closed_only` still work server-side (export / back-compat) but aren't in the UI. The list's "Active requirements" column is a filtered `_count` on those same three statuses. No-`bucket` legacy calls still use `OR: [{ type: 'client' }, { type: null }]`. **RVG** (`recruiter-vendor-gaps`) lists `type = 'vendor'` **and** `stage = 'active'` accounts only; `vendor_activity=active` = every such vendor, `inactive` = none of its sourced candidates is in a live submission (any `SubmissionStage` except `closed`/`rejected`/`backout`), `has_live` = Active − Inactive (at least one live submission).
- **HR report** (`GET /reports/hr`, `authorize('admin')`, `reports.service.hrReport`): 4 per-day tables — sourcing (`Profile.created_at`), submissions (`Submission.created_at`), and internal round 1 grouped by sourcer and by interviewer (`InterviewRound.scheduled_at`, `round_type='internal_r1'`). "Sourcer" = `Profile.added_by` everywhere. On-bench profiles excluded from all four. Round metrics: *completed* = `status='completed' && result in (pass,fail)`; *shortlisted* = `result='pass'`. Filters: `date_from`/`date_to`, `sourcer_id` (tables 1-3), `interviewer_id` (table 4), `source` (all). Client (`reportViews.js` `hrSections()` + `ReportsPage`): a **visible** report labelled "HR reports" (`ALL_REPORTS`, no `hidden`); the 4 tables show on named tab cards (icon + hint + count pill, like RVG/CWR), one at a time, with `HrChart` above the active table — a **horizontally-scrollable** plot (`min-width` grows with day count), stacked bars by source for sourcing/submissions and multi-line for the round tables. Sourcing/Submissions rows are **one per (sourcer, day)**; the per-source split rides on `row.by_type` and shows on hover over the Count cell (`hrTypeSummary`). Add more tables as HR asks.
- **Candidate source labels:** stored `ProfileSource` enum stays `direct`/`vendor`/`linkedin`; the UI shows **Bench** / **Vendor** / **Market** (via `Badge` `LABEL_OVERRIDES` + the source `<select>`s + `reports.service SOURCE_LABEL`). Logic still keys off the raw values.
- **Reports dates** render via `formatReportDate` (`reportViews.js`) as `08 September 26`. **All report date bucketing + range filtering is IST** (`Asia/Kolkata`, fixed +05:30) regardless of the server clock (UTC in prod). In `reports.service.js`: `asIst()` shifts an instant so its `getUTC*`/`toISOString` read the IST wall clock; `dayKey`/`monthKey` bucket on that; `reportFrom`/`reportTo` (used by `optionalDateRange` and the inline `from`/`to` in every `*-performance` report + `closure`) turn a `YYYY-MM-DD` param into `…T00:00:00+05:30` / `…T23:59:59.999+05:30`. `explorer.service.js` inlines the same `+05:30` literals. **Never** parse a report date param with bare `new Date('YYYY-MM-DD')` (that's UTC midnight) or close a range with local `setHours` — the two must agree or a same-day custom range under-counts vs a monthly one.
- **Joinings** (`GET /reports/joinings`, admin+sales) — joining = `Submission` `stage='closed'` with `actual_joining_date` in range; `{tables:[by_sourcer, by_interviewer(L1/L2 split), by_vendor, by_sales_poc]}`, grouped by joining month. `by_sales_poc` ("By sales requirement") groups by the joining's requirement `sales_owner`. **Time to submit** (`GET /reports/time-to-submit`, admin+sales) — one row per submission created in range; columns: requirement created-at, requirement, client, candidate, **sourcer** (`Profile.added_by`), **type** (`Bench`/`Vendor`/`Market` from `SOURCE_LABEL`), **vendor** (`Profile.vendor_account.name`), then three durations **all measured from `requirement.created_at`**: `req_to_submission` (`→ submission.created_at`), `req_to_r1` (`→ first internal_r1 scheduled_at`), `req_to_submitted` (`→ first submitted_to_client stage-history`). Each `{ms,label,from,to}` (`—` when unreached; `from`/`to` ISO bounds shown on cell hover). Filters: `client_id` / `requirement_id` / `sourcer_id` / `search` (candidate name) + date range. Client: `joiningsSections()` / `timeToSubmitColumns()` in `reportViews.js`, both visible in `ALL_REPORTS`; Time to submit renders Candidate-search + Client/Requirement/Sourcer `SearchableSelect`s.
- **BDA reports** (`GET /reports/bda-reports`, `authorize('admin','bda')` — a `bda` caller is scoped to `bda_id = self`) — `reports.service.bdaReports`, 5 per-day tables keyed off `Account.origin_owner_id` ("Brought by", the immutable creator): `accounts_created` (accounts brought per BDA per day, with a Client/Vendor/Unclassified split on the Count hover), `meetings_scheduled` (account `stage_history` rows `to_stage='meeting_scheduled'` per BDA per day + how many of those accounts are `stage='active'` **now**), `meetings_conversion` (same, rolled up per BDA, no date), `requirements_brought` (one row per requirement on a BDA-brought **client** account — BDA / clickable Client → `/accounts/:id` / requirement / date), `requirements_brought_counts` (those counted per BDA per day, client names on Count hover). **Sales reports** (`GET /reports/sales-reports`, `authorize('admin','sales')` — a `sales` caller is scoped to `sales_id = self`) — `reports.service.salesReports`, 2 per-day tables: `requirements_created` (requirements per `sales_owner_id` per day, client names on Count hover), `meetings_attended` (accounts where the sales user is in `meeting_attendees`, counted by the account's `meeting_date` day). Both visible in `ALL_REPORTS` (`bdaReportsSections()` / `salesReportsSections()` in `reportViews.js`, rendered with the joinings-style tab cards in `ReportsPage`). Filters (`dateRangeSchema`, all optional): `bda_id` / `sales_id` (self-scoped server-side for that role; the "Individual" picker in `FilterBar` is hidden for that role on its own report, admin-only, and its options are the **full `/users/directory` roster** — no `role=` filter — since "brought by" / "sales POC" can be any user, active or not), `client_id` (an account id — despite the name it's client **or** vendor for bda-reports; narrows every table that has an account dimension), `account_type` (`client`/`vendor`/`unclassified`, **bda-reports `accounts_created` only**). Client: `bdaReportsAccountId`/`bdaReportsAccountType` (Account + Type selects — Account list is **every** account via `fetchAllAccountOptions()`, which pages `GET /accounts` past its 100 cap, no type restriction) and `salesReportsAccountId` (Client select, `type=client`, same paging) in `ReportsPage`.
- **Dashboard KPIs** (`GET /dashboard/summary`, `dashboard.service.js`): `startOfMonth`/`startOfWeek` are the **IST** calendar boundaries (fixed +05:30), matching the reports. Every KPI tile deep-links via `dashboardWidgets.kpiHref(key, { role, userId, monthStartIso })` to a list URL that reproduces the tile's exact population: BDA account tiles add `&owner_id=<me>` (the accounts list has no role auto-scope); sales submission tiles add `&sales_owner_id=<me>` (only recruiters are auto-scoped there); "closed / closures this month" pass `&closed_from=` / `&joined_from=` (IST month-start ISO). Supporting list params added: accounts `?stuck=stuck` (stale lead/meeting/rescheduled, mirrors the "Stuck leads" tile) and CSV `?stage=a,b`; submissions `?sales_owner_id=` (seat→requirement), `?joined_from=`/`?joined_to=`; requirements `?closed_from=`/`?closed_to=`. The `stuck`/`closed_*`/`joined_*`/`sales_owner_id` params are URL-only passthrough on the list pages (no dropdown; cleared via "Clear all filters"). "Interviews this week" has no list view — its tile links to `/calendar`.
- **Page copy uses a plain hyphen `-`, not an em dash `—`.** The only `—` allowed in `client/src` is the standalone empty-value placeholder (`?? '—'` / `|| '—'` in tables & detail fields). Don't introduce `—` into JSX text, labels, placeholders, tooltips, or toasts.
- **Requirement scope** (`modules/access/requirementScope.js`, used by the pipeline board + reports explorer): `admin` **and `bda`** see every requirement; `sales` sees `sales_owner_id`; `recruiter` sees assigned only.
- **Document reads are open** — `GET /documents?entity_type=&entity_id=` returns an entity's attachments (resumes, JDs, agreements) to any authenticated user; only `POST` / `DELETE` are gated to the entity owner / uploader. `/uploads/*` still requires a bearer token. In-app viewing goes through `FileViewerModal` (PDF/image inline, `.docx` via `docx-preview`); uploads must **not** set a `Content-Type` header on the `FormData` POST (kills the multipart boundary).
- **`GET /users/directory`** is the roster for filter bars and owner / brought-by / POC pickers — readable by **every authenticated role**, returns lightweight `{ id, name, role, active }` only, **includes inactive users**, and applies **no role clamp** (`GET /users` is `admin|sales|bda`-only and forces a `sales` caller's results to recruiters). Optional `?role=` / `?active=true`. Use it for any picker; keep `GET /users` for the Users admin page. Client: `useUserOptions()` in `lib/lookups.js` and all filter/picker fetches point here.
- Interview round create requires `scheduled_at` (interview date & time).
- **Notification / email dates:** the server clock is UTC — human-readable times must be formatted with `timeZone: env.timezone` (`APP_TIMEZONE`, default `Asia/Kolkata`), e.g. `fmtWhen` in `jobs/interviewReminders.js` and `modules/submissions/submissions.service.js`. The calendar UI is client-side so it's already local-time.
- **Calendar time-grid overlap:** `layoutDayEvents` (`pages/calendar/monthGrid.js`) does cluster-based column packing — every event in a transitively-overlapping cluster shares one `colCount` so blocks never render on top of each other. `monthGrid.test.mjs` locks this.
- **Calendar feed = interviews + client meetings.** `GET /interviews` (`interviews.service.listForCalendar`) returns `InterviewRound` events **plus** `listClientMeetings()` — accounts with `meeting_date` in range (`deleted_at: null`), serialized with `{ kind: 'client_meeting', id: 'meeting-<accountId>', meeting_mode, meeting_location, meeting_notes, audience: 'external', duration_minutes: 60 }` and no `submission_id`. `audience=internal` drops meetings; `mine=1` scopes them to `owner_id` / `origin_owner_id` / a `meeting_attendees` row; `status=completed` excludes them, `status=cancelled` → `stage=dropped`. Client colour model in `lib/interviewRounds.js`: `isClientMeeting()`, `eventPrimaryLabel()`, `eventTypeLabel()`; `CLIENT_MEETING_LOOK` gives **online meetings blue, in-person amber** (two extra `STATUS_LEGEND` rows). All calendar views (`CalendarTimeGrid`/`EventPill`/`EventCard`/`EventHoverCard`/`EventDetailDrawer`) branch on `isClientMeeting` to swap labels/links (`/accounts/:id`) and hide the interview-only feedback/cancel/reschedule actions.
- Keep CSS lean: layout and component structure as Tailwind classNames inline; `global.css` holds only tokens for spacing, typography, font, colors, and hover/button color utilities.
- Deploy workflow (`.github/workflows/deploy.yml`) is a no-op until `DEPLOY_ENABLED` repo variable + VPS secrets are set — don't assume deploys are live.
- Initial scaffold is committed and pushed to `main`, `staging`, and `dev` on `github.com/deepanshu-chauhan-delphic/delphic-one` as of 2026-08-20. Migrations have not yet been run against a real PostgreSQL instance — do that before trusting the schema.
