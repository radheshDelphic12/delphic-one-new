# Progress Log

Reverse-chronological log of what's been done. Newest entry on top. See [TODO.md](TODO.md) for what's next and [AGENTS.md](../AGENTS.md) for project context.

## 2026-09-16 — Multi-company ERP Phases 8-10 (accounting ledger/tax, external CA/Legal access, org chart — all backend) — branch `feature/multi-company-erp`

Plan log: [MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](../architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md).
Closes out every phase the 2026-09-15 client brief added. Two additive
migrations (Phase 10 needed none — see below), applied to
`requirement_dashboard_erp` + `requirement_dashboard_test`.

- **Phase 8 — accounting.** Migration
  `20260916123254_phase8_accounting_ledger_tax`. Schema: `LedgerAccount`
  (asset/liability/equity/revenue/expense, unique per org by `name`);
  `LedgerEntry` — one row per debit/credit line, no separate "journal
  entry header" table; a posting is simply >=2 `LedgerEntry` rows sharing
  one `transaction_id`, and `accounting.service.postJournalEntry` is the
  only place balance (`sum(debit) === sum(credit)`) is enforced — the DB
  has no constraint for it, same documented-gap posture as
  `PayrollRun`/`ClientInvoice`'s forward-only status transitions;
  `TaxRecord` (`pending → filed → paid`, `jurisdiction`/`kind` **kept free
  text**, not enums — which tax regimes apply is an explicit open question
  in the HLD's §10, so this doesn't guess at one). New `accounting` module
  (router-wide `authorize('admin')` — every route here is finance data):
  ledger-account CRUD, `POST /journal-entries`, `GET /ledger-entries`
  (filterable by account/transaction/date range), and three reports —
  `GET /reports/trial-balance`, `/profit-and-loss`, `/balance-sheet`. The
  balance sheet's `balances` field (`assets − (liabilities + equity)`) is
  reported, not hidden or auto-corrected: this module posts journal entries
  but doesn't do period-close/retained-earnings postings, so a non-zero
  value there just means the period's net profit hasn't been closed into
  equity yet — proved directly in a test (`balances === net_profit` on an
  unclosed book). Trial-balance/P&L aggregation uses a single
  `prisma.ledgerEntry.groupBy` per report (not one query per account) to
  keep it to two round trips regardless of chart-of-accounts size. 14 tests
  (`erp-phase8-accounting.test.js`).
- **Phase 9 — external Legal/CA access.** Migration
  `20260916130602_phase9_external_access`. Schema: `ExternalAccess`
  (`org_id`, `email`, `scope` json — `{ resources: [...] }`, `token_hash`,
  `granted_by`, `expires_at`, `revoked_at`, `last_used_at`/`use_count`).
  Deliberately **not** an `OrgMembership`, per the HLD — a CA/Legal
  reviewer has no role-in-a-company and no password to manage, so this
  gets its own auth path end to end: `middleware/auth.js` gained
  `authenticateExternal` (looks up a SHA-256 hash of an opaque `ext_…`
  bearer token, same posture as a password hash — never stores or accepts
  the plaintext after the grant response) and `requireExternalScope`
  (checks the grant's `scope.resources` allow-list). New `externalAccess`
  module: `POST/GET /external-access` + `POST /external-access/:id/revoke`
  (ordinary JWT+org admin auth — the plaintext token is returned exactly
  once, in the create response, and is never recoverable after that) plus
  a guest portal at `/external-access/guest/accounting/*` that calls the
  accounting module's own report functions directly, so a CA sees numbers
  computed identically to what an org admin sees — no parallel read path
  to keep in sync. Guest resources are an explicit enum
  (`externalAccess.validation.js`'s `RESOURCE`, currently just
  `'accounting'`, the HLD's own worked example) rather than a wildcard —
  extend it as more modules grow a guest-facing view. 7 tests
  (`erp-phase9-external-access.test.js`), including an expired-token case
  and a revoked-token-that-was-valid-before case.
- **Phase 10 — org chart + lifecycle visualization.** **No migration** —
  `OrgMembership.manager_id` (self-relation), `employment_status`
  (`pending_onboarding`/`notice_period` included), and `notice_end_date`
  all landed already in the 2026-09-15 Phase 2 amendment, specifically so
  this phase wouldn't need a schema change once it was built (see that
  amendment's own PROGRESS.md entry). New `orgChart` module:
  `GET /org-chart` (any active org member, not admin-only — a directory
  view) builds the `manager_id` reporting tree **in memory** from a single
  `OrgMembership.findMany`, not a recursive SQL CTE — one company's
  headcount doesn't need one (same reasoning as the project's
  no-analytics-warehouse posture, HLD §12); `include_terminated` toggle
  defaults to excluding them. `GET /org-chart/group`
  (`authorizeGroupSuperadmin`, mirrors the super-dashboard's cross-org
  gating exactly) returns every org's tree, optionally narrowed by
  `org_group_id`. `pending_onboarding`/`notice_period`/`notice_end_date`
  carry straight through onto each node as the "lifecycle indicators" the
  client brief asked for — no separate workflow engine, an admin just sets
  them via the existing `PATCH /orgs/memberships/:id`. 6 tests
  (`erp-phase10-org-chart.test.js`).
- **Verification posture for this entry, stated plainly**: each of the
  three new suites above is green **in isolation** (27/27 total,
  eslint clean across all three modules). The full ~54-file cross-suite
  regression was **not** re-run to completion this session — it was
  started, then explicitly paused mid-run at the human's request
  ("complete the remaining test cases later... do all the functionality of
  remaining phases first") to prioritize shipping Phase 8-10 before
  circling back to the full run. This machine's known RAM ceiling (see the
  Phase 4-7 entries below) made a `prisma migrate dev` and a backgrounded
  jest batch collide into a literal Node OOM crash mid-session — recovered
  by retrying once the colliding process had exited, not by any code
  change. **Run the full suite before merge.**
- **Not built this session**: frontend for any of the three phases; Phase
  8's auto-posting from billing/expense/vendor-payment events (manual/API
  journal entries only); Phase 9's email delivery of the guest token
  (API-response-only, matching this project's "local first" posture) and
  its per-view audit trail beyond `last_used_at`/`use_count` (HLD §10 flags
  a finer-grained trail as still an open question, not decided here); Phase
  10's actual chart visualization (the API returns the tree; nothing
  renders it yet).

## 2026-09-16 — Multi-company ERP Phase 7 (expenses + vendor payments, backend) — branch `feature/multi-company-erp`

Plan log: [MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](../architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md). Migration
`20260916115320_phase7_expenses_vendor_payments` — additive only, applied
to `requirement_dashboard_erp` + `requirement_dashboard_test`. First of the
four brand-new phases (7-10) that only existed as an HLD schema sketch
before this — no prior migration-plan section to extend.

- **Schema**: `ExpenseClaim` (`org_membership_id` + `location_id`, free-text
  `category`; `pending → approved → reimbursed` or `→ rejected` —
  `reimbursed` only reachable from `approved`, a separate step from the
  decision itself, since approving and actually paying out are different
  events). `VendorPayment` (`vendor_name` plain text, `vendor_type` ∈
  `contractor`/`external_resource`/`third_party`, `period_month`/
  `period_year`; `pending → approved → paid` or `→ rejected`, same two-step
  shape). **`VendorPayment` has zero FK to the recruitment domain's
  `Account`** — deliberately, per the HLD's module-map note: a recruitment
  `Account(type=vendor)` is a sourcing vendor (candidates/money coming
  *in*), while `VendorPayment` is money going *out* to a contractor/external
  resource, a completely different real-world relationship that happens to
  reuse the word "vendor." `expense_claim`/`vendor_payment` added to
  `DocumentEntityType` — a receipt or invoice attaches via the **existing**
  polymorphic documents module (`POST /documents` with the right
  `entity_type`/`entity_id`), zero new upload code required.
- **New `expenses` module**: `POST /expenses/claims` (any org member, for
  themselves), `GET /expenses/claims/me`, `GET /expenses/claims` (admin,
  team-wide), `POST /expenses/claims/:id/decision` (admin, pending only),
  `POST /expenses/claims/:id/reimburse` (admin, approved only);
  `POST/GET /expenses/vendor-payments` (admin-only throughout — raising a
  vendor payment isn't a self-serve action like an expense claim),
  `GET /expenses/vendor-payments/:id`,
  `POST /expenses/vendor-payments/:id/decision`,
  `POST /expenses/vendor-payments/:id/pay` (approved only). Both
  `ExpenseClaim`/`VendorPayment` added to the write-side `org_id`
  auto-injection set (`config/db.js`).
- Tests: `erp-phase7-expenses.test.js` (10 — org-membership gate, claim
  submission + cross-org location rejection, approve→reimburse +
  reimburse-before-approval rejected + double-decide rejected, rejection
  carries its reason and blocks reimbursement, self-view vs. admin
  team-view scoping, non-admin blocked from deciding/reimbursing/team-view,
  vendor payment creation admin-gated, decide→pay + pay-before-approval
  rejected + double-decide rejected, list filters by status/vendor_type/
  period, and an explicit proof that a `VendorPayment` shares no FK with a
  same-named recruitment `Account`). Full suite **50 suites / 405 tests
  green** (verified across two ~25-file batches to fit this session's
  tooling — both clean, no flakiness this run), eslint clean (0 errors,
  pre-existing warnings only).
- **Not built this phase**: frontend (claim submission + admin
  approval/reimbursement queue, vendor payment admin screens); any
  approval-chain policy beyond single-admin-decides (matches every other
  decision flow already in this codebase — timesheets, leave, payroll,
  billing all work the same way); claim/payment amount limits.

## 2026-09-16 — Multi-company ERP Phase 6 (profitability fact table + super dashboard, backend) — branch `feature/multi-company-erp`

Plan log: [MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](../architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md). Migration
`20260916103733_phase6_profitability` — additive only, applied to
`requirement_dashboard_erp` + `requirement_dashboard_test`.

- **Schema**: `DailyEmployeeProfitability` — one row per
  (org_membership, day): `revenue`, `cost`, `margin`, plus a `breakdown`
  json carrying the full allocation math for audit. This is the *only*
  table the super dashboard reads (HLD §7 — never live OLTP tables).
- **Computation** (`profitability.service.computeDayForOrg`) — a genuine
  two-step pipeline in one call:
  1. Ensures that day's `DailyProjectRevenue` is fresh by calling
     `billing.service.computeDayRevenue` directly (a cross-module service
     import — same established pattern as `interviews.service` importing
     from `submissions.service`), rather than assuming Phase 5's compute
     already ran for that date.
  2. Allocates each project-day's revenue across everyone who logged
     approved+billable `TimesheetEntry` hours on it, **pro-rata by hours** —
     two employees splitting a day 6h/2h split that project's revenue
     75%/25%, regardless of hourly vs. monthly rate type.
  3. Nets it against `cost` = that membership's latest `SalaryStructure.ctc`
     ÷ days-in-month (same per-day method as Phase 4 payroll; **no overhead
     allocation yet** — HLD mentions it, nothing computes it). A membership
     with no salary structure is skipped (reported, not failed) — same
     posture as payroll. Cost accrues every day of employment regardless of
     billable activity, so a bench/leave/weekend day nets a negative margin
     by design — that's the actual signal a profitability view is for.
  4. Upserts on `(org_membership_id, date)` — idempotent, and this one *is*
     a real DB unique constraint (unlike `DailyProjectRevenue`, both key
     columns here are non-nullable).
- **Rollups** (`profitability.service.rollup`) — plain `SUM()` over the
  fact table grouped by day or month, shared by both modules below
  (`orgId: undefined` reads across every org). No materialized view yet —
  HLD §6 explicitly says start with a live query and only add one once the
  fact table is too large for that to stay fast; it currently isn't.
- **New `profitability` module** (org-scoped, `requireOrgMembership` +
  `authorize('admin')` except `/me`): `POST /compute` (date range, capped at
  31 days), `GET /me`, `GET /team`, `GET /rollup`.
- **New `super-dashboard` module** (cross-org): `POST /compute` +
  `GET /rollup`, both gated to `authorizeGroupSuperadmin` **alone** —
  deliberately no `requireOrgMembership`, mirroring the `orgs` module's
  `GET /orgs` (this isn't a self-org action; a group-superadmin with zero
  org memberships anywhere must still be able to use it — tested). `org_id`
  on the rollup is optional: omitted, a group-wide total; passed, the exact
  same query drills into one company (HLD §7 — "one UI, parameterized, not a
  second dashboard to maintain").
- **New nightly job** `jobs/profitabilityCompute.js` (`node-cron`, same
  shape as the existing `jobs/interviewReminders.js`) — computes
  **yesterday** every day at 02:00 UTC across every `Org.status: 'active'`,
  per-org try/catch so one org's failure doesn't block the rest. A pure
  no-op wherever no orgs exist yet (e.g. this repo's base recruitment app
  before Phase 0's backfill) — nothing gates it further than that. Wired
  into `jobs/index.js`.
- Tests: `erp-phase6-profitability.test.js` (10 — org-membership gate,
  pro-rata revenue allocation across two employees verified with exact
  numbers, no-salary-structure skip, pure-cost negative-margin day +
  idempotent recompute, non-admin blocked, month rollup summing across days
  and employees with a headcount count, super-dashboard 403 for a
  non-group-superadmin, a group-superadmin with **no org membership at all**
  still succeeds, cross-org compute + group-wide vs. single-org rollup, the
  nightly job's "yesterday" date selection). Full suite **49 suites / 395
  tests green**, eslint clean (0 errors, pre-existing warnings only).
- **Test-fixture note**: `tests/helpers.js`'s `createOrgMembership` defaults
  `joined_at` to "now" (real system clock). This suite computes profitability
  for fixed calendar dates, so every membership needed explicit backdating
  or the service's employment-eligibility check correctly (and confusingly)
  excluded them — fixed locally in the test file, no shared helper change.
- **Confirmed pre-existing, unrelated to this session**: while chasing
  intermittent full-suite failures on this resource-constrained dev machine
  (see below), found that `tests/orgs-phase1.test.js`'s "earliest-joined
  active membership" case is genuinely flaky — `OrgMembership.joined_at` is
  `@db.Date` (day precision only), so two memberships created moments apart
  in the same test get an *identical* value and `auth.service.js`'s
  `orderBy: { joined_at: 'asc' }` has no secondary tie-breaker, making the
  "earliest" pick physically-row-order-dependent. `git diff` against that
  file and `orgs.service.js` is empty for this session — not something this
  work touched or caused. Not fixed here (out of scope); flagged for
  whoever picks up Phase 1's remaining items.
- **This dev machine, still resource-constrained**: the full 49-file suite
  doesn't reliably fit in one run — under memory/CPU pressure,
  `cleanDatabase()`'s `TRUNCATE` occasionally exceeds Jest's 20s hook
  timeout on an otherwise-passing file (confirmed by rerunning each
  "failure" alone or with less concurrent load, where it passes clean every
  time). Verified this phase's 395 tests green across a full pass split into
  batches to fit available resources, with every suite independently
  confirmed passing — no logic regressions found.

## 2026-09-16 — Multi-company ERP Phase 5 (billing + real-time project revenue, backend) — branch `feature/multi-company-erp`

Plan log: [MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](../architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md). Migration
`20260916092941_phase5_billing` — additive only, applied to
`requirement_dashboard_erp` + `requirement_dashboard_test` (day-to-day
`requirement_dashboard` untouched, as with every ERP phase).

- **Schema**: `BillingRate` (per `account_id` + optional `requirement_id`,
  versioned by `effective_from` like `SalaryStructure`; `hourly` or
  `monthly` `rate_type`). `DailyProjectRevenue` (one row per
  (account/requirement, day) — the client brief's real-time revenue metric;
  idempotent by design, recomputing a date updates the row instead of
  duplicating — not a DB unique constraint, since `requirement_id` is
  nullable and Postgres treats `NULL` as distinct under a unique index,
  which would silently let account-level rows duplicate). `ClientInvoice`
  (one per client account/period, `draft → sent → paid` forward-only, same
  freeze posture as `PayrollRun`/`TimesheetLock`). `GroupBillingCharge`
  (intra-group — a charge against one member org's books, raised at the
  group level; `kind` is free text since the HLD doesn't enumerate charge
  kinds).
- **Rate resolution** (`billing.service.resolveRate`) — most-specific-wins:
  a requirement-specific `BillingRate` beats the account-wide default
  (`requirement_id: null`) when both apply on a date.
- **Revenue computation** (`billing.service.computeDayRevenue`) — groups
  that day's **approved + billable** `TimesheetEntry` hours (never
  draft/rejected/non-billable) by (account, requirement), resolves the
  applicable rate, and computes: `hourly` = hours × rate; `monthly` = rate ÷
  days-in-month (that day's share of the retainer, only earned because
  there was billable activity — no activity, no row). A pairing with no
  applicable rate is skipped and reported, not failed.
- **New `billing` module**: `POST/GET /billing/rates` (admin);
  `POST /billing/daily-revenue/compute` (admin, a date range capped at 31
  days — admin-triggered, not a background job yet, see "not built" below)
  + `GET /billing/daily-revenue`; `POST /billing/invoices` (admin — sums a
  period's `DailyProjectRevenue` into a draft invoice with a per-requirement
  `line_items` breakdown; rejects if no revenue has been computed for that
  period) + `GET /billing/invoices` + `GET /billing/invoices/:id` +
  `POST /billing/invoices/:id/status` (forward-only transition);
  `POST /billing/group-charges` (`authorizeGroupSuperadmin` only — raises a
  charge against any org) + `GET /billing/group-charges` (self-org view, any
  admin) + `GET /billing/group-charges/all` (group-superadmin, cross-org).
  Mirrors the `orgs` module's pattern of NOT requiring `requireOrgMembership`
  on the two group-superadmin routes, since those are inherently cross-org,
  not self-org, actions. `BillingRate`/`ClientInvoice` added to the
  write-side `org_id` auto-injection set (`config/db.js`) —
  `GroupBillingCharge` deliberately excluded, since its `org_id` is the org
  *being charged*, routinely different from the caller's own org, so
  auto-stamping the caller's org_id there would be actively wrong.
- Tests: `erp-phase5-billing.test.js` (12 — org-membership gate, rate CRUD +
  cross-account requirement rejection, hourly revenue from approved+billable
  hours only, monthly-rate proration, requirement-specific rate overriding
  the account default, no-rate pairing skipped not failed, idempotent
  recompute, invoice generation + duplicate-period rejection + line_items,
  no-revenue-yet rejection, forward-only status transitions + non-admin
  block, group-charge creation gated to group-superadmin + self-org and
  cross-org visibility). Full suite **48 suites / 385 tests green**
  (split into two ~24-file batches to fit this session's tooling — each
  batch clean on its own), eslint clean (0 errors, pre-existing warnings
  only).
- **Not built this phase**: frontend (rate admin, invoice list/detail,
  group-charge screens); a scheduled/nightly auto-compute for daily revenue
  (today it's a manual admin call — matches the HLD §8 posture of adding a
  job queue only once something actually needs it, not speculatively);
  invoice PDF/export.

## 2026-09-16 — Multi-company ERP Phase 4 (payroll, backend) — branch `feature/multi-company-erp`

Plan log: [MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](../architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md). Migration
`20260916074851_phase4_payroll` — additive only, applied to the isolated
`requirement_dashboard_erp` + `requirement_dashboard_test` DBs (the
day-to-day `requirement_dashboard` DB is untouched, as with every prior ERP
phase).

- **Schema**: `SalaryStructure` (per `org_membership_id`, versioned by
  `effective_from` — a run uses the latest row with `effective_from <=` the
  period's last day; `ctc` is **monthly** gross throughout this module, not
  annual; `components` json is validated on write to sum to `ctc`).
  `PayrollRun` (`org_id` + `period_month`/`period_year`, unique per period;
  `draft → processed` is **one-way**, same freeze posture as
  `TimesheetLock` — a mistaken run needs a documented manual correction, not
  a silent re-run; `skipped` json records which memberships processing
  couldn't cover and why). `Payslip` (`gross`/`deductions`/`net` +
  a full `breakdown` json for audit). `payslip` added to
  `DocumentEntityType` so a generated PDF can attach via the existing
  polymorphic Document model later — no dedicated FK column needed, and none
  was added.
- **Payroll math** (`payroll.service.computeBreakdown`), per employee per
  period, documented assumptions and all: a day is paid in full when it's a
  weekend (**5-day work week assumed — no weekly-off calendar exists yet to
  configure this per org**), a holiday on the org's default `Calendar`, or
  attendance is `present`/`wfh`; half-paid on `half_day`; an approved
  `LeaveRequest` on a paid `LeaveType` covers it fully, an unpaid one docks a
  day. Everything else on a working day (absent, or simply no attendance
  record and no leave) is loss-of-pay. Deduction = `(ctc / days_in_month) ×
  lop_days`. **Overtime is tracked (`overtime_minutes` summed into the
  breakdown) but not paid** — no overtime-pay policy exists yet (Phase 3's
  own deferred item).
- **New `payroll` module**: `POST/GET /payroll/salary-structures` (admin) +
  `GET /payroll/salary-structures/me`; `POST/GET /payroll/runs` (admin);
  `POST /payroll/runs/:id/process` (admin, one-way) — pulls every org
  membership employed during the period, skips (not fails) anyone with no
  applicable salary structure, computes + stores a `Payslip` per the rest in
  one transaction; `GET /payroll/runs/:id/payslips` (admin team view);
  `GET /payroll/payslips/me` / `GET /payroll/payslips/:id` (owner or admin).
  Gated by `requireOrgMembership`, mirrors the `timesheets` module's route
  shape. `SalaryStructure`/`PayrollRun` added to the write-side `org_id`
  auto-injection set (`config/db.js`) — belt-and-suspenders, the service
  already sets `org_id` explicitly on every write.
- Tests: `erp-phase4-payroll.test.js` (13 — org-membership gate,
  components-must-sum-to-ctc validation + cross-org rejection, duplicate-run
  rejection, a fully-present employee nets exactly `ctc` with zero
  deductions, unpaid absences deduct correctly while approved paid leave
  doesn't, a member with no salary structure is skipped not failed, a run
  can't be processed twice, payslip ownership + admin access). Full suite
  **47 suites / 373 tests green**, eslint clean (0 errors, pre-existing
  warnings only).
- **Local environment note (this machine specifically)**: port **5434** is
  *also* taken by a native `postgres.exe` on this box (in addition to the
  5432/5433 conflicts AGENTS.md already documented) — the Docker `db`
  service is remapped to **5435** here via a local (gitignored) root `.env`
  (`POSTGRES_PORT=5435`); `server/.env` / `server/.env.erp` follow suit.
  `tests/env.setup.js` gained a `TEST_DATABASE_URL` override (falls back to
  the documented `:5434` default unchanged for every other machine) so this
  local remap didn't require touching the checked-in default. Also created
  the isolated `requirement_dashboard_erp` + `requirement_dashboard_test`
  databases in the shared Docker Postgres container (they didn't exist yet
  on this machine).
- **Not built this phase**: frontend (salary-structure admin screen, run
  processing + payslip UI); a correction/re-run workflow for a mistaken run
  (today it's one-way with no undo, matching Phase 3's `TimesheetLock`
  posture, but documented as a gap rather than assumed-fine); payslip PDF
  generation (the `payslip` `DocumentEntityType` value is ready for it, nothing
  generates one yet).

## 2026-09-15 — Multi-company ERP Phase 0 (tenancy scaffold) — branch `feature/multi-company-erp`

Plan: [MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](../architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md) (full log there). Design: [MULTI-COMPANY-ERP-PLATFORM-HLD.md](../architecture/MULTI-COMPANY-ERP-PLATFORM-HLD.md).

- Branch cut from `main` (`d7068cc`); isolated local DB
  `requirement_dashboard_erp` created in the existing Docker Postgres
  container (`localhost:5434`) — the day-to-day `requirement_dashboard` DB
  and whatever `server/.env` points at are untouched. `server/.env.erp.example`
  (+ `.gitignore` carve-out) lets any dev point at it without disturbing
  their own `.env`.
- **Schema**: new `OrgGroup`/`Org`/`OrgMembership` models + `OrgStatus`/
  `EmploymentStatus` enums + `User.is_group_superadmin`; nullable `org_id` +
  `Org?` relation added to `Account`, `Requirement`, `Profile`, `Submission`,
  `InterviewRound`, `StageHistory`, `Document`, `Comment`, `Notification`,
  `NotificationPreference`, `AuditLog`. Migration
  `20260915103201_phase0_org_tenancy_scaffold` — additive only, no `DROP`/
  `NOT NULL`. `Department`/`Designation`/join tables deliberately deferred to
  Phase 2 (inherit tenancy transitively via their parent's `org_id`).
- **Backfill**: `server/prisma/erp/phase0-backfill.js` (`npm run
  erp:phase0:backfill`), idempotent — one `OrgGroup`/`Org("Delphic")`, one
  `OrgMembership` per `User`, `org_id` stamped on every row of the 11 models
  above. Verified against the full CSV-seeded ERP DB (13 users → 13
  memberships; 111 accounts / 34 requirements / 213 comments stamped;
  re-run is a clean no-op).
- **App behavior unchanged** — migration applied to the shared
  `requirement_dashboard_test` DB too; full server suite **41 suites / 307
  tests green**, `eslint` 0 errors (pre-existing warnings only). `org_id`
  stays `NULL` everywhere until Phase 1 starts writing it.
- Windows note: `prisma generate` hit `EPERM` (query-engine `.dll` locked by
  the running dev server/vite — shared `node_modules` across branches);
  resolved by stopping the project's node processes before regenerating.
  Restart `dev:server`/`dev:client` after pulling this branch.

## 2026-09-15 — Multi-company ERP Phase 1 (JWT org context, switcher backend, group superadmin) — branch `feature/multi-company-erp`

Plan log: [MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](../architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md). No schema change — app-code only, on top of Phase 0.

- `auth.service.js`: `login`/`refresh` now carry an `org_id` claim end to
  end; `login()` picks the caller's earliest-joined active `OrgMembership`
  as the default org and returns `memberships` + `active_org`; `refresh()`
  re-verifies the membership is still active on every refresh. New
  `switchOrg(userId, orgId)` — the org switcher's backend half.
- `middleware/auth.js`: `authenticate` re-resolves role live from
  `OrgMembership` when the token carries `org_id` (never trusts the JWT
  claim — same pattern as `authorizeSuperadmin`); a token with no `org_id`
  is a complete no-op, so every pre-Phase-1 token / membership-less user
  behaves exactly as before. New `authorizeGroupSuperadmin`.
- New `orgs` module: `GET /orgs/me/memberships` (any user), `GET /orgs`
  (group-superadmin only). New route `POST /auth/switch-org`.
- Tests: `orgs-phase1.test.js` (11 — backward compat, default-org pick, live
  role resolution vs a lying JWT, ended-membership fallback, switcher happy
  path + 403, group-superadmin gate + live demotion). Full suite **42
  suites / 318 tests green**, eslint clean.
- Local: `admin@delphic.in` set `is_group_superadmin: true` in
  `requirement_dashboard_erp`.
- **Deferred** (tracked in TODO.md): the Prisma-middleware `org_id`
  auto-injection on write + the `org_id` → `NOT NULL` migration (order
  matters — flipping `NOT NULL` first would break every existing create
  call), and the org-switcher frontend (no second org to switch to yet).

## 2026-09-15 — DB connection pooling & latency architecture (repo-wide, done from `feature/multi-company-erp`)

New guide: [DATABASE-CONNECTION-POOLING.md](../guides/DATABASE-CONNECTION-POOLING.md). Triggered by the ERP branch adding a second local DB + dev-server instance sharing one Postgres with the existing dev server and jest — three uncoordinated, unbounded connection pools against one `max_connections=100` box was a real, repo-wide gap, not specific to multi-tenancy.

- Every `DATABASE_URL` (`server/.env.example`, `server/.env.erp.example`,
  `tests/env.setup.js`, `docker-compose.yml`, `docker-compose.prod.yml`) now
  carries explicit `connection_limit`/`pool_timeout` (new `DB_POOL_SIZE`/
  `DB_POOL_TIMEOUT` knobs for compose) instead of Prisma's default
  `num_physical_cpus*2+1` guess, which is unreliable under Docker Desktop's
  cgroup CPU reporting.
- Local Postgres (`docker-compose.yml`) bumped to `max_connections=200`
  (verified live: `SHOW max_connections` → 200; all three databases —
  `requirement_dashboard`, `_erp`, `_test` — survived the container
  recreate, only the container was recreated, not the volume).
- `src/index.js` graceful shutdown now calls `prisma.$disconnect()`.
- Confirmed `PrismaClient` is a genuine singleton (`grep -rn "new
  PrismaClient"` → one hit, `config/db.js`) — the actually-correct baseline
  already existed, this was purely about pool sizing on top of it.
- Full suite re-run with the pooled URLs: **43 suites / 328 tests green**.
- **Deferred, with concrete triggers documented**: PgBouncer (once total
  connections approach the ceiling or there's more than one app instance —
  with the `?pgbouncer=true` prepared-statement gotcha spelled out) and a
  read replica (once real write contention shows up on reports/
  profitability queries). Neither is needed at current scale.

## 2026-09-16 — Multi-company ERP Phase 3 (project-centric timesheets, daily lock, regularization tickets) — branch `feature/multi-company-erp`

Plan log has the full diff. Two additive migrations
(`20260916052421_phase3_project_timesheets` +
`20260916052614_phase3_timesheet_decision_reason`).

- New `TimesheetEntry` — one row per (employee, day, project); a split day
  (4h Project A + 4h Project B) is two rows, per the client brief. Linked to
  the existing `Account`/`Requirement` as the "project," not a new concept.
  New `TimesheetLock` — an org-wide daily lock (not per-employee). New
  `TimesheetRegularizationTicket` — the only path to change a locked day's
  entry; `requested_change` is restricted to `hours`/`billable`/`notes` by
  validation, applied field-by-field on approval inside a transaction.
- New `timesheets` module: log/list/edit entries (edit blocked once
  approved or once the day is locked), admin approve/reject, admin lock a
  day (no unlock — one-way freeze by design), raise + decide regularization
  tickets. Gated by `requireOrgMembership`; `TimesheetEntry`/`TimesheetLock`
  added to the write-side `org_id` auto-injection set.
- Tests: `erp-phase3-timesheets.test.js` (14 — org-membership gate, basic +
  multi-project logging, 24h/day cap, requirement-must-belong-to-account,
  cross-org rejection, edit-while-submitted then blocked-after-approval,
  non-admin can't decide, lock freezes new entries + edits, ticket rejected
  before lock / required after, approved ticket applies the change,
  rejected one doesn't, admin team view + non-admin blocked). Full suite
  **46 suites / 360 tests green**, eslint clean. Smoke-tested against
  `requirement_dashboard_erp`.
- **Not built this phase**: frontend; reconciling attendance-derived
  overtime against logged timesheet hours (still attendance-only, per
  Phase 2) — the HLD's overtime module description ("computed from
  attendance + timesheet") is only half-built.

## 2026-09-16 — Pre-Phase-3 hardening: org_id auto-injection + Designations module — branch `feature/multi-company-erp`

No migration — pure app code. Plan doc log has the full reasoning; summary here.

- New `src/lib/orgContext.js` (`AsyncLocalStorage`) + `middleware/auth.js`
  now runs each request inside it; `config/db.js` gained a second
  `prisma.$use` that auto-stamps `org_id` on `create` for 17 org-scoped
  models when the request has org context and the caller didn't already
  set it. Zero behavior change for anyone without an org membership (still
  the default test/pre-backfill case) or any service that already sets
  `org_id` explicitly (all of Phase 2/2-amendment).
- **Deliberately still not done**: the `org_id` → `NOT NULL` flip and the
  read-side half (filtering every list/report query by org). Both need a
  bigger, separate decision than this pass — see the plan doc / TODO.md for
  why.
- New `designations` module (org-scoped, mirrors `departments`):
  `GET/POST /designations`, `PATCH /designations/:id`.
- Tests: `designations.test.js` (8 — membership gate, CRUD + admin gate,
  cross-org name reuse, rename collision, plus 3 proving the auto-injection
  behaves correctly in all three cases: stamped, left `null`, never
  overrides an explicit value). Full suite **45 suites / 346 tests green**,
  eslint clean. Smoke-tested against `requirement_dashboard_erp` directly.
- Docker Desktop went down mid-session (unrelated — a Postgres-unreachable
  connection error, not a test failure); relaunched it, confirmed all three
  local databases + `max_connections=200` survived, reran clean.

## 2026-09-15 — Multi-company ERP: client brief received, Phase 2 amended — branch `feature/multi-company-erp`

Full brief + phase mapping: HLD doc's new "Product brief" section + §11. Plan doc log has the exhaustive diff; this is the summary.

- **Docs updated first**: HLD gained the full client brief (3 client-facing
  phases: Core ERP/HRMS → project timesheets/revenue → financials/
  analytics/multi-company), a revised module map + data model covering 6 new
  entities not in the original design (`Location`, `Shift`,
  `TimesheetLock`/`TimesheetRegularizationTicket`, `BillingRate`/
  `DailyProjectRevenue`, `ExpenseClaim`/`VendorPayment`,
  `LedgerAccount`/`LedgerEntry`/`TaxRecord`, `ExternalAccess`), 4 new internal
  phases (7 expenses/vendor, 8 accounting, 9 external access, 10 org chart),
  and a mapping table (§11) tying the client's phase names to this doc's
  numbered phases so nothing gets lost in translation.
- **4 concrete gaps closed same-day** (schema migration
  `20260915120000_phase2_amend_location_shift_poc_multiproject_calendar`,
  additive-only): `Location` (default Ahmedabad/Indore/Gurgaon + custom) +
  `GET/POST /orgs/locations`; `OrgMembership.hr_poc_id`/`sourcing_poc_id`/
  `manager_id` + `PATCH /orgs/memberships/:id`; `Shift` (timings + grace
  period) + `GET/POST /attendance/shifts` + automatic
  `AttendanceRecord.overtime_minutes` computed on check-out; `EmployeeCalendar`
  changed from strictly one-per-employee to one-per-(employee, project) so an
  employee on two concurrent client engagements follows two calendars at
  once (`account_id` added, the old single-column unique dropped for a
  compound one) + `GET /calendars/assignments/:id`.
- Fixed same-day rather than deferred: the multi-project calendar change
  alters the *shape* of an already-shipped table, and it's cheaper to fix
  while only demo data exists than after Phase 3-6 build on top of the old
  1:1 assumption.
- Tests: `erp-phase2-amendment.test.js` (10 — location CRUD + admin gate,
  POC/manager mapping + self-manager + cross-org-manager rejections, shift
  CRUD + overtime math incl. overnight-shift-safe duration + within-grace
  case, multi-project assignment/listing/reassignment-replaces). Full suite
  **44 suites / 338 tests green**, eslint clean.
- Local: seeded Ahmedabad/Indore/Gurgaon + a "General 9-6" shift into
  `requirement_dashboard_erp`, assigned to all 13 memberships.
- **Explicitly not built this pass** (documented, not silently dropped):
  everything from internal Phase 3 onward — timesheet locking/
  regularization tickets, billing/daily-revenue, payroll, profitability/
  super-dashboard — plus all 4 brand-new phases (expenses/vendor,
  accounting, external access, org chart). Schema-sketched in the HLD, no
  code. Infra (AWS S3, dedicated server + RDS) stays deliberately last per
  the client's own stated "local first" dev strategy — no change needed to
  the existing local-DB-first approach, just confirmation it already
  matches.

## 2026-09-15 — Multi-company ERP Phase 2 (calendar, attendance, leave, backend) — branch `feature/multi-company-erp`

Plan log: [MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](../architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md). Migration `20260915110152_phase2_directory_calendar_attendance_leave` — additive only.

- **Schema**: `Designation`, `Calendar`/`CalendarHoliday`/`EmployeeCalendar`,
  `AttendanceRecord`, `LeaveType`/`LeaveBalance`/`LeaveRequest` (all new
  tables, `org_id` `NOT NULL` from creation — no legacy rows to backfill,
  unlike Phase 0's existing tables). `OrgMembership.designation_id` added.
  `Department.org_id` added (nullable; the global `name` unique is
  deliberately left as-is for now — a known, documented gap, not an
  oversight).
- **New modules**: `calendars` (create calendar, add/list holidays, assign
  to an `OrgMembership`), `attendance` (check-in/out on the IST calendar
  day, own history, admin team view + regularize), `leave` (leave types,
  request/approve/reject/cancel, approval increments `LeaveBalance.used`).
  All gated by new `requireOrgMembership` (403, not a silent no-op, for a
  caller with no active org membership) — unlike existing recruitment
  routes, which stay oblivious to org context.
- New `src/lib/istDate.js` (shared IST "today", mirrors reports' `asIst`)
  and `zodDate.requiredDate`.
- Tests: `erp-phase2.test.js` (10 — org-membership gate, calendar CRUD +
  duplicate-holiday + assignment, check-in/out + double-action rejections,
  team listing + regularize, leave request → approve → balance → re-decide
  rejected, cancel flow, date-range validation). Full suite **43 suites /
  328 tests green**, eslint clean.
- Local: seeded a default calendar (2 holidays, assigned to all 13
  memberships) + 3 leave types in `requirement_dashboard_erp`; verified
  check-in end-to-end against `admin@delphic.in`.
- **Not built this phase**: Department/Designation CRUD endpoints (schema
  only), any frontend, leave accrual seeding.

## 2026-09-11 — Account meeting attendees widened + editable, put-forward pickers complete, sales bench-only submissions — branch `dev-deep`

- **Meeting attendees are no longer sales-only.** `AccountStageMoveDrawer` / `AccountStageOverrideDrawer` used to fetch `/users/directory?role=sales` — a BDA, recruiter, or admin who attended a client meeting had no way to be recorded. New shared `AccountAttendeesPicker` (`pages/accounts/`) fetches the full active roster; both drawers now use it.
- **Meeting details are editable after the fact.** New `POST /accounts/:id/meeting` (`authorize('bda','admin')`, `accounts.service.updateMeeting`) updates mode/date/location/notes/attendees **without a stage transition** — previously the only way in was `changeStage`, whose transition map has no `meeting_scheduled → meeting_scheduled` edge, so a wrong attendee list was stuck once scheduled. New `AccountMeetingEditDrawer` + an "Edit meeting" action on `AccountDetailPage`'s "Meeting information" card (shown whenever the caller can mutate the account, it's unlocked, and a meeting exists). Audited in `stage_history` as `"Meeting details updated"` (from_stage == to_stage).
- **Reports stay correct despite the wider attendee pool**: `reports.service.salesReports.meetings_attended` now filters attendees to `role IN (sales, admin)` so a BDA/recruiter tagged onto a meeting doesn't inflate the "Sales POC" count.
- **Put forward pickers now show everything.** `SubmissionCreatePage` fetched candidates/requirements with a bare `limit: 100` — anything past the first page was silently invisible. New `lib/fetchAllPages.js` pages a `{data, pagination}` endpoint to completion; used for both the candidate and (in-progress) requirement pickers, and reused to simplify `ReportsPage`'s `fetchAllAccountOptions`.
- **Sales can now put forward candidates — bench only.** `POST /submissions` opens to `authorize('recruiter','sales','admin')`; `submissions.service.create` rejects a sales caller with `sales_bench_only` (403) unless the profile is `source: 'direct'` **and** `on_bench`. Client: `canCreateSubmission` includes sales; `canOnlyPutForwardBench(user)` locks the "On bench only" checkbox on and filters the picker for a sales caller (both `lib/submissionStages.js`).
- Tests: `accounts-meeting.test.js` (new, 6), `submissions-stage.test.js` +4 (bench-only), `reports-bda-sales.test.js` +1 (non-sales attendee excluded). Full server suite (307) + client build/lint green.

## 2026-09-10 — UX: sticky list headers + top form CTAs + wider two-column edit drawers — branch `dev-deep`

- **Lists** — `DataTable` gains a `maxHeight` prop; the 4 list pages (accounts / requirements / submissions / profiles) pass `"calc(100dvh - 18rem)"`. The body scrolls inside that height while the filter bar and the `thead` (already `sticky top-0`) stay put. Embedded/preview tables (reports, dashboard, detail sub-tables) don't pass it → unchanged.
- **Edit / create forms** — the four form components (`Requirement` / `Account` / `Profile` / `SubmissionCreate`) now render **two-column** in drawer (panel) mode too, hosted in `Drawer size="xl"` (new size, ~46rem) instead of `lg`/`md`. Save/Cancel moved into a new `FormActionsBar` (`sticky top-0` inside the drawer body) rendered as the first child of the `<form>` — CTAs stay visible while fields scroll; the old bottom button row now renders only on the standalone route (`!asPanel`). All 13 drawer call sites bumped to `size="xl"`.
- Client build + lint clean. (Pre-existing failing test `accountBoard.test.mjs` unrelated.)

## 2026-09-10 — Dashboard KPI drill-through: click a tile, land on the exact rows — branch `dev-deep`

- **Problem:** KPI tiles linked to approximate views — a BDA's "Active leads" opened *everyone's* leads (accounts list has no role scope), "Stuck leads" just did `?stage=lead` (no staleness), "In meeting" dropped `rescheduled`, "Closed/Closures this month" showed *all* closed rows ever, sales's "Active submissions" showed the whole company.
- **`dashboardWidgets.js`**: replaced the static `KPI_LINKS` map with `kpiHref(key, { role, userId, monthStartIso })` — role-scopes (`owner_id` for BDA account tiles, `sales_owner_id` for sales submission tiles) and date-scopes (`closed_from` / `joined_from` = IST month start) each link so it reproduces the tile's count. "Interviews this week" → `/calendar` (no list view exists for it).
- **`dashboard.service.js`**: `startOfMonth` / `startOfWeek` now compute the **IST** calendar boundary (fixed +05:30), consistent with the reports; `DashboardPage` computes the matching `monthStartIso`.
- **List-page params** (server validation + service + client URL passthrough, no new UI controls):
  - accounts: `?stuck=stuck` (stale lead/meeting/rescheduled, 7d) and CSV `?stage=a,b`.
  - submissions: `?sales_owner_id=` (seat→requirement), `?joined_from=` / `?joined_to=` (actual_joining_date window).
  - requirements: `?closed_from=` / `?closed_to=` (closed_at window).
  - New passthrough params are cleared by each list's "Clear all filters".
- Tests: `dashboard-kpi-filters.test.js` (6). Full server suite + client build green.

## 2026-09-10 — Add Delphic favicon — branch `dev-deep`

- `client/index.html`: added `<link rel="icon">` + `<link rel="apple-touch-icon">` pointing at the existing `/Delphic_D-logo_transparent.png` (the blue "D" mark in `client/public/`). Site previously shipped no favicon.

## 2026-09-10 — BDA/Sales reports: column filters — branch `dev-deep`

- **Server** (`reports.service.bdaReports` / `salesReports`, `reports.validation.dateRangeSchema` +`account_type`): every table now honours
  - `bda_id` / `sales_id` — already existed for self-scoping; unchanged.
  - `client_id` — an account id (reused, generic across reports). For bda-reports it's client **or** vendor (accounts_created, meetings_scheduled, meetings_conversion, requirements_brought(_counts) all narrow to it); for sales-reports it's the client account (requirements_created, meetings_attended).
  - `account_type` (`client`/`vendor`/`unclassified`) — bda-reports only, narrows `accounts_created`.
- **Client**: new Account/Type selects (bda-reports) and Client select (sales-reports) in the report's filter bar, options from `GET /accounts`. The existing generic "Individual" filter is now wired up for both reports too (`bda_id`/`sales_id`) but hidden from the self-scoped role — admin only, since a bda/sales caller's own id always wins server-side.
- Tests: `reports-bda-sales.test.js` +5 (`column filters` — bda_id/client_id/account_type narrow accounts_created, client_id narrows meetings + requirements_brought + requirements_created + meetings_attended). All 68 report tests green; client build/lint clean.

## 2026-09-09 — Reports: all date bucketing + range filtering moved to IST — branch `dev-deep`

- **Bug:** a custom "1 Sep – 1 Sep" range and "This month" disagreed on 1 Sep's counts. Root cause: reports bucketed rows by **UTC** day and `date_from` parsed as UTC midnight, while the `date_to` end-of-day was computed in the server's **local** tz. Two inconsistencies at once (UTC bucket vs local range; and neither is what an IST user means by "1 September").
- **Fix — everything is IST now** (`Asia/Kolkata`, fixed +05:30, no DST), independent of the server clock:
  - `reports.service.js`: new `asIst()` / `dayKey` / `monthKey` bucket on the IST wall clock; new `reportFrom`/`reportTo` turn a `YYYY-MM-DD` param into `T00:00:00+05:30` / `T23:59:59.999+05:30`. Used by `optionalDateRange` **and** the inline `from`/`to` in `recruiter/sales/bda/vendor/clientPerformance` + `closure` (whose month/quarter group labels now also read IST). Old UTC `dayKey`/`monthKey` deleted.
  - `explorer.service.js`: pipeline-explorer `created_at` range inlines the same `+05:30` literals.
- Effect: a meeting at `2026-09-09T19:30Z` (= 10 Sep 01:00 IST) now buckets on **Sep 10** everywhere, and a same-day custom range catches it — custom and monthly agree. Some day counts shift vs the old UTC behaviour (this is the correct IST answer).
- Client `formatReportDate` unchanged — pure `YYYY-MM-DD` strings from the API render tz-safe; raw timestamps still render in the viewer's tz (IST in practice).
- Test: `reports-bda-sales.test.js` — IST day-boundary test (same-day vs wide range agree, bucketed on the IST day not the UTC day). All 63 report tests green.

## 2026-09-09 — Sales can move submission stages (forward, any submission) — branch `dev-deep`

- **Problem:** the client only ever surfaced submission stage-move actions to `recruiter`/`admin` (`canMutateSubmission`), so a sales user saw nothing clickable — while the server allowed sales exactly one move (`internal_screening → submitted_to_client` on an owned requirement). Net effect: sales couldn't move stages at all in practice.
- **Server** (`submissions.service.changeStage`): dropped the `if (user.role === 'sales')` restriction block. Sales now flows through the same path as recruiter — any **forward** transition on **any** submission. Backward moves / reactivations are still gated to admin/superadmin by the existing `backward` guard (`forbidden_backward`, reason required); `rejected`/`backout` reasons still enforced. `forbidden_stage_change` error is now unused but kept in the controller map.
- **Client** (`lib/submissionStages.js`): new `canMoveSubmissionStage(user)` = `recruiter|sales|admin`, used for the move UI in `CandidatePipelineBoard`, `RequirementKanbanPage`, `AccountPipelineBoardPage`, and the `SubmissionDetailPage` Stage section (the old `canSalesSubmitToClient` special-case removed). `canMutateSubmission` stays `recruiter|admin` and still gates field-edit fieldsets + submission create.
- Tests: `submissions-stage.test.js` +3 (`sales stage permissions` — forward on a non-owned requirement, reject/backout with reason, still-blocked backward). Full submissions + entity-access suites green; client lint/build clean.

## 2026-09-09 — BDA reports + Sales reports + joinings "by sales requirement" — branch `dev-deep`

- **New `GET /reports/bda-reports`** (`authorize('admin','bda')`, `bda` scoped to self via `bda_id`). `reports.service.bdaReports` → `{ tables: [...] }`, 5 per-day tables, all keyed off `Account.origin_owner_id` ("Brought by"):
  1. `accounts_created` — accounts brought per BDA per day; Count hover shows the Client/Vendor/Unclassified split (`by_type`).
  2. `meetings_scheduled` — `stage_history` rows `entity_type='account'`, `to_stage='meeting_scheduled'`, grouped by `changed_by` + day; plus `converted_to_active` = how many of those accounts are `stage='active'` right now.
  3. `meetings_conversion` — the same rolled up per BDA (no date).
  4. `requirements_brought` — one row per requirement on a BDA-brought **client** account (BDA / clickable Client → `/accounts/:id` / requirement / date).
  5. `requirements_brought_counts` — #4 counted per BDA per day; Count hover lists client names.
- **New `GET /reports/sales-reports`** (`authorize('admin','sales')`, `sales` scoped to self via `sales_id`). `reports.service.salesReports` → 2 per-day tables:
  1. `requirements_created` — requirements per `sales_owner_id` per day; Count hover lists client names.
  2. `meetings_attended` — accounts where the sales user is in `meeting_attendees`, counted by the account's `meeting_date` day. (One meeting per account in the data model — reschedules overwrite `meeting_date`.)
- **Joinings report gains a 4th tab** `by_sales_poc` ("By sales requirement") — joinings grouped by month + the joining's requirement `sales_owner`. `joinings()` now selects `seat.requirement.sales_owner`.
- Both new reports take only a date range, are `authorize('admin','sales')` for `/export` (BDA export not wired — view in-app), and produce one export sheet per table (same as HR / joinings).
- Client: `ALL_REPORTS` gains `bda-reports` (admin, bda) + `sales-reports` (admin, sales); `bdaReportsSections()` / `salesReportsSections()` + column defs in `reportViews.js` (`hoverCount` for the breakdown cells, `clientLink` for the clickable client); `ReportsPage` renders them with the joinings-style tab cards (`bdaReportsTab` / `salesReportsTab` state, `isDateOnly` extended). Tab-card badge for these two reports is `sectionTabBadge()` — the **sum of the count column** (total meetings / requirements for the range), not the grouped-row count, since these are daily aggregate tables. Detail tables (`requirements_brought`) still badge row count.
- Tests: `server/tests/reports-bda-sales.test.js` (8 — per-day counts, type split, meeting conversion, client-only filter, self-scoping for bda + sales, the joinings `by_sales_poc` tab). `reportViews.test.mjs` role lists updated. Server + client lint/build green.

## 2026-09-09 — Superadmin requirement status override (reopen dropped/closed) — branch `dev-deep`

- **Problem:** `REQUIREMENT_STATUS_TRANSITIONS` maps `closed` and `dropped` to `[]`
  and dropping sets `is_locked = true`, so a dropped requirement had no way back —
  `POST /requirements/:id/status` rejects it twice (`locked`, then
  `invalid_transition`) and `updateSchema` has no `status` field. Submissions and
  accounts already had `POST /:id/stage/override`; requirements never did.
- **New:** `POST /requirements/:id/status/override` (`authorizeSuperadmin`) —
  force a requirement to ANY status, bypassing the transition map, the lock, and
  the seats-closed gate. `reason` required; audited in `stage_history` as
  `[override] <reason>`. Clears `closed_at` unless the target is `closed`; may
  flip the lock via optional `is_locked`. `statusOverrideSchema` +
  `service.changeStatusOverride` + `controller.changeStatusOverride` + route.
  Mirrors `POST /accounts/:id/stage/override`.
- **Client:** `RequirementStatusOverrideDrawer` (status select over
  `REQUIREMENT_ALL_STATUSES` + required reason + "keep record locked" checkbox).
  `requirementStages.js` gains `REQUIREMENT_ALL_STATUSES` +
  `canOverrideRequirementStatus`. Wired into:
  - `JobPipelineBoard` — a superadmin dragging a card to a disallowed column (or
    the new "Override status…" card action) opens the drawer preset to the drop
    target; superadmins can now drag locked / terminal cards. Ordinary roles
    still get the "Cannot move from X to Y" toast.
  - `RequirementDetailPage` — "Override status…" button in the Requirement status
    section (always shown for superadmins, even when locked / no transitions).
- **Reports impact:** none historical. Every report/dashboard query reads
  requirement `status` + `closed_at` live (no snapshots) and keys closure metrics
  on `status: 'closed'` + `closed_at`, which a dropped req never had. Reopening a
  dropped→open req just moves it out of the `dropped` count and back into the
  `open`/active population everywhere; `updated_at` bumps so it is not
  immediately "stuck". No report reads requirement `stage_history`.
- **One-off:** `server/scripts/reopen-dropped-requirement.js` — dry-run by
  default, `--commit` to apply; for the requirement already stuck before this
  shipped. Run it in the target environment (not committed data).

## 2026-09-08 — Time to submit re-anchored + Type/Vendor cols + client meetings on the calendar — branch `dev-deep`

- **Time to submit** — the three durations now all start at **requirement
  creation** (leadership's definition), not hop-to-hop:
  `req_to_submission` (`requirement.created_at → submission.created_at`),
  `req_to_r1` (`→ first internal_r1 scheduled_at`),
  `req_to_submitted` (`→ first submitted_to_client stage-history entry`). Each
  keeps `{ ms, label, from, to }`; hover still shows the bound timestamps.
- Two new columns: **Type** (`Bench` / `Vendor` / `Market` from `Profile.source`
  via `SOURCE_LABEL`) and **Vendor** (`Profile.vendor_account.name`, `—` when not
  vendor-sourced). Export sheet carries both + the renamed `requirement_to_*`
  columns.
- **Calendar now shows client meetings.** `interviews.service.listForCalendar`
  concats `listClientMeetings()` — accounts with `meeting_date` in range
  (`deleted_at: null`), serialized as `{ kind: 'client_meeting', meeting_mode,
  meeting_location, meeting_notes, audience: 'external', … }` with id
  `meeting-<accountId>`. Dropped `audience=internal` from the feed; `mine=1`
  scopes to `owner_id` / `origin_owner_id` / a `meeting_attendees` row;
  `status=completed` excludes meetings, `cancelled` → `stage=dropped`.
- Client colour model (`interviewRounds.js`): `CLIENT_MEETING_LOOK` — **online =
  blue, in-person = amber**; `isClientMeeting()`, `eventPrimaryLabel()`,
  `eventTypeLabel()` helpers; `eventAppearance` / `eventAudience` handle the new
  kind; two new `STATUS_LEGEND` rows. `CalendarTimeGrid` / `EventPill` /
  `EventCard` / `EventHoverCard` / `EventDetailDrawer` render meeting labels,
  link to `/accounts/:id`, show Mode/Location/Notes, and hide the interview-only
  feedback/cancel/reschedule actions.
- Tests: `reports-time-to-submit.test.js` (6 — re-anchored durations, Type +
  Vendor, filters), `interviews-calendar.test.js` (+3 — meeting kind/mode,
  audience filter, `mine=1` scoping). Server + client lint/build clean.

## 2026-09-08 — Two new reports: Joinings + Time to submit — branch `feature/reports-joinings-time-to-submit`

Both `authorize('admin', 'sales')`, visible in the Reports picker, follow the HR-report pattern.

- **`GET /reports/joinings`** (`joiningsSchema`: `date_from`/`date_to`).
  `reports.service.joinings` — a joining = `Submission` `stage='closed'` with
  `actual_joining_date` in range. Returns `{ tables: [by_sourcer,
  by_interviewer, by_vendor] }`, all grouped by joining **month**:
  - `by_sourcer` — month × `Profile.added_by` → count.
  - `by_interviewer` — month × interviewer, split `l1` (users on the joined
    candidate's `internal_r1` rounds) / `l2` (`internal_r2`) / `total`; every
    linked interviewer credited, `interviewer_name` fallback.
  - `by_vendor` — vendor-sourced joinings only, month × `vendor_account.name`.
- **`GET /reports/time-to-submit`** (`timeToSubmitSchema`: `date_from`/`date_to`
  + `client_id` / `requirement_id` / `sourcer_id` / `search` candidate-name).
  One row per submission `created_at` in range (any stage). Columns: requirement
  created-at, requirement, client, candidate, **sourcer** (`Profile.added_by`),
  and the three hop durations of the app flow **profile sourced → submission
  created → internal round 1 → submitted to client** (raw `ms` + `"1d 6h"`
  label + `from`/`to` ISO bounds, `—` when not reached):
  `sourced_to_submission` (`profile.created_at → submission.created_at`),
  `submission_to_r1` (`submission.created_at → first internal_r1 scheduled_at`),
  `r1_to_submitted` (`→ first submitted_to_client stage-history entry`).
  Each duration cell shows its lower/upper bound timestamps on hover (`from`/`to`).
- Wired into `reports.routes` (`REPORTS` map + routes + `/export` branches:
  joinings = one sheet per table, time-to-submit = one sheet from `rows`).
- Client: `reportViews.js` `joiningsSections()` / `timeToSubmitColumns()` +
  `ALL_REPORTS` entries; `ReportsPage` renders Joinings as a 3-tab block (like
  HR) and Time to submit as one table with a Candidate-search box + Client /
  Requirement / Sourcer `SearchableSelect` filters (client & requirement lists
  fetched from `/accounts?type=client` + `/requirements`, `limit=100`).
- Tests: `reports-joinings.test.js` (5), `reports-time-to-submit.test.js` (5,
  incl. sourcer field + sourcer/search filter narrowing). All 6 reports suites
  (53 tests) green; client eslint + build clean; `reportViews.test.mjs` updated.

## 2026-09-08 — Reports polish + candidate-source relabel + notification time fix + calendar overlap fix

- **Reports dates** — all dates in the Reports section render as `08 September 26`
  (`formatReportDate` in `reportViews.js`); the HR chart axis uses a compact
  `08 Sep 26` and tooltips the full form.
- **Candidate source relabel (display only)** — stored enum values stay
  `direct` / `vendor` / `linkedin`; UI labels are now **Bench** (`direct`),
  **Vendor**, **Market** (`linkedin`). Via `Badge` `LABEL_OVERRIDES` + the source
  dropdowns (profile form / profiles list / HR reports filter) + server
  `reports.service SOURCE_LABEL`. No migration, no logic change.
- **HR report — no more per-type row spam.** The Sourcing / Submissions tables
  now have **one row per (sourcer, day)**; the per-source split lives in
  `by_type` and shows on **hover** over the Count cell ("Bench 3 · Vendor 2 ·
  Market 1"). `hrReport` groups without the source dimension; server test updated.
- **HR chart is horizontally scrollable** — dropped the day-window carousel;
  the plot area now has a `min-width` that grows with the number of days inside
  an `overflow-x-auto` wrapper, so every day is reachable by scrolling. Sourcing /
  submissions = stacked bars by source; round tables = multi-line.
- **Notification times were wrong (UTC).** The server clock is UTC, so
  `fmtWhen` in `jobs/interviewReminders.js` and `modules/submissions/
  submissions.service.js` rendered interview times in UTC (e.g. 5:00 PM IST shown
  as 11:30 AM). Now formatted in `env.timezone` — new `APP_TIMEZONE` env var,
  default `Asia/Kolkata`. Calendar (client-side, local TZ) was already correct.
- **Calendar time-grid horizontal overlap.** `layoutDayEvents` computed
  `colCount` only across *currently-active* events, so blocks in the same visual
  cluster could disagree on width and render on top of each other. Rewritten as
  cluster-based column packing — every event in a cluster shares one `colCount`;
  freed columns are reused. New `monthGrid.test.mjs`.

## 2026-09-08 — Superadmin record deletion (soft-delete) — branch `feature/superadmin-record-deletion`

Replaces hand-written prod SQL for pruning duplicate / mistaken rows (the trigger:
vendor `ACC-F637AC68` "Spiral TechnoLabs" entered twice). Spec:
[RD-SUPERADMIN-RECORD-DELETION.md](../features/RD-SUPERADMIN-RECORD-DELETION.md).

- **Schema** — `account`, `requirement`, `submission`, `profile`, `interview_round`
  gain `deleted_at` / `deleted_by` / `delete_reason` (+ a `deleted_at` index). New
  `AuditLog` model (`audit_logs`): `actor_id`, `action`, `entity_type`, `entity_id`,
  `reason`, `snapshot` JSON. Migration `20260908120000_soft_delete_and_audit`
  (additive, `IF NOT EXISTS` throughout) — applied to the local dev + test DBs.
- **Global filter** — one `prisma.$use` middleware in `config/db.js` injects
  `deleted_at: null` into every `findMany/findFirst/findUnique/count/aggregate/groupBy`
  on those 5 models (no raw SQL anywhere, so one hook covers ~150 read sites).
  `findUnique` is promoted to `findFirst`. Escape hatch: pass an explicit
  `deleted_at` in the `where`. Known gap: nested-include reads aren't filtered.
- **API** — extends the `admin` module, all `authorizeSuperadmin`:
  `POST /admin/:entity_type/:entity_id/delete` `{ password, reason }` (bcrypt-checks
  the caller's **own** password), `POST .../restore` `{ reason }`,
  `GET /admin/deleted?entity_type=` (current deletions + deleter name),
  `GET /admin/audit?entity_type=&limit=` (full delete + restore trail). Every
  delete/restore writes an `audit_logs` row with a pre-image snapshot. Delete
  response carries live-dependency counts (informational — soft-delete is
  reversible, so it never blocks).
- **Visibility + reversal UI** — **Settings → Deleted records** tab (superadmin
  only, `DeletedRecordsPanel`) lists everything currently deleted with a
  **Restore** action (reason required) plus the full delete/restore audit trail.
  Deletions/restores are also folded into the dashboard **Recent activity** feed
  (`recentActivity` now merges `stage_history` + `audit_logs`). Settings tab bar
  now stretches full-width (`flex-1` tabs) at `max-w-5xl`.

## 2026-09-08 — Boards/lists: open-in-new-tab, filter persistence, Clear all filters + Requirements work-mode

- **Open in new tab.** `OpenInNewTabButton` is now a real `<a href={path+search}
  target="_blank">` (was `window.open(url, '_blank', 'features')`, which opens a
  popup-blocked window). Every board card's primary open action + `CardActionsMenu`
  nav items are React-Router `<Link>`s (menu items gained a `to`/`href` prop), so
  cmd/ctrl/middle-click opens the **correct** requirement / account / profile /
  submission in a new tab. Applied to Lead/Job/Candidate/Matrix boards,
  `RequirementKanbanPage`, `AccountPipelineBoardPage`. Drag-and-drop unaffected.
- List peeks (`{Accounts,Profiles,Submissions,Requirements}ListPage`): the peek
  **Key** field and the primary "Open …" action are `<Link>`s now.
- **Filter persistence.** The 4 list pages hydrated filter state from the URL only
  once; added a `useEffect([searchParams])` that re-hydrates every filter state
  var from the params (guarded, converges with the existing mirror-to-URL effect),
  so Back / reload / a shared link / a new tab all restore the filters.
  (Pipeline boards were already URL-authoritative via `PipelineFilters`.)
- **"Clear all filters"** — the only way to clear. `PipelineFilters`' tiny ghost
  "Clear" is now a `btn-secondary` **Clear all filters** (X icon), shown only when
  a filter/search is active. Same button added to each of the 4 list toolbars with
  a `clearAllFilters()` that resets every filter state + strips the params
  (keeping only `create` / `profile_id`). No implicit clears anywhere.
- **Requirements list: Work mode.** New `work_mode` list filter — server
  `listQuerySchema` + `list()` where-clause (`requirements.validation` /
  `.service`), test in `requirements-crud-ui.test.js`. Client: a "Work mode: All /
  Remote / Onsite / Hybrid" `<select>`, a **Work mode** table column, and a peek
  field — all URL-synced + cleared by Clear all filters. Visible to every role.
- Fix: `RequirementDetailPage` requested `GET /submissions?…&limit=200`
  (`listQuerySchema` caps at 100) → every requirement detail page threw "Number
  must be less than or equal to 100". Now `limit: 100`. Also added a **Job
  details** `<Link>` CTA to the requirement peek (was reachable only via the Key).
- Server suite **35 / 253** green; client eslint 0 errors; `vite build` +
  `usePipelineFilters.test.mjs` (new round-trip case) pass.

## 2026-09-08 — Calendar: "Review feedback" once feedback is submitted

The interview "Submit feedback" CTA kept showing (and opened a blank form) even
after feedback was recorded for a round (e.g. a rejection). Now:
- New `hasSubmittedFeedback(event)` in `interviewRounds.js` — true when
  `result ∈ {pass,fail,no_show}` or free-text `feedback` exists.
- `EventCard`, `EventDetailDrawer`, `EventHoverCard`: the button reads **Review
  feedback** (not "Submit feedback") once feedback exists, and stays available
  even if the start time check would otherwise hide it. The detail drawer's
  "Candidate did not join" quick action is hidden once feedback is in.
- `FeedbackDrawer` pre-fills `result` / `rating` / `feedback` from the round (was
  blanking rating + feedback), retitles to "Review interview feedback", and the
  save button reads "Update feedback". Server already allowed amending (no
  "already submitted" guard on `POST /interviews/:id/feedback`).

## 2026-09-08 — Pipeline "Open in new tab" + Tagged profiles on requirement detail

- **Open in new tab** — new shared `OpenInNewTabButton` (`window.open(location.href)`,
  every role, no gate) in the pipeline board headers: `PipelineShell` (covers
  Leads / Jobs / Candidates / Requirement map), `RequirementKanbanPage`
  (`/requirements/:id/board`), `AccountPipelineBoardPage` (`/pipeline/:accountId`).
  Board filters + `view` are already URL-synced (`usePipelineFilters` →
  `applyFiltersToSearchParams`), so the new tab opens the same filtered view.
- **Tagged profiles on the requirement detail page** — `RequirementDetailPage`
  loads `GET /submissions?requirement_id=<id>` and shows a **Tagged profiles**
  table (candidate → profile link, stage badge, seat, recruiter, tagged-on date,
  "Open submission" link) between Seats and Status history. Recruiters see only
  their own submissions (existing `GET /submissions` scope) — a note says so.

## 2026-09-08 — Date presets (Today / This week) + BDA can view profiles + CVs

- **Filter bar date presets** gain **Today** and **This week** (Monday-start,
  matches the calendar grid) ahead of This month. `rangeForPreset` +
  `FilterBar.DATE_PRESETS`; Reports `groupBy` now defaults to `month` for any
  non-quarter preset. Applies to Reports + Dashboard filter bars.
- **BDA read access to profiles.** `GET /profiles`, `/profiles/:id`,
  `/profiles/:id/submissions` now allow `bda` (create/edit still recruiter+admin);
  client cap `viewProfiles` added to `bda`. A BDA can now open a candidate and see
  the **attached CV** (document reads were already open across roles; the block
  was the profile routes + the missing client cap). Test in `entity-access.test.js`.

## 2026-09-08 — HR report (4 tables) + em-dash → hyphen sweep

- **New `GET /reports/hr`** (`authorize('admin')`, `hrSchema`: `date_from`,
  `date_to`, `sourcer_id?`, `interviewer_id?`, `source?`). `reports.service.hrReport`
  returns `{ tables: [...] }`, all per-day, on-bench profiles excluded:
  - **Sourcing** — group `Profile` (added_by, `created_at` day, `source`) → count.
  - **Submissions** — group `Submission` (profile.added_by, `created_at` day,
    profile.source) → count.
  - **Internal round 1 by sourcer** / **by interviewer** — from `internal_r1`
    rounds keyed on `scheduled_at` day: `scheduled` = all, `completed` =
    `status='completed' && result in (pass,fail)`, `shortlisted` = `result='pass'`.
    The interviewer table expands each round to every linked `interviewers[].user`
    (falls back to `interviewer_name`); `interviewer_id` narrows it.
  - Wired into `/reports/export` (4 sheets) + the `REPORTS` map.
- Client: `reportViews.js` gains a visible `{ key: 'hr', label: 'HR reports' }` +
  `hrSections()`. `ReportsPage` shows the 4 tables on **named tabs** (icon +
  title + hint, row count as a highlighted pill top-right — mirrors the RVG/CWR
  tab cards), one table at a time, above it an **adaptive `HrChart`**: a range of
  ≤14 days (Today / This week / short custom) renders a grouped/stacked **bar
  chart** with every date; longer ranges render a **line chart** (round tables:
  scheduled/completed/shortlisted) or **streamgraph** (stacked area, silhouette
  offset — sourcing/submissions by type) with a **day-window carousel** (prev/next,
  14 days/page). Type / Sourcer / Interviewer filter row (people from
  `/users/directory`) + standard date-range presets; the chart always reflects the
  filtered response.
- Tests: `server/tests/reports-hr.test.js` (6). Server suite **35 / 251** green.
- **Em-dash sweep** — replaced `—` with `-` in **user-facing prose only** across
  `client/src` (31 lines: JSX text, labels, placeholders, tooltips, option
  labels, toasts). Left untouched: the `'—'` empty-value placeholder in
  tables/detail fields, and code comments / JSDoc.

## 2026-09-08 — Team directory endpoint: filters + owner/POC pickers work for every role

The Accounts **Owner** / **Brought by** filters (and owner / POC pickers elsewhere)
were empty or wrong for non-admin roles: `GET /users` is gated to
`admin|sales|bda` (recruiters got 403) **and** clamps a `sales` caller's results
to recruiters only — so a sales/recruiter user never saw BDAs like Garv / Krupali
/ Prashanth. The lists also filtered `active: true`, hiding deactivated people
whose names still appear on existing records.

- **New `GET /users/directory`** — any authenticated user; lightweight
  `{ id, name, role, active }` only (no email/phone/pagination), inactive users
  **included**, no role clamp. Optional `?role=` / `?active=true`.
  (`users.service.listDirectory`, `directoryQuerySchema`.)
- Client `useUserOptions` and every filter/picker `/users` fetch (Accounts list +
  form, PipelineFilters, ReportsPage, AssignRecruiterDrawer, RequirementFormPage,
  InterviewRoundsPanel, Account stage move/override drawers) repointed to
  `/users/directory`. Inactive people show as "Name (inactive)".
- Tests: `server/tests/users-directory.test.js` (recruiter blocked on `/users`
  but reads the directory; inactive included unless `?active=true`; sales not
  clamped; `?role=` narrows). 34 suites / 245 green.
- **Client** — superadmin-only `DeleteRecordButton` (password + reason modal, reuses
  `PasswordInput` / `Modal`) on Account / Submission / Profile / Requirement detail
  pages and per-round in `InterviewRoundsPanel`. New cap `deleteRecords` in
  `permissions.js` `SUPERADMIN_ONLY`.
- **Tests** — `server/tests/admin-soft-delete.test.js` (9 cases: happy path + audit,
  wrong password, non-superadmin 403, reason required, double-delete 409, restore +
  409-on-live, dependency counts, submission drops out of list, unknown type 422).
  `cleanDatabase` TRUNCATE list gains `audit_logs`.
- **Server suite 34 / 245 green** (no regressions from the `$use` middleware or the
  directory endpoint); server `eslint` 0 errors; client `vite build` + `eslint` clean.
- Still to do: manual superadmin click-through; hand the human `prisma migrate
  deploy` for staging/prod.

## 2026-09-07 — Fix RVG tabs: restore Active/Inactive, add With live submissions

Wrong 3-way split in `eb1d7c8` redefined Active/Inactive. Restored prior meanings and added the difference tab:

- **Active vendors** — every active-stage vendor (`vendor_activity=active`)
- **Inactive vendors** — no candidate currently in a live submission (`inactive`)
- **With live submissions** — Active − Inactive (`has_live`)

## 2026-09-07 — Calendar: team-wide scope, clickable links, in-card actions, 24h time grid (branch `feature/notifications-calendar`)

- **Scope filter.** `GET /interviews` "All" is now truly team-wide for **every**
  role (no ownership / role scope). "My interviews" (`mine=1`) = rounds the user
  **scheduled** (`scheduled_by`), is **tagged on** as an interviewer, or
  **submitted the candidate** for. Removed the per-role `where.OR` branches in
  `interviews.service.listForCalendar`. Test updated
  (`interviews-calendar.test.js`: "All is team-wide … mine=1 hides them").
- **Clickable links** in every calendar card (`EventCard`, `EventHoverCard`,
  `EventDetailDrawer`): the **requirement** → `/requirements/:id`, the
  **candidate** → `/submissions/:id`.
- **In-card actions.** The month/week/day hover card (`EventHoverCard`) now
  carries role/permission-gated buttons — **Open details** (always),
  **Submit feedback** (when `can_submit_feedback` and the round has started),
  **Cancel** (when it's still upcoming; routes to the detail drawer's reason
  form), plus **Join meeting**. `onFeedback` threaded
  `CalendarPage → CalendarMonthView / CalendarTimeGrid → EventPill / TimeBlock →
  EventHoverCard`.
- **Time grid.** `DAY_START_HOUR/DAY_END_HOUR` widened to a full 24h
  (`monthGrid.js`) — an early-morning interview was clamped to `top: 0` and hidden
  under the header ("top half hidden", wrong times). `CalendarTimeGrid` now
  auto-scrolls to the day's **earliest event** (falls back to now).
- **Schedule CTA.** Calendar toolbar gains a role-wise button: BDA →
  "+ Schedule meeting" (`/accounts`); recruiter / sales / admin →
  "+ Schedule interview" (`/submissions`). There is no standalone scheduler —
  interviews are added from a submission's rounds panel, client meetings from an
  account's stage flow — so the CTA routes to the right list.
- **Time-grid polish.** Fixed the 12 AM label clipping (first hour label no
  longer `-translate-y-1/2` off the top edge).
- **Calendar colour model reworked** (`interviewRounds.js` `eventAppearance`) to
  two independent signals: the **fill** now encodes the interview **category** —
  internal = sky/blue, external (client-facing) = violet/purple, and *only* those
  two — while **status** rides on the `<Badge>`s already shown on cards / hover /
  detail, plus `cancelled` → grey + struck (overrides) and `rescheduled` → same
  fill dimmed + struck. Previously the fill was status-coloured with clashing
  hues (completed≈pass, no_show≈rescheduled) and internal/external was only a
  thin border in a colliding shade. `STATUS_LEGEND` + the toolbar legend updated
  to match.
- **Reschedule / Cancel on every calendar surface, for every role.** `EventCard`
  (agenda) and `EventHoverCard` gained a **Reschedule** button (opens the detail
  drawer's inline form). Cancel + Reschedule are no longer gated on the
  `can_*` permission flags client-side — they show for any live (non-cancelled,
  non-past for cancel) round and the **server** enforces who may actually act
  (`canManageInterviewRound` / scheduler), returning 403 otherwise.
- **Reschedule no longer requires a new time.** The drawer's reschedule form
  starts blank; with a time it PATCHes `scheduled_at`, without one it PATCHes
  `{ result: 'rescheduled' }` — flags the round for rescheduling, slot set later.
- **Outcome recolours the slot.** `eventAppearance` now colours the interview
  slot itself by outcome when there is one — passed=green, rejected/failed=red
  (round `fail` *or* the submission is `rejected`/`backout`), did-not-join=orange,
  cancelled=grey+struck — superseding the internal(sky)/external(violet) category
  fill; only still-scheduled slots show the category colour. `serializeCalendarEvent`
  gained `submission_stage`. Legend + trailing note updated.
- Also fixed a missing `CalendarDays` lucide import in `CalendarPage.jsx` (crash
  on the empty-agenda path) surfaced by the `main` merge.
- Server suite **32 / 229** green; client lint 0 errors; `vite build` clean.

## 2026-09-07 — Notifications: admins get a copy of every event (branch `feature/notifications-calendar`)

- `dispatch.notify()` now folds **every active admin** into the recipient set for
  *every* `NotificationType`, independent of `ROLE_EVENT_MATRIX` and the per-event
  recipient resolvers. The existing filters still run after: an admin who is the
  actor is not self-notified, and an admin can still mute a type for themselves
  via `NotificationPreference` (`in_app: false`). Role filter changed to
  `u.role === 'admin' || matrix.roles.includes(u.role)`. Costs one extra
  `user.findMany({ role: 'admin', active: true })` per dispatch.
- `eventCatalog.js` header comment documents the admin exemption; `admin` stays in
  every `roles` list only so the preferences UI offers admins all toggles.
- Tests: `notifications.test.js` +3 — every active admin gets a non-participant
  event; an admin-actor is not self-notified; an admin can mute a type. Full
  server suite **32 suites / 222 tests** green.
- Docs: feature spec §4.1 algorithm + §10 as-built; `TESTING-NOTIFICATIONS-CALENDAR.md`
  Part A note + regression checklist item.

## 2026-09-07 — Calendar month-view: hover-expand meeting cards (branch `feature/notifications-calendar`)

- New `client/src/pages/calendar/EventHoverCard.jsx` — a floating detail card,
  portalled to `<body>` and `position: fixed` (escapes the month grid's
  `overflow-hidden`), flips right/left + clamps to the viewport. Shows round type
  + name, status/result, when, candidate, requirement, account, interviewers,
  cancellation reason, feedback/rating, and a "Join meeting" link.
- `EventPill.jsx` now opens the card on hover/focus (140 ms in, 160 ms out); the
  card stays open while the pointer is on it (so the Join link is reachable).
  Clicking the pill still opens `EventDetailDrawer`. Lint + `vite build` clean.

## 2026-09-07 — Merge `main` into `feature/notifications-calendar` + Prisma schema realign (branch `feature/notifications-calendar`)

**Merged `origin/main` (`727ca7b`) into the branch** — merge commit `8f15352`, no
conflicts. What `main` brought in (all shipped to `main` first; see its own log
`57ef425`..`727ca7b`):

- **Accounts** — a **Specialization** column in the list table: vendor accounts
  show `vendor_specializations` as chips, clients/unclassified show `—`. Row peek
  gains Specializations / Rate range / Payment terms for vendors only.
  Client-only; the list API already returned the fields.
- **Reports — CWR** (`clients-without-requirements`) reworked to present-state, no
  date filters: **3 tabs** — *All active clients* (strictly `type = 'client'`,
  `stage = 'active'`), *Has requirements* (`bucket=with_requirements` — ≥1 req
  open/in-progress/on-hold), *No requirements* (`bucket=no_active` — no such req;
  closed/dropped only or never had one). `with_requirements` + `no_active`
  partition the set. The "Reqs" column is now **"Active requirements"**
  (`active_requirements_count`, a filtered `_count` on the same statuses).
  `without_active_requirements` / `closed_only` buckets kept server-side for the
  export route / back-compat.
- **Reports — RVG** (`recruiter-vendor-gaps`) reworked: vendor set is strictly
  `type = 'vendor'` **and** `stage = 'active'` (dropped the profile-linked wide
  net). **2 tabs** — *Active vendors* (`vendor_activity=active`, every
  active-stage vendor) and *Inactive vendors* (`vendor_activity=inactive` — no
  sourced candidate currently in a live submission stage: any `SubmissionStage`
  except `closed`/`rejected`/`backout`). New `has_live_submission` field per row.
  `vendor_activity` enum trimmed back to `active|inactive`. Date inputs removed
  from both reports (server still accepts `date_from`/`date_to`).
- **BDA requirement map** — `requirementScopeWhere()` returns `{}` for `bda` (team-
  wide, like admin) instead of scoping to accounts they own. Affects the pipeline
  board + reports explorer. Sales (own) / recruiter (assigned) unchanged.
- **Documents / resumes** — `documents.service.list()` no longer runs the per-
  entity access gate on **reads**: any authenticated user can list an entity's
  attachments (sales needs a recruiter's attached CV). `create` / `delete` stay
  owner-gated. `FilesPanel` + `ProfileFormPage` drop the explicit
  `Content-Type: multipart/form-data` header on upload (it dropped the boundary →
  request hung on "Uploading…"). New `FileViewerModal` — PDF `<iframe>` /
  image `<img>` inline, `.docx` rendered in-browser via **`docx-preview`**
  (dynamic import, own chunk); other types → download. Row actions are now
  **View** / **Download** / Delete, with a file-type badge + size.
  `apiClient` exports `fetchAuthenticatedBlob`, adds `downloadAuthenticatedFile`.
- **Candidate detail for sales** — the profile peek gains a **"View full
  details"** action for every role (navigates to read-only `/profiles/:id`), so
  sales no longer has to open the edit drawer to see the full record.

**Prisma schema realign (this branch, `server/prisma/schema.prisma`).** A prior
rebase on this branch had dropped the schema changes for migration
`20260903110804_notifications_and_calendar` while keeping the migration SQL, the
app code, and the tests — so the generated client lacked `prisma.notification`,
`prisma.notificationPreference`, and `InterviewRound.status`, and the three
notification/calendar suites failed. Reconstructed in `schema.prisma` to match
the already-applied migration (no new migration, DB untouched,
`prisma migrate diff` confirms alignment):

- enums `InterviewRoundStatus`, `NotificationType`, `NotificationEntityType`
- `InterviewRound`: `status` (default `scheduled`), `cancelled_at`,
  `cancellation_reason`, `reminder_sent_at`, `reminder_1h_sent_at`,
  `online_meeting_provider`, `external_event_id`, `@@index([status, scheduled_at])`
- `model Notification`, `model NotificationPreference` + their `User` relations

**Status.** `node_modules` synced (`npm ci` — `docx-preview` + `lottie-web` +
`node-cron`), Prisma client regenerated. **Server suite 32 / 32 suites, 219 / 219
tests green** (`--runInBand`). Client `npm run lint` 0 errors, `vite build` clean.
Nothing pushed. `server/prisma/schema.prisma` is the only uncommitted change.

## 2026-09-04 — Login polish + "Delphic one" rename + hover-zoom + calendar interview dot (branch `feature/notifications-calendar`)

- **Rename** — the product now reads **"Delphic one"**: login brand panel heading
  + wordmark, sign-in card copy, `client/index.html` `<title>`. (The old
  "Requirement Management Dashboard" string is gone from the login page.)
- **Login UI** — reworked into a proper split: full-bleed `primary-700→800`
  gradient brand panel (white text, glass card around `undraw_dashboard_p93p.svg`,
  soft light blobs) on `lg+`; right side a centered card with a gradient top
  accent bar, larger inputs (shadow-soft, 4px `primary/15` focus ring), and a
  faint `primary-50` wash behind the form on mobile. `delphic-logo.png` shows
  above the card on mobile, `Delphic_D-logo_transparent.png` in the panel.
- **Accent audit** — confirmed no `#0052ff` / `rgb(0 82 255)` / `#3d7bff`
  anywhere under `client/` (grep clean); buttons + avatars already ride the
  `primary` scale / solid `primary-600` from the earlier brand pass.
- **Hover-zoom** — new `.hover-zoom` utility in `global.css` (`scale(1.02)`,
  soft easing, `prefers-reduced-motion` aware). Applied to `KpiCard`, `StatCard`,
  the three dashboard panels (Stuck leads / Stuck requirements / Recent activity),
  and calendar `EventCard`.
- **Calendar interview indicator** — `notificationsContext` now derives
  `interviewUnread` (unread notifications whose `type` starts with `interview_` —
  scheduled / rescheduled / cancelled / reminder). `AppLayout` shows a red count
  pill on the **Calendar** nav item (a dot on the icon when the sidebar is
  collapsed), mirroring the bell badge.
- `vite build` + `eslint` clean.

## 2026-09-04 — Settings page (tabbed): account / security / notifications / activity (branch `feature/notifications-calendar`)

- **New `/settings` route + nav item** (`Settings` icon, no capability — everyone).
  `client/src/pages/settings/SettingsPage.jsx` — top tab bar (`?tab=` synced,
  `account` is the default / bare URL): **Account** (profile summary + Log out),
  **Security** (change-password form), **Notifications** (renders the existing
  `NotificationPreferencesPage`), **Activity** (account history).
- **Change-password** extracted from the modal into
  `client/src/components/ChangePasswordForm.jsx` (fields + submit, optional
  `onDone`/`onCancel`). `ChangePasswordModal.jsx` deleted — the header avatar
  menu no longer opens a modal; its "Change password" item is replaced by a
  **Settings** link, "Logout" kept. `AppLayout` lost the `passwordOpen` state +
  modal mount.
- **Account history** — new read-only `GET /users/me/activity` (`users.routes` →
  `users.controller.myActivity` → `users.service.listActivity`): the caller's own
  `stage_history` rows (account / requirement / seat / submission), newest first,
  `limit` 1–200 (default 50), entity labels resolved (account name, requirement
  title, `candidate → requirement` for submissions). No schema change. The
  Activity tab renders it as a timeline with `from → to` stage, reason, and a
  link to the entity where one exists.
- **Redirect** `/notifications/preferences` → `/settings?tab=notifications`; the
  notification-bell dropdown "Settings" link and `headerTitle` updated to match.
- `vite build` + `eslint` (client + server) clean.

## 2026-09-04 — Brand pass: accent → #105aa9, login redesign, home Lottie preloader (branch `feature/notifications-calendar`)

- **Accent colour** — the `primary` Tailwind scale (`client/tailwind.config.js`) rebuilt
  around `#105aa9` (600 = the accent); `--color-primary` / `--color-primary-soft`
  tokens in `client/src/styles/global.css` updated to match. Hardcoded `#0052FF` /
  `#EEF4FF` / `#DBE6FE` literals swapped for `#105AA9` / `#EEF5FC` / `#D8E8F6` across
  `AppLayout`, `FilterBar`, `chartTheme.js`, and the Accounts / Dashboard / Pipeline /
  Profiles / Requirements / Submissions / Users pages. Everything else already goes
  through `primary-*` utilities so it recolours automatically. `Avatar` (initials
  badge for candidates + people) switched to a solid `#105aa9` fill / white text
  (was `primary-100` / `primary-800`); the redundant `bg-primary-600` override on
  the sidebar user avatar dropped. Sidebar brand now `Delphic_D-logo_transparent.png`
  + "Delphic one" text (was a letter-D tile + "Delphic").
- **Login page** (`client/src/pages/auth/LoginPage.jsx`) — split layout: left brand
  panel (`primary-50→100` gradient, soft blur blobs, `Delphic_D-logo_transparent.png`,
  `undraw_dashboard_p93p.svg` illustration, feature bullets), right sign-in card
  (`shadow-card`, rounded-2xl, `primary` focus ring). Panel is `lg`+ only; mobile
  shows `delphic-logo.png` above the card. Assets are the new files dropped in
  `client/public/`.
- **Home Lottie preloader** — `client/public/assets/preloader/d_preloader.json`
  (copied from `public/d_preloader.json`); `lottie-web@^5.13` added to the client
  workspace. New self-contained `client/src/components/HomePreloaderGate.jsx` wraps
  the index route (`DashboardPage`) in `App.jsx`. First visit per browser session:
  fixed full-screen white overlay (`z-9999`, `role="status"`, `aria-busy`), Lottie
  (`svg`, loop, `xMidYMid meet`, 180×230) plays while critical home images preload;
  page reveals only when a full `loopComplete` **and** the assets are both done, then
  the overlay fades + scales + blurs out (~320ms) and unmounts. `sessionStorage`
  `site_preloader_played='1'` — revisits skip the Lottie and wait on assets only.
  Fail-open: any Lottie fetch/parse error reveals as soon as assets are ready.
  `lottie-web` is a dynamic `import()` so it stays out of the login-route bundle
  (separate 308 kB / 79 kB gzip chunk). CSS lives under `.site-preloader*` in
  `global.css` (respects `prefers-reduced-motion`). `vite build` + `eslint` clean.

## 2026-09-04 — In-app notifications + interview calendar (built, branch `feature/notifications-calendar`)

Full spec + as-built: [features/RD-NOTIFICATIONS-AND-CALENDAR.md](../features/RD-NOTIFICATIONS-AND-CALENDAR.md).

- **Schema** — migration `20260903110804_notifications_and_calendar`: `notifications`
  + `notification_preferences` tables; `NotificationType` / `NotificationEntityType`
  / `InterviewRoundStatus` enums; `interview_rounds` gains `status`, `cancelled_at`,
  `cancellation_reason`, `reminder_sent_at`, `reminder_1h_sent_at`, and reserved
  `online_meeting_provider` / `external_event_id`. `tests/helpers.js` truncate list
  + `createInterviewRound` helper.
- **Dispatch** — `server/src/lib/notifications/` (`eventCatalog` `ROLE_EVENT_MATRIX`
  + `renderNotification`; `recipients`; `dispatch.notify()` — role- + preference-
  filtered, wrapped so it never throws / never rolls back a business `$transaction`).
- **APIs** — `/api/v1/notifications` (`GET /`, `/unread-count`, `POST /read`,
  `/read-all`, `GET`/`PUT`/`DELETE /preferences`) and `/api/v1/interviews`
  (`GET /` role-scoped calendar feed, `POST /:id/feedback` for assigned
  interviewers **or** managers, `POST /:id/cancel`). Both mounted in `app.js`.
- **Call sites** — account → active; requirement create / assign / unassign /
  status-changed; submission interview scheduled / rescheduled / feedback /
  cancelled / submitted-to-client / rejected / backout / offer.
- **Cron** — `node-cron`; `server/src/jobs/interviewReminders.js` (T-24h + T-1h,
  deduped) started from `index.js` via `startJobs()`, gated by `ENABLE_JOBS`
  (`!== 'false'`, always off in tests). Reserved `env.notifications` block.
- **Frontend** — `NotificationsProvider` (60s poll, tab-visibility aware) in
  `main.jsx`; header `NotificationBell` (9+ badge, popover); `/notifications` +
  `/notifications/preferences` pages; `/calendar` page (month grid + agenda,
  `localStorage` view, scope + status filters, `EventDetailDrawer` /
  `FeedbackDrawer`), `Calendar` nav item; shared `lib/interviewRounds.js`,
  `components/ui/Toggle.jsx`, `Badge` colors for the new statuses.
- **Tests** — `notifications.test.js`, `interviews-calendar.test.js`,
  `interview-reminders.test.js`. **Not yet run against the full suite** — local
  Docker Postgres (`:5434`) was down; client `vite build` + `eslint` are clean,
  and the submissions / interviews / accounts / requirements suites passed
  pre-merge.

## 2026-09-07 — BDA team-wide account flow + specialization filter + docs

- **BDA accounts:** team-wide view + mutate (edit, classify, stage/meetings, type, brought-by); unlock **accounts** only. Still no requirement mutate and no superadmin stage override.
- **Accounts list:** shared `specialization` filter + `GET /accounts/specializations` for all roles.
- **Docs/diagrams updated:** README, ARCHITECTURE-OVERVIEW, HLD, API-Spec, System Design v2 role tables, AGENTS conventions.

## 2026-09-03 — CWR: 3-way toggle (All / Has requirements / No requirements), default All

The two-tab view left a gap: clients whose only requirements are on_hold /
closed / dropped were in neither tab, so the tabs didn't sum to the stage total
(e.g. 8 + 22 ≠ 36).

- `bucket` enum gains `all`. **`with_requirements` now = `requirements: { some: {} }`**
  (any status, not just open/in_progress). `without_active_requirements` unchanged
  (`none: {}`). The three now partition the stage-filtered client set:
  `all == with ∪ without`, `with ∩ without == ∅` (verified on the restored DB:
  79 = 10 + 69).
- Reports page: 3-button toggle, **default "All active clients"**; labels
  All active clients / Has requirements / No requirements.
- Test rewritten to assert the partition across all three buckets.

## 2026-09-03 — Coverage reports: Brought-by + date filters, and complete people dropdowns

- **RVG filters**: added **Brought by** (`origin_owner_id`) and a **date range**
  (`date_from`/`date_to`, scopes the sourced-profile counts). Vendor + Our-POC
  filters unchanged. `coverageSchema` gains `date_from`/`date_to`.
- **CWR filter**: added a **Created** date range (`account.created_at`). Stage /
  Brought by / Sales POC unchanged.
- **Filter dropdowns were missing names.** The Brought-by / Sales-POC / Our-POC
  option lists were role-scoped (`bda|admin`, `sales|admin`, …) and `active`-only,
  so a POC / origin owner who is a recruiter or an inactive user never appeared —
  even though their name is in the column. Now each list is the **full user
  roster (`/users?limit=100`, no `active` filter) unioned with the people present
  in the current report rows** (`mergePeople`). Same lists feed the superadmin
  inline-edit cell.
- Tests: `reports-coverage-gaps.test.js` — CWR created-date range; RVG
  `origin_owner_id`; RVG date range scoping the sourced count. 29 suites / 201.

## 2026-09-03 — recruiter-vendor-gaps: count every sourced profile; "active" = sourced from at all

Two prod issues with the report:

1. **`profiles_sourced` stayed 0.** `recruiterVendorGaps` iterated only
   `account.type = 'vendor'` rows; on prod (user-created, no seed) many vendor
   accounts were never classified `type='vendor'` / weren't `active`, so profiles
   pointing at them were invisible. Fix — vendor set is now `type='vendor'` **OR**
   any account id referenced by a `Profile.vendor_account_id`
   (`prisma.profile.groupBy(['vendor_account_id'])`).
2. **"Active vendors" hid vendors once any profile was submitted.** The whole
   report was filtered to `!any_submitted` ("gap"). Now: with `vendor_activity`
   set, that filter is dropped — `active` = "we've sourced ≥1 profile from this
   vendor, submitted or not", `inactive` = "sourced nothing". Legacy no-toggle
   call keeps the old "never submitted" meaning.

- `profiles_submitted` is now a real count (was hardcoded `0`) — the "Submitted"
  column is meaningful.
- `ProfileFormPage`: vendor picker no longer filters `stage: 'active'` so a
  non-active vendor account is still selectable.
- Tests: `reports-coverage-gaps.test.js` — profile on a `type: null` account is
  counted; `vendor_activity=active` lists a vendor whose profile WAS submitted
  (`profiles_sourced: 1`, `profiles_submitted: 1`).
- Server suite green (29 suites / 198 tests). Not yet on `main`.

## 2026-09-03 — CWR "no requirements" bucket = zero requirements ever

Follow-up to the entry below. The `without_active_requirements` bucket of
clients-without-requirements now returns **only clients that have never had any
requirement** (`requirements: { none: {} }`) instead of "no open/in-progress
requirement". A client whose only requirements are on_hold / closed / dropped is
now in neither toggle. Toggle relabelled **"No requirements"** ("…never had a
requirement"); `with_requirements` hint tightened to "open / in-progress".
`reports-coverage-gaps.test.js` updated. Server suite green.

## 2026-09-03 — List-page filters, "Tagged Profiles" fix, RVG activity toggle, CWR bucket overlap fix

Branch `feature/list-filters` (off `main`). One server file + validation + client
list pages + Reports page. Server suite green (29 suites / 196 tests). Client
`vite build` + `eslint` clean (0 errors). No schema/migration change.

### 1. "Tagged Profiles" column counted every stage — now client-facing only

- `requirements.service.js`: `DECORATE_INCLUDE.seats._count.submissions` is now
  **stage-filtered** to `submitted_to_client → bgv` (`submitted_to_client`,
  `interview_scheduled`, `interview_result`, `offer_sent`, `bgv`). Excludes
  `sourced` / `internal_screening` (not with the client yet) and
  `closed` / `backout` / `rejected` (out of play).
- Serialized field renamed `tagged_profiles_count` → **`client_submissions_count`**;
  Requirements list column header → **"Client Submissions"**, peek field too.
- Test: `requirements-crud-ui.test.js` — one submission per stage, asserts the
  count is exactly the 5 client-facing ones (list + detail).

### 2. More filters on Requirements / Profiles / Submissions lists

New shared `client/src/lib/lookups.js` — session-cached reference lists
(`useUserOptions(role)`, `useClientAccountOptions`, `useVendorAccountOptions`,
`useRequirementOptions`) so filter bars don't refetch rosters per mount.

- **Requirements** — added Type, Client, Sales owner, Assigned recruiter, Tech
  stack (apply-on-submit), Sort by/order. All URL-synced. (Backend already
  accepted every param — `listQuerySchema` unchanged.)
- **Profiles** — kept Source + On-bench; added a **"More filters"** panel: Vendor,
  Added by, Experience min/max, Expected-CTC min/max, Notice ≤, Work mode,
  Relocate, Active, Skills (apply-on-submit), Sort by/order + Clear. URL-synced.
  Backend `profiles.validation` already had all of these.
- **Submissions** — stage single-select → **multi-select** (CSV, already
  supported); added Recruiter, Client, Requirement, Sort by/order; **added
  pagination** (page/limit + pager — the page had none, footer used to read
  `N of N`). URL-synced.

### 3. recruiter-vendor-gaps — Active / Inactive vendor toggle

- `coverageSchema` gains `vendor_activity: 'active' | 'inactive'`.
  `recruiterVendorGaps` filters the (already not-submitted) gap list by
  `profiles_sourced > 0` (active — "wasted relationship") vs `=== 0` (inactive —
  dormant). Route unchanged (passes the parsed query through).
- Reports page: a two-tab toggle above the table (mirrors the CWR one), default
  **Active**; `vendor_activity` sent on run + export.
- Test: `reports-coverage-gaps.test.js` — active list all `profiles_sourced > 0`,
  inactive list all `=== 0`, disjoint.

### 4. clients-without-requirements — buckets were not mutually exclusive (prod bug)

- Prod showed the same client (e.g. Sinon Tech, Orangebites, DianApps) under
  **both** "with requirements" and "no active requirements". Cause:
  `with_requirements` = `requirements: { some: {} }` (any status), so a client
  whose only reqs are `closed` / `on_hold` / `dropped` matched both toggles.
- Fix: `with_requirements` now `requirements: { some: { status: { in: ['open','in_progress'] } } }`
  — the exact complement of `without_active_requirements`. Verified against the
  restored DB: with=10, without=69, overlap=0.
- Test updated: on_hold-only client is now **only** in the without bucket; added a
  "no id in both buckets" partition assertion.

## 2026-09-03 — Ticket undo/reactivate, actor names, Brought-by admin, report tweaks

`main`, uncommitted. No schema/migration change.

### Pipeline / submissions

- Admin (+ superadmin) may step a submission back one stage or reactivate
  `rejected` / `backout` → `sourced` via `POST /submissions/:id/stage` (reason
  required; stamps cleared on reactivate). Recruiters still forward-only.
- Detail page + Candidate / Requirement / Account boards surface "Move back…" /
  "Reactivate candidate" for admins; reason drawer required for those moves.
- Submission detail no longer blanks when `/history` fails; history endpoint
  matches `getOne` visibility (no extra recruiter-owner 403). `profile_id`
  restored in serialize. Stage history rows now include `changed_by.name`
  (requirement + submission), rendered on both detail pages.

### Accounts

- "Brought by" (`origin_owner_id`) editable by **admin + superadmin** (was
  superadmin-only). Non-admins get a loud 403 instead of a silent drop. Reports
  inline coverage edit uses the same `editBroughtBy` capability.

### Reports

- Recruiter–vendor gaps: hide "Recruiters (our end)" column (table + export).
- Clients without requirements: toggle **With requirements** /
  **No active requirements** (`bucket` query); adds `requirements_count` column.

### Tests

- Updated `submission-stage-machines`, `submissions-stage`, `superadmin-accounts`,
  `reports-coverage-gaps`, `reportViews.test.mjs`.

## 2026-09-03 — Prod data-loss safeguards (deploy backup + destructive-script guards)

`main`, uncommitted. Ops/tooling only — no app code, no schema change. Shell scripts
pass `bash -n`; `_guard.js` unit-checked (local host → allowed; remote host or
`NODE_ENV=production` → refuse with exit 1; `ALLOW_DESTRUCTIVE_SEED=1` → override).

**Trigger:** a prior prod deploy lost ~2–3 h of real data. Root cause was a destructive
DB operation running as (or alongside) a deploy — `--restore` (drop + recreate + restore
an older dump) and/or a CSV seed (`seed.js` wipes every table).

### 1. Every prod deploy takes a verified backup first — `start-delphic.sh`

- New `backup_db()` runs **before** `docker compose up -d --build` / migrations: brings
  `db` up if needed, waits for `pg_isready`, `pg_dump -Fc` → `./backups/predeploy-<ts>.dump`,
  then verifies the dump is readable (`pg_restore --list` inside the container).
- **Aborts the deploy** if `pg_dump` errors or the dump can't be read back — nothing is
  built or migrated. A tiny dump (genuinely empty DB) warns and continues.
- Keeps the newest `BACKUP_KEEP` (7) predeploy dumps — one per push, oldest deleted.
  Aborts when the backups volume has less than `BACKUP_MIN_FREE_GB` (2) free.
  `--skip-backup` escape hatch for the first-ever deploy only.
- `start-delphic.sh` still has **no `--restore` flag** — restores are manual `pg_restore`
  only, never part of a deploy (runbook §4 rewritten to match; the old runbook told people
  to pass a `--restore=` flag that doesn't exist).

### 2. Destructive CSV seeds refuse against non-local DBs — `server/prisma/_guard.js`

- New guard: `assertNonProdDestructive()` exits 1 when `NODE_ENV=production` or the
  `DATABASE_URL` host isn't in {localhost, 127.0.0.1, ::1, db, postgres,
  host.docker.internal}, unless `ALLOW_DESTRUCTIVE_SEED=1`.
- Wired into `seed.js`, `seed-accounts.js`, `seed-jira.js`, `seed-vendors.js` (just before
  `main()`). `seed-admin.js` is untouched (already non-destructive).

### 3. `start-platform.sh` (local dev tool) guards `--restore` / `--fresh`

- `guard_local_db()` refuses those two when `NODE_ENV=production` or `.env`'s `DATABASE_URL`
  host is remote. `--seed` is covered by the seed-script guard.

### 4. Scheduled backups — `scripts/db-backup.sh` + runbook

- Standalone verified `pg_dump -Fc` → `./backups/auto-<ts>.dump`, keeps newest
  `BACKUP_KEEP` (7), aborts under `BACKUP_MIN_FREE_GB` (2) free, optional
  `BACKUP_OFFSITE_CMD` hook.
- [DEPLOY-RUNBOOK.md](../guides/DEPLOY-RUNBOOK.md) gains: cron / systemd-timer setup,
  pre-flight destructive-migration grep, expand-contract migration rule, row-count
  spot-check, manual PITR-first rollback. `backups/` added to `.gitignore`.

## 2026-09-03 — Pipeline map filters, Tagged Profiles column, sales "submit to client", report/filter fixes

`main`, uncommitted. No schema/migration change. eslint clean on touched files;
`usePipelineFilters.test.mjs` / `reportViews.test.mjs` / `pipelineBoardUtils.test.mjs` /
`submission-stage-machines.test.js` green. **DB-backed suites not run** — Postgres
`localhost:5434` was down (see TODO).

### 1. Pipeline → Requirement map filters

- "All recruiters" single-select → **"Assigned recruiters"** `MultiSelectDropdown`
  (`recruiter_ids`, CSV). "Past SLA" checkbox → **"Submitted by"** `MultiSelectDropdown`
  (`submitted_by_ids`) — filters submissions by `submitted_by` **and** narrows the shown
  requirements to those with a matching submission (same pattern as the candidate-stage
  filter). New **"All admins"** single-select (`admin_id`) — filters on `account.owner_id`
  alongside `bda_id` (both set → `owner_id IN (...)`).
- Server: `pipeline.validation` + `pipeline.service` accept `recruiter_ids` /
  `submitted_by_ids` / `admin_id`; legacy single `recruiter_id` still honoured.
  `usePipelineFilters.js` gained the URL keys + `filtersToApiParams` mapping.
- Matrix filter row got `relative z-40` so open filter dropdowns render above the
  sticky `z-30` requirement/stage header cells (were hidden behind them).

### 2. Requirements list: "Seats" column → "Tagged Profiles"

- `requirements.service` `DECORATE_INCLUDE.seats` now selects `_count.submissions`;
  `serialize()` returns `tagged_profiles_count` (sum of submissions across all the
  requirement's seats, all stages — same semantic as the dashboard `submissions_count`).
  `seats_total` / `seats_closed` still returned.
- `RequirementsListPage` table column swapped; peek panel gains a "Tagged profiles" field
  (Seats kept there).

### 3. Sales can mark a candidate "Submitted to client"

- `POST /submissions/:id/stage` → `authorize('recruiter', 'sales', 'admin')`.
  `submissions.service.changeStage(id, body, user)` (was `userId`): role `sales` is
  allowed **only** `internal_screening → submitted_to_client` and only when
  `user.id === requirement.sales_owner_id`; anything else → `forbidden_stage_change`
  (403). Recruiter/admin behaviour unchanged.
- `SubmissionDetailPage` shows a single "Move to submitted to client" button for a
  qualifying sales owner (`canSalesSubmitToClient`); no field edits, no other transitions.
  Drag-and-drop pipeline boards still gate on `canMutateSubmission` (recruiter/admin).

### 4. Dashboard "Stuck" cards are point-in-time

- "Stuck leads" / "Stuck requirements" KPI cards + panels now show **"as of today"** and
  their hover copy states the dashboard date filter does not scope them ("stuck" = stale
  now). No count-logic change. (The dashboard date-range bar is still inert for **every**
  metric — separate open item, see TODO.)

### 5. Accounts list: "Brought by" filter now works + column

- `origin_owner_id` was missing from `accounts.validation` `listQuerySchema` (Zod stripped
  it) and from `accounts.service` `list()` — the filter did nothing. Added to both
  (`and.push({ origin_owner_id })`).
- New dedicated **"Brought by"** table column; removed the "via …" sub-line under Owner.

### 6. Reports — "Clients w/o requirements"

- Filtered `type: 'client'` only, so **unclassified accounts (`type: null`) — every real
  lead / meeting-scheduled account — never appeared**, and the Stage = Lead/Meeting/etc.
  filter returned nothing. Now `OR: [{ type: 'client' }, { type: null }]`, mirroring the
  Lead board's `include_unclassified`.
- Removed a hardcoded `sales_poc: … : { id: null, name: 'Paras Gulati' }` fallback → `null`.
- Added an explicit **"All stages"** option (previously only reachable via a hover-only ✕).
- Unchanged by design: `requirements: { none: {} }` means *never had a requirement* — a
  client that was active, got requirements, then dropped stays excluded. Switch to
  "no *open* requirement" is a separate decision (see TODO).
- Regression test added (`type: null` lead account appears under `stage=lead`).

### 7. Reports — coverage filter dropdowns role-scoped

- "Brought by" / "Sales POC" (CWR) and "Our POC" (RVG) were three identical all-user
  lists. Now: Brought by = BDA + admin, Sales POC = sales + admin, Our POC = BDA + sales +
  admin. Superadmin inline-edit `CoveragePersonCell` still gets the full user list.
  Tradeoff: a BDA-owned client is no longer selectable in "Sales POC" (use "Brought by").

### 8. Superadmin stage override — submissions + wired onto the boards

- **New:** `POST /submissions/:id/stage/override` (`authorizeSuperadmin`) — force a
  submission to ANY stage (backward, straight to `sourced`, out of a terminal state),
  bypassing `SUBMISSION_STAGE_TRANSITIONS`, the lock, and the round/BGV gates. Reason
  required; audited in `stage_history` as `[override] <reason>`. Deliberately minimal —
  it does not touch seat status. `stageOverrideSchema` + `service.changeStageOverride` +
  `controller` + route. Mirrors the existing account `POST /accounts/:id/stage/override`.
- **New component** `SubmissionStageOverrideDrawer` (stage select + required reason).
  `submissionStages.js` gains `SUBMISSION_ALL_STAGES` + `canOverrideSubmissionStage`.
- Wired so a superadmin dragging a card to a disallowed column opens the override drawer
  (preset to the drop target) instead of the "Cannot move from X to Y" toast:
  - submissions — `SubmissionDetailPage` ("Override stage…" button), `RequirementKanbanPage`,
    `CandidatePipelineBoard`, `AccountPipelineBoardPage`.
  - accounts — `LeadPipelineBoard` + `AccountsListPage` peek now route a disallowed
    move to the existing `AccountStageOverrideDrawer` (which gained a `preferredToStage`
    prop). `AccountDetailPage` already had it.
- Ordinary roles are unaffected — the disallowed-move toast still fires for them.

## 2026-09-02 — Fix: account edit form crashed on null columns ("Failed to update account")

`main`. Client-only. `vite build` + `accountUtils.test.mjs` green.

- **Symptom:** editing almost any client (or vendor) account — as admin or BDA — failed
  with a bare "Failed to update account" toast and no network request.
- **Cause:** `formFromAccount()` did `{ ...EMPTY_FORM, ...account }`; the API returns unset
  optional columns (`industry`, `poc_phone`, `source`, `client_payment_terms`, …) as
  `null`, which overwrote the `''` defaults. `buildAccountBody()` then called
  `form.<field>.trim()` → `TypeError` thrown **inside** `saveAccount`'s try/catch, so the
  user only ever saw the generic fallback string. Not a server bug — the request never
  left the browser.
- **Fix:** moved `EMPTY_FORM` / `EMPTY_CONTACT` / `formFromAccount` / `buildAccountBody`
  into `accountUtils.js` (testable, matches `canMutateAccount` etc. already there).
  `formFromAccount` now coerces every `EMPTY_FORM` string key back to `''` when the row
  has `null`, and sanitizes `additional_contacts`. `buildAccountBody` uses a null-safe
  `str()` helper on every field. Added regression assertions in `accountUtils.test.mjs`
  (null-heavy client row → clean form + body; fresh form still omits `type`/`owner_id`).
- **Swept the other edit forms for the same pattern — none affected.** `profileForm.js`
  `profileToForm`, `RequirementFormPage` `hydrateForm`, `InterviewRoundsPanel` `hydrate`,
  `SubmissionDetailPage` form init and `UsersPage` all re-default every field explicitly
  (`|| ''` / `?? ''` / `|| []`) instead of spreading the raw API row, so their `.trim()` /
  `.split()` calls never see `null`. Reason/notes/label `.trim()`s elsewhere read from
  local `useState('')`, never a hydrated value.

## 2026-09-02 — Dashboard "Stuck" KPI: real count (uncapped) + one "no movement" rule everywhere

`main`. No schema/migration change. Full server suite green
(29 suites / 188 tests, `jest --runInBand`); client eslint clean on touched files.

### 1. Stuck KPI cards were capped at 5

- `dashboard.service.js` `stuckLeads()` / `stuckRequirements()` fetch `take: 5` preview
  rows; `dashboardWidgets.js` used `summary.stuck_*.length` as the **KPI value**, so the
  admin "Stuck leads" / "Stuck requirements" tiles and the "N stuck 7d+" hint badges
  (bda / sales / recruiter) maxed out at 5 regardless of the true total.
- Added `countStuck{Leads,Requirements}()` (`prisma.*.count`, same where clause, no `take`)
  and return `stuck_leads_count` / `stuck_requirements_count` from every role summary
  (`0` where a role has no such list). Front-end now reads the `*_count` fields; the
  `stuck_*` arrays remain only the top-5 preview lists shown in the panels below.

### 2. "Stuck" now means the same thing for requirements as for leads/submissions

- Leads & submissions already used `updated_at <= now-7d` ("no movement"). Requirements
  used `created_at <= now-7d` ("opened 7+ days ago"), so a busy requirement opened 8 days
  ago still counted. Switched the requirement stuck check to `updated_at` in all five
  places: `dashboard.service` (`stuckRequirementsWhere`), `requirements.service`
  (`isStuck` + list `?stuck=` clause), `pipeline.service` (`serializeRequirement`),
  `reports.service` `aging()`, and `explorer.service` `computeAging` (also removed a
  dead `x ? A : A` ternary in the submission-grain `is_stuck`). `reports.service`
  bda/client-performance `stuck_*_count` already used `updated_at` — now consistent.
- Dashboard `stuck_requirements` rows gain `days_idle` (from `updated_at`); the panel
  badge shows "Nd idle" and moves "Nd open" into the sub-line.
- KPI hover copy reworded from "no movement" / "7+ days open" to "no update (no stage
  change or edit) for 7+ days", and the "Open requirements" / "Assigned open" / "Active
  leads" tiles now explain that their badge counts a wider set than the tile number.

### 3. Tests

- Test helpers that aged a requirement via `created_at` only now also set `updated_at`
  (`requirements-stage`, `pipeline-board`, `backend-gaps`, `reports-ui`,
  `reports-explorer`). No assertion changes needed.

## 2026-09-02 — Reports dropdown trimmed + coverage/RVG rework + screening chips + account owner filters

Uncommitted work on `main` (local). No schema/migration change. `client vite build` +
`reportViews.test.mjs` green; **server suite not run** (Docker Desktop down → test DB on
`localhost:5434` unreachable). `node -c` syntax-clean on all touched server files.

### 1. Reports page — only the two coverage-gap reports in the dropdown

- `reportViews.js` `ALL_REPORTS` — every report except `clients-without-requirements`
  and `recruiter-vendor-gaps` now carries `hidden: true`; `reportsForRole` filters
  `!r.hidden`. Reports stay fully defined (routes, columns, charts, export all still
  resolve by key) — they're just gone from the picker. `reportViews.test.mjs` updated
  to assert the dropdown is exactly those two per role.

### 2. `clients-without-requirements` — stage filter, default Active

- New `stage` on `coverageSchema` (5 account stages) → `clientsWithoutRequirements`
  adds `...(stage ? { stage } : {})`. `ReportsPage` renders a clearable Stage
  `SearchableSelect` that **defaults to `active`** on load / report switch; wired into
  `buildParams` + run-report deps + `/reports/export`.

### 3. `recruiter-vendor-gaps` — one row per vendor account, filterable

- Reworked `recruiterVendorGaps` from `(recruiter × vendor)` profile-driven pairs to
  **one row per vendor account** (`type = 'vendor'`) whose profiles were never
  submitted anywhere. Row carries `vendor`, `our_poc` (`account.owner`), `brought_by`
  (`account.origin_owner`), `recruiters[]` (everyone who sourced a profile from it —
  derived, there is no stored vendor↔recruiter link), `profiles_sourced`,
  `last_sourced_at`, `days_since_sourced`. Vendors with **zero** sourced profiles are
  included (admin view); a recruiter is self-scoped to vendors they've sourced from.
- **Filter correctness fix:** `any_submitted` is now computed from ALL of a vendor's
  profiles, never a single recruiter's slice — so `recruiter_id` no longer surfaces a
  vendor as a "gap" when another recruiter's profile from it was submitted. `recruiter_id`
  now post-filters on the displayed `recruiters[]` set (was an indirect `profiles_sourced > 0`
  after query-scoping).
- Filters `vendor_id` + `owner_id` on `coverageSchema`; `ReportsPage` adds a Vendor
  `SearchableSelect` (from `/accounts?type=vendor`) and an "our POC" people select. The
  shared "individual" recruiter picker is kept (admin) — note only users who have sourced
  a vendor profile can ever match, so most picks return an empty report by design.
- **Superadmin inline edit** on this report too: "Our POC" (`owner_id`) and "Brought by"
  (`origin_owner_id`) are editable in place, same `CoveragePersonCell` mechanism as
  `clients-without-requirements` (`PATCH /accounts/:vendorId`). "Recruiters" stays
  read-only (derived from candidate sourcing; an "assigned recruiters" vendor field was
  scoped out).
- `reportViews.js` columns/rows-id/chart bucket updated; `reports-coverage-gaps.test.js`
  rewritten for the vendor-centric shape + filter tests (incl. the cross-recruiter
  `any_submitted` case) + a `clients-without-requirements` stage-filter test.
  `cd server && npm test` → **29 suites / 188 tests green**.

### 4. Internal screening round results on pipeline cards

- New `client/src/pages/pipeline/ScreeningRoundChips.jsx` — renders every
  `internal_r1`/`internal_r2` round as an `IS1: pass` / `IS2: fail` chip (colour by
  result). Added to the **Candidate pipeline** card (uses `submission.interview_rounds`
  from `/submissions`) and the **Requirement map** card (new `submission.internal_rounds`
  from `/pipeline/board` — that endpoint's `interview_rounds` select now also pulls
  `round_type` + `round_number`).

### 6. Local dev launcher

- New `start-platform.sh` / `start-platform.ps1` at repo root + `npm run platform[:restore|:seed|:fresh|:down]`.
  Brings up only the compose `db` service (Postgres :5434), runs `prisma generate` +
  `migrate deploy`, optional data load, then runs the API (nodemon :4000) and client
  (Vite :5173) with hot reload — `.sh` foreground+prefixed, `.ps1` in separate windows.
- `--restore` / `-Restore` loads real-like data: safety-dumps the current DB, drops &
  recreates `requirement_dashboard`, `pg_restore`s the newest `backup-*.dump` (or
  `--restore=FILE`) inside the `db` container, then `migrate deploy` applies the
  migrations the dump predates. Validated: `backup-2026-09-01-113412.dump` →
  13 users / 123 accounts / 43 requirements / 27 profiles / 24 submissions / 213 comments,
  3 migrations auto-applied (`account_origin_owner`, `drop_lead_generated_date`,
  `add_is_superadmin`), `admin@delphic.in` back to `is_superadmin`. Mutually exclusive
  with `--seed`/`--fresh`. Docs: AGENTS.md "Local setup".

### 5. Accounts list — filter by Owner and Brought by

- `listQuerySchema` gains `origin_owner_id`; `accounts.service.list` adds an
  `origin_owner_id` AND-clause (`owner_id` was already supported). `AccountsListPage`
  adds two clearable people `SearchableSelect`s (active-user roster), URL-synced via
  `?owner_id=` / `?origin_owner_id=`. (BDA role is still server-scoped to own accounts.)

## 2026-09-01 — Coverage-report rework + manual interview_result

Uncommitted work on `main` (local). No schema/migration change (an interim
`sales_owner_id` field was added then reverted — "Sales POC" == the account owner /
"POC from our end", one person, no new column). `cd server && npm test` →
**28 suites / 178 tests green**; client `vite build` + `reportViews.test.mjs` green.

### 1. "Sales POC" == account owner

- Clarified: **POC from our end (`Account.owner_id`) and "Sales POC" are the same person.**
  The LeadMinds CSV "Sales POC" column stays as free text in `meeting_notes` (not a
  structured field). "Brought by" (`origin_owner_id`) remains the separate originator.
- `seed-accounts.js` — BDA-owner fallback for an unrecognised "Account manager" is now
  **Paras Gulati → Biswajit Dey** (was Chahak); added `paras`/`biswajit` manager aliases.

### 2. `clients-without-requirements` report

- Columns: Client · Stage · **Brought by** (`origin_owner`) · **Sales POC** (`owner`,
  renamed from "BDA owner") · Created · Days idle. The old always-empty "Sales owner"
  column is gone.
- Filters: **Brought by** (`origin_owner_id`) and **Sales POC** (`bda_id` = `owner_id`),
  both by person name from the active-user roster. **Department filter removed** from both
  coverage reports (`coverageSchema` drops `department_id`, adds `origin_owner_id`;
  `recruiterVendorGaps` no longer takes `department_id`).
- **Superadmin inline edit**: on the Reports page a superadmin gets a person `<select>` in
  the "Brought by" and "Sales POC" cells — changing it `PATCH`es the account
  (`origin_owner_id` / `owner_id`) and refreshes the report (`ReportsPage.CoveragePersonCell`
  + `saveCoverageField`).

### 3. Interview stage stays manual

- `interview_scheduled → interview_result` is **no longer auto-advanced** when all interview
  rounds are resolved. Removed the auto-advance from `addInterviewRound` and
  `updateInterviewRound` (`submissions.service.js`). The only remaining round side-effect is
  `submitted_to_client → interview_scheduled` when the first round is created. Moving to
  `interview_result` now always requires `POST /submissions/:id/stage`.
- Tests updated in `submissions-stage.test.js`; API-Spec doc notes updated.

## 2026-09-01 — Superadmin tier (`admin@delphic.in`)

Uncommitted work on `main` (local). One migration added (`20260901131738_add_is_superadmin`).
`cd server && npm test` → **28 suites / 177 tests green**; client `vite build` green.

### Model

- New `User.is_superadmin Boolean @default(false)` (`schema.prisma` + migration, which also
  backfills `is_superadmin = true WHERE email = 'admin@delphic.in'`). A superadmin keeps
  `role: 'admin'` — every existing `authorize('admin')` gate is unchanged; the flag only
  *adds* powers. Seeds set it: `team-roster.js` (Admin entry), `seed.js` `seedUsers`,
  `seed-admin.js` (first bootstrap admin).

### Server authz — never trusts the JWT

- `middleware/auth.js` gains `authorizeSuperadmin` (hard 403 gate) and `loadSuperadminFlag`
  (non-failing) — both re-read `is_superadmin && active` from the DB every request, so a
  demoted superadmin loses access immediately. `lockCheck` now lets a superadmin through
  (`row.is_locked && !req.user?.is_superadmin`) — only effective where `loadSuperadminFlag`
  ran first (accounts PATCH).

### Users — full edit, update-only (no delete)

- `PATCH /users/:id` (`authorize('admin')` + `loadSuperadminFlag`): `updateSchema` gains
  `password?` and `is_superadmin?`. Service guards (`update(id, patch, actor)`): only a
  superadmin may set `is_superadmin`, set another user's `password`, or edit a user who is
  already a superadmin; the last active superadmin can't be demoted / deactivated
  (`countActiveSuperadmins() <= 1` → 409 `last_superadmin`). Password is bcrypt-hashed
  (cost 10) into `password_hash`. New `GET /users/:id`. `PUBLIC_SELECT` now returns
  `is_superadmin` (flows to `/users/me` and `login`).

### Accounts — brought-by + free-form stage override (accounts only)

- `PATCH /accounts/:id` honours `origin_owner_id` ("Brought by") **only** for a superadmin
  (validated active user); silently stripped otherwise. Superadmin also bypasses the lock
  on this route (middleware order: `loadSuperadminFlag` → `lockCheck`).
- New `POST /accounts/:id/stage/override` (`authorizeSuperadmin`) → `changeStageOverride`:
  any target stage incl. `lead` / backward, ignores `canTransition` / ownership / lock /
  meeting-field rules, `reason` required, optional `is_locked` toggle, still writes a
  `stage_history` row with a `[override]`-prefixed reason.

### Frontend

- `permissions.js` — new `userCan(user, cap)` (superadmin passes everything; new
  superadmin-only caps `editBroughtBy` / `overrideStage` / `editAnyUser`).
  `usePermissions` exposes `isSuperadmin` and routes through `userCan`; `<Can>` too.
  `authContext` exposes `isSuperadmin`.
- `UsersPage` — new `EditUserDrawer` (name / email / role / dept / phone / active, plus
  superadmin-only superadmin-toggle + password reset) behind an **Edit** button shown only
  to a superadmin; `· super` badge on the Role column.
- `AccountFormPage` — superadmin-only "Brought by (origin owner)" `SearchableSelect`;
  superadmin can open the edit form on a locked account.
- `AccountDetailPage` + new `AccountStageOverrideDrawer` — superadmin-only **Override
  stage** button (all five stages, reason required, keep-locked checkbox).
- New tests: `superadmin-users.test.js`, `superadmin-accounts.test.js`;
  `helpers.createUser` takes `is_superadmin`.

### Not done / notes

- Delete routes were explicitly out of scope — update only.
- A newly promoted superadmin must reload / re-login before the SPA shows the extra UI
  (flag is read at mount via `/users/me`).
- `client/scripts/check-permissions.mjs` still fails on a pre-existing `bda`/`viewReports`
  assertion — unrelated to this change.

## 2026-09-01 — Drop `lead_generated_date`; lead board now shows unclassified leads

Uncommitted work on `main` (local). Two migrations added.

### 1. Removed `Account.lead_generated_date`

- Lead "generated" date is now just `created_at` (the row's creation date). Dropped the column + its index (`schema.prisma`, migration `20260901125143_drop_lead_generated_date`), the zod field (`accounts.validation.js`), the form input + request-body/formFromAccount mapping (`AccountFormPage.jsx`), the "Lead generated" detail row (`AccountDetailPage.jsx` — "Created" row already shows it), and the test payload key.
- `reports.service.js` `avg_days_lead_to_meeting` now measures `created_at → meeting_date`.
- Also applied migration `20260901120000_account_origin_owner` to the freshly-restored local DB (dump predated it → `origin_owner_id` missing).

### 2. Lead pipeline board hid every account in the `lead` stage

- `LeadPipelineBoard` hard-filtered `type: 'client'`, but an unclassified lead sits at `type IS NULL` (v2 nullable type). Result: LEAD / early columns always empty on the board even when such accounts existed.
- `GET /accounts` gains `include_unclassified=true` (only meaningful with `type=client`) → matches `type = 'client' OR type IS NULL`. `accounts.service.list` rebuilt around an `AND` array so the type-scope OR and the search OR no longer clobber each other in the object literal. `LeadPipelineBoard` passes the new flag.
- Verified headless (admin): LEAD/MEETING SCHEDULED columns now populate; `accounts-stage` (10) + `pipeline-board` (14) suites green.

## 2026-09-01 — Vendor name on pipeline cards + candidate-stage filter fix + coverage-gap reports

Uncommitted work on `main` (local). No schema/migration changes. `cd server && npm test` → **26 suites / 163 tests green**; client `vite build` + `reportViews.test.mjs` + `usePipelineFilters.test.mjs` green.

### 1. Vendor name on candidate cards

- `GET /pipeline/board` and `GET /submissions` now select `profile.vendor_account { id, name }` (`pipeline.service.js` submission include; `submissions.service.js` `INCLUDE.profile.select` — flows through the existing pass-through serializers).
- Requirement-map `CandidateCard` and candidate-pipeline `CandidateCard` show a `via <Vendor>` line when `profile.source === 'vendor'`.

### 2. Pipeline filter fixes (`pipeline.service.js` + client filter helpers)

- **Candidate-stage bug:** `submission_stage` was applied only to the submissions query, so requirements with zero matching candidates still rendered. Now, when a stage is selected, requirements are filtered to those with ≥1 candidate in that stage.
- **"Stuck" de-duped:** removed `stuck_only` from the pipeline entirely (checkbox + `usePipelineFilters` key + `pipeline.validation` + service). The `stuck` tri-state (`all`/`stuck`/`not_stuck`) is the single control. Reports-explorer `stuck_only` is a separate feature, untouched.
- **Search** on the board now also matches candidate/profile name (added an `OR` branch through `seats.some.submissions.some.profile.name`).
- **Date-range filter wired up:** server already applied `date_from`/`date_to` to `requirement.created_at`; added a compact "Created" date-range control (`PipelineFilters`, gated by the new `date_range` field) and put it on the requirement matrix.
- **Candidate board multi-stage:** `CandidatePipelineBoard` now forwards all selected stages as CSV; `GET /submissions` `list()` parses `stage` as a CSV → `{ stage: { in: [...] } }`.

### 3. New coverage-gap report tabs (`/api/v1/reports/*`, separate tabs)

- **`clients-without-requirements`** (`admin` / `sales` / `bda`, BDA self-scoped) — client accounts with `requirements: { none: {} }`; columns Client / Stage / BDA owner / Brought by / Sales owner (null by definition — kept to show the BDA→sales handoff gap) / Created / Days idle.
- **`recruiter-vendor-gaps`** (`admin` / `recruiter`, recruiter self-scoped) — `(recruiter, vendor)` pairs from `Profile.added_by` + `Profile.vendor_account_id` where the recruiter sourced ≥1 profile from the vendor but none was ever submitted.
- New shared `coverageSchema` (`department_id` + `bda_id` + `recruiter_id`, no date range). Both wired into `reports.routes.js` (`REPORTS` map + GET routes + `/export` branch), `reportViews.js` (`ALL_REPORTS`, columns, rows id, bar chart), and `ReportsPage.jsx` (`isCoverage` → no date presets; individual picker maps to `bda_id` / `recruiter_id` for admins).
- Tests: `server/tests/reports-coverage-gaps.test.js` (shape, self-scoping, 403 gates, xlsx export); pipeline-board tests updated for the stage filter, candidate-name search, vendor-account exposure, and `stuck` rename.

## 2026-09-01 — Admin-editable account type + dashboard KPI fixes/split + app-wide searchable dropdowns

Uncommitted work on `main` (local). No schema/migration changes in this entry. Client `vite build` green.

### 1. Account `type` is now editable (admin-only re-classification)

Previously `type` was write-once via `POST /accounts/:id/classify` (one-way, `already_classified` guard) and hard-disabled on the edit form. Now an **admin** can switch an already-typed account between `client` / `vendor` from `AccountFormPage`:

- `updateSchema` accepts `type: z.enum(['client','vendor']).optional()` (`accounts.validation.js`).
- `accounts.service.update`: a real `type` change is **admin-only** (`forbidden_type_change` otherwise) and refreshes `classified_at` / `classified_by`; a no-op `type` is stripped from the patch.
- `accounts.controller.js` maps `forbidden_type_change → 403`.
- `AccountFormPage`: `canEditType = isEditing && role === 'admin'`; the type `<select>` is `disabled={isEditing && !canEditType}`, `buildAccountBody` sends `type` on create **or** admin edit, plus an "Admin only · re-classifies" hint. Switching back to undecided/lead is intentionally not supported (enum has no empty member); non-admins still can't touch it. The one-way `/classify` flow for undecided leads is unchanged.

### 2. Home dashboard KPI corrections + client/vendor split + 4-col grid

Backend `dashboard.service.js` (`summaryForAdmin` + `summaryForBda`):

- **`leads_active` bug fixed** — was `count({ type: 'client', stage: 'lead' })`, which silently dropped every unclassified lead (type is `null` until classified, independent of stage) and every vendor-classified lead. Now `count({ stage: 'lead' })` across all types. The card count now also matches its `/accounts?stage=lead` drill-through.
- **`leads_in_meeting`** now `stage IN ('meeting_scheduled','rescheduled')` (was `meeting_scheduled` only) — matches the card copy and how `stuckLeads` treats rescheduled.
- `clients_active` / `vendors_active` unchanged (already correct: `type` + `stage: 'active'`).

Frontend `dashboardWidgets.js` + `DashboardPage.jsx`:

- KPI grid `xl:grid-cols-6` → **`xl:grid-cols-4`** (real grid + skeleton; skeleton bumped to 8 tiles).
- **Admin KPI set is now 10 tiles** (4 + 4 + 2): Active leads · Open requirements · **In progress** *(new — splits `requirements_in_progress`, previously returned but never rendered for admins)* · Active submissions // Interviews this week · Closures this month · Active clients · **Active vendors** *(new — `vendors_active` was returned but never shown for admins)* // **Stuck leads** · **Stuck requirements** *(new dedicated cards, red theme, `AlertTriangle`; the redundant "N stuck 7d+" hint badge dropped from Active leads / Open requirements — bottom stuck panels stay)*.
- New `KPI_LINKS`: `stuckLeads → /accounts?stage=lead` (accounts list has no stuck filter), `stuckRequirements → /requirements?stuck=stuck`.
- Lead-tile descriptions reworded (no longer claim "client accounts").
- BDA/Sales/Recruiter tile sets unchanged; they wrap fine in the 4-col grid.

### 3. App-wide searchable dropdowns

New **`client/src/components/ui/SearchableSelect.jsx`** — hand-rolled single-select combobox (no new dependency), styled to match `MultiSelectDropdown`: type-to-filter on `label` + `hint`, ↑/↓/Enter/Esc keyboard nav, click-outside close, `disabled` / `required` (native form validation kept via a 1px opacity-0 focusable mirror input) / `allowClear` / `ariaLabel` / `className` (width). API: `options={[{ value, label, hint?, disabled? }]}`, `onChange(value)` (raw value, not an event).

Scope agreed with the user: **convert data-driven or 6-plus-option selects; leave small fixed enums native.** 25 selects across 12 files converted:

| File | Converted |
|---|---|
| `RequirementFormPage` | client account, sales owner, budget currency |
| `AccountFormPage` | owner, billing currency, vendor rate currency |
| `ProfileFormPage` | vendor account |
| `SubmissionCreatePage` | candidate, job requirement, seat |
| `InterviewRoundsPanel` | round type |
| `AssignRecruiterDrawer` | recruiter |
| `UsersPage` | department |
| `components/ui/FilterBar` | individual, department |
| `pipeline/PipelineFilters` | client, BDA, sales, recruiter |
| `AccountsListPage` | stage filter |
| `SubmissionsListPage` | stage filter |
| `RequirementsListPage` | status filter |
| `reports/ReportsPage` | report type, explorer status |

Filter dropdowns got `allowClear` to return to "All". **Left native** (fixed enums < ~6 options): gender, work mode, engagement type, req type, priority, company size, 4-option currency pickers, rate types, BGV status, interview result, meeting mode, stage/status **transition** pickers (`AccountStageMoveDrawer`, `JobPipelineBoard`, `CandidatePipelineBoard`), closure group-by, `stuck` tri-state, profile source. `SubmissionDetailPage` untouched (all seven selects are 3–4-option enums).

## 2026-09-01 — Editable account owner + immutable "brought by" + relaxed API rate limit

Uncommitted work on `main` (local). **Includes a Prisma migration — see deploy note below.**

- **Account owner (POC from our end) is now editable** from the edit-account form (`AccountFormPage`) by **anyone who can edit the account** (admin, or the owning BDA) — not admin-only. New `owner_id` on `updateSchema`; `accounts.service.update` only checks the target is an **active user of any role** (`user_not_found`); no role/admin gate on the reassignment itself. The owner select is **required** (no "Unassigned") and lists every active user. `GET /users` list opened to `bda` too (unclamped) so the roster loads for them.
- **New `Account.origin_owner_id`** — immutable "brought by" the BDA/admin who first added the client/vendor. Set once in `create()` (= first owner), never updated; `owner_id` can be reassigned freely without losing acquisition credit. Nullable column + FK + index; migration backfills `origin_owner_id = owner_id` for all existing rows.
- **Surfaced** on account detail (header + "Brought by" field), list (Owner column shows "via <origin>" when reassigned; peek drawer "Brought by"), and edit form hint.
- **`bda-performance` report**: "brought"/funnel metrics (`leads_created`, meeting, converted, dropped, vendors_created, unclassified, via_linkedin, avg_days_lead_to_meeting) now credit `origin_owner_id`; `*_current` snapshots still credit `owner_id` (present POC).
- **Rate limit relaxed** (`server/src/app.js`): general `apiLimiter` now skips GET/HEAD/OPTIONS and allows 6000 writes/min/IP (was 1200 all-methods) so the request-dense dashboard behind a shared office IP stops hitting "Too many requests". `loginLimiter` raised 30 → 60/min.

### Deploy note — migration `20260901120000_account_origin_owner`

Additive and safe on populated data (nullable ADD COLUMN + backfill UPDATE + FK + index; no drops, no rewrite-locking default). On the VPS the `server` container runs `prisma migrate deploy` on startup, so `./start-delphic.sh --prod` applies it automatically. **Before deploying:** `pg_dump` backup. **After:** verify `SELECT count(*) FROM accounts WHERE origin_owner_id IS NULL;` returns `0`. Rollback (only if needed, and no new accounts created since): `ALTER TABLE accounts DROP COLUMN origin_owner_id;` then delete the migration row from `_prisma_migrations`.

Uncommitted work on `main` (local).

- **Seed chain:** `seed` (team only) → `seed:accounts` (LeadMinds clients) → `seed:jira` (34 reqs) → `seed:vendors` (optional). Fake Acme/Stuck Lead demo data removed from base seed.
- **`client-aliases.js`:** GirnarSoft + Girnarsoft_Pragya → Girnarsoft; Devlabs → Devlabsalliance; other Jira short names map to LeadMinds display names.
- **`seed-jira`:** full Jira `Description` → `job_description`; sales owner prefers `sales` role (Tanvi) so assign UI works; recruiter assignments from Multi-Assignee + comment mentions.
- **Requirements list:** Previous/Next pagination (20/page) — pipeline still loads all rows.
- **Assign recruiters:** ownership-aware UI messaging; Assign button on requirement detail.
- Docs: `AGENTS.md`, `guides/PRODUCTION-SEED.md`, `testing/TESTING-DEMO-SEED.md` updated for the new seed order.

## 2026-08-31 — Vendor accounts seeded from the vendor tracker sheet

Uncommitted work on `main` (local). `server/prisma/seed-vendors.js` is untracked.

- New `server/prisma/seed-vendors.js` + `npm run seed:vendors` (root + server). Inline data array of the **32 vendors whose sheet Status is "Active"** (Hold / In Budget rows excluded, per instruction). Idempotent: wipes `source: 'vendor_csv'` accounts then recreates.
- Each row → `Account { type: 'vendor', stage: 'active', source: 'vendor_csv' }`. POC initials map to the internal owner (`garv`→Garv, `krupali`→Krupali Vala, `prashant`→Prashant Singh Hada; blank → admin). Sheet fields: email → `poc_email`, location → `location`, Technologies → `vendor_specializations[]`, the free-text "Budget" column → `meeting_notes`.
- Seeded locally: 32 vendor accounts (owners: Garv 10, Prashant 10, Krupali 8, Admin 4). Total accounts now 43 (11 client + 32 vendor).

## 2026-08-31 — Stuck requirements: visible by default + tri-state filter, plus graceful token-expiry handling

Uncommitted work on `main` (local).

- **Requirements list (`GET /requirements`):** every row now carries `is_stuck` (active status `open`/`in_progress` **and** no movement for `STUCK_THRESHOLD_DAYS` = 7, using `created_at` as the movement proxy — same rule as the pipeline board). Stuck rows are **not hidden** — they list normally with a red "Stuck" pill on the Status cell and in the peek. New optional `stuck` query param: `stuck` (only stuck) / `not_stuck` (exclude stuck); absent = all. Implemented as a Prisma `AND` / `NOT` clause so pagination stays correct.
- **Requirements list page:** added a "Stuck: All / Stuck only / Not stuck" `<select>` next to Status/Priority, URL-synced via `?stuck=`.
- **Requirement × stage matrix board (`GET /pipeline/board`):** the old `stuck_only` checkbox is replaced (on this board only) by the same tri-state `stuck` selector. `stuck_only` still works server-side and on the other pipeline boards for backward compatibility. `usePipelineFilters` gains a `stuck` field (`'all'` default, omitted from the URL/params when `all`).
- **Token expiry (`client/src/lib/apiClient.js`):** the 401 refresh interceptor was surfacing "Invalid or expired access token" as a page error whenever there was no refresh token, or when parallel requests raced the refresh. Now: a single shared refresh promise de-dupes concurrent 401s; a missing/failed refresh token, or a 401 from `/auth/refresh` itself, clears the session and redirects to `/login` (guarded so it doesn't loop when already there).
- Tests: `requirements-stage.test.js` +2 (`is_stuck` truth table + `stuck` filter narrowing; closed-but-old requirement is never stuck). `usePipelineFilters.test.mjs` +1 block (tri-state round-trip, `all` omitted). Full server suite green (25 suites / 155 tests).

## 2026-08-31 — Admin can reassign a requirement's Sales owner

Uncommitted work on `main` (local).

- **Server:** `updateSchema` gains `sales_owner_id`; `requirements.service.update()` only lets an **admin** change it, and only to a `sales` / `bda` / `admin` user that is active (`forbidden_owner_change` → 403, `invalid_owner_role` → 400, reuses `user_not_found`). Non-owner-change PATCHes are unaffected.
- **Client:** `RequirementFormPage` shows a "Sales owner" dropdown when editing **and** the current user is admin — options are active sales/bda/admin users, plus the current owner pinned if they fall outside that set.
- **BDA stays account-level only** (per decision) — no per-requirement BDA field. Recruiter assignment left strict (recruiters only); the existing "Assign recruiters" drawer already covers add/remove.
- Tests: `requirements-stage.test.js` +2 (admin reassigns owner / non-admin blocked / recruiter rejected).

## 2026-08-31 — Jira import repointed to full export (`Jira_all.csv`)

Uncommitted work on `main` (local). Seed helper files are still untracked.

- `docs/jira/Jira_all.csv` — full Jira export (142 cols, 34 `Requirement` rows, project OUT). Replaces the older 39-row `docs/jira/Jira.csv` as the import source. The 8 requirements that existed only in the old file (OUT-22313/22311/22308/22307/22301/22300/22292/22239) are intentionally dropped; 3 new ones added (OUT-22320/22319/22318).
- `server/prisma/seed-jira.js` rewritten to parse **by header name** (old version was positional and assumed the old layout + `Comments` header; new export uses a different column order and a singular `Comment` header). Now also imports: `Number of Positions` → `seats_total` + N seats, `Requirement Type` (C2C/C2H → `contract`, Perm → `full_time`), `Budget` ("1.8 LPM" → monthly INR ₹180000, "1000/hr" → hourly, ranges → min/max, "0" → none), `Priority` "Highest" → `urgent`. Reporter now owns the requirement regardless of role (was sales-only), so Chahak (bda) and Diksha (admin) own their own rows.
- `server/prisma/team-roster.js` — added **Biswajit Dey** (`biswajit.dey@delphic.in`, role `admin`; creator of OUT-22317) and renamed `Prashant Hada` → `Prashant Singh Hada` to match the Jira display name. All 8 Jira comment-author IDs (incl. Biswajit's creator id) map to roster users.
- Seeded: 13 users, 11 client accounts, 34 requirements, 41 seats, 213 comments, 89 recruiter assignments (8 via comment-mention regex for dheeraj/krupali/nikhil). Owners: Tanvi 23, Chahak 9, Diksha 2.

## 2026-08-29 — Closure progress rings + requirement × stage matrix board + form field wiring

Uncommitted work on `main` (local). Complements the role pipeline boards and V2 lead work.

**Closure probability** (`server/src/utils/closureProgress.js`):
- `computeClosureProgress(stage, interviewRounds)` — percent whose denominator grows with interview rounds (min 2); interview phase fills as rounds resolve; `rejected`/`backout` → `null`.
- `describeClosureSteps` / `computeClosureDetail` — step list for UI breakdown.
- Serialized on submissions (`progress`) and on profiles (best active-submission progress).
- UI: `ProgressRing`, `ClosureStepsBreakdown` on submission detail / list / candidate surfaces and matrix cards.

**Requirement map board** (`GET /api/v1/pipeline/board`):
- New `server/src/modules/pipeline/` (routes + service + validation). Role-scoped requirements + their submissions with progress; admin/sales/recruiter only.
- Frontend: `RequirementMatrixBoard` under `/pipeline?view=matrix` (“Requirement map”); capability `viewRequirementMatrix` for admin/sales/recruiter (not BDA).
- Tests: `closure-progress.test.js`, `pipeline-board.test.js`.

**Form / validation wiring** (schema fields that existed but were missing from create/edit UIs):
- Accounts: `client_agreement_url` / `vendor_agreement_url`; stage move accepts `meeting_notes`.
- Profiles: DOB, gender, relocate, preferred locations, relevant exp, certifications, domain, current CTC, notice/serving notice, etc.
- Requirements: certifications required, time zone, contract duration, billing notes, notice-period max.

**Docs:** this entry; TODO resume point; API-Spec §13 pipeline board + `progress` on Submission/Profile; AGENTS + ARCHITECTURE-OVERVIEW capability notes.

**Verification (2026-08-29):** `cd server && npm test` — **23 suites / 135 tests**, all green (includes new `closure-progress` + `pipeline-board`).

## 2026-08-27 — Internal round interviewer multiselect + alert banners

Commit `7ba5c90` (cherry-picked onto main with matrix/closure). Internal interview rounds (`internal_r1` / `internal_r2`) can assign one or more active users via `interview_round_interviewers`; UI uses searchable `MultiSelectDropdown`. Client rounds keep free-text interviewer name/email. App-wide dismissable alert banners (`AlertBannerStack` + `useAlerts`) and shared form validation helpers replace many inline error divs.

## 2026-08-27 — Dashboard KPI cards drill into their filtered list view

Commit `c76d0af` on `feature/v2-lead-pipeline-requirements` (follows the V2 entry below; `676db9d` + `e06b359` committed the V2 work and a CI Prisma-generate fix in between).

**What:** every KPI card on the role dashboard is now a link into the matching list page, pre-filtered to exactly what the card counts — click "Active clients" → `/accounts?stage=active&type=client`, "Open requirements" → `/requirements?status=open`, "Closures this month" → `/submissions?stage=closed`, etc. Full map in `KPI_LINKS` (`client/src/pages/dashboard/dashboardWidgets.js`), one entry per KPI across all four roles (admin / bda / sales / recruiter).

- **`KpiCard.jsx`** — new optional `to` prop; when set the card's root element becomes a react-router `Link` (plain `div` otherwise), with a subtle hover shadow (`cardHover`, added to `client/tailwind.config.js`) and a focus ring so linked cards read as interactive. No visual change for cards without a link.
- **List pages now honour their filter query params on mount** so the drill-through actually lands filtered: `RequirementsListPage` now reads `?status=` / `?priority=` (previously ignored — status/priority were local state only), `AccountsListPage` now reads `?type=` (it already read `?stage=`), and both re-sync when the query string changes. `SubmissionsListPage` already honoured `?stage=`. (These three list-page edits landed folded into `676db9d`.)
- **Semantics note:** "Interviews this week" links to `/submissions?stage=interview_scheduled` (closest available filter — not week-scoped) and "Active submissions" links to the unfiltered `/submissions` table (no single "active" stage value exists).

**Verify:** `npm run build --workspace client` — succeeds (3145 modules). `npx eslint` on the five changed files — clean.

## 2026-08-27 — V2: lead capture, candidate pipeline round taxonomy, requirement types, candidate bench flag, client-performance report

Full design + rationale: [V2-LEAD-PIPELINE-REQUIREMENTS.md](../architecture/V2-LEAD-PIPELINE-REQUIREMENTS.md). Done on local branch `feature/v2-lead-pipeline-requirements`, not yet merged/pushed.

**Schema + migration** (`server/prisma/schema.prisma`, two migrations `20260827115000_v2_add_enum_values` + `20260827120000_v2_lead_pipeline_requirements`, applied to local dev + test DBs):
- `Account.type` is now nullable (a lead can exist before BDA decides client/vendor); added `lead_generated_date`, `location`, `linkedin_url`, `meeting_location`, `classified_at`, `classified_by`.
- New `AccountMeetingAttendee` join table — multiple Sales users can be tagged to a meeting.
- `ProfileSource`: `internal`→`direct` (`linkedin` stays separate).
- `Profile.on_bench` — flags a candidate as currently available for a new submission.
- `RoundType`: `internal|client_l1|client_l2|client_hr|client_final` → `internal_r1|internal_r2|client_r1|client_r2|client_r3|hr_cto_ceo` (old `client_hr`+`client_final` both collapse into the combined `hr_cto_ceo` round).
- `SubmissionStage`: `offer`→`offer_sent`.
- `ReqType`: `project|developer` → `managed_services|recruitment|project`.

**Backend:** new `POST /accounts/:id/classify` (one-way, logged to `StageHistory`); offline meetings require `meeting_location`; `canManageInterviewRound()` lets Sales log client-facing rounds (client_r1-3, hr_cto_ceo) on requirements they own, alongside the submission's recruiter; soft `missing_mandatory_rounds` warning (internal_r1, hr_cto_ceo) serialized on submissions — existing hard gates (unresolved rounds block `offer_sent`, uncleared BGV blocks `closed`) are unchanged; `on_bench` filter on `GET /profiles`. New report `GET /reports/client-performance` mirrors `vendor-performance`, anchored on `Account.type='client'`. Extended `recruiter-performance` (`rounds_missing_mandatory_count`), `sales-performance` (`submissions_missing_hr_cto_ceo_round`), `bda-performance` (`leads_unclassified`, `leads_via_linkedin`, `avg_days_lead_to_meeting`), `vendor-performance` (offer_sent rename).

**Frontend:** lead create form allows an unset type + new lead fields; account detail page gets a "Classify lead" action and meeting-attendee chips; stage-move drawer adds `meeting_location` (required when offline) and a Sales attendee picker; `InterviewRoundsPanel` reworked for the 6 new round types with per-role add/edit gating and a missing-mandatory-rounds banner; candidate list/form get an on-bench toggle + filter, and the submission candidate-picker gets an on-bench quick filter; requirement form's type dropdown is now Managed Services/Recruitment/Project; reports page adds the Client performance report and new columns on BDA/recruiter/sales performance.

**Seed data:** fully remapped to the new enums; added 2 unclassified leads, meeting attendees on 2 accounts, 2 bench-flagged candidates, 1 managed-services requirement, extra `internal_r2`/`client_r3` interview rounds.

**Tests:** `cd server && npm test` — **21 suites / 117 tests**, all green (added `interview-rounds-scope.test.js`, `profiles-bench.test.js`, extended `accounts-stage.test.js` and `reports-ui.test.js`). `npm run lint` — 0 errors. `npm run build --workspace client` — succeeds (3145 modules).

**Not done yet:** nothing outstanding on scope — docs are the last item and this entry covers them. Still uncommitted (local branch only); merge/push/deploy pending user go-ahead.

## 2026-08-26 — Entity access guards, VM deploy scripts, fail-closed env guard

Same commit as the pipeline-board entries below (`a824240`), landing the backend/infra half of that work — not previously logged here.

**Server — centralised entity access checks** (`server/src/lib/entityAccess.js`): `assertCanAccessEntity(user, entityType, entityId)` mirrors each entity's existing getOne ownership rule (BDA→own accounts, sales→own requirements or assigned recruiter, recruiter→own submissions, profiles open to all) and is now the single gate used by the `documents`, `comments`, and history sub-routes instead of ad hoc checks per module. `submissions.controller`/`.service` also tightened to the same recruiter-scoping used by `GET /submissions`. New tests: `entity-access.test.js`, `history-access.test.js`, `uploads-auth.test.js`.

**Fail-closed env guard** (`server/src/config/env.js`): `assertProductionConfig()` now throws at boot under `NODE_ENV=production` if `DATABASE_URL`/`CORS_ORIGIN` are unset or `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` are missing, under 32 chars, or match a known placeholder/dev value — a prod boot can no longer silently run on dev secrets. Test: `env.guard.test.js`.

**`server/prisma/seed-admin.js`** — production-safe alternative to the destructive demo `seed.js`: creates one admin user from `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NAME` env vars, no-ops if an admin already exists, never truncates tables.

**VM deploy tooling** (previously only `ecosystem.config.js` + `nginx.conf.example`, now removed/rewritten): `setup-vm.sh` (idempotent Ubuntu/EC2 bootstrap — Docker, Compose v2, nginx, certbot) and `start-delphic.sh` (`--prod` runs `docker-compose.yml` + new `docker-compose.prod.yml` overlay with loopback binds; validates `.env` has no placeholder/short secrets before starting; `--service`/`--no-boot` for systemd; installs a `delphic.service` unit). Deploy workflow (`.github/workflows/deploy.yml`) now SSHs to the VPS and runs `./start-delphic.sh --prod` instead of targeting the old bare PM2 layout. `docs/AGENTS.md` deploy line updated to match. `.gitattributes` added (LF-only for `*.sh`/compose files, so scripts don't break with CRLF from a Windows checkout).

RD-121 (deploy story) is effectively delivered by this; RD-122 (deploy day) is still open pending `DEPLOY_ENABLED` + VPS secrets being set for real.

## 2026-08-25 — Dashboard filter polish + list spacing tightened

Client-only visual pass (`07e461e`, not previously logged): `AppLayout`, `FilterBar`, `DataTable`, `ListToolbar`, `KpiCard`, `Badge`, `ChartCard`, `IconButton`, `Tooltip` restyled; new `ExportIcons.jsx`; `dashboardWidgets.js` gained more widget config; denser rows across Accounts/Requirements/Submissions/Profiles list pages and the dashboard.

## 2026-08-24 — CSS pass + Delphic logo

Client-only visual pass (`0ca73e4`, not previously logged): `client/public/delphic-logo.png` added and wired into `AppLayout`; `ChartCard`/`KpiCard` and `AccountDetailPage`/`DashboardPage` layout tweaks.

## 2026-08-26 — Pipeline DnD + card actions menu on every board

All pipeline boards now support drag-and-drop between columns, and stage/status moves live in a ⋯ dropdown on each card (no more “Move stage” / → button rows).

- Shared: `CardActionsMenu`, `pipelineDnd.jsx` (DroppableColumn / DraggableCard / sensors).
- Boards: Lead, Job, Candidate, Requirement kanban, Account matrix.
- Transitions that need a reason/meeting form still open the existing drawers (pre-filled target stage when dropped/selected).

## 2026-08-26 — Role-specific pipelines (BDA leads / Sales jobs / Recruiter candidates)

`/pipeline` is no longer a single account picker for everyone. `PipelineShell` picks a role board; admin can switch via `?view=lead|jobs|candidates`.

- **BDA:** Lead pipeline — accounts as cards in account-stage columns; move stage via existing drawer; drill into `/pipeline/:accountId`.
- **Sales:** Job pipeline — requirements as cards in status columns; expand for submission previews; status moves via `POST /requirements/:id/status`.
- **Recruiter:** Candidate pipeline — own submissions as cards in submission-stage columns.
- **Admin:** Switcher across all three.
- **Backend:** `GET /submissions` (and getOne) auto-scopes recruiters to `submitted_by = self`.
- Dashboard pipeline CTA now always goes to `/pipeline`.
- Capabilities: `viewLeadPipeline` / `viewJobPipeline` / `viewCandidatePipeline`.
- Tests: `pipelineBoardUtils.test.mjs`, `permissions.pipeline.test.mjs`, `submissions-recruiter-scope.test.js`.

## 2026-08-26 — BDA account create/edit/stage gaps + matching list forms

BDA (and admin) create-account from the Accounts list used a stripped mini-form (type/name/industry/POC only), so client/vendor commercial fields and contacts were missing. Peek also called `canMutateAccount(user)` with the wrong arity, so Edit never appeared, and there was no Move stage from the list.

**Fixes:**
- Accounts list create now mounts full `AccountFormPage` (company, contacts, client/vendor commercial).
- Peek: correct `canMutateAccount(account, user)`; actions Open details / Edit / Move stage.
- Shared `AccountStageMoveDrawer` used from list peek, account detail, and pipeline board.
- Same stripped-create pattern on Requirements list → full `RequirementFormPage`.
- Regression test: `client/src/pages/accounts/accountUtils.test.mjs`.

## 2026-08-21 — UX audit pass: all-drawer forms, tooltips, skill picker, richer seed, pipeline visibility, report accuracy

Full audit (API↔frontend mapping, dead UI, modal/drawer compliance, seed/pipeline/reports) followed by a fix pass across client and server. Verified end-to-end via `npm run lint` (0 errors), `npm run build`, and a live Docker stack re-seed + login/report checks through the client proxy.

**All forms/confirmations now RHS drawers, never modal or full page:**
- Account, Requirement, and Profile edit now open in an RHS drawer from their detail pages (`?edit=1` query param), matching how create already worked. Old `/:id/edit` routes redirect via a shared `EditRedirect` helper in `App.jsx`.
- Converted the last `components/ui/Modal.jsx` usages to `Drawer`: `ChangePasswordModal.jsx` → `ChangePasswordDrawer.jsx`, and the three modals on `RequirementDetailPage.jsx` (status change, seat stage, add seat).
- Converted two hand-rolled centered dialogs (`fixed inset-0` divs, not even using `Modal.jsx`) to `Drawer`: `AccountDetailPage.jsx`'s stage-move dialog and `UnlockButton.jsx`.
- Renamed `AssignRecruiterModal.jsx` → `AssignRecruiterDrawer.jsx` (it already rendered a Drawer; filename-only fix).
- New admin-only Departments create/edit drawer on `/users`, wiring up the previously-unused `POST/PATCH /departments` endpoints.
- Deleted the dead, unused `GET /submissions/:id/interview-rounds` route/controller/service method.
- Fixed `ReportsPage.jsx`'s export download to go through `apiClient` (blob response) instead of a raw `fetch`, so it gets the shared 401/refresh-token handling.

**New: searchable skill/tech-stack picker** — `components/ui/SkillPicker.jsx` + `lib/skillsCatalog.js` (~150 curated entries with category icons from `lucide-react`, no new dependency). Replaces the old free-text CSV inputs on Candidate (`primary_skills`/`secondary_skills`) and Requirement (`primary_tech_stack`/`secondary_tech_stack`) forms; always allows adding a custom/unlisted skill since the backend stores plain string arrays.

**New: hover tooltips** — `components/ui/Tooltip.jsx`. Applied to dashboard KPI cards (each now explains exactly what it counts and its scope), report KPI columns via renamed fields (see below), stage-change buttons on Requirement/Submission detail pages (flags which transitions require a reason/date), and `UnlockButton`.

**Pipeline visibility:** BDA's dashboard funnel was always empty (it showed the submission funnel, which BDAs don't own) — added `accountFunnelFromRows` in `dashboard.service.js` so BDA now sees a real lead-stage funnel (lead → meeting_scheduled → active/dropped). Added a "View pipeline board" / "View all leads" CTA to the dashboard's pipeline section linking into Requirements/Accounts.

**Reports/KPI accuracy fixes** (`reports.service.js`, `dashboard.service.js`):
- Unified the stuck/aging threshold into one `server/src/config/constants.js` (`STUCK_THRESHOLD_DAYS`) instead of three separate hardcoded `7`s.
- `bdaPerformance`'s `clients_active`/`vendors_active`/`stuck_leads_7d` were all-time snapshots silently mixed into an otherwise period-scoped report row — renamed to `clients_active_current`/`vendors_active_current`/`stuck_leads_current` (and updated `reportViews.js` columns) so the snapshot semantics are explicit instead of implied.
- `salesPerformance.avg_closure_days` was anchored on requirement `created_at` falling in the date range (inconsistent with `periodClosures`, which anchors on the closure event) — now anchored on `closed_at` falling in range, matching. Caught and fixed a bug in this same change during testing: the first version didn't filter `status: 'closed'`, so dropped requirements (which also stamp `closed_at`) were pulled into the average — verified via a real seeded example (61 days → 32 days after the fix).
- Unified "interviews this week" anchor logic (`completed_at` if set, else `scheduled_at`) across all three dashboard summary functions and `reports.summarizeInterviewRounds`, via a shared `interviewsInRangeWhere()` helper — previously the dashboard only looked at `scheduled_at`, so a completed interview could disappear from the dashboard count while still showing in the equivalent report.

**Seed data enrichment** (`server/prisma/seed.js`): 5→8 users (2nd sales/BDA/admin, real activity for recruiter #2), added `dropped`/`rescheduled` account examples and `on_hold`/`dropped` requirement examples, 5→10 profiles, submissions now cover every `SubmissionStage` (added `interview_result`/`bgv`/`backout`/`rejected`), full per-transition `StageHistory` rows instead of one snapshot per record, 0→6 `Document` rows (resumes, agreements, job docs — model existed but was never seeded), wider date spread (up to ~250 days back) for month/quarter trend views, and interview rounds now include `no_show`/`rescheduled` results and a feedback/no-feedback mix.

**Loading states:** `DataTable.jsx`'s loading state now renders skeleton rows (covers every list page at once, since they all already pass `loading` through). Added `components/ui/DetailSkeleton.jsx` and wired it into Account/Requirement/Profile/Submission detail pages, replacing bare "Loading…" text.

**Docs:** seeded-user list in this file updated to include the 3 new demo accounts.

## 2026-08-21 — RD-133 UI redesign (drawers, pipeline KPIs, BDA/Sales reports)

**Ticket:** **RD-133** — marked **DONE (Aug 21)** in [SPRINT-PLAN.md](SPRINT-PLAN.md). Guide: [UI-REDESIGN.md](../ui/UI-REDESIGN.md). Commit: `0add970` on `dev-deep`.

**UX**

- Shared `DataTable` + `ListToolbar` on list pages; row click opens RHS peek drawer with actions (not full-page navigation).
- Create flows (candidate, put-forward, account, requirement, user) and assign/interview forms use narrow scrollable RHS `Drawer` with tone colors (`create` / `edit` / `danger` / `info`).
- Dashboard: real KPI numbers only; submission pipeline promoted and always visible to admin.
- Interview rounds: RHS drawer; **interview date & time required** on create (API Zod + UI).

**Reports**

- Added admin **BDA performance** (`GET /reports/bda-performance`) — lead funnel by account `owner_id`.
- **Sales performance** measures requirements/joinings/margin by `sales_owner_id` (no longer treats sales as lead owners).

**Docs:** [UI-REDESIGN.md](../ui/UI-REDESIGN.md), [TESTING-RD-114-128.md](../testing/TESTING-RD-114-128.md), [TESTING-RD-111-125-112.md](../testing/TESTING-RD-111-125-112.md), [AGENTS.md](../AGENTS.md), API spec report section.

## 2026-08-21 — Hide Profiles (and Reports) from BDA nav

BDA has no API access to `/profiles` (403 Insufficient role) but the sidebar still linked to Candidates and showed an empty error page. Nav now role-filters Profiles + Reports; profile routes redirect to home via `RoleRoute` + `canViewProfiles`.

## 2026-08-21 — Merged `origin/dev` into local `dev-deep` (no conflicts)

Merged RD-116 ESLint + RD-120 Docker compose CI smoke (`ef67c7d` / `d0feab9`) into `dev-deep` on top of the ChangePasswordModal import fix (`d247b82`). Merge commit `7c4606e`. No conflicts.

## 2026-08-21 — Docs reorganized by function

Moved markdown under `docs/` into folders and updated cross-links + [AGENTS.md](../AGENTS.md) index:

| Folder | Purpose |
|---|---|
| `architecture/` | Diagrams, HLD, field model, API spec |
| `ui/` | Jira UX + RD-115 walkthrough + `references/` |
| `testing/` | Demo seed + ticket test guides |
| `progress/` | PROGRESS, TODO, SPRINT-PLAN |
| `guides/` | Backend logging (and similar operator guides) |

`docs/AGENTS.md` stays at the docs root as the entry point.

## 2026-08-21 — Dev B RD-114 + RD-128 (reports UI + change password)

- **RD-114:** Reports page shows role-filtered reports, default month date range, Recharts bar charts, dense tables (not raw JSON), aging sections, closure group-by, Excel/PDF download. Export API writes multi-sheet Excel for aging and tabular PDF rows.
- **RD-128:** Header avatar menu → Change password modal (`POST /auth/change-password`) + Logout.

**Tests:** `reports-ui.test.js` + existing `auth.test.js` change-password. Guide: [TESTING-RD-114-128.md](../testing/TESTING-RD-114-128.md).

**Still open:** RD-119 E2E · RD-121 deploy story · RD-122 deploy day.

## 2026-08-21 — Dev A RD-116 + RD-120 (lint + Docker CI smoke)

- **RD-116:** Root ESLint 9 flat config (`eslint.config.mjs`) for `server/src` (Node/CJS) and `client/src` (React). Scripts: `npm run lint` / `npm run lint:fix`. Warnings allowed; errors fail CI.
- **RD-120:** `.github/workflows/ci.yml` now runs lint + client build + syntax check, plus a **docker-smoke** job: `docker compose up --build`, wait for `/api/v1/health`, seed, POST login on API `:4000` and via client proxy `:8081`.

**Verify locally:** `npm run lint` (0 errors). Docker smoke needs Docker Desktop running.

## 2026-08-21 — RD-110 / RD-127 / RD-115 completed after merge

Re-wired post-merge gaps on Dev B detail pages:

- **RD-110:** `NotesPanel` + `FilesPanel` on Job (`RequirementDetailPage`) and Submission (`SubmissionDetailPage`) — Account + Candidate already had them.
- **RD-127:** Admin `UnlockButton` on locked requirement header, locked seat rows, and locked submission header (Account already wired).
- **RD-115:** Spec walkthrough updated — Job form, put-forward, kanban, interview, Notes/Files/Unlock marked Present; RD-114/128 later completed on this branch.

## 2026-08-21 — Staging updated with merged Dev A + Dev B

Fast-forwarded `staging` to `4b0b61b` (same tip as `dev-deep`: `origin/dev` merge + status docs). Pushed to `origin/staging`.

## 2026-08-21 — Local `dev-deep` pulled from `dev` (no conflicts)

Fast-forwarded local `dev-deep` to `origin/dev` (`c01e99f`). No merge conflicts.

Brought in Dev A work already on `dev`: accounts (RD-101/102), profiles (RD-105), assign recruiter (RD-106), Notes/Files (RD-109/110), dashboard (RD-113), unlock (RD-127), RD-115 walkthrough, plus conflict-resolution commit from the main/dev merge.

**Branch tip after pull:** `c01e99f` (`origin/dev`); docs note commit followed on `dev-deep` / `staging`.

**Open remaining (after RD-110/127 follow-up):** RD-114, RD-116, RD-119–122, RD-128.

## 2026-08-21 — Merged Dev A + Dev B onto main

Pulled Dev B Days 1–3 (RD-103/104, RD-107/108, RD-111/125/112) and restored Dev A work (accounts, candidates, assign, notes/files, dashboard, unlock, UX). Conflict-resolved App routes and list pages; both Create/Put-forward and Assign/filter UX kept.

## 2026-08-21 — Synced Dev B Days 1–3 to all branches

Committed and pushed RD-103/104, RD-107/108, RD-111/125/112 (requirements + submissions UI, stage buttons, interview rounds, kanban), demo seed + test guides. Branches `main`, `staging`, `dev`, and `dev-deep` fast-forwarded to the same tip.

## 2026-08-21 — Dev B Day 3: RD-111 + RD-125 + RD-112

- **RD-111:** Submission detail stage move buttons + modal (backout/rejection reason required).
- **RD-125:** `InterviewRoundsPanel` — add/edit internal + client rounds (schedule, interviewer, feedback, rating, result).
- **RD-112:** `/requirements/:id/board` kanban by stage; cards link to submissions; quick stage chips. Linked from requirement + submission detail.

**Tests:** `submissions-pipeline-ui.test.js` — **77** green. Guide: [TESTING-RD-111-125-112.md](../testing/TESTING-RD-111-125-112.md).

## 2026-08-21 — Demo seed for frontend / dashboard E2E

Expanded `server/prisma/seed.js` beyond users: accounts (incl. stuck lead + active clients), requirements/seats/assignments, profiles, submissions across funnel stages, interview rounds, stage history, comments. Re-run wipes all demo tables then recreates.

**How to test:** [TESTING-DEMO-SEED.md](../testing/TESTING-DEMO-SEED.md).

## 2026-08-21 — Dev B Day 2: RD-107 + RD-108 (submissions UI)

- **RD-108:** `/submissions/new` — pick active candidate + requirement + open seat, rates, live margin preview, create → detail.
- **RD-107:** `/submissions/:id` — stage stepper, candidate + job/seat panels, editable commercials/margin + offer/BGV, interview rounds list (read-only), stage history. List links + **+ Put forward** for recruiter/admin.

Shared maps: `server/.../submissions/stageMachines.js` + `client/src/lib/submissionStages.js`.

**Tests:** `submissions-crud-ui.test.js`, `submission-stage-machines.test.js` — **72** green.  
**How to test:** [TESTING-RD-107-108.md](../testing/TESTING-RD-107-108.md).

## 2026-08-21 — Dev B Day 1: RD-103 + RD-104 (requirements UI)

Implemented Job Requirement frontend for Dev B Aug 22 tickets:

- **RD-104:** `/requirements/new`, `/requirements/:id/edit` — create/edit form (active client, seats_total on create, tech stack, budget, etc.); list **+ Create**; detail **status** buttons + **Add seat** modal.
- **RD-103:** `/requirements/:id` — info panels, seats table with per-seat stage controls (open→interviewing→offer→bgv→closed with `joined_at`, drop+reason), assigned recruiters + assignment history, requirement status history. Badge colors for seat stages. Modal for confirmations.

Shared stage maps: `server/.../stageMachines.js` + `client/src/lib/requirementStages.js` (keep in sync).

**Tests:** `stage-machines.test.js`, `requirements-crud-ui.test.js` — **62** tests green.  
**How to test manually:** [TESTING-RD-103-104.md](../testing/TESTING-RD-103-104.md).

## 2026-08-21 — Dev A Day 5 unlock + spec/UX (RD-127 / RD-115)

**RD-127:** Reusable `UnlockButton` (`POST /admin/:entity_type/:entity_id/unlock` with reason). Wired for admin on locked Account detail and Candidate/Account surfaces; Job/Submission unlock still to verify after Dev B detail merge.

**RD-115:** Spec walkthrough logged in [RD-115-SPEC-WALKTHROUGH.md](../ui/RD-115-SPEC-WALKTHROUGH.md). Fixed owned UX gaps: Requirements/Submissions Basic filter bars + mono keys + denser tables; AppLayout Delphic brand + tighter chrome.

**Verification:** Docker client production build passed (913 modules). Stack restarted on `:8081`.

## 2026-08-21 — Dev A Day 4 role dashboard (RD-113)

Frontend-only home dashboard wired to existing role-scoped `GET /dashboard/summary`:

- Title uses `{name}'s Dashboard` with role-specific subtitle.
- Stat cards differ by role (BDA: account counts; Sales/Recruiter: jobs/submissions/interviews; Admin: full set including interviews + closures).
- Stuck leads (Admin/BDA) and stuck requirements (Admin/Sales/Recruiter) with deep links.
- Pipeline funnel for Admin/Sales/Recruiter; Recent activity for all roles with entity links.
- Widget config in `client/src/pages/dashboard/dashboardWidgets.js`.

**Verification:** Docker client production build passed (913 modules). Stack restarted on `:8081`.

## 2026-08-21 — Dev A Day 3 Notes + Files (RD-109 / RD-110)

Reusable panels plus drop-in on Account and Candidate detail:

- `NotesPanel` and `FilesPanel` under `client/src/components/` — list/add notes via `/comments`, list/upload/delete via `/documents`.
- Wired on Account detail (sidebar) and Candidate detail (FilesPanel + Notes).
- Backend: `CommentEntityType` + validation now allow `profile` (migration `20260821153000_comment_entity_profile`).
- **Follow-up:** wire Notes/Files onto Dev B Job + Submission detail pages if not already present.

**Verification:** Docker client production build passed (912 modules).

## 2026-08-21 — Fix profile date fields for Prisma DateTime

**Root cause:** HTML date inputs send `YYYY-MM-DD`, but Prisma `DateTime` rejected that as “premature end of input”.
**Fix:** Frontend maps date-only values to ISO (`…T00:00:00.000Z`); profiles service also normalizes `date_of_birth` / `last_working_day` / `earliest_join_date` on create/update.
**Verified:** `POST /profiles` with `date_of_birth=1995-08-27` returned 201 and stored `1995-08-27T00:00:00.000Z`.

## 2026-08-21 — Dev A Day 2 candidates + assign UI (RD-105 / RD-106)

Frontend-only work plus one narrow users-list permission for Sales:

- Candidate list: Jira-like filters, create button, detail links (`PRF-…` keys).
- Candidate create/edit form with personal, professional, education, compensation, sourcing fields; optional resume file on create/edit.
- Candidate detail page with full field panels, resume upload/delete via documents API, and submission history sidebar.
- Assign recruiter modal from the Requirements list (Assign / Assignments action): active assign/unassign for Sales/Admin, full assignment history for all viewers.
- Backend: `GET /users` now allows Sales, but Sales is forced to `role=recruiter` only so they can pick assignees without seeing other roles. Create/patch users stay admin-only.

**Verification:** Docker client production build passed (908 modules).

## 2026-08-21 — Dev A Day 1 accounts UI complete (RD-101 / RD-102)

Implemented the Client/Vendor frontend:

- Jira-like Accounts list with search, type/stage filters, pagination, owner initials, account keys, detail links, and a role-gated Create action.
- Account detail page with company, contact, meeting, client/vendor commercial fields, additional contacts, lock state, and stage history.
- Stage movement modal follows the existing API state machine. Meeting scheduling requires mode/date; dropping requires a reason.
- Shared create/edit form covers company, primary/additional contacts, and client/vendor-specific fields. Only BDA/Admin can create; edits follow ownership and lock rules.
- Added `/accounts/new`, `/accounts/:id`, and `/accounts/:id/edit` routes.

**Verification:** Docker client production build passed (903 modules transformed).

## 2026-08-21 — Docs synced; logging + Jira UX noted; ticket snapshot

Documented and linked for the next session:

- [BACKEND-LOGGING.md](../guides/BACKEND-LOGGING.md) — full logging guide
- [UI-UX-JIRA.md](../ui/UI-UX-JIRA.md) + [references/jira-like-dashboard-reference.png](../ui/references/jira-like-dashboard-reference.png)
- [SPRINT-PLAN.md](SPRINT-PLAN.md) — Done (9) / Open (22) ticket snapshot
- AGENTS, README, TODO, PROGRESS, API-Spec security bullet, compose `LOG_LEVEL`

## 2026-08-21 — Standing UX note: Jira-like UI

Stakeholder direction: product UI/UX must feel like **Atlassian Jira** (issue search / filters / dense list), not a generic admin CRUD theme.

Documented in [UI-UX-JIRA.md](../ui/UI-UX-JIRA.md). Reference screenshot saved at [references/jira-like-dashboard-reference.png](../ui/references/jira-like-dashboard-reference.png). Cross-linked from AGENTS, TODO, SPRINT-PLAN, and README. Frontend tickets (lists, dashboard, detail chrome, RD-115) must follow this before done.

## 2026-08-21 — Backend structured logging (documented)

Added a zero-dependency logger (`server/src/config/logger.js`): levels `error|warn|info|debug` via `LOG_LEVEL` (default debug in dev, info in prod, error in tests). Pretty lines in development; JSON in production.

Wired:
- HTTP access log middleware (`requestLogger`) — method, path, status, duration_ms, user when present; skips `/health` and test env
- `errorHandler` logs validation/warn vs 500 errors with stack
- Process startup/shutdown + uncaughtException / unhandledRejection in `index.js`

**Docs:** full operator/developer guide in [BACKEND-LOGGING.md](../guides/BACKEND-LOGGING.md); cross-links in [AGENTS.md](../AGENTS.md), root README, `.env.example` files, and compose `LOG_LEVEL`. `server/.env.example` documents `LOG_LEVEL`. **50 tests green.**

## 2026-08-21 — Interview feedback confirmed/extended; recruiter/sales reports get interview + closure depth (RD-132)

**Feedback:** Already supported on `InterviewRound` (`feedback`, `rating`) via `PATCH /interview-rounds/:id`. Extended so recruiters can also submit **feedback + rating + result on create** (`POST /submissions/:id/interview-rounds`) — useful for logging a completed internal screen in one step. Completing a result auto-sets `completed_at`.

**Reports (recruiter-performance + sales-performance)** now include for the date range:
- `interviews_total` / `interviews_completed` / `interviews_pending`
- `interviews_internal` vs `interviews_client`, plus `interviews_by_type` and `interviews_by_result`
- `interviews_with_feedback` / `interviews_missing_feedback`
- `avg_interview_rating`, `avg_days_interview_turnaround` (scheduled → completed)
- `closures_count`, `closure_rate_percentage` (recruiter); sales also gets period closures + same interview stats on owned requirements

Recruiters can call `GET /reports/recruiter-performance` scoped to themselves. Export flatten now expands nested metric objects.

## 2026-08-21 — One-click test login + Admin Users page (RD-126 / RD-131)

**One-click login (temporary):** Login page shows Admin / BDA / Sales / Recruiter buttons that sign in as seeded users (`*@delphic.local` / `Password123!`). Marked clearly as testing-only; hide with `VITE_DISABLE_QUICK_LOGIN=true`. Lives in `client/src/lib/testAccounts.js` — remove when real auth/SSO lands.

**Admin-only user provisioning:** `/users` page (admin nav only) lists users, creates BDA / Sales / Recruiter / Admin with a temporary password shown once for sharing, and activate/deactivate. Backend `POST/PATCH /users` was already `authorize('admin')`; create now returns 409 on duplicate email. Non-admins are redirected away from the page.

Everyone else signs in with credentials the admin shares (or uses one-click for seed accounts during testing).

## 2026-08-21 — Sprint plan filled with previously missing tickets; progress docs synced

**Why:** An audit against the API/build plan found product gaps that existed in the backend (or were only implied in older tickets) but were **not named as sprint tickets** — so they could slip past Aug 28.

**Added / expanded in [SPRINT-PLAN.md](SPRINT-PLAN.md):**

| Ticket | What was missing |
|---|---|
| RD-103 / RD-104 | Explicit **seat stage controls** and **Add seat** (API existed; tickets only said “list seats” / requirement status) |
| RD-111 | Clarified full stage list including **`internal_screening`** |
| **RD-125** | **Interview rounds UI** — recruiter **internal** rounds + client rounds (API/`round_type: internal` already supported; no FE ticket before) |
| **RD-126** | **Admin Users page** (API existed; no UI — needed for real team accounts on deploy) |
| **RD-127** | **Unlock UI** on locked detail pages (API + tests existed; no button) |
| **RD-128** | **Change password** from header/menu (API existed; no UI) |
| RD-113 / RD-114 | Noted that stuck lists, role scoping, avg days, and export **APIs are already done** — FE only |
| RD-119 | E2E walkthrough must include internal interview, seat close, unlock, create user |
| **RD-129** | Ownership + dashboard role scoping — marked **DONE (Aug 21)** |
| **RD-130** | admin/comments/documents module split — marked **DONE (Aug 21)** |
| RD-117 / 118 / 123 / 124 | Already marked DONE; left in plan for history |

Also added a **Backend vs frontend map** table in the sprint plan so owners can see what is API-ready vs still UI.

**TODO.md** resume point updated: next work is frontend Day 1 (RD-101+) plus the new FE tickets above. Backend remains **47 tests green**, uncommitted until asked.

## 2026-08-21 — Split admin / comments / documents into routes/controller/service/validation

Brought the three remaining routes-only modules in line with the rest of the server:

- `admin/` — unlock body/params validation, `admin.service.unlock`, thin controller/routes
- `comments/` — list/create service + Zod validation + controller
- `documents/` — list/create/remove in service (DB + unlink); multer upload stays in routes (transport); meta validated in `documents.validation.js`

Smoke coverage in `server/tests/modules-split.test.js` (comments CRUD-ish, document upload/list/delete, admin unlock). **7 suites / 47 tests green.**

## 2026-08-21 — Remaining backend product gaps closed (RD-123, RD-124, ownership, dashboard scoping)

**Done and verified** (`cd server && npm test` → initially 43 tests; now 47 with module-split suite):

1. **RD-123 — dashboard stuck lists:** `dashboard.service.js` now reuses the same aging rules as the Aging report (7+ days). Spec shape: `stuck_leads: [{id,name,days_in_stage}]`, `stuck_requirements: [{id,title,days_open,submissions_count}]` (top 5 each). Hardcoded `[]` removed.
2. **Dashboard role scoping:** admin = global; BDA = own accounts/leads; sales = own requirements + related pipeline; recruiter = assigned reqs + own submissions/funnel.
3. **RD-124 — avg stage days:** recruiter performance computes `avg_days_*` from `stage_history` (+ interview-round fallback for interview start). Vendor performance computes `avg_days_to_submit` from requirement `created_at` → submission `created_at`. Interview auto-advances now also write `stage_history` so metrics stay accurate.
4. **Ownership on mutate:** BDA can only PATCH/stage own accounts; sales can only mutate own requirements (update/status/assign/unassign/addSeat). Admin unrestricted. List/getOne scoped the same way for BDA/sales.

**New tests:** `server/tests/backend-gaps.test.js` (stuck lists, role scoping, ownership 403s, recruiter/vendor avg days).

**Remaining sprint work** is frontend + infra (see SPRINT-PLAN RD-101+ and RD-125–128 open FE tickets).

## 2026-08-21 — Test suite finished and green (auth, locking, accounts/requirements/submissions stage machines)

**Ran and fixed** the suite Claude left unexecuted, then wrote the two missing files. Final result: **5 suites / 36 tests, all passing** (`cd server && npm test`).

**Fixes found by first run:**
1. Login rate limiter (`max: 5 / 60s` in `server/src/app.js`) was hitting mid-suite → 429. Skipped the limiter when `NODE_ENV === 'test'`.
2. Account stage machine only allows `dropped` from `meeting_scheduled` / `rescheduled` / `active` — not from `lead`. `locking.test.js` and two cases in `accounts-stage.test.js` were dropping from `lead` and would have failed; rewritten to schedule a meeting first. Post-lock transition assertion corrected to **403** (lock check before transition validity), matching the service.

**New files (RD-117):**
- `server/tests/requirements-stage.test.js` — requirement status (incl. `seats_not_closed`, drop+lock), seat machine (skip/join_at/drop reason), auto-close parent when last seat closes or drops, assign/unassign + role mismatch.
- `server/tests/submissions-stage.test.js` — margin on create, vendor_rate gate, duplicate submission, skip/backout/reject reasons, `rounds_not_resolved` / `bgv_not_cleared` gates, auto-advance via interview rounds, full happy path to closed (locks submission + seat).

**Helpers extended:** `createRequirement`, `createProfile` in `server/tests/helpers.js`.

**Still uncommitted** (do not commit unless asked): test suite + app.js rate-limit skip + earlier SPRINT-PLAN RD-123/RD-124 edit + package-lock / jest deps.

## 2026-08-21 — Sprint plan corrected; test suite started but NOT yet run — paused mid-work

**Read this whole entry before touching `server/tests/` — work stopped mid-task, nothing here has been verified to pass.**

**Sprint plan correction (uncommitted):** User asked "are all backend APIs done?" — did a real grep of every route file against every endpoint in `docs/architecture/API-Spec-and-Build-Plan.md`. Result: all 52 spec endpoints exist with correct method + role guard. But that's route *coverage*, not correctness — two known stubs were already tracked (dashboard's `stuck_leads`/`stuck_requirements` hardcoded to `[]`; six `avg_days_*` report fields always `null`). Added these as explicit tickets **RD-123** and **RD-124** to `docs/progress/SPRINT-PLAN.md` (Day 5, Dev A) and to the published artifact, and rewrote the plan's intro to stop implying "backend: done" without qualification. **This edit is saved to disk but not committed** — user explicitly said "do not commit by yourself to github until asked for" (now saved as a standing feedback memory).

**Test suite: infrastructure built, files written, but never executed — this is the important part.** User asked to "run the tests," which surfaced there were none. Set out to write and run a real suite for the highest-risk logic (stage machines, locking, auth — matching `RD-117`/`RD-118`), then got interrupted by a "pause, document everything" instruction before `npm test` was run even once. Concretely, as of this entry:

- Installed `jest` + `supertest` as server devDependencies (`npm install --workspace server` — succeeded, `package-lock.json` updated).
- Added `server/jest.config.js` (setupFiles-based env injection, `testMatch: tests/**/*.test.js`).
- Created an **isolated test database**: `requirement_dashboard_test` on the same Dockerized Postgres the dev DB (`requirement_dashboard`) already lives on (`docker exec delphic_one-db-1 psql -U postgres -c "CREATE DATABASE requirement_dashboard_test;"`), then applied the existing migration to it with `DATABASE_URL=...localhost:5434/requirement_dashboard_test npx prisma migrate deploy` — this succeeded and printed a Prisma update notice (5.22.0 → 7.9.1 available; not acted on, just noted).
- `server/tests/env.setup.js` — points `DATABASE_URL` at the test DB and sets test JWT secrets, loaded via Jest `setupFiles` so it runs before `src/app.js`/`src/config/db.js` are ever required (dotenv in `config/env.js` won't clobber env vars already set, so this is safe).
- `server/tests/helpers.js` — `cleanDatabase()` (raw `TRUNCATE ... RESTART IDENTITY CASCADE` across all 11 tables), `createUser()`, `loginAs()` (hits the real `/auth/login` endpoint via supertest), `createActiveClientAccount()`, `authed()` helper for attaching bearer tokens.
- `server/tests/auth.test.js` — 8 tests: login success/wrong-password/deactivated-user, `/users/me` with and without a token, refresh (valid + garbage token), change-password (wrong current password, then success, then confirms the old password stops working and the new one works).
- `server/tests/locking.test.js` — 2 tests: full lock lifecycle (create account → edit while unlocked → drop it → confirm edit now 403s → confirm a further stage transition now 403s, not 400, because the lock check runs before the transition-validity check → admin unlocks → edit works again), and confirming a non-admin gets 403 from the unlock endpoint itself.
- `server/tests/accounts-stage.test.js` — 6 tests covering the account stage machine: can't skip lead→active, meeting_scheduled requires its fields, dropped requires a reason, the full valid path with history verification, rescheduled looping back to meeting_scheduled, and dropped being terminal (confirmed the *right* status code: 403 locked, not 400 invalid-transition, since drop sets `is_locked` before any further attempt). **One bug in this file was caught and fixed before being run**: a test originally asserted `rescheduled` would 400 without a reason — checked `accounts.validation.js` directly and confirmed `reason` is optional for every transition except `dropped`, so the test was rewritten to assert 200 and actually verify the reschedule → meeting_scheduled loop instead of a guess.
- **Not yet written:** `requirements-stage.test.js` (requirement status transitions, `seats_not_closed` gate, seat stage machine, auto-close-requirement-when-all-seats-close side effect, assignment/unassignment) and `submissions-stage.test.js` (full submission pipeline, `rounds_not_resolved` gate, `bgv_not_cleared` gate, backout/rejection reason requirements, margin calculation). These are exactly `RD-117`'s scope and are the two files most likely to actually catch a bug, since submissions has the deepest state machine.
- **Not yet done, at all:** running `npm test` (or `npx jest`) even a single time. Zero confirmed pass/fail for anything above. Do not report these tests as "passing" or "written and verified" — they are only "written, believed correct by inspection."

**Environment state left behind:** `docker compose up -d` is running (db/server/client containers), plus the extra `requirement_dashboard_test` database sitting alongside the dev one in the same Postgres instance/volume. Next session should: run `cd server && npm test` first (fix whatever it finds — first real signal), then write the two missing test files, then decide with the user whether to commit.

## 2026-08-21 — Dockerized the stack; verified working end-to-end

- Added `server/Dockerfile`, `client/Dockerfile` (multi-stage build → `nginx:1.27-alpine` runtime, `client/nginx.conf` proxies `/api` and `/uploads` to the `server` container), root `docker-compose.yml` (`db`/`server`/`client` services, named volumes for Postgres data and uploads), `.dockerignore`, and root `.env.example` for compose overrides.
- Ran `npm install` for real in both `server/` and `client/` workspaces (previously never installed) — both installed cleanly, no dependency resolution errors. Committed the resulting root `package-lock.json`.
- `docker compose up --build` surfaced a real bug: `node:22-alpine` has no OpenSSL, and Prisma's schema-engine binary needs it — server crash-looped with `Could not parse schema engine response`. Fixed by adding `RUN apk add --no-cache openssl libc6-compat` to `server/Dockerfile`.
- Discovered `prisma migrate deploy` (used in the container's startup command) only *applies* existing migrations — it doesn't generate them, and no `prisma/migrations` folder existed yet. First attempt to generate one via `docker compose run --rm ... prisma migrate dev` *appeared* to succeed (applied against the real `db` service) but the generated migration files were written into that ephemeral `--rm` container's throwaway layer and vanished when it exited — confirmed by checking the host filesystem afterward and finding no `server/prisma/migrations/` directory at all, despite `docker exec ... psql \dt` showing all 12 tables present in the actual database.
- Also hit a host networking gotcha: this machine runs two native (non-Docker) Postgres instances on `localhost:5432` and `localhost:5433`, and native Apache/XAMPP on `localhost:8080`. `docker-compose.yml`'s original default host ports (5433, 8080) collided with these — connections silently reached the *wrong* server (confirmed via `netstat -ano` showing two LISTENING PIDs per port, cross-referenced with `Get-Process` to identify one as `postgres.exe`/`Apache` and the other as Docker's proxy). Fixed by moving the compose defaults to unused ports: Postgres → `5434`, client → `8081`.
- **Resolution:** dropped/recreated the dev database, then ran `prisma migrate dev --name init` directly from the *host* (`server/` with `DATABASE_URL` pointed at `localhost:5434`) — this writes the migration folder to the real host filesystem, unlike running it inside a `docker compose run --rm` container. Confirmed `server/prisma/migrations/20260821054624_init/migration.sql` now exists on disk and is committed.
- Did a full clean-slate verification: `docker compose down -v` (wipes volumes) → `docker compose up -d --build` → server logs show `1 migration found in prisma/migrations` / `All migrations have been successfully applied` (this is the real proof the Docker image works standalone, not dependent on manually-generated state) → seeded via `docker compose run --rm --entrypoint "" server sh -c "node prisma/seed.js"` → `POST /auth/login` returns a real JWT for `admin@delphic.local` / `Password123!`, `GET /users/me` and `GET /dashboard/summary` both return correct data, and the same login works through the client's Nginx proxy on port 8081, not just hitting the API directly on 4000.
- Docker Desktop itself dropped between sessions (daemon stopped responding, `docker info` failed) and had to be relaunched; on restart, the previously-running containers resumed automatically. Environment flakiness, not a project bug — noted in case it recurs.
- Updated `docs/AGENTS.md` "Local setup" with the verified Docker quick-start and the port/migration-generation gotchas above so the next session doesn't have to rediscover them.

## 2026-08-20 — Migrated server from Knex to Prisma

- Replaced Knex query builder with Prisma ORM across the whole server: `server/prisma/schema.prisma` now defines all 11 tables (as Prisma models/enums) that previously lived as 12 numbered Knex migration files — those migration files and `knexfile.js` are deleted.
- `server/src/config/db.js` now exports a `PrismaClient` singleton instead of a Knex instance; every service file and route module (`auth`, `users`, `accounts`, `requirements`, `profiles`, `submissions`, `documents`, `comments`, `admin`, `dashboard`, `reports`, and `middleware/lockCheck.js`) rewritten to Prisma's query API (`findMany`/`findUnique`/`create`/`update`, `$transaction` in place of Knex transactions, `groupBy` in place of raw `count().groupBy()`).
- Seeding moved from `knex seed:run` to `server/prisma/seed.js`, run via `npm run seed` → `node prisma/seed.js`.
- `npm run migrate` in `server/package.json` now runs `prisma migrate dev` instead of `knex migrate:latest`.
- Not yet done: no `npm install` has been run against this Prisma setup, so it has never actually generated a client or run a real migration — first real test is still pending (see TODO).

## 2026-08-20 — Repo pushed to GitHub

- Initial scaffold committed on `main` and pushed to `github.com/deepanshu-chauhan-delphic/delphic-one`.
- `staging` and `dev` branches created from `main` and pushed; CI workflow triggers on all three.
- Hit two auth snags along the way: wrong repo name (`delphic_one` vs `delphic-one`) and a 403 from the cached GitHub credential (`deepanshu-chauhan-483`) lacking write access — resolved by adding that account as a collaborator.

## 2026-08-20 — Initial scaffold
- Client scaffold: Vite + React + Tailwind, `AppLayout`, auth context, `apiClient`, list pages stubbed for accounts / requirements / profiles / submissions / reports, dashboard page, login page.
- Server scaffold: Express app, Knex config, JWT auth middleware, error handler, lock-check middleware.
- DB migrations 000–011: extensions, users, accounts, requirements, requirement_seats, requirement_assignments, profiles, submissions, interview_rounds, stage_history, documents, comments.
- Seed: `001_seed_users` (admin, sales, bda, 2 recruiters).
- Full domain modules (routes/controller/service/validation) built for: **accounts, auth, profiles, requirements, submissions, users**.
- Routes-only (no controller/service split yet) for: **admin, comments, dashboard, documents**; requirements/seats and submissions/interviewRounds routes exist as extra route files within those modules.
- CI workflow and deploy workflow (`deploy.yml`, currently a no-op pending `DEPLOY_ENABLED` + VPS secrets) added under `.github/workflows/`.
- `docs/AGENTS.md`, `docs/progress/PROGRESS.md`, `docs/progress/TODO.md` created to track context going forward.
