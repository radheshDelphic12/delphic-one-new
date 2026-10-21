# Owner review - phases 1 to 8 (2026-10-21)

The owner reviewed the live app (one.delphic.in) and gave an 8 phase brief for the Gulati Industries group platform
(8 companies; Delphic Global is the main one; a Group Super Admin sees every company, each company has its own admin).
Working rules: explore first, migrations safe on production data (backfill, never drop), company scoping everywhere,
a regression test for every fix and tests for new business logic, report what changed and how to test.

Everything below is **built locally and committed on `super_admin_branch`** (phases 1-8). Nothing from this brief is pushed or deployed (see "Security incident" at the end).

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

## Phase 2 - applicants flow (Pipeline > Applicants)

Assign to me only claims the applicant (Pool -> My candidates); a profile is created only by "Create profile" (existing profiles stay). Soft delete from the pool, "Unlink from job" on a profile, filters (All / unassigned vs assigned / profile created or not / recruiter) next to the screening filters, a unique (normalized email, requirement) rule at the database (duplicates were reported first with `npm run applicants:duplicates`), the public form now asks for Experience (the column was empty because nothing ever collected it), a loading state instead of the empty pool, and Unpublish on website jobs (keeps requirement and applicants). Migration `20261021130000_applicant_soft_delete_unlink_unique`.

## Phase 3 - change log and soft delete

Every create, update and delete across companies is captured (who, when, company, entity, exact old and new values) by a Prisma middleware (`server/src/config/changeCapture.js`). Group Dashboard > Logs (filters: company, record type, person, action, dates) with a Deleted records view and Restore; Finance > Projects has a per-project History. Soft delete + restore for projects, employees, accounts, requirements, profiles, applicants, expense claims and invoices; locked payroll/attendance blocks deletion. `npm run projects:integrity` reports inconsistent project data.

## Phase 4 - people, exit, payroll

- 4.1 User type (Full-time / Contractor) already existed with a People filter; unchanged.
- 4.2 The nightly LWD job now also starts an FnF record (Pending). Payroll > FnF lists everyone who left: amount, start date, FnF date, status Pending / In progress / Settled (settling stamps the date). Exiting someone by hand starts the same record. Migration `20261021150100_fnf_increments_previous_dues_dob`.
- 4.3 Date of birth in My details / admin edit. Dashboard Announcements card: birthdays (no year) and work anniversaries (years) in the next 14 days; contractors and people who left are left out; 29 Feb is celebrated on 28 Feb in other years.
- 4.4 Increment reminders: one per person per completed year, created nightly (looks back a week), notification `increment_review_due` to Super Admin users (and holders of the "Receive increment reminders" permission). Payroll > Increment Reminders: Completed / Ignore; pending ones keep showing. Never touches salary.
- 4.5 Payroll Runs > "Previous dues": earlier months' salary not paid for days worked (late joiners). The admin adds each one to the current month as an adjustment; whatever is not added is offered again next month; never automatic.

## Phase 5 - bench and internal jobs

`bench_start_date` / `bench_end_date` on the employee (People > Edit); the end follows the start by 30 days until set by hand. On the bench = inside the dates, working, and not allocated to any project today. Dashboard "On the bench" (admins) with days left; nightly countdown notification (`bench_countdown`) at 30, 15, 7, 3, 1 days and the last day, to the person and the admins. Internal Jobs: "Apply myself" only for people on the bench or serving notice (API refuses others with 403, button disabled); "Refer someone" stays open to all. Migrations `20261021160000_notification_bench_countdown`, `20261021160100_membership_bench_dates`.

## Phase 6 - filters, accounts, travel

Calendar filters for meeting type (Sales meetings / Interviews), organiser and attendee. Accounts: Location filter (matches the Location text, city or country) and a Location column; the Location field already existed on the client/vendor form. Group Dashboard > Travel: "Add a new meeting" now asks for the company, then one of its active clients, and the meeting lands on that company's calendar (clients outside the group are refused).

## Phase 7 - custom roles and permissions

- Model: `custom_roles` (per company) + `org_memberships.custom_role_id` (migration `20261021170000_custom_roles`). A role = a plain **base role** + permissions. The base role keeps everything not covered by a permission, so nobody loses a screen. People with no custom role are untouched.
- Catalogue (`server/src/lib/permissions.js`): accounts view/add/edit/delete, meetings schedule, vendors onboard, requirements view/add/edit/delete, profiles view/add/edit/delete, submissions add/edit, timesheets check, attendance changes check, resource allocation, financials view/add/update/delete, receive increment reminders. Edit/delete carry a scope: Own / Team (direct reports and teams they lead) / Everyone.
- Enforced on the API: accounts, requirements, profiles, submissions, meetings/interview rounds, allocations, financials + accounting, timesheet review and attendance review routes, admin soft-delete, increment reminders. The screens follow via `user.permissions` from `/users/me`.
- Settings > Roles & permissions (Super Admin and Group Super Admin): tick-box matrix, people picker, "Add the starting roles", and a **mapping preview** that lists who would get which role and writes nothing until Apply.
- Starting roles (created only when missing): BDE, Sales, Sales Admin, Sales Super Admin, HR, HR Admin, HR Super Admin, IT Employee, Admin, Super Admin. Proposed people: Dheeraj, Chahak, Tanvi, Biswajit, Krupali, Prashant, Diksha, Abhishek, Paras Gulati (Super Admin, which includes Admin's checks).
- [CONFIRM] Admin and Super Admin use base role `admin`, so they keep every admin screen; only the actions in the catalogue are permission-controlled. To narrow a role further, build it on the Employee base and tick what it needs.
- [CONFIRM] HR roles also get edit-own on profiles and submissions (the brief listed add only) so recruiters can correct their own entries.

## Phase 8 - vendor auto email

Requirements list: tick requirements, "Email to vendors": choose active vendors (filter by specialization or name), the vendor's internal account owner is CC'd (a real CC header), a preview shows the exact subject, text and recipients (vendors without a contact email are listed as skipped), then send. One queued email per vendor; every send is stored in `vendor_email_logs` (who, requirements, recipients, delivery status via `GET /api/v1/vendor-email/log`). The client's name is never put in the email; the budget range is (remove it in `vendorEmail.service.js` if the owner prefers). Migration `20261021180000_vendor_email`. The onboarding / joining-form email is skipped, per the owner's answer.

## Migrations added (all additive, with rollback.sql where tables/columns are added)

`20261021100000`, `20261021100100` (attendance auto source), `20261021130000` (applicants), the Phase 3 change-log and soft-delete migrations, `20261021150000`, `20261021150100` (FnF, increments, previous dues, DOB), `20261021160000`, `20261021160100` (bench), `20261021170000` (custom roles), `20261021180000` (vendor email).

## Security incident (2026-10-21)

A commit with the same message as ours, authored as `radheshDelphic12`, added `api.js` (obfuscated JavaScript) and appended
obfuscated code after thousands of tabs at the end of `client/tailwind.config.js`. It is on main, staging, super_admin_branch, dev,
dev-deepanshu, acconcy-finance-workspace and delphic-one-bugFix-and-newImplementation, and CI + Deploy of df8ceb1 ran on production
(2026-10-19 07:21 UTC) and on Render staging. Do not pull, merge or build those branches. Clean commits: `923f35d`, `231bf51`.
Rotate GitHub tokens/SSH keys, the Neon password, JWT secrets, Render env and the prod `.env`, and inspect the prod server.
Restoring the branches needs a force push that only the owner may approve.
