# Multi-Company ERP Platform — Implementation Plan

Companion to [MULTI-COMPANY-ERP-PLATFORM-HLD.md](MULTI-COMPANY-ERP-PLATFORM-HLD.md) (design).
This doc is the **execution plan**: branch, database, workstreams, schedule, and
exit criteria for a working local build. Status: **Phase 0-10 shipped, backend
and frontend both**, as of the 2026-09-18 follow-up pass that added the
Payroll (Phase 4) frontend, the remaining Phase 5 screens (billing rates,
intra-group charges), and re-architected the Org Chart into a real
parent/child tree. A full cross-suite backend regression re-run is the one
remaining item. See "Current status" right below for a one-screen summary
— the rest of this doc is a chronological log, newest work at the bottom of
each dated section but sections themselves added newest-last, so scan the
tail of the file for the latest entry.

## Current status (updated 2026-09-18)

| Phase | What | Status |
|---|---|---|
| 0 | Tenancy scaffold (`OrgGroup`/`Org`/`OrgMembership`, nullable `org_id` backfill) | ✅ shipped — `org_id` → `NOT NULL` deliberately still open |
| 1 | JWT org context, org switcher backend, group superadmin, write-side `org_id` auto-injection | ✅ shipped — `OrgGroup` parent scope, explicit group memberships, strict active-org enforcement, tenant-scoped People/HR APIs, dynamic branding, and organization onboarding delivered; recruitment read-side audit remains open |
| 2 | Directory/calendar/attendance/leave + client-brief amendment (Location, Shift, HR/Sourcing POC, multi-project calendars, auto-overtime) | ✅ shipped — Release 2 People, Attendance, Leave, HR Settings, and live leave-balance summary delivered; accrual and overtime approval remain open |
| 3 | Project-centric timesheets, daily lock, regularization tickets | ✅ shipped — **frontend built 2026-09-18** (`/attendance?section=timesheets`); overtime not yet reconciled against timesheet hours |
| 4 | Payroll — `SalaryStructure`/`PayrollRun`/`Payslip`, attendance+leave-driven computation | ✅ shipped — **frontend built 2026-09-18 (follow-up pass)**: `/payroll` hub — Salary Structure Configurator, Payroll Run create/process screen, Payslip viewer with a print-to-PDF action (no server-side PDF endpoint exists, so this is a client-side "open a print-styled window" action, not a generated file); no correction/re-run workflow yet |
| 5 | Billing — `BillingRate`, `DailyProjectRevenue`, `ClientInvoice`, `GroupBillingCharge` | ✅ shipped — **frontend now complete** (invoicing built 2026-09-18 into Finance → Accounting; **billing-rate admin + intra-group charges built in the 2026-09-18 follow-up pass** — Finance → Billing Rates, Finance → Group Charges (read-only, "charges against my company"), and Group Overview → Billing Charges (raise + view-all, group-superadmin only)); daily-revenue compute is admin-triggered, not scheduled; no invoice PDF/export |
| 6 | Profitability — `DailyEmployeeProfitability` fact table, nightly job, org-scoped + cross-org super dashboard | ✅ shipped (backend) — **super dashboard frontend built 2026-09-18** (Group Overview: KPIs, revenue/expense chart with day/month/quarter/year grouping — quarter/year added this pass, subsidiary tiles with drill-in); an org-scoped "my profitability" self-service view still has no frontend; no overhead-cost allocation; rollups are a live `SUM()`, no materialized view yet |
| 7 | Expenses + vendor payments — `ExpenseClaim`, `VendorPayment` | ✅ shipped — **frontend built 2026-09-18** (Finance → Expenses/Vendor Payments); no approval-chain policy beyond single-admin-decides |
| 8 | Accounting — `LedgerAccount`, `LedgerEntry`, `TaxRecord` | ✅ shipped — **frontend built 2026-09-18** (Finance → Accounting: ledger accounts, journal entries, trial balance/P&L/balance sheet, tax records); no period-close/retained-earnings posting; no auto-posting from billing/expense/vendor-payment events |
| 9 | External Legal/CA access — `ExternalAccess`, own bearer-token auth path | ✅ shipped — **frontend built 2026-09-18** (Finance → External Access grant/revoke admin screen + public `/guest-access` portal); no token delivery by email; guest reads limited to accounting reports today |
| 10 | Org chart + lifecycle visualization | ✅ shipped — **re-architected 2026-09-18 (follow-up pass)** into a real top-down parent/child tree with CSS connector lines and a single synthetic root node (company, or "Group" in group mode) — the original build (same day) was a left-indented nested list; new-hire/notice-period/on-leave/terminated badges carried over unchanged |

Every phase's own suite is green in isolation, eslint clean, on branch
`feature/multi-company-erp` (isolated local DB `requirement_dashboard_erp`,
never merged/pushed to `main`/`staging`/`dev` by an agent). Phases 0-7 were
last verified together as **50 suites / 405 tests green**; Phases 8-10 add
27 more tests across 3 new suites (14 + 7 + 6), each confirmed green on its
own, but **the full cross-suite regression has not been re-run to
completion since** — it was deliberately paused mid-run to prioritize
shipping Phase 8-10 functionality first (see this doc's Phase 8-10 log
entry, tail of file). Re-run it before merge. Release 1 provides the shared
frontend shell, active-org context, and multi-membership switcher. Release 2
now provides the People directory/profile, Attendance, Leave, and HR Settings
 screens; strict tenant isolation, parent-group RBAC, dynamic branding, and onboarding are now
 documented as Release 1 platform guarantees. The 2026-09-18 pass (client
 brief's "Phase 3: Financials, Analytics & Multi-Company Group Management")
 added Timesheets, Group Overview (dashboard + org chart), Finance
 (Expenses/Vendor Payments/Accounting/Invoicing/External Access), and a
 public Guest Access portal, plus consolidated the sidebar into hubs — see
 that entry at the tail of this file for the full breakdown. Remaining
 module-specific ERP pages (payroll, billing-rate admin, org-scoped
 profitability self-service) and the recruitment read-side audit stay
 tracked phase by phase below.

## 2026-09-15 — client brief received, plan updated

A full product brief landed (HLD doc's new "Product brief" section, top of
file) — 3 client-facing phases (Core ERP/HRMS → project timesheets/revenue →
financials/analytics/multi-company), each broader than this doc's original
phase-by-phase build order. The HLD's §11 has the exact mapping table; the
short version:

- **Nothing already shipped had to be thrown away** — the client's Phase 1
  is what Phase 0-2 already built, plus 4 concrete gaps (below).
- **The internal phase list grew**: Phase 5 now includes real-time daily
  project revenue (not just invoicing); three new phases were added —
  **Phase 7** (expenses + vendor payments), **Phase 8** (accounting
  ledger/tax), **Phase 9** (external Legal/CA access), **Phase 10** (org
  chart + lifecycle visualization) — none of which existed in the original
  design at all.
- **Phase 2 got amended same-day** (below) rather than deferring the 4 gaps
  to a later phase, because they change the *shape* of already-shipped
  tables (`EmployeeCalendar`'s cardinality, in particular) — better to fix
  that now while only two orgs' worth of demo data exists than after
  Phase 3-6 have built on top of the old shape.
- **Infra (S3, dedicated server + RDS) stays explicitly last**, per the
  client's own stated dev strategy ("begin implementation locally... before
  executing cloud migration") — this doc's existing local-DB-first approach
  already matches that; no change needed there, just confirmation.

## Revised workstream table (supersedes the one below where it conflicts)

| Stream | Owns | Depends on |
|---|---|---|
| A — Platform | Phase 0, 1 | — |
| B — Directory/Calendar/Attendance/Leave | Phase 2 (+ amendment) | A |
| C — Timesheet/Locking/Regularization | Phase 3 | B |
| D — Payroll | Phase 4 | B, C |
| E — Billing + daily revenue | Phase 5 | C, existing Account/Requirement |
| F — Profitability + Super Dashboard | Phase 6 | D, E |
| H — Expenses + Vendor Payments | Phase 7 | A (Location) |
| I — Accounting + tax | Phase 8 | E, H |
| J — External access (Legal/CA) | Phase 9 | I |
| K — Org chart + lifecycle | Phase 10 | A (manager_id, employment_status) |
| G — Frontend | every phase's UI | contract-first per stream |

H/I/J/K were new relative to the original plan; all four are now **shipped
(backend)** as of 2026-09-16 — see the Phase 8-10 log entry at the tail of
this file. Frontend for every stream in this table remains open.

## 2026-09-15 — Phase 2 amended for the client brief (4 gaps closed)

Migration `20260915120000_phase2_amend_location_shift_poc_multiproject_calendar`
— additive only (one `DROP INDEX`, relaxing a uniqueness rule with zero data
loss; everything else is `ADD COLUMN`/`CREATE TABLE`). Applied to
`requirement_dashboard_erp` and the shared test DB.

- **`Location`** (new model, org-scoped): default (Ahmedabad/Indore/Gurgaon)
  + custom locations. `Calendar.location_id` (nullable — a client-specific
  calendar isn't tied to a physical office) and `OrgMembership.location_id`.
  New endpoints `GET/POST /orgs/locations` (admin creates).
- **HR POC / sourcing POC / manager**: `OrgMembership` gains `hr_poc_id` /
  `sourcing_poc_id` (both → `User`, since an HR/sourcing contact may not
  share this org) and a self-referencing `manager_id` (→ `OrgMembership`,
  for the not-yet-built org chart, Phase 10). New `PATCH
  /orgs/memberships/:id` (admin) sets any of these — validated so a
  membership can't manage itself, and a manager must be a membership in the
  same org.
- **`Shift`** (new model, org-scoped): `start_minutes`/`end_minutes`
  (minutes-from-midnight, so an overnight shift works) + `grace_minutes`
  (default 15). `OrgMembership.shift_id`. New `GET/POST /attendance/shifts`.
  **Automatic overtime**: `AttendanceRecord.overtime_minutes`, computed in
  `attendance.service.checkOut()` as `max(0, worked_minutes - (shift
  duration + grace))`, `null` when no shift is assigned. This is the
  auto-*calculation* the brief asks for — an approval workflow on top of it
  (matching the original HLD sketch's `OvertimeRecord`) is a separate,
  still-open question (HLD "Open items").
- **Multi-project calendar mapping** (the change with the most blast
  radius): `EmployeeCalendar` was a strict one-per-membership
  (`org_membership_id @unique`) in the original Phase 2 build; the client
  brief requires an employee on more than one concurrent client engagement
  to follow more than one calendar at once. Dropped that unique constraint,
  added `account_id` (nullable — `null` = the employee's default/base
  calendar), new compound unique `(org_membership_id, calendar_id,
  account_id)`. `calendars.service.assign()` now takes an optional
  `account_id` and does a find-then-upsert per `(membership, project)`
  rather than a single `upsert` on the old unique key (Postgres unique
  constraints don't dedupe `NULL` against `NULL`, so the service layer
  enforces "one mapping per project" itself — documented as a known gap in
  the schema comment, same pattern as `Department`'s name-uniqueness gap).
  New `GET /calendars/assignments/:orgMembershipId`.
- **Tests**: `server/tests/erp-phase2-amendment.test.js` (10 cases —
  location CRUD + admin gate, POC/manager mapping + self-manager rejection
  + cross-org manager rejection, shift CRUD + overtime math including the
  overnight-safe duration calc and the "within grace, no OT" case,
  multi-project assignment + listing + reassignment-replaces-not-duplicates).
  Full suite **44 suites / 338 tests green**; eslint clean (same
  pre-existing warnings only).
- Local: seeded Ahmedabad/Indore/Gurgaon + a "General 9-6" shift into
  `requirement_dashboard_erp`, assigned the shift to all 13 memberships.
## 2026-09-16 — Pre-Phase-3 hardening: org_id write-side auto-injection + Designations module

Before starting Phase 3, closed two loose ends flagged as "remaining" in the
Phase 1/2 logs — both zero-regression, verified against the full suite.

- **`org_id` auto-injection on create** (HLD §5 layer 1, the write-side
  half only — see below for why the read-side half and the `NOT NULL` flip
  stay deferred). New `server/src/lib/orgContext.js`
  (`AsyncLocalStorage`-based, empty outside a request — cron jobs/scripts
  are unaffected). `middleware/auth.authenticate` now runs the rest of the
  request inside `orgContext.run({ org_id, org_membership_id }, next)`.
  `config/db.js` gained a second `prisma.$use` (alongside the existing
  soft-delete one) that stamps `org_id` onto a `create` for 17 org-scoped
  models (the Phase 0 list + `Department`/`Designation`/`Calendar`/
  `AttendanceRecord`/`LeaveType`/`LeaveRequest`) **only when** the request
  has resolved org context **and** the caller didn't already set `org_id`
  explicitly. Every existing service that already sets `org_id` explicitly
  (all of Phase 2/2-amendment) is unaffected; every caller with no org
  membership (still the default for a plain `createUser()` in tests, and
  for any real user before they're backfilled) is unaffected.
  **Why not the read-side half or the `NOT NULL` flip too**: auto-filtering
  every read by `org_id` would change results for any caller who already
  has an org membership, and the entire recruitment domain's read paths
  (accounts/requirements/profiles/submissions/reports/dashboard — dozens of
  service functions) have never been audited against that; and `NOT NULL`
  can't land while `createUser()`-style membership-less users are still a
  deliberately-supported, tested case (Phase 1's own backward-compat
  guarantee). Both stay open, larger, separately-scoped decisions — not
  silently dropped, tracked in TODO.md.
- **`designations` module** (new, org-scoped, mirrors the existing global
  `departments` module's shape): `GET/POST /designations`, `PATCH
  /designations/:id`, gated by `requireOrgMembership` + `authorize('admin')`
  for writes. Same designation name is allowed in two different orgs
  (unlike `Department`'s still-global unique).
- Tests: `server/tests/designations.test.js` (8 — membership gate, CRUD +
  admin gate, cross-org name reuse, rename-collision rejection, plus 3
  cases proving the auto-injection: a department created with org context
  gets stamped, one created without context stays `null` exactly as before,
  and an explicitly-set `org_id` from an existing service is never
  overridden). Full suite **45 suites / 346 tests green**, eslint clean.
- Local: smoke-tested the auto-injection directly against
  `requirement_dashboard_erp` (a `Department` created inside
  `orgContext.run()` came back correctly stamped).
- **Side note**: mid-session, Docker Desktop went down (unrelated to this
  work — confirmed by the error being a Postgres-unreachable connection
  failure, not a test failure) while a test run was in flight; relaunched
  it, confirmed all three local databases and the `max_connections=200`
  setting survived, and reran clean.

## 2026-09-16 — Phase 3 shipped (project-centric timesheets, daily lock, regularization tickets)

Two migrations (`20260916052421_phase3_project_timesheets` +
`20260916052614_phase3_timesheet_decision_reason`, both additive-only, no
`DROP`), applied to `requirement_dashboard_erp` and the shared test DB.

- **Schema**: new `TimesheetEntry` — one row per **(employee, day,
  project)**, per the client brief (a split day like 4h Project A + 4h
  Project B is two rows, not one blended entry). `account_id` (required, the
  client) + `requirement_id` (optional, a specific engagement under that
  account) reuse the existing recruitment domain rather than inventing a
  new "project" concept, per the original HLD's own reasoning. `org_id`
  denormalized directly (same reasoning as `AttendanceRecord`/
  `LeaveRequest` — a real `(org_id, date)` index, not a join). New
  `TimesheetLock` — one row per `(org_id, date)`, an **org-wide** daily
  lock (not per-employee — matches "Admins can lock timesheets daily").
  New `TimesheetRegularizationTicket` — `requested_change` is a small JSON
  patch restricted to `hours`/`billable`/`notes` by validation (never
  trusted as an arbitrary write), applied field-by-field on approval inside
  a transaction alongside the ticket's own status update.
- **New `timesheets` module** (`server/src/modules/timesheets/`), gated by
  `requireOrgMembership`:
  - `POST /timesheets/entries` — checks the day isn't locked, the account
    (and requirement, if given) belongs to the caller's org, and the day's
    total hours across all of that employee's entries won't exceed 24.
  - `GET /timesheets/entries/me`, `GET /timesheets/entries` (admin, team-wide).
  - `PATCH /timesheets/entries/:id` — owner-only, and only while `status`
    is still `submitted` **and** the day isn't locked; a decided or
    locked-day entry can only change via a regularization ticket.
  - `POST /timesheets/entries/:id/decision` (admin) — approve/reject,
    reason optional but stored (`decision_reason`), one-shot (can't
    re-decide).
  - `POST /timesheets/entries/:id/regularization-tickets` — **only valid
    once the day is locked** (422 otherwise — "just edit it directly").
  - `GET /timesheets/regularization-tickets` (admin), `POST
    /timesheets/regularization-tickets/:id/decision` (admin) — approving
    applies the patch to the entry inside a transaction; rejecting leaves
    the entry untouched; one-shot.
  - `POST /timesheets/locks`, `GET /timesheets/locks` (admin) — locking is
    idempotent-checked (409 on a day already locked), and deliberately has
    **no unlock endpoint** — the brief's whole point is that a lock is a
    one-way freeze; corrections go through the ticket flow, not an admin
    toggle.
  - `TimesheetEntry`/`TimesheetLock` added to the write-side `org_id`
    auto-injection set in `config/db.js` (redundant with the service
    explicitly setting `org_id` — defense-in-depth, matching the pattern
    for every other Phase 2/3 module).
- **Tests**: `server/tests/erp-phase3-timesheets.test.js` (14 cases —
  org-membership gate, basic logging, multi-project split-day logging, the
  24h/day cap, requirement-must-belong-to-account validation, cross-org
  account rejection, owner-edit-while-submitted then blocked-after-approval,
  non-admin can't decide, lock freezes both new entries and edits on that
  day, a ticket is rejected before the day is locked and required after,
  approving a ticket applies the change transactionally, rejecting one
  doesn't, admin team view, non-admin blocked from the team view and from
  locking). Full suite **46 suites / 360 tests green**, eslint clean.
- Local: smoke-tested `createEntry` end-to-end against
  `requirement_dashboard_erp` inside a real `orgContext.run()` block.
- **Not built this phase**: any frontend (timesheet entry form, admin lock
  button, ticket review screen); overtime is still computed only from
  attendance check-in/out (Phase 2), not cross-checked against logged
  timesheet hours — the HLD's `overtime` module description
  ("computed from attendance + timesheet") is only half-built; that
  reconciliation is a reasonable next add, not done here to keep this pass
  scoped to what the client brief's Phase 2.1/2.2 actually asked for.

- **Not built this pass** (see HLD §11 for the full remaining map):
  everything in Phase 3 onward (timesheet locking/regularization tickets,
  billing/daily revenue, payroll, profitability/super-dashboard) and all
  four brand-new phases (7 expenses/vendor, 8 accounting, 9 external
  access, 10 org chart) — schema-sketched in the HLD, zero code. Also not
  built: an overtime *approval* workflow (only the auto-calc), and any
  frontend for locations/shifts/POC-mapping/multi-project calendars.

## Branch & database (do this once, per machine)

- Branch: **`feature/multi-company-erp`**, cut from `main` at `d7068cc` (2026-09-15).
  All 9 HLD phases land here via short-lived sub-branches merged into it.
  **Never merged into `main`/`staging`/`dev` by an agent** — same standing rule
  as everywhere else in this repo (`AGENTS.md` "Working conventions"). When it's
  ready, the agent hands the human the exact merge/push commands.
- Database: a **second local Postgres database**, `requirement_dashboard_erp`,
  created inside the *same* Docker container already used for dev
  (`delphic_one-db-1`, mapped to `localhost:5434`). The existing
  `requirement_dashboard` DB (and whatever your `server/.env` currently points
  at — e.g. a restored `prodcopy`) is **completely untouched**; this is a
  parallel, empty DB that only this branch's migrations touch.
  ```bash
  docker compose exec -T db createdb -U postgres requirement_dashboard_erp
  ```
  (Already run as of this doc's creation — safe to re-run, `createdb` no-ops if
  it exists.)
- Env template: **`server/.env.erp.example`** (committed — carved out of the
  `.env.*` gitignore rule so it ships with the repo). Copy it to `server/.env`
  when you want to actively run against the ERP DB, or run it as a second
  instance on `PORT=4001` alongside your normal dev server (the template
  defaults to 4001 for exactly this). Your regular `server/.env` is never
  touched by this workflow — swap it back with `server/.env.example` (or
  whatever you were using) to resume normal recruitment-dashboard work.
- First migration on this branch (`prisma migrate dev`, from `server/`, with
  `DATABASE_URL` pointed at `requirement_dashboard_erp`) will replay the full
  existing migration history first, then layer on new Phase-0 migrations — so
  the ERP DB starts as a clean copy of today's schema, then diverges.
- Seed: run the normal seed chain (`seed` → `seed:accounts` → `seed:jira` →
  `seed:vendors`) against the ERP DB for baseline recruitment data, then the
  new Phase-0 backfill script (below) to create the `Org`/`OrgMembership` rows,
  then a to-be-built `seed-erp-history.js` that backdates ~60 days of synthetic
  attendance/timesheet/leave so payroll and profitability have something to
  compute against without waiting on a real month of data.

## Scope for the local build (all 9 HLD phases, thin-but-working)

Target: every module wired end-to-end and demoable locally against seeded
synthetic history — not production-trustworthy (see "Deliberately thin" below).

## Dependency graph / workstreams

```
Phase 0 (tenancy scaffold)
   └─ Phase 1 (JWT org context, org switcher, group superadmin)
        └─ Phase 2 (Department/Designation/Calendar/Attendance/Leave)
             ├─ Phase 3 (Timesheet/Overtime) ── needs Phase 2's Calendar
             └─ Phase 5 (Billing) ── needs Phase 3's Timesheet + existing Account/Requirement
                  └─ Phase 4 (Payroll) ── needs Phase 2 Attendance/Leave + Phase 3 Overtime
                       └─ Phase 6 (Profitability + Super Dashboard) ── needs Phase 4 + 5 producing rows
```

| Stream | Owns | Depends on | Can start |
|---|---|---|---|
| A — Platform | Phase 0, 1, then an RLS/hardening pass at the end | — | immediately |
| B — Directory/Calendar/Attendance/Leave | Phase 2 backend + UI | A | Day 1 draft schema, full speed once A lands |
| C — Timesheet/Overtime | Phase 3 | B's Calendar | once B's Calendar schema is fixed |
| D — Payroll | Phase 4 | B's Attendance/Leave, C's Overtime | once B+C have schema + seed data |
| E — Billing (client + group) | Phase 5 | existing Account/Requirement, C's Timesheet | schema Day 1, full build alongside C |
| F — Profitability + Super Dashboard | Phase 6 | D + E producing rows | last, thin nightly-job + rollup + read-only UI |
| G — Frontend shell | Org switcher, per-module UI, super-dashboard UI | contract-first per stream | Day 1, against agreed API contracts, not blocked on real endpoints |

Critical path (A: Phase 0 → Phase 1 → B's Phase 2 schema) is the bottleneck
regardless of headcount — budget it fully before fanning out.

## Day-by-day (assuming 3-4 devs; see HLD-planning conversation for the
1-dev and 6+-dev variants)

- **Day 1** — A: Phase 0 schema (`OrgGroup`/`Org`/`OrgMembership`, nullable
  `org_id` everywhere), migration, backfill script (one `Org` = Delphic, one
  `OrgGroup`, one `OrgMembership` per existing `User`). B: Phase 2 schema draft
  reviewed against A's shape, not migrated yet. E: billing schema draft
  (`ClientInvoice`/`GroupBillingCharge`). G: org-switcher UI + nav shell against
  a mocked `/orgs/me/memberships`.
- **Day 2** — A: Phase 1 (JWT `org_id`, `authorize()` reads `OrgMembership`,
  `authorizeGroupSuperadmin`, org-switcher endpoint) + `org_id` → `NOT NULL`
  (second migration, additive-only per the repo's HARD RULE — no `DROP` ships
  with feature code). B: Phase 2 migration lands, attendance check-in/out +
  leave request/approve endpoints + UI. C: timesheet schema against B's
  Calendar. E: client-invoice CRUD skeleton against existing
  Account/Requirement.
- **Day 3** — B: leave balances/accrual, holiday-calendar assignment UI. C:
  timesheet entries (linked to existing Account/Requirement as "project"),
  overtime from attendance+timesheet. D: payroll schema
  (`SalaryStructure`/`PayrollRun`/`Payslip`) + `seed-erp-history.js`.
- **Day 4** — D: payroll run + payslip generation (a synchronous "run now"
  admin action locally — no BullMQ/Redis yet, that's an explicit
  add-when-needed item in HLD §8). E: group billing charge, invoice line-items
  from C's timesheet. F: `DailyEmployeeProfitability` fact table + a manual
  "recompute" endpoint (skip the nightly cron locally).
- **Day 5** — F: super-dashboard API + UI (`is_group_superadmin`-gated, reads
  only the fact table), per-company drill-in reusing normal dashboard
  components. Everyone: create the second `Org` ("Acconcy"), give one seeded
  user a second `OrgMembership`, verify isolation, run the demo script below.
  A: RLS pass if time allows — otherwise explicitly deferred (see below).

## Deliberately thin at the end of Day 5 — call these out, don't hide them

- No BullMQ/Redis — payroll runs and the profitability ETL are synchronous
  admin-triggered actions, not background jobs.
- No Postgres RLS unless Day 5 has slack — app-layer `org_id` injection
  (Prisma middleware, same pattern as the existing soft-delete middleware) is
  the only isolation layer. **Real gap before this touches shared/prod data.**
- Payroll math runs against synthetic backdated data, not a real trusted
  month — fine to see it work locally, not fine to trust the numbers for an
  actual payroll run.
- No mobile/biometric attendance, no read replica, no PgBouncer, no analytics
  warehouse — out of scope per HLD §10, unchanged here.

## Local demo script (Day 5 exit criteria)

1. Log in as a user with two `OrgMembership` rows → switch between Delphic and
   Acconcy via the org switcher.
2. Check in/out, see it on the attendance calendar; submit and approve a leave
   request.
3. Log a timesheet entry against an existing requirement; see overtime
   computed.
4. Trigger a payroll run for the current period; open the generated payslip.
5. Generate a client invoice referencing logged timesheet hours.
6. As `is_group_superadmin`, open the super dashboard, see aggregated margin
   across both orgs, drill into one company's dashboard.
7. Confirm an Acconcy-only user never sees a Delphic row anywhere above.

## Open items (carried from the HLD's own "confirm before Phase 0" list)

- Who gets `is_group_superadmin` locally for testing — default plan:
  `admin@delphic.in` only.
- Whether the second `Org` ("Acconcy") gets realistic seeded data or is just a
  throwaway isolation-test org.

## Database connection pooling & latency

See [guides/DATABASE-CONNECTION-POOLING.md](../guides/DATABASE-CONNECTION-POOLING.md)
for the full writeup (this was a repo-wide gap, not ERP-specific, fixed while
working this branch since three DB consumers now share one Postgres
instance). Summary: every `DATABASE_URL` now carries explicit
`connection_limit`/`pool_timeout` instead of Prisma's default guess; local
Postgres bumped to `max_connections=200`; graceful `$disconnect()` on
shutdown; PgBouncer and a read replica stay deferred with concrete triggers
documented (not needed at current scale).

## Log

- **2026-09-15** — Branch `feature/multi-company-erp` cut from `main`
  (`d7068cc`). DB `requirement_dashboard_erp` created in the existing Docker
  Postgres container (`localhost:5434`), current `requirement_dashboard` /
  `server/.env` (`prodcopy`) untouched. `server/.env.erp.example` +
  `.gitignore` carve-out added. No phase code written yet.
- **2026-09-15 — Phase 0 shipped (schema + migration + backfill).**
  `schema.prisma`: new `OrgGroup` / `Org` / `OrgMembership` models, new enums
  `OrgStatus` / `EmploymentStatus`, `User.is_group_superadmin` (default
  `false`, unused until Phase 1), and a nullable `org_id` column + `Org?`
  relation added to every existing tenant-scoped model: `Account`,
  `Requirement`, `Profile`, `Submission`, `InterviewRound`, `StageHistory`,
  `Document`, `Comment`, `Notification`, `NotificationPreference`,
  `AuditLog`. Migration `20260915103201_phase0_org_tenancy_scaffold` —
  additive only (no `DROP`, no `NOT NULL`), applied to
  `requirement_dashboard_erp` and the shared `requirement_dashboard_test` DB.
  **Deliberately not touched:** `Department`/`Designation` (Phase 2's job per
  the module map) and pure join tables (`RequirementSeat`,
  `RequirementAssignment`, `AccountMeetingAttendee`,
  `InterviewRoundInterviewer`) — they inherit tenancy transitively via their
  parent row's `org_id`, no direct column needed.
  New `server/prisma/erp/phase0-backfill.js` (idempotent, non-destructive —
  no `_guard.js` needed since it never deletes): creates one `OrgGroup`
  ("Delphic Group") + one `Org` ("Delphic", slug `delphic`), one
  `OrgMembership` per existing `User`, then stamps `org_id` on every row of
  the 11 models above. New script: `npm run erp:phase0:backfill` (from
  `server/`). Verified against `requirement_dashboard_erp` seeded with the
  full CSV chain (team + accounts + jira + vendors): 13 users → 13
  memberships, 111 accounts / 34 requirements / 213 comments stamped;
  re-running is a no-op (org reused, 0 duplicate memberships, 0 re-stamped).
  **App behavior unchanged** — full server suite **41 suites / 307 tests
  green** against `requirement_dashboard_test` post-migration; client not
  touched. `org_id` stays `NULL` on every table until Phase 1 starts writing
  it and flips the column to `NOT NULL` (own migration, per the repo's
  additive-only HARD RULE).
  **Windows note:** `prisma generate` failed with `EPERM` (query-engine
  `.dll` locked by the running dev server/vite processes sharing this
  workspace's `node_modules`) — stopped the 7 project node processes
  (`dev:server`/`dev:client`/nodemon/vite/`src/index.js`) to clear the lock,
  regenerated, then reran `npm test` clean. Restart your dev server/client
  after pulling this — nothing else needed, Phase 0 is purely additive.
- **2026-09-15 — Phase 1 shipped (JWT org context, org switcher backend,
  group superadmin).** No schema change — pure app-code wiring on top of
  Phase 0.
  - **JWT**: `auth.service.signAccessToken`/`signRefreshToken` gain an
    `org_id` claim. `login()` resolves the caller's earliest-joined active
    `OrgMembership` as the default org (HLD §2 "default org = only
    membership, or last-used" — no last-used tracking yet, so first-joined
    stands in) and returns `{ ..., memberships: [...], active_org }`
    alongside the existing `user` shape. `refresh()` re-verifies the
    membership on the refresh token is still active on every refresh
    (offboarding takes effect on next refresh, not just next login), falling
    back to the current default org if it's gone.
  - **`middleware/auth.js`**: `authenticate` now calls `resolveOrgContext()`
    after decoding the JWT — if the token carries `org_id`, it re-reads the
    live `OrgMembership` row for `(user, org_id)` and overrides `role` with
    it (never trusts the JWT's role claim), matching the existing
    `authorizeSuperadmin` re-read-from-DB pattern. A token with no `org_id`
    (any pre-Phase-1 token, or a user with zero memberships) is a full no-op
    — `authorize()` itself is untouched. New `authorizeGroupSuperadmin`
    (mirrors `authorizeSuperadmin`) re-reads `User.is_group_superadmin` +
    `active` per request.
  - **New `orgs` module** (`server/src/modules/orgs/`): `GET
    /orgs/me/memberships` (any authenticated user — powers the org
    switcher) and `GET /orgs` (`authorizeGroupSuperadmin` — every org in the
    group, for the future super dashboard's org picker).
  - **Org switcher backend**: `POST /auth/switch-org` `{ org_id }` —
    verifies an active membership, re-issues both tokens scoped to that org
    (`403 not_a_member` otherwise). No frontend yet — see "Remaining" below.
  - **Tests**: new `server/tests/orgs-phase1.test.js` (11 cases — no-membership
    backward compat, default-org selection, live per-org role resolution
    ignoring a lying JWT claim, ended-membership fallback, the switcher happy
    path + rejection, group-superadmin gate + live demotion). Full suite
    **42 suites / 318 tests green**; `eslint` 0 errors (same pre-existing
    warnings only).
  - Local: `admin@delphic.in` flipped to `is_group_superadmin: true` in
    `requirement_dashboard_erp` (the plan's default pick for who tests the
    super dashboard locally).
  - **Remaining for Phase 1** (deferred, tracked in TODO.md): the
    `org_id` → `NOT NULL` migration and the read-side isolation audit. The
    write-side AsyncLocalStorage + Prisma-middleware auto-injection is now
    shipped. Release 1 also ships the org-switcher frontend: the header
    switcher appears for users with multiple active memberships and
    `authContext` stores `memberships`/`active_org`.
- **2026-09-15 — Phase 2 shipped (directory + calendar + attendance + leave,
  backend).** Migration `20260915110152_phase2_directory_calendar_attendance_leave`
  — additive only, applied to `requirement_dashboard_erp` and the shared test
  DB.
  - **Schema**: new `Designation`, `Calendar`/`CalendarHoliday`/
    `EmployeeCalendar`, `AttendanceRecord`, `LeaveType`/`LeaveBalance`/
    `LeaveRequest` + `CalendarKind`/`AttendanceStatus`/`AttendanceSource`/
    `LeaveRequestStatus` enums. `OrgMembership` gains `designation_id`
    (nullable). `Department` gains a nullable `org_id` — **its global
    `name` unique is deliberately left alone** (not tightened to
    `@@unique([org_id, name])` yet); today's single-org data has no
    collisions, and enforcing per-org uniqueness is a follow-up once
    `org_id` is actually enforced app-side. `AttendanceRecord`/`LeaveRequest`
    denormalize `org_id` directly (not just reachable via
    `org_membership_id`) so the HLD §8 `(org_id, date)` composite index is a
    real index, not a join. All new tables are brand new (no legacy rows),
    so their `org_id` is `NOT NULL` from creation — unlike Phase 0/1's
    nullable-until-enforced columns on existing tables.
  - **New modules** (`server/src/modules/{calendars,attendance,leave}/`),
    all gated by new `requireOrgMembership` middleware (403 if the caller
    has no active `OrgMembership` for the token's org — unlike the existing
    recruitment routes, which stay oblivious to org context per Phase 1):
    - `calendars`: `GET/POST /calendars`, `GET/POST /calendars/:id/holidays`,
      `POST /calendars/:id/assign` (assigns a calendar to an
      `OrgMembership`, one active calendar per membership).
    - `attendance`: `POST /attendance/check-in` / `check-out` (today, IST
      calendar day via new `src/lib/istDate.js`, shared with reports'
      existing `asIst` logic), `GET /attendance/me`, `GET /attendance`
      (admin, team-wide), `POST /attendance/:id/regularize` (admin,
      reason required).
    - `leave`: `GET/POST /leave/types`, `POST /leave/requests`, `GET
      /leave/requests/me`, `GET /leave/requests` (admin), `POST
      /leave/requests/:id/decision` (approve/reject — approving increments
      `LeaveBalance.used`), `POST /leave/requests/:id/cancel` (owner,
      pending only).
  - New `src/lib/zodDate.requiredDate` (sibling to the existing
    `optionalDate`) for required date fields (holiday date, leave
    from/to_date).
  - **Tests**: `server/tests/erp-phase2.test.js` (10 cases — org-membership
    gate returns 403 not a crash for every new module, calendar create +
    holiday + duplicate-holiday rejection + assignment, admin-only gates,
    check-in/check-out happy path + both double-action rejections, team
    listing + regularization, leave request → approve → balance increments
    → re-decide rejected, cancel-then-cancel-again rejected, from>to
    validation). Full suite **43 suites / 328 tests green**; eslint clean.
  - Local: seeded a default "Delphic Standard" calendar (2 holidays) assigned
    to all 13 memberships, plus 3 leave types, in
    `requirement_dashboard_erp`. Verified `checkIn()` end-to-end against
    `admin@delphic.in`'s real membership.
  - **Not built this phase** (by design, per the plan's day-by-day split):
    Department/Designation CRUD endpoints (schema only — `OrgMembership` can
    reference them, but nothing creates/lists them via API yet; the real
    Phase 2 deliverables are calendar/attendance/leave, not directory admin
    screens); any frontend; leave accrual (balances only move via approved
    requests, nothing seeds `accrued` yet).
- **2026-09-16 — Phase 4 shipped (payroll, backend).** Everything shipped
  between this entry and the Phase 2 one above (Phase 2 amendment, Phase 2
  remaining/designations, DB connection pooling, pre-Phase-3 hardening,
  Phase 3 timesheets) is logged in [PROGRESS.md](../progress/PROGRESS.md)
  rather than backfilled here — see the "Current status" table at the top of
  this doc for the one-screen summary. Migration `20260916074851_phase4_payroll`
  — additive only.
  - **Schema**: `SalaryStructure` (`org_membership_id`, versioned by
    `effective_from`; `ctc` is **monthly** gross throughout, `components`
    json validated on write to sum to it), `PayrollRun` (`org_id` +
    `period_month`/`period_year`, unique per period; `draft → processed` is
    **one-way**, same freeze posture as `TimesheetLock`; `skipped` json
    records uncovered memberships + why), `Payslip` (`gross`/`deductions`/
    `net` + a full `breakdown` json). `payslip` added to
    `DocumentEntityType` so a future generated PDF attaches via the
    existing polymorphic Document model — deliberately no dedicated FK
    column on `Payslip` for this.
  - **Payroll math** (`payroll.service.computeBreakdown`) — documented
    assumptions: a day is paid in full on a weekend (**5-day work week
    assumed; no weekly-off calendar exists yet to configure this per org**),
    an org-default-`Calendar` holiday, or `present`/`wfh` attendance;
    half-paid on `half_day`; a paid-`LeaveType` approved `LeaveRequest`
    covers it fully, an unpaid one docks a day; anything else on a working
    day (absent, or no attendance record and no leave) is loss-of-pay.
    Deduction = `(ctc / days_in_month) × lop_days`. Overtime minutes are
    summed into the breakdown for visibility but **not paid** — no
    overtime-pay policy exists yet (a Phase 3 deferred item, still open).
  - **New `payroll` module**, mirrors `timesheets`' route shape, gated by
    `requireOrgMembership`: salary-structure CRUD (admin) + self view;
    run create (admin) + `POST /runs/:id/process` (admin, one-way — pulls
    every membership employed during the period, skips anyone with no
    applicable salary structure rather than failing the run, computes every
    `Payslip` in one transaction); payslip views (self, admin per-run team
    list, single payslip by owner or admin). `SalaryStructure`/`PayrollRun`
    added to the write-side `org_id` auto-injection set in `config/db.js`
    (belt-and-suspenders — the service already sets `org_id` explicitly).
  - **Tests**: `erp-phase4-payroll.test.js` (13 — org-membership gate,
    components-must-sum-to-ctc validation + cross-org salary-structure
    rejection, duplicate-run rejection, a fully-present employee nets
    exactly `ctc` with zero deductions, unpaid absences deduct correctly
    while approved paid leave doesn't, a member with no salary structure is
    skipped not failed, a run can't be processed twice, payslip ownership +
    admin access, admin per-run team listing). Full suite **47 suites / 373
    tests green**, eslint clean (0 errors, pre-existing warnings only).
  - **Local environment note (this specific dev machine)**: port 5434 is
    *also* occupied by a native `postgres.exe` here (beyond the 5432/5433
    conflicts AGENTS.md already documents), so the Docker `db` service is
    remapped to **5435** via a local gitignored root `.env`
    (`POSTGRES_PORT=5435`); `server/.env`/`server/.env.erp` follow suit.
    `tests/env.setup.js` gained a `TEST_DATABASE_URL` override (default
    unchanged for every other machine) instead of hardcoding this machine's
    remap into the checked-in file. The isolated `requirement_dashboard_erp`
    + `requirement_dashboard_test` databases didn't exist yet in this
    machine's Docker volume and were created fresh.
  - **Not built this phase**: frontend (salary-structure admin screen, run
    processing + payslip UI); a correction/re-run workflow for a mistaken
    run (today: one-way, no undo — a deliberate gap, not an oversight, same
    reasoning as `TimesheetLock`); payslip PDF generation (the
    `DocumentEntityType` value is ready for it, nothing generates one yet).
- **2026-09-16 — Phase 5 shipped (billing + real-time project revenue,
  backend).** Migration `20260916092941_phase5_billing` — additive only.
  - **Schema**: `BillingRate` (`account_id` + optional `requirement_id`,
    versioned by `effective_from` — same pattern as `SalaryStructure`;
    `hourly`/`monthly` `rate_type`). `DailyProjectRevenue` (one row per
    (project, day) — the client brief's real-time revenue metric; idempotent
    by design, recompute updates in place rather than duplicating — no DB
    unique constraint, since `requirement_id`'s nullability would let
    Postgres treat two account-level rows as distinct under one). `ClientInvoice`
    (one per client account/period; `draft → sent → paid` forward-only, same
    freeze posture as `PayrollRun`). `GroupBillingCharge` (intra-group charge
    against a member org; `kind` is free text — the HLD doesn't enumerate
    charge kinds, so this isn't an invented enum).
  - **Rate resolution** (`billing.service.resolveRate`) — most-specific-wins:
    a requirement-specific rate beats the account-wide default
    (`requirement_id: null`) on a given date.
  - **Revenue computation** (`billing.service.computeDayRevenue`) — that
    day's **approved + billable** `TimesheetEntry` hours only, grouped by
    (account, requirement), × the resolved rate: `hourly` = hours × rate;
    `monthly` = rate ÷ days-in-month (only earned on a day with billable
    activity — no activity, no row). No applicable rate → the pairing is
    skipped and reported, not failed.
  - **New `billing` module**, mirrors `payroll`'s route shape for
    rates/revenue/invoices (`requireOrgMembership` + `authorize('admin')`):
    rate CRUD, `POST /daily-revenue/compute` (date range, capped at 31 days,
    admin-triggered — not a background job yet), invoice generate (sums a
    period's computed revenue into a draft with a per-requirement
    `line_items` breakdown; rejects with no revenue computed) + forward-only
    status transition. Group charges follow the `orgs` module's cross-org
    pattern instead: `POST/GET /group-charges/all` gated to
    `authorizeGroupSuperadmin` alone (no `requireOrgMembership` — this is
    inherently not a self-org action), `GET /group-charges` (any admin,
    self-org view). `BillingRate`/`ClientInvoice` added to the write-side
    `org_id` auto-injection set; `GroupBillingCharge` deliberately excluded
    since its `org_id` is the org *being charged*, not the caller's own.
  - **Tests**: `erp-phase5-billing.test.js` (12 — org-membership gate, rate
    CRUD + cross-account requirement rejection, hourly revenue from
    approved+billable hours only, monthly proration, requirement-specific
    override, no-rate skip, idempotent recompute, invoice generation +
    duplicate-period + line_items + no-revenue rejection, forward-only
    transitions + non-admin block, group-charge creation gated + self-org
    vs. cross-org visibility). Full suite **48 suites / 385 tests green**,
    eslint clean.
  - **Not built this phase**: frontend (rate admin, invoice list/detail,
    group-charge screens); a scheduled/nightly auto-compute for daily
    revenue (today it's a manual admin call, matching the HLD §8 posture —
    add a job queue only once something needs it); invoice PDF/export.
- **2026-09-16 — Phase 6 shipped (profitability fact table + super
  dashboard, backend).** Migration `20260916103733_phase6_profitability` —
  additive only.
  - **Schema**: `DailyEmployeeProfitability` — one row per
    (org_membership, day): `revenue`/`cost`/`margin` + a `breakdown` json
    for audit. The only table the super dashboard reads (HLD §7).
  - **Computation** (`profitability.service.computeDayForOrg`) chains two
    batch steps in one call: (1) calls `billing.service.computeDayRevenue`
    directly to guarantee that day's `DailyProjectRevenue` is fresh — a
    cross-module service import, same precedent as `interviews.service`
    importing from `submissions.service`; (2) allocates each project-day's
    revenue **pro-rata by approved+billable hours** across everyone who
    logged time on it that day (a 6h/2h split gets 75%/25% of that project's
    revenue, regardless of the underlying rate being hourly or monthly);
    (3) nets against `cost` = latest `SalaryStructure.ctc` ÷ days-in-month
    (Phase 4's own per-day method — **no overhead allocation yet**, the HLD
    mentions it but nothing computes it); a membership with no salary
    structure is skipped, not failed, matching payroll's posture. Cost
    accrues every employed day regardless of billable activity, so a
    bench/leave/weekend day correctly nets a negative margin — that's the
    point of the metric. Upserts on `(org_membership_id, date)`, a real DB
    unique constraint this time (unlike `DailyProjectRevenue`, neither key
    column is nullable here).
  - **Rollups** (`profitability.service.rollup`) are a live `SUM()` over the
    fact table by day or month — no materialized view yet, per HLD §6's own
    sequencing ("start with a live query, add a materialized view only once
    the fact table is too large for that to stay fast"). Shared by both
    modules below; `orgId: undefined` reads across every org.
  - **New `profitability` module** (org-scoped): `POST /compute` (date
    range, capped 31 days), `GET /me`, `GET /team`, `GET /rollup`.
  - **New `super-dashboard` module** (cross-org): `POST /compute` +
    `GET /rollup`, gated to `authorizeGroupSuperadmin` **alone** —
    deliberately no `requireOrgMembership`, mirroring `orgs`' `GET /orgs`
    (verified a group-superadmin with zero org memberships anywhere still
    works). `org_id` optional on rollup: omitted = group-wide total, passed
    = the identical query drilling into one company (HLD §7 — one UI,
    parameterized).
  - **New nightly job** `jobs/profitabilityCompute.js` (node-cron, same
    shape as `jobs/interviewReminders.js`) — computes *yesterday* daily at
    02:00 UTC across every active org, per-org try/catch, a no-op wherever
    no orgs exist. Wired into `jobs/index.js`.
  - **Tests**: `erp-phase6-profitability.test.js` (10 — org-membership gate,
    exact-number pro-rata allocation across two employees, no-salary skip,
    pure-cost negative-margin day + idempotent recompute, non-admin block,
    month rollup with headcount, super-dashboard 403 + no-membership-still-
    works + cross-org compute + group-wide-vs-drill-in rollup, the nightly
    job's date selection). Full suite **49 suites / 395 tests green**,
    eslint clean.
  - **Confirmed, not caused by this work**: while chasing intermittent
    full-suite failures on this resource-constrained dev machine,
    `tests/orgs-phase1.test.js`'s "earliest-joined" case turned out to be
    genuinely flaky — `OrgMembership.joined_at` is `@db.Date` (day
    precision), so two memberships created moments apart in one test tie,
    and `auth.service.js`'s `orderBy: { joined_at: 'asc' }` has no secondary
    key. `git diff` against that file and `orgs.service.js` is empty for
    this session. Flagged, not fixed (out of scope) — see PROGRESS.md.
  - **Not built this phase**: frontend (super dashboard UI, drill-in,
    org-scoped profitability view); overhead-cost allocation; a
    materialized-view refresh layer (not needed yet at this data volume).
- **2026-09-16 — Phase 7 shipped (expenses + vendor payments, backend).**
  Migration `20260916115320_phase7_expenses_vendor_payments` — additive
  only. First of the four brand-new phases (7-10) that only existed as an
  HLD schema sketch before this session — no prior day-by-day section here
  to extend, so this entry starts fresh.
  - **Schema**: `ExpenseClaim` (`org_membership_id` + `location_id`,
    free-text `category`; `pending → approved → reimbursed` or
    `→ rejected` — `reimbursed` is a separate step only reachable from
    `approved`, since deciding and actually paying out are different
    events). `VendorPayment` (`vendor_name` plain text, `vendor_type` ∈
    `contractor`/`external_resource`/`third_party`, `period_month`/
    `period_year`; same `pending → approved → paid` or `→ rejected` shape).
    **`VendorPayment` carries zero FK to the recruitment domain's
    `Account`** — deliberate, per the HLD's module-map note: a recruitment
    `Account(type=vendor)` is a sourcing vendor (candidates/money coming
    *in*); `VendorPayment` is money going *out* to a contractor/external
    resource — same English word, unrelated real-world relationship, and
    the schema keeps them fully separate rather than overloading one model.
    `expense_claim`/`vendor_payment` added to `DocumentEntityType` so a
    receipt/invoice attaches via the **existing** polymorphic documents
    module — zero new upload code.
  - **New `expenses` module**: claims are self-serve
    (`POST /expenses/claims` for the caller's own membership,
    `GET /expenses/claims/me`), admin decides/reimburses/views the team
    (`GET /expenses/claims`, `POST .../decision`, `POST .../reimburse`).
    Vendor payments are admin-only throughout (raising one isn't a
    self-serve action) — `POST/GET /expenses/vendor-payments`,
    `GET .../:id`, `POST .../:id/decision`, `POST .../:id/pay`. Both models
    added to the write-side `org_id` auto-injection set.
  - **Tests**: `erp-phase7-expenses.test.js` (10 — org-membership gate,
    claim submission + cross-org location rejection, approve→reimburse +
    reimburse-before-approval rejected + double-decide rejected, a
    rejection's reason blocks reimbursement, self-view vs. admin team-view
    scoping, non-admin blocked everywhere admin-only, vendor payment
    creation gated, decide→pay + pay-before-approval rejected +
    double-decide rejected, status/vendor_type/period list filters, and an
    explicit proof that `VendorPayment` shares no FK with a same-named
    recruitment `Account`). Full suite **50 suites / 405 tests green**,
    eslint clean.
  - **Not built this phase**: frontend (claim submission + admin
    approval/reimbursement queue, vendor payment admin screens); any
    approval-chain policy beyond single-admin-decides (matches every other
    decision flow already in this codebase); claim/payment amount limits.
- **2026-09-16 — Phases 8, 9, 10 shipped (accounting, external CA/Legal
  access, org chart — all backend).** Closes out every phase the
  2026-09-15 client brief added; the streams table's H/I/J/K rows above are
  now all shipped.
  - **Phase 8 — accounting.** Migration
    `20260916123254_phase8_accounting_ledger_tax` — additive only.
    `LedgerAccount` (asset/liability/equity/revenue/expense, unique per org
    by `name`); `LedgerEntry` — one row per debit/credit line, no separate
    journal-entry header table, a posting is just >=2 rows sharing one
    `transaction_id`; `accounting.service.postJournalEntry` is the only
    place `sum(debit) === sum(credit)` is enforced, not the DB, same
    documented-gap posture as `PayrollRun`/`ClientInvoice`'s forward-only
    transitions. `TaxRecord` (`pending → filed → paid`; `jurisdiction`/
    `kind` **kept free text, not enums** — §10's open questions flag which
    tax regimes apply as undecided, so this doesn't guess). New
    `accounting` module, router-wide `authorize('admin')` (every route is
    finance data): ledger-account CRUD, `POST /journal-entries`,
    `GET /ledger-entries` (filter by account/transaction/date range), and
    three reports — `GET /reports/trial-balance`, `/profit-and-loss`,
    `/balance-sheet`. The balance sheet's `balances` field
    (`assets − (liabilities + equity)`) is reported, not hidden: this
    module posts journal entries but doesn't do period-close/
    retained-earnings postings, so a non-zero value there just means that
    period's net profit hasn't been closed into equity yet — a test proves
    `balances === net_profit` on an intentionally-unclosed book.
    Trial-balance/P&L aggregation is one `prisma.ledgerEntry.groupBy` call
    per report, not one query per ledger account.
  - **Phase 9 — external Legal/CA access.** Migration
    `20260916130602_phase9_external_access` — additive only.
    `ExternalAccess` (`org_id`, `email`, `scope` json
    `{ resources: [...] }`, `token_hash`, `granted_by`, `expires_at`,
    `revoked_at`, `last_used_at`/`use_count`). Deliberately **not** an
    `OrgMembership` — a CA/Legal reviewer has no role-in-a-company and no
    password, so this gets its own auth path end to end:
    `middleware/auth.js` gained `authenticateExternal` (hashes the
    incoming bearer token with SHA-256 and looks it up — same posture as a
    password hash, the plaintext is never stored) and
    `requireExternalScope` (checks the grant's `scope.resources`
    allow-list). New `externalAccess` module:
    `POST/GET /external-access` + `POST /external-access/:id/revoke`
    (ordinary JWT+org admin auth; the plaintext `ext_…` token is returned
    exactly once, in the create response, never recoverable after) plus a
    guest portal at `/external-access/guest/accounting/*` that calls the
    accounting module's own report functions directly — a CA sees numbers
    computed identically to an org admin, no parallel read path to keep in
    sync. Guest resources are an explicit enum
    (`externalAccess.validation.js`'s `RESOURCE`, currently just
    `'accounting'` — the HLD's own worked example, "read accounting for
    Org X, expires in 30 days") rather than a wildcard.
  - **Phase 10 — org chart + lifecycle visualization. No migration.**
    `OrgMembership.manager_id`, `employment_status`
    (`pending_onboarding`/`notice_period` included), and `notice_end_date`
    all landed already in the 2026-09-15 Phase 2 amendment — specifically
    so this phase wouldn't need a schema change once built. New `orgChart`
    module: `GET /org-chart` (any active org member, not admin-only — a
    directory view) builds the `manager_id` reporting tree **in memory**
    from one `OrgMembership.findMany`, not a recursive SQL CTE (one
    company's headcount doesn't need one — same no-analytics-warehouse
    reasoning as HLD §12); `include_terminated` toggle defaults to
    excluding them. `GET /org-chart/group`
    (`authorizeGroupSuperadmin`, mirrors the super-dashboard's cross-org
    gating exactly) returns every org's tree, optionally narrowed by
    `org_group_id`. Lifecycle fields carry straight onto each node — no
    separate workflow engine, an admin sets them via the existing
    `PATCH /orgs/memberships/:id`.
  - **Tests**: `erp-phase8-accounting.test.js` (14),
    `erp-phase9-external-access.test.js` (7),
    `erp-phase10-org-chart.test.js` (6) — 27 new tests, each suite
    confirmed green **in isolation**, eslint clean across all three new
    modules (`accounting`, `externalAccess`, `orgChart`).
  - **Verification posture, stated plainly**: the full ~54-file
    cross-suite regression was **not** re-run to completion this session.
    It was started, then explicitly paused mid-run at the human's request
    ("complete the remaining test cases later... do all the functionality
    of remaining phases first") to prioritize shipping Phase 8-10 before
    circling back. Mid-session, this machine's known RAM ceiling (documented
    in the Phase 4-7 entries above) made a `prisma migrate dev` and a
    backgrounded jest batch collide into a literal Node
    `Fatal process out of memory` crash — recovered by retrying once the
    colliding process had exited, not by any code change. **Run the full
    suite before merge.**
  - **Not built this session**: frontend for any of the three phases;
    Phase 8's auto-posting from billing/expense/vendor-payment events
    (manual/API journal entries only); Phase 9's email delivery of the
    guest token (API-response-only, matching this project's local-first
    posture) and any per-view audit trail beyond `last_used_at`/
    `use_count` (§10 flags a finer-grained trail as still an open
    question); Phase 10's actual chart visualization (the API returns the
    tree; nothing renders it).

## 2026-09-18 — Client brief "Phase 3: Financials, Analytics & Multi-Company
Group Management" — frontend + nav consolidation

Closes the frontend gap the "Not built" notes above kept flagging, for every
phase this specific client-brief ask named: the Super Admin Group Dashboard,
live org charts, Expense & Vendor Management, and Accounting & Compliance
(including CA/audit guest access). Also does the nav restructuring the same
request asked for. All of it frontend (plus a handful of small, necessary
backend additions below) — **everything in this entry is uncommitted**, same
as every other frontend delivered on this branch so far.

- **What this explicitly did *not* invent**: the brief's own wording named
  `Expense`, `Vendor`, `Invoice`, and `FinancialReport` as the Phase 3
  models needing `org_id`/`org_group_id` scoping. Those already exist —
  `ExpenseClaim`, `VendorPayment`, `ClientInvoice` (Phase 5), and the
  accounting reports computed live off `LedgerEntry` (Phase 8) respectively
  — all already `org_id`-scoped in every service query (verified by
  grep, not assumed: every read/write in `expenses.service.js`,
  `accounting.service.js`, `billing.service.js`, and
  `externalAccess.service.js` filters by `org_id`). Building parallel
  models with the brief's literal names would have duplicated schema this
  codebase's own "single source of schema truth" principle rules out — so
  this pass builds frontend against the existing models instead. Group-wide
  consolidated views scope by `org_group_id` via `org: { org_group_id: {
  in: orgGroupIds } }` (mirrors the existing `orgs`/`orgChart` modules'
  pattern), never by a redundant `org_group_id` column duplicated onto every
  leaf table.

### 1. Navigation restructuring

- **`People` hub** (`client/src/pages/people/PeopleHubPage.jsx`, new) —
  `?section=directory|org-chart|users|hr-settings` tabs wrapping the
  existing `PeopleListPage`/`UsersPage`/`HrSettingsPage` plus the new
  `OrgChartPage`. Old `/people/settings` and `/users` routes redirect into
  the matching tab.
- **`Time & Attendance` hub** (`client/src/pages/time/TimeAttendanceHubPage.jsx`,
  new) — `?section=attendance|leave|timesheets`, wrapping the existing
  `AttendancePage`/`LeavePage` plus the new `TimesheetsPage`. Old `/leave`
  redirects in.
- **`Finance` hub** (`client/src/pages/finance/FinanceHubPage.jsx`, new) —
  `?section=expenses|vendor-payments|accounting|external-access`. Expenses
  is visible to every role (self-serve claims); the other three are
  admin-only tabs, matching the backend's own `authorize('admin')` gating
  on those modules exactly (no UI-only permission invented that the API
  doesn't also enforce).
- **`Group Overview`** (new sidebar item, `client/src/pages/groupOverview/GroupOverviewPage.jsx`)
  — gated on `isGroupSuperadmin` (the per-user flag, not a role capability;
  `permissions.js` deliberately does not carry a `viewGroupOverview`
  capability since that would let every admin see it regardless of the
  flag). Hidden from the sidebar (`navItems.js`'s `groupSuperadminOnly`
  flag, filtered in `AppLayout.jsx`) **and** route-guarded
  (`App.jsx`'s new `RequireGroupSuperadmin`), so a direct URL visit by a
  non-group-superadmin redirects home instead of hitting a wall of 403
  toasts.
- **Sidebar highlight bug** — the request named "People and HR Settings
  both highlighting at once" explicitly. `AppLayout.jsx` already had a
  special-cased `isNavItemActive` function patching exactly this for the
  `/people` vs `/people/settings` prefix collision (both matched
  `NavLink`'s default `startsWith` semantics). Folding HR Settings into a
  `People` hub *tab* instead of a separate top-level route removes the
  prefix collision structurally — there's no longer a second top-level
  route to collide with, so that whole special-case function is deleted
  rather than extended.

### 2. Group Overview (Super Admin Group Dashboard)

- **Dashboard tab** — KPI row (companies, group headcount, trailing-30-day
  group revenue, group valuation), a `recharts` `ComposedChart` (revenue /
  expenses / vendor-payments bars + a net-margin line) with a
  day/month/quarter/year grouping selector, and clickable subsidiary tiles.
  A tile click calls the existing `switchOrg()` + navigates home — "drill
  into that company's ERP" is just switching active-org context, reusing
  the org switcher's own backend contract (`POST /auth/switch-org`) rather
  than inventing a parallel cross-org read path.
- **Quarter/year rollup grouping did not exist anywhere in the codebase
  before this** — both `profitability.validation.js` and
  `superDashboard.validation.js`'s `group_by` enum were hard-limited to
  `day`/`month`. Added `yq()`/`yr()` bucket-key helpers to
  `profitability.service.js` (both endpoints share one `rollup()`
  function), extended both validation enums, and exported `bucketKey`/
  `round2` so the new group-financials aggregation (below) can reuse the
  exact same bucketing instead of duplicating it.
- **New `Org.valuation`** (nullable `Decimal(16,2)`, migration
  `20260918120000_add_org_valuation`) — the brief asks for "group-level
  valuation" but no valuation model or methodology exists anywhere in the
  HLD or schema. Rather than fabricate a computed number with no backing
  methodology, this is a manually-entered figure a group superadmin sets
  via the new `PATCH /orgs/:id/valuation` (scoped to the caller's own
  holding group via `orgGroupIds`, same pattern as `listOrgs`) — displays
  as "Not set" until someone does.
- **New `server/src/modules/superDashboard/superDashboard.service.js`**
  (this module previously had *no* service file — `superDashboard.routes.js`
  called `profitability.service` directly). Two new functions:
  - `listSubsidiaries(orgGroupIds)` — one row per org in scope, each with a
    trailing-30-day snapshot (revenue/cost/margin from
    `DailyEmployeeProfitability`, `expenses` from approved+reimbursed
    `ExpenseClaim`, `vendor_payments` from approved+paid `VendorPayment`) so
    a tile has something to show without the viewer picking a date range
    first. New `GET /super-dashboard/subsidiaries`.
  - `financialsRollup({ orgId, orgGroupIds, from, to, groupBy })` — layers
    approved-expense and vendor-payment totals on top of
    `profitability.service.rollup()`'s existing revenue/cost/margin
    buckets, bucketed identically. **Vendor payments are deliberately
    excluded from a `day` bucket** — `VendorPayment` only carries
    `period_month`/`period_year` (no day column, schema.prisma), so
    smearing a monthly figure across days it wasn't actually paid on would
    misrepresent the chart; documented in the function's own comment, same
    "call out the gap, don't hide it" posture as this codebase's other
    known-thin spots. New `GET /super-dashboard/financials-rollup`.
- **Org Chart tab** — reuses `OrgChartPage` (below) in group mode, fed by
  the existing `GET /org-chart/group`.

### 3. Live org charts (Phase 10 frontend)

- **New `client/src/pages/orgChart/OrgChartPage.jsx`** — a recursive tree
  render (`OrgChartNode`) off `GET /org-chart` (org mode) or
  `GET /org-chart/group` (group mode, one tree per subsidiary, passed via a
  `groupOrgs` prop rather than the component fetching twice). New-hire and
  notice-period indicators read directly off fields that already existed
  on `OrgMembership` since the 2026-09-15 Phase 2 amendment but had no UI
  consumer until now: `employment_status === 'pending_onboarding'` →
  "New hire" badge; `employment_status === 'notice_period'` → "Notice"
  badge showing `notice_end_date`. No new schema, no new endpoint for the
  org-level chart — this was purely a missing frontend consumer of an
  already-complete backend contract.

### 4. Expense & Vendor Management (Phase 7 frontend)

- **`client/src/pages/finance/ExpensesTab.jsx`** — self-serve claim
  submission (location/category/amount/currency) + "My claims" /
  "Team claims" toggle; admin approve/reject/mark-reimbursed inline.
- **`client/src/pages/finance/VendorPaymentsTab.jsx`** — admin-only raise/
  approve/reject/mark-paid, categorized by `vendor_type`
  (contractor/external_resource/third_party), matching the brief's
  "external contractors and third-party resources" wording exactly against
  the existing enum (no new categorization invented).

### 5. Accounting & Compliance (Phase 8/9 frontend)

- **`client/src/pages/finance/AccountingTab.jsx`** — five sub-tabs (its own
  `?atab=` param, siblings to the Finance hub's `?section=`, no collision
  since they're different routes): **Invoicing** (new — see below),
  **Ledger accounts** (CRUD), **Journal entries** (a dynamic debit/credit
  line-item form that will not enable submit until debits=credits — the
  same balance rule `accounting.service.postJournalEntry` enforces
  server-side, checked client-side too so a user sees *why* before hitting
  a 422), **Reports** (trial balance / P&L / balance sheet, one selector
  driving all three existing report endpoints), **Tax records** (create +
  file + pay lifecycle).
- **`client/src/pages/finance/InvoicingSection.jsx`** (new) — the brief's
  "Native bookkeeping views: Invoicing, P&L statements, and Balance sheets"
  named Invoicing specifically; this was initially missed in the first
  pass (Accounting tab shipped without it) and added once re-checked
  against the literal request. Compute daily revenue (`POST
  /billing/daily-revenue/compute`) → generate a draft invoice for a client/
  period (`POST /billing/invoices`) → forward-only status transitions
  (draft → sent → paid). Deliberately thin: no billing-rate admin screen
  and no group-billing-charge screen, since the brief didn't name either —
  tracked as open in TODO.md rather than silently skipped.
- **CA/Legal — admin side**: `client/src/pages/finance/ExternalAccessTab.jsx`
  — grant (email + expiry, scope is always `['accounting']`, the only
  guest resource the backend supports today) / list / revoke. The
  plaintext token is shown exactly once, in the create response, exactly
  matching the backend's own one-time-reveal guarantee — the UI doesn't
  cache or re-display it.
- **CA/Legal — guest side**: `client/src/pages/guest/GuestPortalPage.jsx`
  — a public route (`/guest-access`, registered *outside*
  `ProtectedRoute`/`AppLayout` in `App.jsx`) since a reviewer has no user
  account: paste the `ext_…` token, view the same four accounting reports
  an org admin sees. Uses a bare `axios.create()` instance scoped to that
  one token, deliberately not the app's `apiClient` — the guest token must
  never enter the normal JWT-refresh/redirect-to-login machinery, and a
  revoked/expired token should fail with a plain "invalid token" message,
  not a forced redirect to the staff login page.

### 6. A few small necessary fixes found while building this

- **`users.service.js`'s `PUBLIC_SELECT` was missing `is_group_superadmin`**
  — `GET /users/me` (the initial-load path on every page refresh, as
  opposed to `POST /auth/login`, which already included it) silently
  dropped group-superadmin status on refresh, which would have made
  `Group Overview` disappear from the sidebar on reload. One-line fix.
- **A real (harmless) schema drift**: `prisma migrate diff` against the
  live dev DB surfaced a `departments_org_id_fkey` `ON UPDATE` action
  mismatch left over from the earlier org-scoping migration
  (`20260918104500_scope_departments_to_org` set the column `NOT NULL` but
  never touched the FK's referential action). Fixed with a small follow-up
  migration (`20260918121000_fix_department_org_fk_action`), applied
  directly via `prisma db execute` and registered via `prisma migrate
  resolve --applied` (it had already been applied manually — not re-run
  through `migrate dev`). `prisma migrate diff` against the live schema
  now returns an empty script.
- **Two concurrent `prisma migrate dev` invocations left a stale Postgres
  advisory-lock session** mid-session (a duplicate migrate attempt from an
  earlier retry that hadn't fully exited) — surfaced as a `P1002` timeout
  on the next attempt. Resolved with `pg_terminate_backend` on the stale
  session's PID, not by restarting Postgres.

### Verification posture

- `npm run lint` — 0 errors across every new/changed file (same
  pre-existing `react-hooks/exhaustive-deps` warning pattern as the rest of
  the codebase, nothing new).
- Every new backend endpoint smoke-tested with `curl` against a real
  admin login: `/super-dashboard/subsidiaries`,
  `/super-dashboard/financials-rollup`, `/org-chart` + `/org-chart/group`,
  `PATCH /orgs/:id/valuation`, `/timesheets/*`, `/expenses/*`,
  `/accounting/*`, `/external-access`, `/billing/invoices` — all 200.
- **Browser verification did not complete.** This dev machine is severely
  RAM-constrained (5.9 GB total, observed well under 1 GB free even at
  idle with nothing of this project's running) — the same "known resource
  ceiling" flagged in the Phase 4-7 and Phase 8-10 entries above. An
  automated Playwright run driving the system's existing Chrome install
  (headless, no separate browser download) got through People/Attendance/
  Leave successfully, then Finance and Timesheets came back with an empty
  page body and zero console/page errors — consistent with a silent
  renderer crash under memory pressure (not caught, since the script
  wasn't listening for Chrome's `crash` event), not a confirmed code
  defect. Re-checked every flagged file by hand and found nothing wrong;
  every endpoint those pages call returns 200. **Still needs a real human
  click-through** — this doc is explicit that it isn't one.
- **Not built this pass**: Phase 4 (payroll) frontend; Phase 5's
  billing-rate-admin and group-billing-charge screens; Phase 6's org-scoped
  "my profitability" self-service view (only the cross-org Group Overview
  got a screen); `OrgGroupMembership` admin UI (granting a user access to a
  *specific* holding group — today's single-holding-group fallback in
  `authorizeGroupSuperadmin` covers local dev with one group, but a second
  real holding group would need this built).

## 2026-09-18 — Follow-up pass: Org Chart tree re-architecture, Phase 4
(Payroll) frontend, remaining Phase 5 screens

Closes the "Not built this pass" gaps from the entry directly above:
Payroll frontend, billing-rate admin, and intra-group charges. Also
re-architects the Org Chart component, which the client flagged as too
close to a plain nested list to read as an actual org chart.

### 1. Org Chart → real parent/child tree

- `client/src/pages/orgChart/OrgChartPage.jsx` rewritten. Previously: a
  left-indented `<ul>` per level with a dashed left border — readable but
  not what "org chart" usually means visually. Now: a top-down tree with
  drawn connector lines between a parent and each of its children, using
  the standard pure-CSS org-chart technique (`display: flex` rows +
  `::before`/`::after` half-borders on each `<li>` to draw the sibling
  connector, plus a `::before` on each `<ul>` to drop a line from the
  parent) — new rules under `.org-tree` in `client/src/styles/global.css`.
  No charting library added; the shape is constrained enough (a strict
  tree, no free-form layout) that the library wouldn't buy much over ~90
  lines of CSS.
- **Single top node, always.** The old version rendered one card per
  manager-less employee side by side with no visual link between them —
  fine when there's a real single CEO/root, silently wrong-looking
  otherwise. This repo's own seed data has 13 org memberships and 0 with a
  `manager_id` set, so the old chart would have shown 13 disconnected
  cards. The new version always wraps the real tree(s) under one synthetic
  root: the active org's name in single-org mode, or "Group" in
  group mode (`groupOrgs` prop, used by Group Overview → Org Chart) —
  branching into each subsidiary, each branching into that company's own
  people tree. `EntityCard` (new) renders that synthetic node distinctly
  (primary-colored border/fill) from the plain employee `PersonCard`.
- New-hire / notice-period / on-leave / terminated lifecycle badges are
  unchanged (`LifecycleBadge`, still reading `employment_status` +
  `notice_end_date` directly, no schema change needed — same as the
  original Phase 10 frontend build).
- Both call sites (`PeopleHubPage`'s Org Chart tab, `GroupOverviewPage`'s
  Org Chart tab) needed no changes — same props (`groupOrgs` optional),
  same backend endpoints (`GET /org-chart`, `GET /org-chart/group`).

### 2. Payroll frontend (Phase 4)

New `client/src/pages/payroll/PayrollHubPage.jsx`, new `/payroll` route
(`App.jsx`) and sidebar entry (`navItems.js`, `Banknote` icon). New
`viewPayroll` capability granted to **every** role (self-service payslips
aren't admin-gated on the backend — `GET /payroll/payslips/me` and
`GET /payroll/payslips/:id` have no `authorize('admin')`), matching
capability naming already established for Timesheets/Expenses. Admin-only
tabs are simply hidden client-side for non-admins, same pattern as the
Finance hub — the backend's own `authorize('admin')` on every other payroll
route is the real enforcement.

- **My Payslips** (all roles) — list, click a row for the full breakdown.
- **Salary Structures** (admin) — `useOrgMembershipOptions` (new lookup
  hook, `client/src/lib/lookups.js`, off `GET /orgs/memberships` — needed
  because payroll keys off `org_membership_id`, not `user.id`, and the
  existing `/users/directory` roster doesn't carry that id) feeds an
  employee picker; CTC + a dynamic list of named components (defaults to
  Basic/HRA/Allowances, add/remove freely) with a live running total
  checked against CTC before the submit button enables — mirrors the
  Accounting tab's journal-entry balance check. The backend models a
  salary structure as CTC = sum(components), full stop — there's no
  separate "deduction" concept — so a deduction-type line (e.g. a fixed
  recovery) is just a component with a negative amount; the form says so.
- **Payroll Runs** (admin) — create a draft run for a period, "Process"
  it (confirmed via `window.confirm`, since a processed run can't be
  re-run for that period — `already_processed`), see the skipped-employee
  count and reasons (`no_salary_structure` is the only reason the backend
  emits today), and view/open the generated payslips.
  **Live-tested, not just curled**: created a run, processed it, and
  confirmed the generated payslip's `breakdown` object (working/weekend/
  holiday/present/half/paid-leave/unpaid-leave/unpaid/LOP/paid days,
  overtime minutes, per-day pay) has exactly the keys the payslip viewer
  renders.
- **Payslip viewer** — gross/deductions/net + the full attendance
  breakdown, plus a "Print / Save as PDF" button. **No server-side payslip
  PDF generation exists** (a documented Phase 4 backend gap, unchanged by
  this pass) — the button opens a small standalone HTML document in a new
  browser window/tab and calls `window.print()` on it. This was a
  deliberate choice over an in-page `@media print` rule: the app shell's
  animated sidebar/drawer (`framer-motion`, which sets an inline
  `transform`) would establish a CSS containing block for any `fixed`- or
  `absolute`-positioned print overlay nested inside it, breaking a
  same-page print attempt in a way that's hard to test on this machine (see
  Verification below) — a detached window sidesteps the whole problem and
  gives the same "browser's Save as PDF" outcome without a new dependency.

### 3. Remaining Phase 5 screens

- **Billing Rate admin** — new `client/src/pages/finance/
  BillingRatesTab.jsx`, new Finance-hub tab (admin-only). Per-client
  (optionally per-requirement, which overrides the account-wide default —
  same "most-specific-wins" rule the backend's `resolveRate` already
  implements) hourly/monthly rate with an effective date. `GET /billing/
  rates` returns raw `account_id`/`requirement_id` with no relations
  included, so the tab joins display names client-side off the same
  `useClientAccountOptions`/`useRequirementOptions` lookups already used
  elsewhere, rather than changing the backend's response shape for a
  display-only concern.
- **Intra-group billing charges** — split across two screens, matching
  the backend's own authorization split exactly:
  - `client/src/pages/finance/GroupChargesTab.jsx` — new Finance-hub tab
    (admin-only), **read-only**: "charges raised against this company",
    off `GET /billing/group-charges` (`authorize('admin')`, scoped to the
    caller's own org).
  - A new "Billing Charges" tab on **Group Overview**
    (`groupOverview/GroupOverviewPage.jsx`), gated the same way the rest
    of Group Overview is (`isGroupSuperadmin` user flag, not a role
    capability — deliberately not added to `permissions.js`'s `ROLE_CAPS`
    for the same reason the dashboard tab isn't): raise a charge against
    any subsidiary (`POST /billing/group-charges`,
    `authorizeGroupSuperadmin`) and see every charge raised across the
    whole group (`GET /billing/group-charges/all`, same gate).
  Neither screen invents a new "raise charge against my own org" self-
  service action — the backend deliberately only lets a group superadmin
  raise charges (they cross company boundaries), so the org-scoped tab is
  view-only by design, not an oversight.

### Verification posture

- `npm run lint` — 0 errors (started at 3: two `react/no-unescaped-entities`
  from apostrophes in new helper text, fixed with `&apos;`); same
  pre-existing `react-hooks/exhaustive-deps` warning pattern as every other
  tab file in this codebase, nothing new introduced.
- Every new/changed endpoint exercised **live**, not just checked for a
  200: logged in as the seeded admin, then round-tripped `POST /payroll/
  salary-structures` → `POST /payroll/runs` → `POST /payroll/runs/:id/
  process` → `GET /payroll/runs/:id/payslips` → `GET /payroll/payslips/
  :id` → `GET /payroll/payslips/me`, `POST /billing/rates` (plus its
  `account_not_found` error shape), `POST /billing/group-charges` →
  `GET /billing/group-charges` (mine) → `GET /billing/group-charges/all`,
  and `GET /orgs/memberships` / `GET /orgs` / `GET /org-chart` / `GET
  /org-chart/group` — in every case diffing the actual JSON shape against
  what the new component code reads. Caught nothing wrong on this pass,
  but this is why: the components were written by reading the real
  Zod schemas and Prisma selects first, not guessed.
- **Browser click-through still did not happen.** Same RAM-constrained
  machine as every previous entry in this doc (5.9 GB total, well under
  1 GB free at idle) — no new attempt was made at automated browser
  verification this pass, given the prior entry's Playwright run already
  hit a renderer OOM on a subset of pages. Static review + live API
  round-trips are what stands behind this work; **an actual human
  click-through of `/payroll`, the new Finance tabs, Group Overview →
  Billing Charges, and the re-drawn Org Chart is still the one
  meaningfully open item** before calling any of this pass done.

## 2026-09-20 — Call-prep audit: multi-project timesheets, project calendars, HRMS + revenue

Audited eight client-brief features against the code (not the docs) and closed
the gaps. Verdicts before this pass: **Yes** — multi-project split hours,
HR/Sourcing POC mapping, timesheet lock + regularization tickets, payroll
computation. **Partial** — location/calendar mapping, attendance/shift rules,
leave automation, real-time revenue. **No** — timesheet-to-project-calendar
mapping.

- **Project-calendar mapping (was No).** `calendars.service.pickCalendarId`
  is the single resolution rule: project mapping > employee default mapping >
  calendar of the employee's office `Location` > org default. Timesheet
  creation now rejects a date that is a holiday on the *project's* calendar
  (422, message names the holiday + calendar). A US client's Jul 3 blocks
  logging on that project; an Indian holiday does not, and vice versa. Weekends
  are NOT enforced (the calendar model has no weekly-off config).
- **Payroll** now uses each employee's own resolved calendar for paid-holiday
  days instead of the org default for everyone (Ahmedabad vs Gurgaon differ).
  Project-specific calendars constrain timesheets only.
- **Location/calendar API (was Partial).** `POST /calendars` accepts
  `location_id` (validated to the org); list returns the location. New
  idempotent `npm run erp:seed:locations` (Ahmedabad/Indore/Gurgaon + office
  calendars + India/US client calendars, *sample* fixed-date holidays only).
  UI: location field + column on HR Settings > Calendars; new "Calendars"
  section on the employee profile to map an employee to a calendar per project.
- **24h/day cap loopholes closed.** The cap was only checked on create; a PATCH
  or an approved regularization ticket could push a day past 24h. One shared
  `otherHoursOnDay` now guards create, edit and ticket approval.
- **Attendance lateness (was Partial).** Grace previously fed only the overtime
  calculation. New `attendance_records.late_minutes` (additive migration
  `20260920120000_add_attendance_late_minutes`), set at check-in: 0 within
  shift start + grace, else minutes past start; evaluated in the org timezone,
  overnight-shift safe. Shown as a "Late" column.
- **Leave guards.** Requests now reject overlap with pending/approved leave
  (AM + PM half-days on one date allowed) and paid leave beyond the remaining
  balance (pending counts). Unpaid / no-quota types stay uncapped.
- **Real-time revenue (was Partial: nightly + admin-triggered).** Approving a
  timesheet entry, or approving a ticket that changes one, recomputes that
  day's `DailyProjectRevenue` immediately (best-effort; never fails the
  decision). `computeDayRevenue` now also deletes rows whose approved billable
  hours have gone, so a recompute is truly idempotent.
- **Payroll automation.** New `payrollDraft` job (1st of month, 03:00 UTC)
  opens the previous month's DRAFT run per active org. Processing stays a
  manual admin action on purpose.

**Tests:** new `erp-multiproject-calendars.test.js` (14 tests). Run only
against an isolated DB (`TEST_DATABASE_URL`) — the suite TRUNCATEs users/orgs.
ERP suites phase 2-5, 7-9 green. Pre-existing failures (not from this pass):
`orgs-phase1` (5), `erp-phase6` (1), `erp-phase10` (1) — those tests create
two orgs in separate holding groups with a group superadmin who has no
`OrgGroupMembership`, which the earlier holding-company hardening now (by
design) answers 403. The tests need updating to grant a group membership.

**Still open / policy calls for the client:** leave counts calendar days
inclusive (a Sat-Mon request burns 3 days; a test pins this) — should weekends/
holidays be excluded?; no monthly leave accrual or carry-forward (quota is
allocated up front per year); shifts are per employee, not per project; no
recruiter-performance report off `sourcing_poc_id` yet (mapping only);
holiday-on-timesheet is a hard block with no override; payroll ignores
overtime and late marks (no pay policy defined).

## 2026-09-20 — Multi-tenant sign-in redesign + workspace switcher

- **Backend (small, additive).** `GET /auth/workspace/:slug` is a public,
  branding-only lookup (`name`, `slug`, `logo_url`; active orgs only; own 30/min
  limiter because GETs skip the general limiter). `POST /auth/login` accepts an
  optional `org_slug`: omitted = unchanged behaviour (earliest membership); given
  = that workspace, else 403. The membership check runs *after* the password is
  verified so it cannot be used to probe who belongs where. 6 tests
  (`auth-workspace.test.js`).
- **Sign-in flow.** Step 1 workspace (typed slug, pasted URL, `?workspace=`,
  optional `*.VITE_TENANT_BASE_DOMAIN` subdomain, or one of the last 4 used) ->
  step 2 credentials with the resolved tenant's logo/name badge. "I don't know my
  workspace" keeps email-only sign-in working for existing users. Subdomain
  detection is inert until wildcard DNS exists and the env var is set.
- **Look.** Animated glass dashboard preview replaces the static illustration
  (labelled "Illustrative preview"; numbers are decorative; motion off under
  prefers-reduced-motion). Floating-label fields with focus rings, integrated
  password toggle and accessible error tooltips. Plus Jakarta Sans. Light/dark/
  system toggle, scoped to the sign-in screen via `darkMode: ['selector',
  '.auth-dark']` so the (not yet dark-styled) app is untouched.
- **SSO buttons are UI only.** No SSO backend exists; clicking Google Workspace /
  Microsoft Entra ID says so plainly and points at the workspace admin.
- **Dev quick-login** is now a collapsible bottom bar with role badges, incl.
  "Multi-Org Admin" (`group.admin@delphic.in`, created by
  `npm run erp:seed:multi-org`: a second org "Acconcy" + one admin in both).
  Still shown unless `VITE_DISABLE_QUICK_LOGIN=true` - set it for any build that
  faces real users (staging currently shows it).
- **In-app.** New `WorkspaceSwitcher` at the top of the sidebar replaces the
  static brand block, the header `<select>` and the header "+" (create-org moved
  into the switcher). Switching now returns to the dashboard so an org-scoped page
  never shows the previous company's data.
- **Verification.** lint 0 errors, `vite build` ok, new components rendered to
  HTML through Vite SSR with assertions, live API round-trips for lookup and
  slug-scoped login. **Not browser-verified** (machine had ~190 MB free RAM and
  the user's Chrome open) - a human look at both themes and mobile is still owed.

## 2026-09-21 - Multi-company requirements pass (vertical modules, analytics, valuation, email)

Driven by the per-company feature list (Delphic Global, Gulati Industries, Zephyr
Infrastructure, Acconcy Finance, Super Admin). Audit result: Delphic's core ERP
(attendance, payroll, timesheets, billing, expenses, accounting, org chart) was
already in place; the gaps were the three vertical businesses, real-time analytics,
email/calendar invites, projections/valuation and report click-through.

- **Per-company modules.** `Org.enabled_modules` (`trading`, `leads`, `contracts`,
  `projects`) gates the vertical APIs (`middleware/requireModule.js`, 403 when off)
  and the sidebar/routes. Set by a group superadmin in Group Overview -> Projections &
  Valuation -> Settings (`PATCH /orgs/:id/settings`). `enabled_modules` rides on the
  login and memberships payloads.
- **Gulati - trading** (`/trading`). Suppliers/consumers with an onboarding funnel
  (lead -> onboarding -> active; activation blocked until the 4-step checklist is
  complete), active/trading status, item master, per-partner rate cards (a new rate
  closes its predecessor the day before), current transactions (rate defaults from the
  rate card for the date; only active partners trade; purchase vs sale follows the
  partner type), dashboard summary.
- **Zephyr / Acconcy - leads, contracts, self projects** (`/leads`, `/contracts`,
  `/projects`). Leads categorised self project / client project / other; a self-project
  lead must name its basis (investor, customer deal or project type) and the matching
  value. Lead -> project or contract conversion (marks the lead won, links both ways).
  Contracts: construction (value, billed, progress) and recurring; MRR normalises
  monthly/quarterly/annual, with a 12-month expected-revenue schedule and ending-soon
  list. Self projects carry revenue / expense / salary / other entries with budget use,
  and legal/site documents (category, reference, expiry, optional file) with an
  org-wide register that surfaces expired and expiring-soon first.
- **Company financials** (`/financials`, admin). Monthly actuals combine client
  billing, trading sales, project entries and recurring contracts (revenue) against
  expense claims, vendor payments, goods purchased, project costs, payroll (processed
  run, else latest salary structures). Plan vs actual per month
  (`FinancialPlan`), least-squares projection.
- **Super Admin projections + valuation** (`GET /super-dashboard/projections`).
  Per company: 12-month actuals, 6-month projection with a confidence label, and a
  valuation that is recomputed on every load (`valuation_method`: manual / revenue
  multiple / EBITDA multiple, `valuation_multiple`, defaults 3x / 8x, last 3 complete
  months annualised). Mixed-currency groups hide the group totals rather than summing
  across currencies.
- **Delphic real-time analytics** (`/analytics`, admin; 30-60 s polling that pauses
  in background tabs). Billing & sales (daily revenue, MTD, invoice status, revenue by
  client with brought-by and owner), resource revenue (working vs face resource via
  `ResourceMapping`), salary, expense analysis (category / office / vendor type),
  vendor amounts (paid vs outstanding). Every row links to its source record.
- **Email + calendar.** `EmailOutbox` queue drained by a per-minute job
  (`lib/email/outbox.js`, nodemailer via `NOTIFICATIONS_SMTP_URL`; unset -> rows
  `skipped`). `notify()` now also emails users whose preference has email on (defaults
  on for interview scheduled / rescheduled / cancelled / reminder and offers), with an
  `.ics` invite for interview rounds (UID = round id, so a reschedule updates the same
  entry; the round's `meeting_link` is the join URL). `POST /invites` sends a team
  invite (colleagues + external emails) from the Calendar page; `GET /invites/outbox`
  is the admin delivery log.
- **Click-through reports.** Recruitment report tables link client / vendor / account
  and requirement cells to their records (`entityLink` in `reportViews.js`; plain text
  when a row has no id).
- **Data / seeds.** Migration `20260921120000_add_vertical_modules_email_planning`
  (12 tables, 2 Org columns + valuation settings). `npm run erp:seed:verticals` (after
  `erp:seed:multi-org`) creates Gulati Industries and Zephyr Infrastructure, enables
  modules on Acconcy, sets revenue-multiple valuations, and seeds demo data.
- **Verification.** 29 new tests (`erp-verticals.test.js`) + a 12-suite regression run
  (114 pass; the 1 failure, `auth.test.js` `/users/me` without a membership, predates
  this work). Client lint 0 errors, `vite build` ok, live API smoke test over all four
  companies. **Not browser-verified.**
