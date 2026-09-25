# Multi-Company Group ERP Platform ("Delphic One") — HLD

Status: **Phases 0-10 backend shipped; tenant-scoped frontend in progress** (tenancy/auth, directory/calendar/
attendance/leave + the 2026-09-15 client-brief amendment, project-centric
timesheets/locking/regularization — see §11 for the full phase-by-phase
status table, and the companion [Implementation Plan](MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md)
for exactly what's shipped vs. planned). Target: evolve this repo from a single-tenant
Delphic recruitment dashboard into a centralized, multi-tenant portal
replacing third-party tools (Zoho, Razorpay, etc.) for internal operations —
HR/HRMS, attendance, timesheets, calendars, leaves, overtime, payroll,
project-based billing/revenue, expense & vendor management, end-to-end
accounting/compliance, and a cross-company "super admin" dashboard with
group-level analytics and org charts.

## Product brief (client requirements, confirmed 2026-09-15 — supersedes the
original phase framing below where they conflict; see §11 for the mapping)

**Core objective**: a centralized, multi-tenant portal ("Delphic One") to
replace third-party software for internal operations, HR, payroll, billing,
time-tracking, and business intelligence.

**Phase 1 — Core ERP & HRMS (immediate focus)**
1. *Flexible calendar & location mapping*: default locations (Ahmedabad,
   Indore, Gurgaon) and custom/client-specific holiday calendars (e.g. US vs
   Indian client calendars for IT staff); map employees to specific project
   calendars based on their **active client assignments** (an employee can
   follow more than one project calendar at once — not a single calendar per
   employee).
2. *Stakeholder & HR POC mapping*: an HR point of contact per employee for
   general HR queries, and a Sourcing POC (the recruiter who onboarded them)
   to monitor recruiter performance.
3. *Attendance, shift & overtime*: configurable shift timings per
   employee/project, configurable grace periods (±15-30 min, set by HR),
   automatic overtime calculation for hours worked beyond the shift.
4. *Leave & payroll*: automated leave-balance tracking, paid leave, and
   attendance-based salary calculation.

**Phase 2 — Project-based time tracking & revenue auto-calculation**
1. *Project-centric timesheets*: an employee split across projects in one
   day (e.g. 4h on Project A, 4h on Project B) logs hours per project, not
   one blended entry; timesheets link to project constraints (calendar,
   schedule), not the general employee profile.
2. *Timesheet locking & authorization*: admins lock timesheets daily to
   freeze entries; any post-lock change requires a raised ticket + approval
   (a regularization flow, distinct from the attendance regularization
   already built in Phase 2).
3. *Automated daily revenue/billing*: hourly/monthly billing rates per
   client/project; real-time daily revenue generated from approved timesheet
   hours.

**Phase 3 — Financials, analytics & multi-company management (long-term)**
1. *Super admin dashboard & group analytics*: a unified dashboard with
   company-wide valuation, revenue, and expense graphs (daily/monthly/
   quarterly/yearly); clickable company tiles drilling into that company's
   own ERP/live data; interactive drill-down from a report number to its
   underlying transactions.
2. *Live automated org charts*: a dynamic hierarchy per subsidiary and a
   combined group chart, with visual indicators for new hires (planned/
   pending onboarding) and resignations/notice periods.
3. *Expense & vendor management*: office expense logging + reimbursement
   requests by location; vendor payment tracking for contractors and
   external/third-party vendors.
4. *End-to-end accounting & compliance*: native bookkeeping — invoicing, tax
   compliance, P&L/balance sheet — plus guest/external portal access for
   legal counsel and CAs to audit compliance directly inside the portal.

**Technical infrastructure**: AWS S3 for documents (resumes, onboarding
docs, receipts); a dedicated/scalable server + managed DB (e.g. AWS RDS),
upgrading from the current basic single instance; build the core ERP module
locally first, migrate to cloud infra after.

---

Architecture decisions locked in for this design (confirmed 2026-09-15):

1. **One identity, per-company roles.** A person has one login (email/password)
   for the whole group. They can hold membership + a role in more than one
   company under the group and switch between them, like switching workspaces.
   No per-company passwords.
2. **Shared database, `org_id` on every tenant-scoped table**, not
   schema-per-company or DB-per-company. Row-level isolation, not physical
   isolation. This keeps the super dashboard a normal aggregate query instead
   of an N-way fan-out.
3. **Same modular monolith.** New ERP modules (attendance, timesheet, payroll,
   billing, leave, calendar) live in this same `server/`, following the
   existing `routes → controller → service → validation` convention, sharing
   identity/notifications/calendar infra already built for recruitment. Module
   boundaries are kept clean enough that any one module can be extracted into
   its own service later if it becomes a scaling bottleneck — but nothing is
   physically split today.

---

## 1. Tenancy model

```
OrgGroup (the parent holding entity)
   └── Org (a company under the group: "Delphic", "Acconcy", ...)
         ├── Department / Designation (org-scoped directory)
         ├── Person memberships (who works here, in what role)
         ├── Client/Vendor Accounts (existing Account model, recruitment)
         ├── Calendars, Attendance, Timesheets, Leave, Payroll, Billing
         └── ... every future module
```

- `OrgGroup` is the parent holding-company boundary. It may own multiple
  sibling `Org` subsidiaries, and group-superadmin access is explicitly
  scoped through `OrgGroupMembership` rather than being global across the
  database.
- `Org` is the tenant boundary. Every module table added by this design
  carries `org_id`.
- **`Person` is global**, not per-org. One row per human being, regardless of
  how many companies they work at.
- **`OrgMembership`** is the join: `(person_id, org_id, roles[], employee_code,
  status, joined_at, left_at)`. This is where "different roles in different
  companies" lives — Person P can be `recruiter` at Delphic and `admin` at
  Acconcy, same login, two membership rows.

## 2. Identity & auth changes

Today: `User` is both the login identity and the role, scoped implicitly to
"the one company this app runs for." That collapses once there's more than
one `Org`.

Target shape (additive, migrated in phases — see §9):

- Keep `User` as the auth table (email, password_hash, mfa, etc.) — it becomes
  the `Person` record. No breaking rename; existing `User.id` stays the FK
  everywhere it's already used for the Delphic org.
- Add `OrgMembership(person_id → User.id, org_id, role, employee_code,
  department_id, designation_id, employment_status, joined_at, left_at)`.
- Add `Org(id, org_group_id, name, slug, timezone, default_currency, status)`.
- JWT gains an **active org context**: `{ user_id, org_id, role }`. Role is
  resolved *for that org*, not globally — mirrors the existing pattern in
  `authorizeSuperadmin` (`middleware/auth.js`), which already re-reads a flag
  from the DB per request instead of trusting a JWT claim. Do the same for
  `role`: the JWT carries `org_id`, the server loads the live `OrgMembership`
  row for `(user_id, org_id)` on every request. This means role changes and
  offboarding take effect immediately, not just on next login.
- **Org switcher**: a person with >1 membership gets a picker (top nav, like a
  workspace switcher) that re-issues a token scoped to the chosen `org_id`.
  Default org = their only membership, or last-used.
- **Group superadmin** is a new, separate flag from `Org`-level
  `is_superadmin` — `User.is_group_superadmin` plus one or more
  `OrgGroupMembership` rows. It grants read access to the super dashboard
  (§7) only inside those parent groups, and nothing else — it does not imply
  per-org admin powers inside any subsidiary. Gated by
  `authorizeGroupSuperadmin`, following the re-read-from-DB pattern.

`can()` / `usePermissions()` on the client keep working as-is; they just start
reading role-for-active-org instead of a single global role.

## 3. Module map

Every module below is a normal `server/src/modules/<name>/` folder
(`*.routes.js` / `*.controller.js` / `*.service.js` / `*.validation.js`),
same convention as `accounts`, `requirements`, etc. All models carry `org_id`.

| Module | Owns | Depends on |
|---|---|---|
| `orgs` | `Org`, `OrgGroup`, `Department`, `Designation`, `OrgMembership`, `Location` | identity |
| `calendars` | `Calendar`, `CalendarHoliday`, `EmployeeCalendar` (per-employee, **per-project** — an employee can carry more than one active mapping); extends the **existing** interview/meeting calendar rather than replacing it | orgs |
| `attendance` | check-in/out, daily attendance status, `Shift` (timings + grace period), automatic overtime, regularization | orgs, calendars |
| `leave` | leave types, policies, balances, requests, approvals | orgs, calendars |
| `timesheet` | project-centric daily work-log entries (multi-project per day), daily locking, post-lock regularization tickets | orgs, requirements/accounts (existing), calendars |
| `payroll` | salary structures, payroll runs, payslips, attendance-based salary calc | orgs, attendance, leave, timesheet (overtime) |
| `billing-client` | client invoices + **daily revenue auto-calc** from approved timesheet hours × billing rate | requirements/submissions (existing), timesheet |
| `billing-group` | intra-group billing (management fee, shared-service cross-charges) | orgs |
| `expenses` | office expense claims + reimbursement, by `Location` | orgs |
| `vendor-payments` | payment tracking for contractors / external resources / third-party vendors — **distinct from** the existing recruitment `Account(type=vendor)` (candidate-sourcing vendors); this is money going *out* for services, not candidates coming *in* | orgs |
| `accounting` | ledger, invoicing, tax records, P&L / balance sheet | orgs, billing-client, billing-group, expenses, vendor-payments |
| `external-access` | scoped, read-only guest access for Legal/CA compliance audits — a distinct auth path from `OrgMembership` (they are not employees) | orgs, accounting |
| `org-chart` | live reporting-line hierarchy (per subsidiary + combined group), onboarding/notice-period visual state | orgs (OrgMembership.manager_id + lifecycle state) |
| `profitability` | the analytics fact tables and rollups behind the super dashboard — valuation, revenue, expense, margin | timesheet, payroll, billing-client, billing-group, expenses, accounting |
| `super-dashboard` | cross-org read-only aggregation API + UI, company tiles, drill-down to transaction detail | profitability, group superadmin auth |

The existing recruitment domain (`accounts`, `requirements`, `profiles`,
`submissions`, `pipeline`, `reports`) becomes **one business capability that
runs inside `Org = Delphic`** (and, if Acconcy also recruits, inside
`Org = Acconcy` too, isolated by `org_id`) — not a special case architecturally.

## 4. Core new data model (sketch)

Naming avoids collision with the existing `Account`/`CompanySize` (client
company) vocabulary by using `Org`, not `Company`.

```
OrgGroup      { id, name }
Org           { id, org_group_id, name, slug, timezone, default_currency, status }
Department    { id, org_id, name }
Designation   { id, org_id, name, department_id? }
Location      { id, org_id, name, city, country, is_default }  // Ahmedabad/Indore/Gurgaon + custom
Shift         { id, org_id, name, start_minutes, end_minutes, grace_minutes }  // configurable check-in grace, ±15-30min typical
OrgMembership { id, person_id(User.id), org_id, role, employee_code,
                department_id, designation_id, location_id, shift_id,
                manager_id(OrgMembership.id)?,        // reporting line, for the org chart
                hr_poc_id(User.id)?,                  // HR contact for this employee
                sourcing_poc_id(User.id)?,             // recruiter who onboarded them
                employment_status[active|on_leave|terminated|pending_onboarding|notice_period],
                joined_at, left_at, notice_end_date? }

Calendar        { id, org_id, name, kind[internal|client|custom], location_id?, is_default }
CalendarHoliday { id, calendar_id, date, label }
// One employee can carry >1 active row here — one per concurrently-assigned
// project/client, not a single calendar per employee (client brief §1).
EmployeeCalendar{ id, org_membership_id, calendar_id, account_id? }

AttendanceRecord { id, org_membership_id, date, check_in_at, check_out_at,
                    status[present|absent|half_day|leave|holiday|wfh],
                    source[web|mobile|manual], overtime_minutes,
                    regularized_by, regularized_reason }

LeaveType    { id, org_id, name, paid, annual_quota }
LeaveBalance { id, org_membership_id, leave_type_id, year, accrued, used }
LeaveRequest { id, org_membership_id, leave_type_id, from_date, to_date,
               status[pending|approved|rejected|cancelled], approver_id, reason }

// One row per (employee, day, project) — the same employee logs multiple rows
// on the same date across different projects (client brief §Phase 2.1).
TimesheetEntry { id, org_membership_id, date, project_ref (client_account_id
                  or requirement_id, existing models), hours, billable,
                  notes, approved_by, status, locked_at }
// Freezes every TimesheetEntry for an org on a given date; a locked entry can
// only change via a TimesheetRegularizationTicket.
TimesheetLock { id, org_id, date, locked_by, locked_at }
TimesheetRegularizationTicket { id, timesheet_entry_id, requested_by, requested_change(json),
                                  reason, status[pending|approved|rejected], decided_by }

SalaryStructure { id, org_membership_id, effective_from, ctc, components(json) }
PayrollRun      { id, org_id, period_month, period_year, status, run_at }
Payslip         { id, payroll_run_id, org_membership_id, gross, deductions,
                   net, generated_pdf_doc_id }

BillingRate       { id, org_id, account_id, requirement_id?, rate_type[hourly|monthly],
                     rate, currency, effective_from }  // per client/project
ClientInvoice     { id, org_id, client_account_id, period, amount, currency,
                     status, line_items(json) }
GroupBillingCharge{ id, org_id, org_group_id, period, amount, currency, kind }
// One row per (project, day) — the real-time revenue metric the client brief
// asks for; DailyEmployeeProfitability (below) rolls this up per employee.
DailyProjectRevenue { id, org_id, account_id, requirement_id?, date,
                       billable_hours, rate, revenue }

ExpenseClaim   { id, org_id, org_membership_id, location_id, category, amount,
                  currency, receipt_doc_id, status[pending|approved|rejected|reimbursed] }
VendorPayment  { id, org_id, vendor_name, vendor_type[contractor|external_resource|third_party],
                  amount, currency, period, status, invoice_doc_id }
                 // NOT the recruitment Account(type=vendor) — see module map note.

// Minimal double-entry ledger — enough for P&L/balance sheet + CA audit, not
// a full accounting-package rebuild.
LedgerAccount  { id, org_id, name, kind[asset|liability|equity|revenue|expense] }
LedgerEntry    { id, org_id, ledger_account_id, date, debit, credit, memo, source_ref(json) }
TaxRecord      { id, org_id, period, jurisdiction, kind, amount, status, filed_at }

// Read-only, scoped guest access for Legal/CA — deliberately not an
// OrgMembership (they're not employees, don't get a role-in-a-company).
ExternalAccess { id, org_id, email, scope(json), expires_at, granted_by }

DailyEmployeeProfitability { id, org_membership_id, org_id, date,
                              revenue, cost, margin }   // fact table, see §6
```

All of the above (except `OrgGroup`) carry `org_id` directly or transitively
via `org_membership_id → OrgMembership.org_id`. Composite indexes:
`(org_id, date)` on every time-series table, `(org_membership_id, date)` for
per-employee lookups — these are the two access patterns the super dashboard
and per-company dashboards both need.

## 5. Row-level isolation

Two layers, same belt-and-suspenders pattern the codebase already uses for
soft-delete (`config/db.js`'s `prisma.$use` middleware that injects
`deleted_at: null`):

1. **App layer (primary):** a Prisma middleware injects `org_id: <active org
   from request context>` into every `findMany/findFirst/count/aggregate/
   groupBy/update/delete` on org-scoped models, the same way soft-delete
   already works. Request-scoped `org_id` comes from AsyncLocalStorage set by
   auth middleware at the top of the request, so service code doesn't have to
   remember to filter — same ergonomics as today.
2. **DB layer (defense-in-depth):** Postgres **Row-Level Security** policies
   on every org-scoped table, keyed off a session variable
   (`SET LOCAL app.org_id = ...`) set at the start of each request's
   transaction. This catches any query that bypasses the Prisma middleware
   (raw SQL, a forgotten model, future code). It does not replace layer 1 — it
   backstops it.

Group-superadmin / super-dashboard queries explicitly opt out of both (a
dedicated `withoutOrgScope()` escape hatch, used only by the
`super-dashboard` and `profitability` modules), never a default.

## 6. Profitability pipeline (the "daily/weekly/monthly/quarterly margin per
employee" requirement) — shipped 2026-09-16, backend only

This is the part that breaks if it's built naively — computing margin per
employee per company by joining live attendance + timesheet + billing +
payroll tables on every dashboard load does not stay low-latency as data
grows across companies.

- **OLTP tables** (attendance, timesheet, payroll, invoices) stay
  write-optimized, as above.
- A **nightly batch job** (extendable to near-real-time via a queue later)
  computes `DailyEmployeeProfitability` per `(org_membership_id, date)`:
  `revenue` = that day's `DailyProjectRevenue` (Phase 5) allocated pro-rata
  by hours across everyone who logged approved+billable time on it, `cost`
  = salary/CTC prorated to the day (**overhead allocation not built yet —
  cost is salary only**), `margin = revenue - cost`.
- **Weekly / monthly / quarterly numbers are never recomputed from scratch on
  read** — they're `SUM()`s over the daily fact table, which is cheap because
  the fact table is narrow, indexed on `(org_id, date)`, and orders of
  magnitude smaller than the source tables it was built from.
- Start with a **Postgres materialized view** (or a plain summary table
  refreshed by the nightly job) for the rollups; only reach for a separate
  analytics warehouse (ClickHouse, etc.) if/when row counts make Postgres
  aggregation too slow for the dashboard's latency budget — don't build that
  upfront. **Shipped as a live `SUM()` query, not a materialized view** —
  the fact table is still small; revisit once it isn't.
- Implementation: a `node-cron` job in the `profitability` module, same
  shape as the existing `jobs/interviewReminders.js` cron already in this
  repo. **Shipped** as `jobs/profitabilityCompute.js`.

## 7. Super dashboard — shipped 2026-09-16, backend only

- A single cross-org read API (`GET /super-dashboard/...`), `org_id`-agnostic
  by design, gated by `authorizeGroupSuperadmin` only.
- Reads exclusively from `DailyEmployeeProfitability` and its rollups — never
  joins live OLTP tables directly — so it stays fast regardless of how many
  companies or employees exist.
- Per-company drill-in reuses the *same* per-company dashboard components,
  just with `org_id` no longer fixed to "mine" — one UI, parameterized, not a
  second dashboard to maintain.

## 8. Low-latency / scalability posture

- **Composite indexes** `(org_id, date)` / `(org_membership_id, date)` on
  every new time-series table (attendance, timesheet, overtime,
  profitability) from the first migration — not retrofitted later.
- **Partitioning**: once a table like `AttendanceRecord` or
  `DailyEmployeeProfitability` crosses the range where index scans stop being
  enough (rule of thumb: tens of millions of rows), convert it to native
  Postgres range partitioning by month on `date`. The `org_id` + `date`
  composite index makes this a mechanical change, not a redesign.
- **Background jobs, not request-path work**: payroll runs, invoice
  generation, the nightly profitability ETL, and bulk notifications move to a
  job queue (BullMQ + Redis is the standard pairing with this stack) instead
  of blocking an HTTP request. Redis is a new piece of infra for this repo —
  add it once the first job that needs it (profitability ETL) is built,
  not speculatively.
- **Caching**: Redis (same instance as the job queue) for the org directory,
  active-membership lookups, and dashboard KPI tiles with a short TTL (30–60s)
  — mirrors what `GET /users/directory` and `GET /dashboard/summary` already
  are, just with a cache in front once multi-org traffic makes them hot.
- **Read replica**: once there's real multi-company write volume, point
  `reports`/`profitability`/`super-dashboard` reads at a Postgres read replica
  so heavy aggregate queries never contend with OLTP writes (check-ins,
  stage moves). Not needed at current scale — flagged so the module
  boundaries (service-layer DB access, not scattered raw queries) make this a
  connection-string change later, not a rewrite.
- **PgBouncer** in front of Postgres once total connections (multiple org
  workspaces × background jobs × app instances) approach Postgres's
  connection limit.
- None of this is needed on day one for two companies. It's sequenced in §9
  so each piece is added when its trigger condition is actually hit, not
  upfront.

## 9. Migration plan (phased, additive-only — HARD RULE from AGENTS.md applies:
no `DROP` ships with feature code, every phase is an expand, contraction is
always its own later PR)

**Phase 0 — tenancy scaffold, invisible to users** (shipped 2026-09-15)
Add `OrgGroup`, `Org`, `OrgMembership`. Backfill: create one `Org` row
("Delphic"), one `OrgGroup` row, and one `OrgMembership` per existing `User`
pointing at it. Every existing table (`Account`, `Requirement`, `Submission`,
etc.) gets a nullable `org_id` column, backfilled to Delphic's `org_id`, then
(next migration, per HARD RULE) made `NOT NULL`. App behavior unchanged —
this phase is pure plumbing. **The `NOT NULL` flip is still outstanding**
(see the Implementation Plan's "pre-Phase-3 hardening" log for why it's a
deliberate, larger deferral rather than a forgotten step).

**Phase 1 — org switcher + group superadmin** (shipped 2026-09-15; write-side
`org_id` auto-injection added 2026-09-16, see the plan doc)
JWT gains `org_id`; `authorize()` resolves role via `OrgMembership` instead of
`User.role`; org switcher UI ships but there's still only one selectable org
(Delphic) until Acconcy is created. `authorizeGroupSuperadmin` added.
Recruitment app behaves identically to today for every existing user.

**Phase 2 — directory + calendar + attendance + leave** (shipped 2026-09-15;
amended same day per the client brief — see the Implementation Plan's Phase
2 log for the exact diff)
`Department`/`Designation`, `Calendar`/`CalendarHoliday`/`EmployeeCalendar`
(extends, doesn't replace, the existing interview/meeting calendar),
`AttendanceRecord`, `LeaveType`/`LeaveBalance`/`LeaveRequest`. These are the
modules every later module depends on (payroll needs attendance + leave;
timesheet needs calendar for working days). **Amendment**: `EmployeeCalendar`
changed from one-per-employee to one-per-(employee, project) so an employee
on two concurrent client engagements follows two calendars at once; added
`Location`, `Shift` (timings + grace period), `OrgMembership.hr_poc_id` /
`sourcing_poc_id` / `manager_id`; `AttendanceRecord.overtime_minutes`
computed automatically at check-out against the assigned `Shift`.

**Phase 3 — timesheet + overtime** (shipped 2026-09-16 — the timesheet half;
overtime *auto-calculation* shipped in the Phase 2 amendment, an overtime
*approval* workflow is still open, see §11)
Daily work-log entries linked to existing `Account`/`Requirement` as the
"project" reference, so recruiters/BDAs logging time against a client
requirement don't need a new "project" concept invented — reuse what exists.
**One row per (employee, day, project)**, not one blended entry, so a split
day (4h Project A + 4h Project B) is two rows. Daily `TimesheetLock` freezes
a day's entries; a post-lock change requires a
`TimesheetRegularizationTicket` + approval (separate from the attendance
regularization already built in Phase 2 — different entities, same
raise-a-ticket shape).

**Phase 4 — payroll** (shipped 2026-09-16, backend only)
Salary structures, payroll runs, payslips. Depends on attendance + leave +
overtime being live and trusted (at least one full month of clean data)
before payroll math is allowed to read them. Overtime pay itself is
deliberately excluded from the computation (tracked, not paid) since no
overtime-pay policy exists yet — see the Implementation Plan's Phase 4 log
for the exact formula.

**Phase 5 — billing + real-time project revenue** (shipped 2026-09-16, backend only)
Client billing (extends existing client `Account`) + intra-group billing +
`BillingRate` (hourly/monthly per client/project) + `DailyProjectRevenue`,
computed from that day's **approved and billable** `TimesheetEntry` hours ×
the applicable rate — this is the "real-time revenue" metric from the
client brief, and it's what `DailyEmployeeProfitability` (Phase 6) rolls up
per employee across projects. Computation is an admin-triggered call today,
not yet a scheduled job — see the Implementation Plan's Phase 5 log.

**Phase 6 — profitability + super dashboard** (shipped 2026-09-16, backend only)
The `DailyEmployeeProfitability` fact table, its nightly job, rollup views,
and the cross-org super-dashboard API/UI, gated to `is_group_superadmin`.
UI not built yet — see the Implementation Plan's Phase 6 log.

**Phase 7 — expenses + vendor payments** (shipped 2026-09-16, backend only)
`ExpenseClaim` (office expense + reimbursement, scoped by `Location`) and
`VendorPayment` (contractors / external resources / third-party vendors —
money going out for services, kept deliberately separate from the
recruitment domain's `Account(type=vendor)`, which is money/candidates
coming in from a sourcing vendor).

**Phase 8 — accounting & compliance** (shipped 2026-09-16, backend only)
Minimal double-entry `LedgerAccount`/`LedgerEntry` + `TaxRecord`, enough to
produce P&L/balance sheet and support a CA audit — not a full accounting
package rebuild. Journal-entry posting is manual/API-driven today, not yet
auto-generated from billing/group-billing/expense/vendor-payment events —
that wiring is the natural next step once a frontend calls for it.

**Phase 9 — external access (Legal/CA guest portal)** (shipped 2026-09-16,
backend only)
`ExternalAccess` — scoped, time-boxed, read-only grants for non-employees.
Deliberately not an `OrgMembership` (no role-in-a-company, no login
password to manage) — its own bearer-token auth path
(`authenticateExternal`/`requireExternalScope`), gated to whatever
`scope.resources` was granted. The guest portal itself reads the
accounting module's reports (the doc's own "read accounting for Org X,
expires in 30 days" example, built literally); extend the resource enum as
more modules grow a guest-facing view.

**Phase 10 — org chart + lifecycle visualization** (shipped 2026-09-16,
backend only)
Live reporting-line hierarchy from `OrgMembership.manager_id`, per
subsidiary and combined group; `employment_status` gains
`pending_onboarding` / `notice_period` states (plus `notice_end_date`) so
the chart can show new-hire and resignation indicators without a separate
workflow engine. Both landed in the 2026-09-15 Phase 2 amendment already,
so this phase needed no schema change — only the `orgChart` module that
reads them.

**Onboarding Acconcy (or any second `Org`)** is then just: create the `Org`
row, create `OrgMembership` rows for its employees (existing `User`s get a
second membership if they're shared with the group; new hires get a fresh
`User` + membership), configure its calendar/leave policy/salary structures.
No schema changes required — that's the point of Phase 0–1 landing first.

## 11. Client-brief phase names → this doc's internal phase numbers

The client brief's 3 phases are coarser-grained than this doc's phased
migration plan (each of its phases spans several of the numbered phases
above, because "additive-only, one dependency chain at a time" — HARD RULE —
forces payroll/billing/etc. apart even though the client groups them by
product area). This table is the map, kept current as phases ship (✅) or
stay planned:

| Client brief | Internal phases | Status |
|---|---|---|
| Phase 1.1 Calendar & location mapping | Phase 2 (+ 2026-09-15 amendment) | ✅ shipped |
| Phase 1.2 HR/Sourcing POC mapping | Phase 2 amendment | ✅ shipped |
| Phase 1.3 Attendance, shift & overtime | Phase 2 amendment | ✅ shipped (shift + grace + auto-OT); OT *requests/approvals* (vs. auto-calc) still planned |
| Phase 1.4 Leave & payroll | Phase 2 (leave) shipped; payroll = Phase 4 | leave ✅, payroll ✅ shipped (backend) — frontend + correction workflow + payslip PDF still planned |
| Phase 2.1 Project-centric timesheets | Phase 3 | ✅ shipped |
| Phase 2.2 Timesheet locking + regularization | Phase 3 | ✅ shipped |
| Phase 2.3 Automated daily revenue | Phase 5 (`DailyProjectRevenue`) | ✅ shipped (backend) — computed on an admin-triggered call, not yet scheduled |
| Phase 3.1 Super admin dashboard + group analytics | Phase 6 (+ valuation/expense additions) | ✅ shipped (backend) — valuation/expense rollups depend on Phase 7/8, still planned |
| Phase 3.2 Live org charts | Phase 10 | ✅ shipped (backend) — chart visualization (frontend) still planned |
| Phase 3.3 Expense & vendor management | Phase 7 | ✅ shipped (backend) |
| Phase 3.4 Accounting + external CA/Legal portal | Phase 8 + 9 | ✅ shipped (backend) |
| Infra: AWS S3 | orthogonal to phases — a storage-adapter swap, see Implementation Plan | planned |
| Infra: dedicated server + AWS RDS | orthogonal — a `DATABASE_URL`/deploy-target change once service-layer DB access stays centralized (already true) | planned, deliberately last (local-first per the client's own stated dev strategy) |

## 12. What this deliberately does not do yet

- No physical multi-tenancy (schema/DB-per-company) — row-level isolation
  only, per the confirmed decision. Revisit only if a specific company has a
  hard compliance requirement for physical data separation.
- No microservices — module boundaries are enforced in code (own
  routes/controller/service/schema slice per module) so any one module
  *could* be extracted later, but nothing is deployed separately today.
- No analytics warehouse (ClickHouse/BigQuery/etc.) — Postgres materialized
  views/rollup tables until row counts prove that's insufficient.
- No mobile app / biometric device integration for attendance — `source`
  enum on `AttendanceRecord` leaves room for it, but web/manual check-in is
  the Phase 2 scope.
- **No full accounting-package rebuild** — `LedgerAccount`/`LedgerEntry`/
  `TaxRecord` (Phase 8) is a minimal double-entry ledger sized to produce
  P&L/balance sheet and support a CA audit, not a Tally/QuickBooks
  replacement. Revisit only if the CA's actual compliance workflow needs
  more than that.
- **No S3/RDS migration until the core ERP module (Phases 2-6) works
  locally** — explicit client-stated dev strategy. Local disk storage
  (`UPLOAD_DIR`) and the local Postgres stay as-is until then; the storage
  and DB access are already abstracted behind one module each
  (`documents`, `config/db.js`), so swapping either later is a
  configuration/adapter change, not a rewrite.
- **No AI/ML valuation modeling** — "company valuation" on the super
  dashboard (Phase 6) means a number the group finance function inputs or a
  simple formula over revenue/assets, not a computed market valuation.

## Open items (original, still unconfirmed)

- Exact list of companies to onboard beyond Delphic (Acconcy confirmed; any
  others, and their target timeline) — affects how much of Phase 1's org
  switcher UX gets built up front vs. deferred.
- Salary/payroll compliance requirements (India PF/ESI/TDS specifics if any
  company operates outside India, given `Currency`/`ProfileCurrency` already
  span INR/USD/AED/SAR/EUR/GBP) — affects `SalaryStructure.components` shape.
- Who holds `is_group_superadmin` day one, and whether it's a brand-new set of
  people or a superset of existing Delphic superadmins.

## Open items (raised by the 2026-09-15 client brief)

- Full list of default locations beyond Ahmedabad/Indore/Gurgaon, and
  whether each `Org` gets its own location set or they're shared
  group-wide (currently modeled per-`Org`).
- Standard grace-period value(s) HR wants as the default (brief says
  "±15-30 min" — is that one fixed org-wide default, or does it vary by
  shift/designation?).
- Whether overtime needs an approval step (a request/approval workflow,
  matching `OvertimeRecord` in the original sketch) or the automatic
  calculation alone is the whole feature — affects whether Phase 3 also
  needs an approval queue or just the auto-calc already shipped.
- Billing-rate granularity: per client, per project/requirement, or
  per-employee-per-project (a senior dev and a junior dev on the same
  project at different rates) — affects `BillingRate`'s shape before
  Phase 5 is built.
- What "company valuation" means concretely for the super dashboard tiles —
  a manually-entered number, a formula, or something else (see §12 — this
  doc assumes a simple input/formula, not computed modeling).
- Compliance/jurisdiction scope for the accounting module (Phase 8) — which
  tax regimes, and whether the CA/Legal `ExternalAccess` grant needs an
  audit trail of what they viewed (likely yes, for compliance, but not yet
  designed).
- AWS account/infra ownership for the eventual S3 + RDS migration, and
  target timeline — affects nothing about the local build, but the
  Implementation Plan's "local first" sequencing assumes this is genuinely
  a later phase, not a parallel workstream.
