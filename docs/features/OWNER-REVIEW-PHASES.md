# Owner review - phases 1 to 8 (2026-10-21)

The owner reviewed the live app (one.delphic.in) and gave an 8 phase brief for the Gulati Industries group platform
(8 companies; Delphic Global is the main one; a Group Super Admin sees every company, each company has its own admin).
Working rules: explore first, migrations safe on production data (backfill, never drop), company scoping everywhere,
a regression test for every fix and tests for new business logic, report what changed and how to test.

Everything below is **built locally**. Nothing from this brief is pushed or deployed (see "Security incident" at the end).

## Owner decisions (answers to the [CONFIRM] questions)

1. `AttendanceSource` gets an explicit `auto` value; existing `auto_daily` rows are migrated to it; run a dry run first and show the count; reversible; the `regularized_reason` column is kept; manual and regularized entries are never marked `auto`.
2. Soft delete (restorable) for Projects, Employees, Accounts (clients/vendors), Requirements, Profiles/Candidates, Applicants, Expense claims, Invoices. Locked payroll and locked attendance records cannot be deleted at all; reopen them first.
3. Keep the nightly LWD job (`server/src/jobs/lwdExit.js`). FnF is built on top of it: when the job exits someone, an FnF record is created with status Pending. Fields: FnF amount, FnF start date, FnF date, status (Pending / In progress / Settled).
4. Birthdays and work anniversaries: highlighted in People and on the main dashboard in a small Announcements card (next 14 days).
5. Increment reminders go to users with the Super Admin role for now; Phase 7 turns it into a permission ("Receive increment reminders").
6. Skip the onboarding confirmation / joining-form email for now.
7. After each phase: push to a branch/PR and deploy to **staging only**; production only when the owner confirms. (Later: the owner asked to finish all phases first, then summarise.)

## Phase 1 - production bugs

| # | What | Root cause / how it works | Where |
|---|---|---|---|
| 1.1 | Report counts wrong | Joinings filter a `@db.Date` column with IST instants: "1 Oct 00:00 IST" is 30 Sep in UTC, so the lower bound reached one day too far back (summary counted a 30 Sep joining in October). The month-grouped drill-down row also ignored the report period and listed the whole month. Fix: `dateOnlyRange()` for DATE columns; `rangeOf(q, {dateOnly})` intersects the row's month with the period. Other count cards filter timestamps with the same helpers for summary and drill-down, so they agree. | `reports/reports.service.js`, `reports/drilldown.service.js`, test in `tests/reports-drilldown.test.js` (every period: today, week, month, last month, quarter, last quarter, YTD, custom) |
| 1.2 | Approved leave hidden by auto "present" | The daily job wrote `source='manual'`, so auto and manual rows could not be told apart. New `auto` source (migrations `20261021100000_attendance_source_auto`, `20261021100100_attendance_auto_backfill` with `rollback.sql`; dry run `npm run attendance:auto-dryrun`). Approving a leave deletes the `auto` rows on those days (a single half day turns present into half day); manual, regularized and real check-in rows and locked months are never touched; applying a leave is no longer blocked by an auto row. | `attendance/autoAttendance.service.js` (`resolveAutoForLeave`), `leave/leave.service.js`, `tests/attendance-auto-leave.test.js`, `tests/attendance-auto-migration.test.js` |
| 1.3 | Holidays not shown everywhere | Every office has its own calendar (Ahmedabad, Gurugram, Indore) and a project follows the Ahmedabad calendar by default, so a holiday entered in one calendar is missing from the others. See Phase 1.3 section below for what was built. | see below |
| 1.4 | Regularization invisible to admins | Timesheet tickets existed but only inside the IT timesheet admin view; attendance had no employee request flow. New `attendance_regularization_requests` (migration `20261021110000`), employee "Request a correction" on Attendance, admin tab **Time & Attendance -> Regularization** (attendance + project timesheets, approve/reject). Approving writes the day through `recordManualDay`; a locked month blocks it. | `attendance/attendanceRegularization.service.js`, `client/.../RegularizationAdminTab.jsx`, `tests/attendance-regularization.test.js` |
| 1.5 | Group org chart not linked | New top-down chart: Group Super Admin -> company -> company admin -> that company's team chart; hiring (open positions) purple. `GET /org-chart/group` now also returns each company's `admins`. | `orgChart/orgChart.service.js`, `client/.../orgChart/GroupOrgChart.jsx` |

## Security incident (2026-10-21)

A commit with the same message as ours, authored as `radheshDelphic12`, added `api.js` (obfuscated JavaScript) and appended
obfuscated code after thousands of tabs at the end of `client/tailwind.config.js`. It is on main, staging, super_admin_branch, dev,
dev-deepanshu, acconcy-finance-workspace and delphic-one-bugFix-and-newImplementation, and CI + Deploy of df8ceb1 ran on production
(2026-10-19 07:21 UTC) and on Render staging. Do not pull, merge or build those branches. Clean commits: `923f35d`, `231bf51`.
Rotate GitHub tokens/SSH keys, the Neon password, JWT secrets, Render env and the prod `.env`, and inspect the prod server.
Restoring the branches needs a force push that only the owner may approve.
