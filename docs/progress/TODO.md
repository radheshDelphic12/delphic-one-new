# TODO

Working task list. Check off / move to [PROGRESS.md](PROGRESS.md) as items land. See [AGENTS.md](../AGENTS.md) for project context.

**Sprint tickets live in [SPRINT-PLAN.md](SPRINT-PLAN.md)** (Aug 21 → Aug 28 deploy).

## Multi-company ERP platform (2026-09-15, branch `feature/multi-company-erp`)

Plan: [MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](../architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md) · Design: [MULTI-COMPANY-ERP-PLATFORM-HLD.md](../architecture/MULTI-COMPANY-ERP-PLATFORM-HLD.md).

- [x] Branch `feature/multi-company-erp` cut from `main` (`d7068cc`).
- [x] Isolated local DB `requirement_dashboard_erp` created (same Docker
      Postgres container, `localhost:5434`); `requirement_dashboard` /
      `server/.env` untouched.
- [x] `server/.env.erp.example` + `.gitignore` carve-out committed.
- [x] Phase 0 — `OrgGroup`/`Org`/`OrgMembership` schema, migration
      (`20260915103201_phase0_org_tenancy_scaffold`), idempotent backfill
      script (`npm run erp:phase0:backfill`). Nullable `org_id` on 11
      existing tenant-scoped models. App behavior unchanged — full server
      suite (41/307) green. See PROGRESS.md / plan doc log for detail.
- [x] Phase 1 (auth core) — JWT `org_id` claim, live per-org role resolution
      (`authenticate`), `authorizeGroupSuperadmin`, `orgs` module
      (`GET /orgs/me/memberships`, `GET /orgs`), `POST /auth/switch-org`.
      No schema change. 11 new tests, full suite 42/318 green. See
      PROGRESS.md / plan doc log for detail.
- [x] Phase 1 (remaining, part 1) — `AsyncLocalStorage` org context
      (`src/lib/orgContext.js`) + Prisma middleware auto-injecting `org_id`
      on `create` for 17 org-scoped models, write-side only. 3 new tests
      (+ designations tests below), full suite 45/346 green.
- [x] Release 1 tenant hardening — active-org context is required for
      organization-scoped Users, Departments, Attendance, Leave, and HR
      Settings routes; reads and writes carry explicit `org_id` filters;
      tokens with missing/inactive org memberships fail closed.
- [x] Release 1 organization onboarding and branding — `Org.logo_url`,
      admin organization creation with an initial admin membership, seamless
      switch into the new membership, and active-org name/logo in the shell.
- [x] Holding-company RBAC hardening — `OrgGroupMembership` scopes group
      superadmins to authorized parent holding companies; subsidiary lists,
      group profitability rollups, and combined org charts cannot cross that
      parent boundary. `OrgGroup` is the canonical parent scope; no redundant
      `parent_org_id` column is introduced.
- [ ] Phase 1 (remaining) — the recruitment domain read-side isolation audit
      and final `org_id` NOT NULL hardening for legacy tenant tables remain
      open; the ERP People/HR surfaces are now explicitly tenant-scoped.
- [x] Phase 2 (backend) — `Designation`, `Calendar`/`CalendarHoliday`/
      `EmployeeCalendar`, `AttendanceRecord`, `LeaveType`/`LeaveBalance`/
      `LeaveRequest` schema + migration
      (`20260915110152_phase2_directory_calendar_attendance_leave`). New
      `calendars`/`attendance`/`leave` modules (check-in/out, leave
      request/approve/cancel, holiday calendars). New `requireOrgMembership`
      middleware. 10 new tests, full suite 43/328 green. See PROGRESS.md /
      plan doc log for detail.
- [x] Phase 2 amendment (2026-09-15 client brief) — `Location` +
      `GET/POST /orgs/locations`; HR/sourcing POC + `manager_id` +
      `PATCH /orgs/memberships/:id`; `Shift` + `GET/POST /attendance/shifts`
      + automatic overtime on check-out; `EmployeeCalendar` changed from
      one-per-employee to one-per-(employee, project) +
      `GET /calendars/assignments/:id`. 10 new tests, full suite 44/338
      green. See PROGRESS.md / plan doc log for detail.
- [x] Phase 2 (remaining, part 1) — `designations` module
      (`GET/POST /designations`, `PATCH /designations/:id`), org-scoped,
      mirrors the existing global `departments` module. 8 new tests.
- [x] Release 2, Delivery Step 2 — Attendance, Leave, and HR Settings UI:
      `/attendance` with My/Team tabs, check-in/out, date/status filters,
      overtime display, and admin regularization drawer; `/leave` with
      request form, isolated `is_half_day` UI payload, request history,
      cancellation, admin approval queue, and decision drawer; and
      `/people/settings` with Departments, Designations, Locations, Shifts,
      Calendars, and holiday management tabs. Empty states are used when
      backend data is unavailable. Remaining backend gaps: leave balance read
      API, leave accrual, and overtime approval. Half-day persistence and
      FIRST_HALF/SECOND_HALF session selection are complete across backend and
      frontend.
- [x] Release 2, Delivery Step 3 — leave balance summary: added
      `GET /leave/balances/me?year=YYYY`, returning allocated/accrued/used/
      remaining days per leave type for the active employee, and connected the
      `/leave` balances card. Standard leave types with no balance row still
      appear with their annual quota and zero usage.
- [x] Release 2, Delivery Step 1 — employee directory and profile frontend:
      org-scoped `GET /orgs/memberships` directory with active-by-default and
      include-terminated filtering, `/people` list with row peek, dedicated
      `/people/:id` profile, and admin-only organization-detail editing for
      department, designation, location, shift, manager, HR POC, and sourcing
      POC. Attendance, leave, and HR Settings remain for the next delivery
      steps.
- [x] Phase 8 (backend) — `LedgerAccount` (asset/liability/equity/revenue/
      expense chart of accounts, unique per org by name), `LedgerEntry` (one
      row per debit/credit line; a journal entry is >=2 rows sharing one
      `transaction_id`, balance enforced in `accounting.service`, not the
      DB — same posture as `PayrollRun`/`ClientInvoice`'s forward-only
      transitions), `TaxRecord` (`pending → filed → paid`; `jurisdiction`/
      `kind` kept free text since which tax regimes apply is still an open
      question, HLD §10). Migration
      `20260916123254_phase8_accounting_ledger_tax`. New `accounting`
      module: ledger-account CRUD, journal-entry posting, ledger-entry
      listing, trial balance / P&L / balance sheet reports, tax-record
      lifecycle. Posting is manual/API-driven, not auto-generated from
      billing/expense/vendor-payment events yet. 14 new tests
      (`erp-phase8-accounting.test.js`), eslint clean.
- [x] Phase 8 (remaining) — frontend built 2026-09-18 (ledger accounts,
      journal entries, all three reports, tax records, plus invoicing —
      see that dated entry below).
- [ ] Phase 8 (still open) — no period-close/retained-earnings posting (the
      balance sheet reports the not-yet-closed-into-equity gap rather than
      hiding it — see its `balances` field); no auto-posting from
      billing/expense/vendor-payment events (manual/API journal entries
      only, today).
- [x] Phase 9 (backend) — `ExternalAccess` (scoped, time-boxed, read-only
      guest grants for Legal/CA; deliberately **not** an `OrgMembership` —
      its own bearer-token auth path, `authenticateExternal`/
      `requireExternalScope` in `middleware/auth.js`, separate from JWT user
      auth entirely; the opaque token is SHA-256-hashed at rest and returned
      exactly once, on grant). Migration
      `20260916130602_phase9_external_access`. New `externalAccess` module:
      admin grant/list/revoke (ordinary JWT+org admin auth) plus a guest
      portal that reads the accounting module's own report functions (trial
      balance / P&L / balance sheet / tax records) so a CA sees numbers
      computed identically to an org admin, scoped to whatever `resources`
      the grant names. 7 new tests (`erp-phase9-external-access.test.js`),
      eslint clean.
- [x] Phase 9 (remaining) — frontend built 2026-09-18 (admin grant/revoke
      screen + public `/guest-access` portal), see that dated entry below.
- [ ] Phase 9 (still open) — no email delivery of the token (returned in the
      API response only — nothing to send it through yet, matching "begin
      implementation locally" posture); no per-view audit trail beyond
      `last_used_at`/`use_count` (HLD §10 flags whether one is needed as
      still open); guest surface limited to the accounting module's read
      reports today (matches the HLD's own example verbatim, "read
      accounting for Org X" — extend `externalAccess.validation.js`'s
      `RESOURCE` enum as more modules grow a guest-facing view).
- [x] Phase 10 (backend) — org chart + lifecycle visualization. **No schema
      change** — `OrgMembership.manager_id`, `employment_status` (including
      `pending_onboarding`/`notice_period`), and `notice_end_date` all
      landed already, in the 2026-09-15 Phase 2 amendment. New `orgChart`
      module: `GET /org-chart` (any active org member — a directory, not
      admin-only — builds the `manager_id` tree in memory,
      `include_terminated` toggle) and `GET /org-chart/group`
      (`authorizeGroupSuperadmin`, combined view across every org, optional
      `org_group_id` filter, mirrors the super-dashboard's cross-org
      posture). 6 new tests (`erp-phase10-org-chart.test.js`), eslint clean.
- [x] Phase 10 (remaining) — frontend built 2026-09-18 (`OrgChartPage`, org
      + group modes, new-hire/notice-period badges), see that dated entry
      below.
- [ ] Phase 10 (still open) — no dedicated onboarding/resignation workflow —
      `pending_onboarding`/`notice_period` are just `employment_status`
      values an admin sets via the existing `PATCH /orgs/memberships/:id`,
      matching the HLD's "without a separate workflow engine" framing.
- [ ] **Full cross-suite regression (all ~54 test files) for Phases 8-10 —
      deliberately deferred.** Each new phase's own suite is green in
      isolation (27/27 across the three files above); the full-suite run
      keeps hitting this machine's known resource ceiling (severe RAM
      contention → transient Postgres disconnects / OOM, documented earlier
      in PROGRESS.md) and was explicitly paused mid-run at the human's
      request to prioritize shipping Phase 8-10 functionality first. Run it
      before merge.
- [x] Phase 3 — project-centric `TimesheetEntry` (one per employee/day/
      project), org-wide daily `TimesheetLock`,
      `TimesheetRegularizationTicket` (post-lock changes only). New
      `timesheets` module (log/edit/approve/reject entries, lock a day,
      raise + decide tickets). Migrations
      `20260916052421_phase3_project_timesheets` +
      `20260916052614_phase3_timesheet_decision_reason`. 14 new tests, full
      suite 46/360 green. See PROGRESS.md / plan doc log for detail.
- [x] Phase 3 (remaining) — frontend built 2026-09-18, see that dated entry
      below.
- [ ] Phase 3 (still open) — reconciling attendance-derived overtime against
      logged timesheet hours (currently computed from attendance alone, per
      Phase 2).
- [x] Phase 4 (backend) — `SalaryStructure` (versioned by `effective_from`,
      MONTHLY `ctc` + itemized `components` validated to sum to it),
      `PayrollRun` (draft → processed, one per org/period, one-way like
      `TimesheetLock`), `Payslip` (`gross`/`deductions`/`net` +
      full `breakdown` JSON). Migration `20260916074851_phase4_payroll`
      (+ `payslip` added to `DocumentEntityType` for a future PDF attachment
      via the existing polymorphic Document model — no dedicated FK). New
      `payroll` module: salary-structure CRUD, run create/process, payslip
      views (self + admin team + per-run). 13 new tests
      (`erp-phase4-payroll.test.js`), full suite **47/373 green**, eslint
      clean. See PROGRESS.md / plan doc log for the computation formula and
      its documented assumptions (5-day work week, no weekly-off calendar
      yet; overtime tracked but not paid).
- [ ] Phase 4 (remaining) — frontend (salary structure admin screen, run
      processing UI, payslip view); a correction/re-run workflow for a
      mistaken run (today: one-way, no undo); payslip PDF generation.
- [x] Phase 5 (backend) — `BillingRate` (per account/requirement,
      versioned by `effective_from`, requirement-specific overrides
      account-wide), `DailyProjectRevenue` (one row per project/day,
      computed from that day's APPROVED + billable `TimesheetEntry` hours ×
      the applicable rate; hourly = hours × rate, monthly = rate prorated
      over days in month; idempotent recompute), `ClientInvoice` (one per
      client account/period, generated from a period's computed revenue,
      `draft → sent → paid` forward-only), `GroupBillingCharge` (intra-group
      charge against a member org, raised only by a group-superadmin).
      Migration `20260916092941_phase5_billing`. New `billing` module.
      12 new tests (`erp-phase5-billing.test.js`), full suite **48/385
      green**, eslint clean. See PROGRESS.md / plan doc log for the rate
      resolution + revenue formula.
- [x] Phase 5 (remaining, part) — invoicing frontend (compute revenue,
      generate, status transitions) built 2026-09-18, folded into the
      Accounting tab — see that dated entry below.
- [ ] Phase 5 (still open) — a dedicated billing-rate admin screen and
      group-charge screens (no frontend yet, not in scope for the last
      pass); the nightly/scheduled auto-compute for daily revenue (today
      it's an admin-triggered `POST /billing/daily-revenue/compute` call,
      not a background job — matches the project's "add a job queue only
      once something needs it" posture); invoice PDF/export.
- [x] Phase 6 (backend) — `DailyEmployeeProfitability` fact table (one row
      per org_membership/day; `revenue` = that day's `DailyProjectRevenue`
      (Phase 5) allocated pro-rata by hours across everyone who logged
      approved+billable time on each project; `cost` = `SalaryStructure.ctc`
      prorated to the day, no overhead allocation yet; `margin` = revenue −
      cost). Migration `20260916103733_phase6_profitability`. New
      `profitability` module (org-scoped: compute, self/team view, rollup by
      day/month) + `super-dashboard` module (cross-org, `authorizeGroupSuperadmin`
      only, `GET /super-dashboard/rollup` reads exclusively from the fact
      table per HLD §7, `org_id` optional for a group-wide total vs. a
      company drill-in). New nightly cron `jobs/profitabilityCompute.js`
      (computes *yesterday*, wired into `jobs/index.js`, no-op wherever no
      orgs exist yet). 10 new tests (`erp-phase6-profitability.test.js`),
      full suite **49/395 green**, eslint clean. See PROGRESS.md / plan doc
      log for the allocation formula.
- [x] Phase 6 (remaining, part) — super dashboard UI + per-company drill-in
      built 2026-09-18 (Group Overview), see that dated entry below.
- [ ] Phase 6 (still open) — an org-scoped "my profitability" self-service
      view has no frontend yet; overhead-cost allocation (today: salary
      only); a materialized-view/refresh layer for rollups if live `SUM()`
      ever stops being fast enough (deliberately not built yet per HLD §6 —
      the fact table is still small).
- [x] Phase 7 (backend) — `ExpenseClaim` (`pending → approved → reimbursed`
      or `→ rejected`, scoped by `Location`) and `VendorPayment`
      (`pending → approved → paid` or `→ rejected`; `contractor` /
      `external_resource` / `third_party`; `vendor_name` is plain text —
      deliberately **not** linked to the recruitment domain's
      `Account(type=vendor)`, which is candidates/money coming *in* from a
      sourcing vendor, not money going *out*). `expense_claim` /
      `vendor_payment` added to `DocumentEntityType` so a receipt/invoice
      attaches via the existing generic documents module — no new upload
      code needed. Migration `20260916115320_phase7_expenses_vendor_payments`.
      New `expenses` module (self-serve claims + admin decide/reimburse;
      admin-only vendor payments). 10 new tests
      (`erp-phase7-expenses.test.js`), full suite **50/405 green**, eslint
      clean.
- [x] Phase 7 (remaining) — frontend built 2026-09-18, see that dated entry
      below.
- [ ] Phase 7 (still open) — no claim/payment limits or approval-chain
      policy (single-admin-decides today, matching every other decision
      flow in this codebase).
- [ ] Local demo script (plan doc §"Local demo script") passes end-to-end with
      two orgs + isolation verified.
- [ ] Never merge this branch into `dev`/`staging`/`main` without the human's
      explicit go-ahead (standing rule).

### 2026-09-18 — Nav restructuring + Phase 3 client-brief frontend (Financials, Analytics & Multi-Company Group Management)

Closes most of the "frontend" gaps the phase bullets above still listed as
open, plus a sidebar cleanup pass. All new frontend, uncommitted (see
plan doc's matching log entry for the full breakdown, including exact
files and what's deliberately still thin).

- [x] **Nav consolidation** — `People` (Directory/Org Chart/Users/HR
      Settings), `Time & Attendance` (Attendance/Leave/Timesheets), and
      `Finance` (Expenses/Vendor Payments/Accounting/External Access) are
      now single sidebar entries with an in-page tab strip each, instead of
      one row per sub-resource. Old routes (`/people/settings`, `/users`,
      `/leave`) redirect into the new `?section=` tabs. This also structurally
      removes the "People and HR Settings both highlight" class of bug —
      `AppLayout.jsx`'s old special-cased `isNavItemActive` hack (for the
      `/people` vs `/people/settings` prefix collision) is deleted; there's
      no longer a prefix collision to special-case.
- [x] **Group Overview** — new sidebar item, visible only when
      `isGroupSuperadmin` (route-guarded too, not just hidden). Dashboard tab:
      KPI row, a revenue/expense `ComposedChart` with day/month/quarter/year
      grouping (quarter/year didn't exist before this — added to
      `profitability.service.rollup`'s bucketing, shared by both
      `/profitability/rollup` and `/super-dashboard/rollup`), and clickable
      subsidiary tiles (`switchOrg` + navigate home = "drill into that
      company's ERP"). Org Chart tab reuses `OrgChartPage` in group mode.
      New endpoints: `GET /super-dashboard/subsidiaries`,
      `GET /super-dashboard/financials-rollup` (layers expenses + vendor
      payments on top of the profitability rollup; vendor payments are
      skipped on a `day` bucket since `VendorPayment` only has month/year
      granularity — documented gap, not a bug). New `Org.valuation` (nullable
      decimal, migration `20260918120000_add_org_valuation`) — manually
      set/cleared by a group superadmin via `PATCH /orgs/:id/valuation`; no
      valuation methodology exists, so this is an admin-entered figure, never
      computed.
- [x] **Org Chart frontend** (Phase 10) — `OrgChartPage`, a recursive tree
      render off `GET /org-chart` / `GET /org-chart/group`; new-hire
      (`pending_onboarding`) and notice-period (`notice_period` +
      `notice_end_date`) badges read directly off `employment_status`.
- [x] **Timesheets frontend** (Phase 3 remaining) — log/edit entries, admin
      team view + approve/reject, daily lock, regularization ticket
      request/review. Not built: a UI surfacing whether a specific day is
      already locked before a submit attempt (today: the API's 409 comes
      back as a toast, not a pre-check).
- [x] **Expenses + Vendor Payments frontend** (Phase 7) — self-serve claim
      submission + admin decide/reimburse; admin-only vendor payment
      raise/decide/pay.
- [x] **Accounting frontend** (Phase 8) — ledger-account CRUD, a balanced
      (debit=credit, enforced client-side before enabling submit)
      journal-entry form, and all three reports (trial balance / P&L /
      balance sheet), tax-record lifecycle.
- [x] **Invoicing frontend** (Phase 5, the piece the client brief's
      "Accounting & Compliance" section actually named) — folded into the
      Accounting tab: compute daily revenue, generate a draft invoice,
      forward-only status transitions. **Not built**: a dedicated billing-rate
      admin screen or the group-billing-charge screens — nothing in the
      client brief named those explicitly, so they stayed out of scope for
      this pass.
- [x] **External Access / Guest portal frontend** (Phase 9) — admin
      grant/revoke screen (the plaintext token is shown exactly once, as the
      backend already guarantees) plus a public `/guest-access` page
      (outside the login/AppLayout shell entirely — a reviewer has no user
      account) where a pasted token drives the same four accounting reports
      via a bare `axios` instance, deliberately not the app's `apiClient`
      (never touches the normal JWT refresh/redirect machinery).
- [x] **Small necessary fixes found along the way**: `users.service.js`'s
      `PUBLIC_SELECT` didn't include `is_group_superadmin`, so a page refresh
      (not just a fresh login) would silently drop group-superadmin status
      client-side — fixed. A `departments_org_id_fkey` `ON UPDATE` action
      left mismatched by the earlier org-scoping migration was flagged by
      `prisma migrate diff` as drift — fixed with a small follow-up migration
      (`20260918121000_fix_department_org_fk_action`), applied and registered
      via `prisma migrate resolve` (already-applied, not re-run).
- [ ] **Not built this pass**: Phase 4 (payroll) and Phase 6's org-scoped
      "my profitability" self-service view have no frontend yet — out of
      scope for what the client brief actually asked for here. Group-charge
      admin screens (Phase 5) likewise. `OrgGroupMembership` (which scopes a
      group superadmin to specific holding groups) has no admin UI to grant
      it — the single-holding-group fallback in `authorizeGroupSuperadmin`
      covers today's local dev setup, but a second real holding group would
      need this.
- [ ] **Verification caveat**: this machine is severely RAM-constrained
      (5.9 GB total, well under 1 GB free even at idle) — an automated
      Playwright smoke-run across every new page hit a genuine browser OOM
      partway through (Finance hub + Timesheets came back with an empty
      page body, no console error — consistent with a silent renderer
      crash, not a code defect). Confirmed instead via: `npm run lint` (0
      errors across every new file), Vite transforming every new file
      without error, a full static read-through of the flagged files, and
      `curl`-verified 200s on every backend endpoint the new pages call.
      **Still needs an actual human click-through** before calling it done.
- [x] **2026-09-18 follow-up — Org Chart tree re-architecture, Phase 4
      (Payroll) frontend, and the remaining Phase 5 screens.** Closes the
      three gaps the previous entry (above) explicitly left open.
  - [x] **Org Chart re-architecture** (`OrgChartPage.jsx`) — replaced the
        left-indented nested list with a real top-down tree: pure-CSS
        parent/child connector lines (`.org-tree` rules in `global.css`,
        the standard flex + `::before`/`::after` branch-line technique, no
        chart library needed), and every tree is now rooted under one
        synthetic top node (the company, or "Group" in group mode) instead
        of rendering N unconnected root cards when several employees have
        no manager set — which is what this repo's actual seed data does
        (13 memberships, 0 with a manager). New-hire / notice-period / on-
        leave / terminated badges carried over unchanged. Single-org and
        group (`groupOrgs` prop, used by Group Overview) modes both
        supported from the same component.
  - [x] **Payroll frontend** (Phase 4, `pages/payroll/PayrollHubPage.jsx`,
        new `/payroll` route + nav item, `viewPayroll` self-service for
        every role, `managePayroll`-equivalent admin tabs matching the
        backend's own `authorize('admin')` gating) — Salary Structure
        Configurator (employee picker off the new `useOrgMembershipOptions`
        lookup, CTC + dynamic components that must sum to CTC, client-side
        balance check before enabling submit — a deduction-type component
        is just a negative amount, since the backend models CTC as one
        additive breakdown, not gross-minus-deductions); Payroll Run screen
        (create a draft run for a period, process it, see skipped-employee
        reasons); Payslip viewer (gross/deductions/net + the full attendance
        breakdown the backend already computes) with a "Print / Save as
        PDF" action. **No server-side payslip PDF exists** (pre-existing,
        documented backend gap) — the print action opens a small standalone
        HTML document in a new window and calls the browser print dialog,
        which sidesteps fighting the app shell's animated/fixed layout for
        an in-page `@media print` rule and gives the same "save as PDF"
        outcome without a new dependency.
  - [x] **Phase 5 remainder** — Billing Rate admin screen
        (`finance/BillingRatesTab.jsx`, new Finance-hub tab: per-client,
        optionally per-requirement, hourly/monthly rate with an effective
        date) and Intra-Group Billing Charges (raise + view-all as a new
        Group Overview tab, `groupOverview/GroupOverviewPage.jsx`'s
        `GroupChargesTab`, gated the same way Group Overview itself is —
        `isGroupSuperadmin`, not a role capability; plus a read-only
        "charges against this company" view in the Finance hub,
        `finance/GroupChargesTab.jsx`, matching the backend's own split
        between `authorize('admin')` reads and `authorizeGroupSuperadmin`
        writes/all-reads).
  - [x] **Verification** — `npm run lint`: 0 errors (3 `react/no-unescaped-
        entities` from this pass fixed; same pre-existing `exhaustive-deps`
        warning style as every other tab file). Every new/changed endpoint
        exercised for real against the running dev server — not just a GET
        200 this time: created a salary structure, created and **processed**
        a payroll run (confirmed skipped-reason payloads and a generated
        payslip's breakdown match the component's field assumptions
        exactly), fetched the payslip both ways (`/payslips/me` and
        `/payslips/:id`), created a billing rate and confirmed its
        `account_not_found` error shape, and created + listed an intra-group
        charge both scoped ("mine") and unscoped ("all", with the `org`
        relation the group view needs). All matched what the frontend
        sends/expects.
  - [ ] **Same RAM-constrained-machine caveat as the previous entry** — no
        in-browser click-through of these new screens either; verification
        here is lint + live API round-trips + static review, not a human
        looking at the rendered page. This is still the one meaningfully
        open item.
  - [ ] Not built (still correctly out of scope): payroll run
        correction/re-run, salary-structure history editing beyond
        append-a-new-effective-dated-row, and a real `OrgGroupMembership`
        grant UI — none of these were asked for here either.

- [x] **2026-09-20 call-prep audit** (details: plan doc, same date) — timesheets
      now validate against the *project's* calendar (project > employee default >
      office location > org default); payroll uses per-employee calendars; 24h/day
      cap enforced on edit + ticket approval too; attendance `late_minutes`
      (grace-aware, migration `20260920120000`); leave overlap + balance guards;
      revenue recomputed on timesheet approval (no manual compute); monthly
      draft-payroll job; calendar `location_id` API + `npm run erp:seed:locations`;
      HR Settings location field, employee-profile calendar mapping, Late column.
      New `erp-multiproject-calendars.test.js` (14 green, isolated test DB).
  - [ ] **Pre-existing red tests to fix**: `orgs-phase1` (5), `erp-phase6` (1),
        `erp-phase10` (1) — need an `OrgGroupMembership` for the group superadmin
        (holding-company hardening now returns 403 without one).
  - [ ] **Policy calls for the client**: do weekends/holidays burn leave balance
        (today: calendar days inclusive)? monthly leave accrual/carry-forward?
        per-project shifts? recruiter-performance report off `sourcing_poc_id`?
        holiday-work override on timesheets? overtime/late affecting pay?
  - [ ] Not browser-verified (same RAM-constrained machine): HR Settings calendar
        form, employee-profile calendar mapping, Attendance "Late" column.
  - [ ] Staging Neon DB is NOT migrated for `late_minutes` yet (Render's
        `prisma migrate deploy` applies it on next deploy).

- [x] **2026-09-20 multi-tenant sign-in redesign** (details: plan doc, same date) — workspace step + tenant badge, animated preview panel, floating-label form, dark mode (sign-in only), SSO buttons (UI only), dev quick-login bar with Multi-Org Admin, sidebar `WorkspaceSwitcher`. Backend: public `GET /auth/workspace/:slug`, optional `org_slug` on login (6 tests).
  - [ ] Not browser-verified (light + dark + mobile) - RAM-constrained machine.
  - [ ] No SSO backend, no password-reset flow exist; the SSO buttons only explain that.
  - [ ] Set `VITE_DISABLE_QUICK_LOGIN=true` on any user-facing build (staging shows the dev bar today).
  - [ ] Staging Neon DB not seeded with the multi-org demo user (`npm run erp:seed:multi-org` is local only so far).
  - [ ] Pre-existing red test: `auth.test.js` GET /users/me for a user with no org membership returns 403 (org-context hardening).
- [x] **2026-09-21 multi-company requirements pass** (details: plan doc, same date) — vertical modules per company (Gulati trading, Zephyr leads/self projects/contracts/legal-site docs, Acconcy leads + recurring contracts/MRR), Delphic real-time analytics (billing, revenue by client / brought-by / owner, face vs working resource, salary, expenses, vendors), company financials + plan vs actual, Super Admin projections + dynamic valuation, email outbox + calendar (.ics / Teams link) invites, click-through report links. 29 new tests.
  - [ ] Not browser-verified (RAM-constrained machine); API smoke-tested against seeded data for every new module.
  - [ ] Email delivery needs `NOTIFICATIONS_SMTP_URL` (+ `NOTIFICATIONS_EMAIL_FROM`) on the target env; without it queued mail is marked `skipped`. Teams meeting *creation* (Graph API) is not built - invites carry a pasted Teams/Meet link.
  - [ ] "Face" vs "working" resource is my reading of the brief (mapping table, revenue attributed face <- working). Confirm the definition with the client.
  - [ ] Valuation is a revenue / EBITDA multiple over the last 3 complete months (defaults 3x / 8x) - the client should supply the real multiples or method.
  - [ ] Project legal/site files are served from `/uploads` (authenticated, not org-scoped) - same as other attachments; tighten if legal documents need per-org file isolation.
  - [x] Staging Neon DB migrated (33/33) and seeded (4 companies) on 2026-09-21 via `server/scripts/staging-bootstrap.js`. Render runs the same script on every boot (`SEED_STAGING=true` tops up demo data; base CSV import only on an empty DB).
  - [ ] Render staging service still needs to be created from `render.yaml` and the `staging` branch has to receive these files (human step; `origin/staging` had none of them). Rotate the Neon password - it was pasted in chat twice.

**⚠️ RESUME POINT — read [PROGRESS.md](PROGRESS.md) top entries first.** Product UI + role pipelines + V2 lead/rounds/bench + **2026-08-29** closure-progress rings + requirement × stage matrix (`GET /pipeline/board`) + form field wiring are implemented locally on `main` but **still uncommitted**. **Also landing via cherry-pick `7ba5c90`:** internal-round interviewer multiselect + alert banners. **Open:** commit/push the uncommitted pile; V2 + matrix manual browser click-through; RD-119 E2E; RD-122 deploy day (`DEPLOY_ENABLED` + VPS secrets). See PROGRESS.md 2026-08-29 and 2026-08-27. Manual reports/password: [TESTING-RD-114-128.md](../testing/TESTING-RD-114-128.md). Spec: [RD-115-SPEC-WALKTHROUGH.md](../ui/RD-115-SPEC-WALKTHROUGH.md). Redesign: [UI-REDESIGN.md](../ui/UI-REDESIGN.md). V2 design: [V2-LEAD-PIPELINE-REQUIREMENTS.md](../architecture/V2-LEAD-PIPELINE-REQUIREMENTS.md).

## Time to submit re-anchor + Type/Vendor + calendar meetings (2026-09-08, branch `dev-deep`)

- [x] Time to submit durations re-anchored to `requirement.created_at` (req→submission / req→R1 / req→submitted).
- [x] Time to submit: Type (Bench/Vendor/Market) + Vendor name columns; export updated.
- [x] Calendar feed includes client meetings (`meeting_date` accounts); online = blue, in-person = amber; legend + labels + `/accounts/:id` links; interview-only actions hidden.
- [x] Tests: reports-time-to-submit (6), interviews-calendar (+3 meeting cases); full server suite 267 green; client lint+build clean.
- [ ] Manual: open the calendar as admin — a scheduled client meeting shows in blue/amber and opens the account.

## Reports: Joinings + Time to submit (2026-09-08, branch `feature/reports-joinings-time-to-submit`)

- [x] `GET /reports/joinings` — by sourcer / by interviewer (L1+L2) / by vendor, per month.
- [x] `GET /reports/time-to-submit` — per submission: sourced→submission, submission→R1, R1→submitted; sourcer column; hover shows from/to timestamps.
- [x] Time to submit filters: client_id / requirement_id / sourcer_id / candidate search + date range.
- [x] Client: visible "Joinings" (3 tabs) + "Time to submit" reports; export branches.
- [x] Tests: reports-joinings (5), reports-time-to-submit (5); all 6 reports suites (53) green.
- [ ] Manual: numbers match a hand count against `/submissions?stage=closed`; xlsx export.

## Reports polish + source relabel + notif time + calendar overlap (2026-09-08)

- [x] Reports dates as `08 September 26`; HR chart axis `08 Sep 26`.
- [x] Source relabel Direct→Bench, LinkedIn→Market (display only, no migration).
- [x] HR Sourcing/Submissions: 1 row per sourcer/day; source split on Count hover.
- [x] HR chart horizontally scrollable (no carousel).
- [x] Notification interview times fixed (UTC → `APP_TIMEZONE`, default Asia/Kolkata).
- [x] Calendar time-grid horizontal overlap fixed (cluster column packing); `monthGrid.test.mjs`.
- [ ] Manual: open a notification for a scheduled interview → time matches the calendar;
      week view with 3+ overlapping meetings → no blocks on top of each other.

## Boards/lists: new-tab + filter persistence + Clear all + work-mode (2026-09-08)

- [x] `OpenInNewTabButton` → real `<a target=_blank>`; every board card + menu nav
      item is a `<Link>` (correct entity opens in a new tab).
- [x] List pages re-hydrate filters from URL (Back/reload/new-tab persistence).
- [x] **Clear all filters** button on `PipelineFilters` + all 4 list pages; only way to clear.
- [x] Requirements list **Work mode** filter (server `listQuerySchema`/`list()`) + column + peek field.
- [x] Fix `RequirementDetailPage` `limit: 200` → 100 (422 "Number must be ≤ 100" on every open).
- [x] Requirement peek: **Job details** CTA `<Link>`.
- [ ] Manual: cmd-click a board card → correct entity in a new tab; drag still works;
      Back keeps filters; Clear all filters is the only reset; Work mode column/filter show.

## Calendar "Review feedback" (2026-09-08)

- [x] `hasSubmittedFeedback` helper; EventCard / EventDetailDrawer / EventHoverCard
      relabel "Submit feedback" → "Review feedback" once feedback exists.
- [x] `FeedbackDrawer` pre-fills existing result/rating/feedback; "Update feedback".
- [ ] Manual: submit feedback (e.g. fail) on a calendar interview → CTA now reads
      "Review feedback" and reopening the drawer shows the saved values.

## Pipeline "Open in new tab" + Tagged profiles (2026-09-08)

- [x] `OpenInNewTabButton` on every pipeline board header (PipelineShell,
      RequirementKanbanPage, AccountPipelineBoardPage) — all roles; filters are
      already URL-synced so the new tab keeps them.
- [x] **Tagged profiles** table on `RequirementDetailPage` (`GET /submissions?requirement_id=`).
- [ ] Manual: filter a pipeline board, click Open in new tab → new tab shows the same
      filtered board; open a requirement → Tagged profiles lists its candidates with links.

## HR report + em-dash sweep (2026-09-08)

PROGRESS.md 2026-09-08 top entry.

- [x] `GET /reports/hr` — 4 per-day tables (sourcing, submissions, round-1 by
      sourcer, round-1 by interviewer); on-bench excluded; export + tests.
- [x] Reports page: visible **HR reports**, Type/Sourcer/Interviewer filters,
      named tabs (icon + count pill) + per-day bar chart per tab.
- [x] Em-dash → hyphen in `client/src` visible prose (31 lines); placeholders +
      comments left as-is.
- [ ] Manual: Reports → HR as admin — 4 tables render, filters narrow, on-bench
      candidate never appears, `no_show` counts scheduled-not-completed, xlsx = 4 sheets.
- [ ] Future: extra HR tables (round 2, client rounds) as they're requested; a
      dedicated `hr` role.

## Superadmin record deletion — soft-delete (branch `feature/superadmin-record-deletion`, 2026-09-08)

PROGRESS.md 2026-09-08. Spec: [RD-SUPERADMIN-RECORD-DELETION.md](../features/RD-SUPERADMIN-RECORD-DELETION.md).

- [x] Schema: `deleted_at`/`deleted_by`/`delete_reason` on 5 models + `AuditLog`.
- [x] Migration `20260908120000_soft_delete_and_audit` (additive, idempotent).
- [x] `prisma.$use` soft-delete filter in `config/db.js`.
- [x] `admin` module: `POST /admin/:type/:id/delete` + `/restore` + `GET /admin/deleted`.
- [x] Client `DeleteRecordButton` on 4 detail pages + `InterviewRoundsPanel`; cap `deleteRecords`.
- [x] **Settings → Deleted records** tab (superadmin) — `DeletedRecordsPanel`: list + Restore + audit trail.
- [x] `GET /admin/deleted` (+ deleter name) and `GET /admin/audit`; deletions folded into dashboard Recent activity.
- [x] **`GET /users/directory`** — every role reads the full roster (inactive included); all filter/owner/POC pickers repointed. `users-directory.test.js`.
- [x] Settings tab bar full-width (`flex-1`), container `max-w-5xl`.
- [x] `server/tests/admin-soft-delete.test.js` 12/12; full server suite 34/245 green.
- [x] Migration applied to local dev + test DBs.
- [ ] Manual: superadmin deletes Spiral TechnoLabs (`ACC-F637AC68`) → gone from
      `/accounts`, `/dashboard`, `/reports`; `GET /admin/deleted` lists it; restore works.
- [ ] Hand the human the `prisma migrate deploy` step for staging/prod (agent never touches `main`).

## Calendar hover cards + Merge `main` + schema realign (branch `feature/notifications-calendar`, 2026-09-07)

PROGRESS.md 2026-09-07 top entries.

- [x] Month-view event pills expand a full-detail `EventHoverCard` on hover/focus.
- [ ] Browser check: hover a month-view meeting pill → card shows all details,
      flips near the right edge, "Join meeting" link is clickable, closes on leave.

- [x] Merged `origin/main` (`727ca7b`) → `8f15352`, no conflicts. Brings in
      specialization column, CWR 3-tab / RVG 2-tab report rework + date-filter
      removal, `active_requirements_count`, BDA full requirement map, open
      document reads, `FileViewerModal` + `docx-preview`, multipart upload fix,
      candidate "View full details".
- [x] `npm ci` synced `node_modules`; `prisma generate`d.
- [x] `server/prisma/schema.prisma` reconstructed to match
      `20260903110804_notifications_and_calendar` (notification models +
      `InterviewRound` status fields). Server suite 32/32 · 219/219 green.
- [ ] **Commit `server/prisma/schema.prisma`** — the only uncommitted change.
- [ ] Decide `chahak.pandya`: she is role **`sales`**, so the BDA requirement-map
      fix doesn't widen her view (sees a scoped map, 0 rows — owns no
      `sales_owner` requirements). Options: widen `sales` in `requirementScopeWhere`
      too, or change her account role to `bda`.
- [ ] Browser click-through of the merged features on this branch: CWR/RVG tabs;
      resume upload + in-app viewer (PDF inline, `.docx` via docx-preview,
      download); sales opens a candidate's full details from the peek; BDA sees
      the full requirement map.
- [ ] AGENTS.md "clients-without-requirements" bullet updated for the new
      buckets — re-verify against the running app.

## Login polish + rename + hover-zoom + calendar dot (branch `feature/notifications-calendar`, 2026-09-04)

PROGRESS.md 2026-09-04 top entry.

- [x] "Delphic one" rename on login + `index.html` title; login page redesigned (gradient brand panel + card).
- [x] `.hover-zoom` utility applied to KPI / stat / dashboard-panel / calendar cards.
- [x] `interviewUnread` in notifications context → red count pill on the Calendar nav item.
- [ ] Browser check: Calendar nav badge appears when an interview_scheduled notification is unread and clears once the bell / notifications page marks it read; login panel looks right at `lg` / `xl` and on mobile; hover-zoom feels right (no clipping) on the dashboard.

## Settings page (branch `feature/notifications-calendar`, 2026-09-04)

PROGRESS.md 2026-09-04 top entry.

- [x] `/settings` tabbed page (Account / Security / Notifications / Activity), `?tab=` synced, nav item + header title/subtitle.
- [x] Change-password extracted to `ChangePasswordForm`; modal removed; avatar menu → Settings link + Logout.
- [x] `GET /users/me/activity` (own `stage_history`, labelled) powering the Activity tab.
- [x] `/notifications/preferences` redirects to `/settings?tab=notifications`; bell "Settings" link updated.
- [ ] `cd server && npm test` when `:5434` is up — add a small `users-activity` check (own rows only, respects `limit`). Not run this session.
- [ ] Browser click-through: each tab loads; deep-link `?tab=activity` selects the right tab; password change still works from Settings; logout from the Account tab; old `/notifications/preferences` bookmark lands on the Notifications tab.

## Brand pass — accent #105aa9 + login redesign + home preloader (branch `feature/notifications-calendar`, 2026-09-04)

PROGRESS.md 2026-09-04 top entry.

- [x] `primary` Tailwind scale + `--color-primary*` tokens rebuilt around `#105aa9`; hardcoded `#0052FF`/`#EEF4FF`/`#DBE6FE` literals swapped app-wide.
- [x] Login page split layout using `undraw_dashboard_p93p.svg` + `Delphic_D-logo_transparent.png` + `delphic-logo.png`.
- [x] `HomePreloaderGate` (Lottie `d_preloader.json`, `lottie-web`, sessionStorage `site_preloader_played`, fail-open) wraps the index route.
- [ ] Browser click-through: first load shows the Lottie overlay then reveals the dashboard once a loop completes; reload in the same tab skips the Lottie; new tab/session shows it again; login page split panel renders and is responsive; spot-check that no screen still shows the old blue.
- [ ] `client/package-lock.json` / root lockfile now include `lottie-web` — commit with the rest.

## Notifications + Interview Calendar — BUILT (branch `feature/notifications-calendar`, 2026-09-04)

Full design + as-built: [features/RD-NOTIFICATIONS-AND-CALENDAR.md](../features/RD-NOTIFICATIONS-AND-CALENDAR.md) §10. PROGRESS.md 2026-09-04.

- [x] **Schema** — migration `20260903110804_notifications_and_calendar`; `helpers.js` truncate list + `createInterviewRound`.
- [x] **Dispatch layer** — `server/src/lib/notifications/` (`eventCatalog` / `recipients` / `dispatch` / `index`).
- [x] **Notifications API** — `server/src/modules/notifications/` + `DELETE /preferences` (reset); mounted.
- [x] **Wire call sites** — accounts `changeStage`; requirements `create`/`assign`/`unassign`/`changeStatus`; submissions `addInterviewRound`/`updateInterviewRound`/`changeStage`.
- [x] **Interviews API** — `server/src/modules/interviews/` (`GET /`, `POST /:id/feedback`, `POST /:id/cancel`); mounted.
- [x] **Reminder cron** — `node-cron`; `jobs/interviewReminders.js` + `jobs/index.js` `startJobs()`; `ENABLE_JOBS` in `env.js` + both `.env.example`; `ENABLE_JOBS=false` in `tests/env.setup.js`.
- [x] **Frontend shared bits** — `client/src/lib/interviewRounds.js`; `components/ui/Toggle.jsx`; `Badge.jsx` colors; `id="interview-rounds"`.
- [x] **Frontend — notifications** — `NotificationsProvider` (inside `AlertProvider`) + `NotificationBell` + `/notifications` + `/notifications/preferences`.
- [x] **Frontend — calendar** — `/calendar` + nav item; `monthGrid.js`; month + agenda views; `EventDetailDrawer` + `FeedbackDrawer`; cancelled struck-through / red strip. Dashboard widget: **skipped** (optional).
- [x] **Tests** — `notifications.test.js`, `interviews-calendar.test.js`, `interview-reminders.test.js` written.
- [x] **Docs finalize** — spec §10 as-built; PROGRESS.md entry; bell in `ui/UI-UX-JIRA.md`; `ENABLE_JOBS` in `guides/DEPLOY-RUNBOOK.md`; three v2 rows flipped in `architecture/API-Spec-and-Build-Plan.md`.
- [ ] **Run `cd server && npm test`** once Docker Postgres (`:5434`) is back up — the full suite + the 3 new suites did not execute at build time (daemon was down). `vite build` + `eslint` (client + server) are clean.
- [ ] **Browser click-through** per spec §9 (assign→bell, schedule→calendar, reschedule, cancel, feedback→panel, preference suppression, reminder cron `node -e`).
- [ ] Decide on the optional dashboard "My upcoming interviews" widget.

## List filters + report fixes (branch `feature/list-filters`)

- [x] **2026-09-03** — Requirements "Tagged Profiles" → **"Client Submissions"**:
  count only `submitted_to_client → bgv` stages (`client_submissions_count`).
- [x] **2026-09-03** — Requirements / Profiles / Submissions list pages: full
  filter sets (URL-synced) via shared `client/src/lib/lookups.js`; Submissions
  gained a multi-stage picker + pagination.
- [x] **2026-09-03** — recruiter-vendor-gaps: `vendor_activity=active|inactive`
  toggle (sourced ≥1 vs sourced 0). clients-without-requirements: `with_requirements`
  bucket now = has open/in_progress req, so the two toggles no longer overlap.
- [ ] Manual click-through: each new filter narrows the list + round-trips through
  the URL; RVG toggle + CWR toggle switch the row set with no overlap; "Client
  Submissions" count matches the client-facing pipeline on a known requirement.

## Backend

- [x] Install, migrate, seed, Docker end-to-end verified.
- [x] All spec API routes present; stage machines, locking, auth tested.
- [x] RD-123 stuck dashboard lists + RD-129 role-scoped summary.
- [x] RD-124 recruiter/vendor avg-day metrics.
- [x] Ownership on account/requirement mutate paths.
- [x] RD-130 admin / comments / documents split to routes/controller/service/validation.
- [x] Test suite: **14 suites / 83 tests** green (`cd server && npm test`). Linter: `npm run lint` (RD-116).
- [x] Interview feedback API (create + PATCH) and extended interview/closure report metrics (RD-132).
- [x] Structured backend logging (`logger` + request/error/lifecycle) — see [BACKEND-LOGGING.md](../guides/BACKEND-LOGGING.md).
- [x] Comments `entity_type` includes `profile` (for Candidate Notes on RD-110).
- [x] Superadmin tier (`User.is_superadmin`, `admin@delphic.in`): full user editing (`PATCH /users/:id` + `password`/`is_superadmin`, `GET /users/:id`), locked-record edits, stage overrides. **Admin + superadmin** may edit account `origin_owner_id` ("Brought by"). Update-only, no deletes. Migration `20260901131738_add_is_superadmin`. See PROGRESS.md 2026-09-01 / 2026-09-03.
- [ ] Superadmin: manual browser click-through (edit a user's role/email/password; override a dropped account back to `lead`). Confirm an ordinary admin can edit "Brought by" but not override stages.
- [x] **2026-09-03** — Admin can undo/reactivate submission stages (reason required); ticket profile visibility fix (history fetch decoupled); actor name on requirement/submission history; CWR report bucket toggle; RVG hides Recruiters column. See PROGRESS.md.
- [x] **2026-09-01** — `clients-without-requirements` report: "Sales POC" = account owner (renamed), "Brought by" kept, Department filter dropped, Brought-by + Sales-POC person filters added, admin/superadmin can edit both people inline on the Reports page. `interview_scheduled → interview_result` is manual only (no round-result auto-advance). No schema change. See PROGRESS.md.
- [ ] Manual click-through: admin edits Brought by / Sales POC inline on the Reports page; the two person filters narrow the list; ordinary BDA sees plain read-only cells.
- [x] **2026-09-02** — Reports dropdown shows only `clients-without-requirements` + `recruiter-vendor-gaps` (others `hidden: true`, still defined). `clients-without-requirements` gains a Stage filter defaulting to Active. `recruiter-vendor-gaps` reworked to one row per vendor account (our POC + recruiters + zero-submitted), filterable by vendor + our POC. Internal screening round chips (`ScreeningRoundChips`) on Candidate pipeline + Requirement map cards. Accounts list filterable by Owner + Brought by. See PROGRESS.md 2026-09-02.
- [ ] **Run `cd server && npm test`** once the Docker test DB (`localhost:5434`) is back up — `reports-coverage-gaps.test.js` was rewritten but not executed this session (Docker Desktop was down).
- [ ] Manual click-through: RVG vendor/POC filters + CWR stage filter; screening chips show `IS1/IS2` results on both boards; Accounts Owner/Brought-by filters narrow the list and round-trip through the URL.
- [x] **2026-09-03** — Pipeline board query accepts `recruiter_ids` / `submitted_by_ids` / `admin_id` (matrix "Assigned recruiters" multiselect, "Submitted by" multiselect, "All admins"). `POST /submissions/:id/stage` allows `sales` for `internal_screening → submitted_to_client` on their own requirement only (`forbidden_stage_change` otherwise). `requirements` list returns `tagged_profiles_count`. Accounts list honours `origin_owner_id`. `clients-without-requirements` includes `type: null` accounts. See PROGRESS.md 2026-09-03.
- [ ] **Run `cd server && npm test`** for the 2026-09-03 changes once `localhost:5434` is up — `pipeline-board`, `submissions-stage`, `accounts-*`, `reports-coverage-gaps` cover the touched paths; none executed this session.
- [ ] Manual click-through (2026-09-03): matrix "Assigned recruiters" + "Submitted by" + "All admins" filters narrow the board and round-trip through the URL; sales user sees only "Move to submitted to client" on an owned submission at `internal_screening` (and 403 on anything else); Requirements list shows Tagged Profiles counts; Accounts "Brought by" filter + column; CWR report shows lead/meeting/dropped accounts per the Stage filter after an API restart.
- [ ] Dashboard date-range filter bar is **inert for every metric** (never sent to `/dashboard/summary`, which has no date params). Decide: wire it through, or remove it. Stuck cards are now explicitly "as of today".
- [ ] Decide CWR semantics: keep `requirements: { none: {} }` ("never had a requirement") or switch to "no open/in-progress requirement" so dropped-then-closed clients surface.
- [x] **2026-09-03** — Superadmin stage override for submissions (`POST /submissions/:id/stage/override`, `authorizeSuperadmin`, reason required, audited); a disallowed drag on the submission/account boards opens the override drawer for a superadmin instead of the "Cannot move" toast (`SubmissionDetailPage`, `RequirementKanbanPage`, `CandidatePipelineBoard`, `AccountPipelineBoardPage`, `LeadPipelineBoard`, `AccountsListPage`). See PROGRESS.md 2026-09-03 §8.
- [ ] Manual click-through (superadmin): drag a candidate backward (submitted_to_client → internal_screening) and an account backward (active → rescheduled) on every board listed above; confirm the override drawer opens preset to the drop target, the move lands, and `stage_history` shows `[override] …`. Confirm an ordinary admin still gets the validation toast.
- [ ] `submission/:id/stage/override` has no test yet — add to `submissions-stage.test.js` (superadmin can, admin/recruiter/sales get 403) when `localhost:5434` is up.

## Frontend (open — see sprint tickets)

- [x] List pages + login + layout/logout wired to API.
- [x] RD-101–102 — account detail, stage history/move, and Client/Vendor create/edit forms.
- [x] **RD-103 / RD-104** Requirement detail + create/edit + status + seats — [TESTING-RD-103-104.md](../testing/TESTING-RD-103-104.md).
- [x] RD-105 — candidate detail + Add/Edit form + resume upload (documents API).
- [x] RD-106 — assign recruiter popup + assignment history from Requirements list.
- [x] **RD-107 / RD-108** Submission detail + put-forward — [TESTING-RD-107-108.md](../testing/TESTING-RD-107-108.md).
- [x] RD-109 — reusable `NotesPanel` + `FilesPanel` components.
- [x] RD-110 — Notes + Files on Account, Job, Candidate, and Submission detail pages.
- [x] **RD-111 / RD-125 / RD-112** Stage buttons + interview rounds UI + job kanban — [TESTING-RD-111-125-112.md](../testing/TESTING-RD-111-125-112.md).
- [x] RD-113 — role home dashboard widgets (BDA / Sales / Recruiter / Admin) on `GET /dashboard/summary`.
- [x] RD-114 — real report charts + export — [TESTING-RD-114-128.md](../testing/TESTING-RD-114-128.md).
- [x] **RD-126** Admin Users page (create BDA/Sales/Recruiter/Admin; deactivate).
- [x] **RD-131** Temporary one-click role login on login page (disable/remove before real auth).
- [x] **RD-127** Unlock UI (admin) on locked account / requirement / seat / submission.
- [x] **RD-128** Change password (Dev B) — header avatar menu — [TESTING-RD-114-128.md](../testing/TESTING-RD-114-128.md).
- [x] RD-115 spec UI audit + Jira-like list polish — [RD-115-SPEC-WALKTHROUGH.md](../ui/RD-115-SPEC-WALKTHROUGH.md).
- [x] **RD-133** UI redesign — RHS drawers, list peeks, pipeline KPIs, BDA/Sales reports — [UI-REDESIGN.md](../ui/UI-REDESIGN.md).
- [x] UX audit fix pass — all remaining forms/modals converted to RHS drawers, searchable skill/tech-stack picker, hover tooltips, BDA pipeline funnel, report KPI accuracy fixes, richer seed data, skeleton loading states.
- [x] Role-specific pipeline boards (BDA leads / Sales jobs / Recruiter candidates / Admin switcher) with shared drag-and-drop shell and card actions menu.
- [x] BDA account create/edit/stage gaps closed; Accounts/Requirements list create now use the full form, not the stripped mini-form.
- [x] Dashboard filter + list spacing polish (Aug 24–25 CSS passes), Delphic logo.
- [x] **V2** — lead classify flow + meeting location/attendees UI; interview rounds panel reworked for 6 named round types + role gating + missing-mandatory banner; candidate on-bench toggle/filter + submission picker quick filter; requirement type dropdown (managed services/recruitment/project); reports page Client performance tab + new BDA/recruiter/sales columns.
- [x] Closure progress rings + step breakdown on submissions/profiles; requirement × stage **Requirement map** board (`/pipeline?view=matrix`, `GET /pipeline/board`).
- [x] Account / profile / requirement create-edit forms wired to remaining schema fields (agreement URLs, candidate compensation/relocate, req certifications/timezone/contract, meeting notes).
- [x] Internal round interviewer multiselect (`interview_round_interviewers`) + app-wide alert banners / form validation helpers.
- [ ] Manual click-through (V2 + closure rings + requirement map + interviewer multiselect) in the browser — tests cover the new server surface; UI not yet hand-verified.
- [x] Stuck requirements list normally + `stuck` tri-state filter (`GET /requirements` `is_stuck` + `?stuck=stuck|not_stuck`; requirements list page + requirement map board). Graceful token-expiry: shared refresh promise, redirect to `/login` on unrecoverable 401 (`apiClient.js`).
- [x] **2026-09-02** — Fix: account edit form threw `null.trim()` in `buildAccountBody` for any account with null optional columns, shown only as a generic "Failed to update account" toast (no request sent). `formFromAccount`/`buildAccountBody` moved to `accountUtils.js`, null-coerced, regression-tested.
- [x] **2026-09-02** — Dashboard "Stuck" KPI: value now comes from `stuck_{leads,requirements}_count` (real `prisma.count`, uncapped) instead of the top-5 preview array length. Requirement "stuck" unified to `updated_at <= now-7d` ("no update") across dashboard / requirements list `?stuck=` / pipeline board / reports aging + explorer, matching leads & submissions. KPI hover copy updated. 29 suites / 188 tests green.
- [x] **2026-09-01** — Admin-editable account `type` (one-way `/classify` unchanged; edit-form path is admin-only re-classification, `forbidden_type_change` guard).
- [x] **2026-09-01** — Dashboard KPI fixes: `leads_active` counts all `stage: 'lead'` accounts (not just `type: 'client'`), `leads_in_meeting` includes `rescheduled`; admin dashboard now a 4-col / 10-tile grid with client vs vendor, requirements open vs in-progress, and stuck leads / stuck requirements split into their own cards.
- [x] **2026-09-01** — `components/ui/SearchableSelect.jsx` + 25 data-driven / 6-plus-option `<select>`s converted app-wide (account/requirement/profile/submission forms, list + pipeline + reports filters). Small fixed enums left native. `vite build` green; not hand-clicked in browser yet.
- [x] **2026-09-01** — Vendor account name shown on candidate cards (requirement matrix + candidate pipeline) when `source = vendor` (`/pipeline/board` + `/submissions` now select `profile.vendor_account`).
- [x] **2026-09-01** — Pipeline `submission_stage` filter now hides requirements with no candidate in the selected stage (both boards); board search matches candidate name; `stuck_only` removed in favour of the `stuck` tri-state; wired the created-date range control onto the matrix. **26 suites / 163 tests** green.
- [x] **2026-09-01** — New report tabs `clients-without-requirements` (admin/sales/bda) and `recruiter-vendor-gaps` (admin/recruiter) — accounts/POCs with no downstream activity. `server/tests/reports-coverage-gaps.test.js`.

## Infra / CI

- [x] GitHub repo + Docker compose stack.
- [x] RD-116 linter — `npm run lint` (ESLint 9, client + server).
- [x] RD-120 Docker CI smoke — compose up, health, seed, login (API + client proxy).
- [x] Server-side entity access guards (`entityAccess.js`) + recruiter scoping on submissions/documents/comments/history.
- [x] Fail-closed production env guard (`assertProductionConfig` — rejects missing/placeholder/short JWT secrets, missing `DATABASE_URL`/`CORS_ORIGIN`).
- [x] `seed-admin.js` — non-destructive prod admin bootstrap.
- [x] RD-121 deploy story — `setup-vm.sh` (VM bootstrap) + `start-delphic.sh --prod` (`docker-compose.prod.yml` overlay, secret validation, systemd unit); `deploy.yml` now SSHs and runs it.
- [ ] RD-122 deploy day — still needs `DEPLOY_ENABLED` + VPS secrets set for a real run.
- [x] **V2** schema + migration (`server/prisma/schema.prisma`, `20260827115000_v2_add_enum_values` + `20260827120000_v2_lead_pipeline_requirements`), applied to local dev + test DBs only.
- [x] **V2** backend — `POST /accounts/:id/classify`, meeting location/attendees, interview-round role scoping, candidate bench filter, `GET /reports/client-performance` + extended existing reports.
- [x] **V2** seed data remapped to new enums + new demo rows.
- [x] **V2** test coverage: new `interview-rounds-scope.test.js`, `profiles-bench.test.js`, extended `accounts-stage.test.js`/`reports-ui.test.js`.
- [x] Closure progress unit tests + `GET /pipeline/board` role-scope tests (`closure-progress.test.js`, `pipeline-board.test.js`). **23 suites / 135 tests** green (2026-08-29).
- [x] Interviewer multiselect tests (`interview-round-interviewers.test.js`).
- [x] **2026-09-03** — Prod data-loss safeguards: `start-delphic.sh --prod` takes a verified pre-deploy `pg_dump -Fc` into `./backups/` and aborts on failure (no `--restore` flag; restores are manual). `prisma/_guard.js` blocks the CSV seeds against non-local / `NODE_ENV=production` DBs (`ALLOW_DESTRUCTIVE_SEED=1` override). `start-platform.sh --restore`/`--fresh` guarded likewise. `scripts/db-backup.sh` for scheduled backups. Runbook rewritten. See PROGRESS.md 2026-09-03.
- [ ] **VPS: schedule `scripts/db-backup.sh`** (cron `*/15` or systemd timer) and set `BACKUP_OFFSITE_CMD` to copy dumps off the box. Runbook §0.
- [ ] **Enable Postgres PITR** (WAL archiving) or move to managed Postgres — recovery to the second, not the last dump. This is the real fix for "hours of data lost".
- [ ] Confirm on the VPS: `./start-delphic.sh --prod` writes `./backups/predeploy-*.dump` and the systemd `ExecStart=... --prod --service` path still boots (backup_db brings `db` up first).
- [ ] Wipe the stale `pre-restore-safety-*.dump` / `backup-*.dump` from the repo root (git-ignored but clutter); keep real backups under `./backups/` only.

## Docs

- [x] SPRINT-PLAN updated with missing tickets (RD-125–130) and DONE marks (Aug 21).
- [x] Backend logging guide: [BACKEND-LOGGING.md](../guides/BACKEND-LOGGING.md) (linked from AGENTS + README).
- [x] Jira-like UI/UX standing note: [UI-UX-JIRA.md](../ui/UI-UX-JIRA.md) + reference screenshot.
- [x] RD-103/104 test guide: [TESTING-RD-103-104.md](../testing/TESTING-RD-103-104.md).
- [x] RD-107/108 test guide: [TESTING-RD-107-108.md](../testing/TESTING-RD-107-108.md).
- [x] RD-111/125/112 test guide: [TESTING-RD-111-125-112.md](../testing/TESTING-RD-111-125-112.md).
- [x] Demo seed test guide: [TESTING-DEMO-SEED.md](../testing/TESTING-DEMO-SEED.md).
- [x] RD-115 walkthrough log: [RD-115-SPEC-WALKTHROUGH.md](../ui/RD-115-SPEC-WALKTHROUGH.md).
- [x] RD-114/128 test guide: [TESTING-RD-114-128.md](../testing/TESTING-RD-114-128.md).
- [x] **V2** design doc: [V2-LEAD-PIPELINE-REQUIREMENTS.md](../architecture/V2-LEAD-PIPELINE-REQUIREMENTS.md); [HLD.md](../architecture/HLD.md) and [API-Spec-and-Build-Plan.md](../architecture/API-Spec-and-Build-Plan.md) updated in place for the new schema/endpoints.
- [x] 2026-08-29 — PROGRESS/TODO + API-Spec pipeline board / `progress` field + AGENTS/ARCHITECTURE notes for matrix + closure rings.
- [x] 2026-09-01 — PROGRESS/TODO updated for admin-editable account type, dashboard KPI fixes + client/vendor + stuck split (4-col grid), and the `SearchableSelect` dropdown migration.
- [x] 2026-09-01 — PROGRESS/TODO updated for vendor-name-on-cards, the candidate-stage filter fix + pipeline filter cleanup, and the two coverage-gap report tabs.
- [ ] Keep this file and PROGRESS.md current each session.
