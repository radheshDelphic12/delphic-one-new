# Client / project timesheet - source of truth per person (design, 2026-10-01)

Status: **all four phases implemented and committed (61ec9b3, 2026-10-01).** Decisions below were answered by the product owner on 2026-10-01.

## Problem

Today one timesheet (`TimesheetEntry`: hours + overtime_hours, manager approval) feeds BOTH payroll hours
(`workHours.service.js`) and client billing (`billing.engine.js`); attendance is presence only. An IT developer logs
a 9h day, but the client needs per-project hours: a developer on two projects with 8h + 8h is billed 8h on each,
while physically working 8h.

## Source of truth per person

| Who | Salary / pay | Client billing | Vendor payout |
|---|---|---|---|
| IT developer (full-time) | Attendance: check-in/out marking `present / half_day / leave / absent / holiday / wfh`, paid + unpaid leave (employee or admin), approved OT tickets | Approved **client/project timesheet** hours | - |
| Non-IT employee | Unchanged: approved timesheet hours (+ approved OT) | Approved timesheet hours if logged on a project | - |
| Vendor contractor | Never payroll | The same client/project timesheet | The same timesheet (hours 8 or 9 a day, `billable_day_hours`) |

* Attendance is marked present / half day / absent (and leave), not derived from hours.
* One contractor timesheet drives both the client bill and the vendor payout.

## Client / project timesheet

* Filled by the allocated person **or anyone on the project team**; approved by the project manager / reporting manager
  (admin can always edit / override). Only approved hours are billed. Invoices generate from it and stay editable
  (adjustments, charges, edits already exist).
* Hours are **independent of attendance**: 8h + 8h on two projects is allowed.
* Per project and day there is a **cap from allocation**: sum over the project's allocated resources of their
  `billable_hours_per_day` (new field on `ProjectMemberAssignment`, default 8, effective-dated like allocations; separate from the
  cost allocation %, which stays the salary-cost split and never exceeds 100%). While filling, everyone sees
  "X of Y hours already logged" for that project and day, so two developers cannot conflict or over-log. Admin may override.
* The existing IT developer timesheet becomes this client/project timesheet.

## Overtime

Separate and ticket based: the employee raises an OT ticket (day, hours, project, reason), the reporting manager approves.
Approved OT goes to the employee's pay; it is billed to the client only where the project has `overtime_billable`.

## Phases

1. **Project timesheet + cap** - `billable_hours_per_day`, project-day "logged / capacity" endpoint, hard cap with admin
   override, IT grid shows the counter, daily 9h-total rule no longer applies to project hours.
2. **Salary by attendance for IT** - per-membership / department `pay_basis` (`attendance` | `timesheet`, admin-editable),
   `computeBreakdown` attendance mode (full / half day, leave, absent unpaid, holiday paid), dry-run comparison before switching.
3. **OT tickets** - raise + manager approval, pay and billing rules above.
4. **Contractors** - day length (8 / 9) per project, one timesheet for both bill and payout (payout already uses approved days).

Rules that always apply: admin can edit everything (docs/guides/ADMIN-EDITABILITY.md), every edit audited, locked months are flagged
not rewritten, targeted tests per phase.

## Open items

* Contractor day length: per project (`billable_day_hours`, default 8) unless told otherwise.
* Exactly which departments are "IT" for the attendance pay basis (department named IT today).

## Phase 1 - implemented (2026-10-01)

* `ProjectMemberAssignment.billable_hours_per_day` (default 8, effective-dated with the allocation; migration
  `20261001140000_assignment_billable_hours`). Set in Finance > Projects > project profile > allocations ("Billable hrs/day"),
  `POST /billing/cost-assignments { billable_hours_per_day }`.
* `timesheets/projectDay.service.js`: a project's day capacity = sum of the allocated people's billable hours; logged = submitted +
  approved hours (rejected and overtime excluded); no allocated person = no cap. `GET /timesheets/project-day?account_id&date`
  returns `{ capped, capacity, logged, mine, remaining, over_by, people[] }`.
* Create / own edit refuse hours that don't fit (`project_day_cap`, 422, with the numbers); admin create / edit bypass the cap.
* The person allocated, **or a team mate of someone allocated**, may log on the project; `GET /timesheets/my-projects` lists those
  projects with `via_team: true`.
* UI: IT timesheet grid shows "X of Y h logged · Z left (you: m h) · who logged what" under every project row
  (`components/finance/ProjectDayHint.jsx`).
* Not yet (phases 2-4): salary by attendance for IT, OT tickets, contractor day length. Salary and payroll are untouched.

## Phase 2 - implemented (2026-10-01): salary by attendance (per person, switched by an admin)

* `OrgMembership.pay_basis` (`timesheet` = default / null, or `attendance`; migration `20261001150000_membership_pay_basis`). **Nothing
  changes until an admin switches someone** - IT is not flipped automatically.
* `payroll.service.computeBreakdown({ payBasis })`: attendance basis pays each company working day by its marking - `present` / `wfh` = the
  shift, `half_day` = half, `absent` = nothing; approved leave pays / doesn't by its type; leave and attendance never double count.
  A past working day with no marking and no leave is **unmarked**: unpaid, counted in `breakdown.unmarked_days`, and it adds an
  `unmarked_attendance` blocker to locking that person's salary (`salary_employee`). Project timesheet hours never enter the figure and never
  create overtime (`workHours.syncDayOvertime` is a no-op for attendance-paid people); OT for them comes from tickets in phase 3, so
  attendance-paid people get **no OT pay until phase 3**. `breakdown` gains `source: 'attendance'`, `pay_basis`, `half_days`, `absent_days`,
  `unmarked_days`.
* Admin: `GET /payroll/pay-basis?period_month&period_year` compares both nets per person (`timesheet_net`, `attendance_net`,
  `difference`, markings, unmarked days) **before** switching; `POST /payroll/pay-basis { pay_basis, org_membership_ids?, it_department?, reason }`
  switches people or the whole IT department (audited as `pay_basis_set`). Locked months keep their locked figures.
* UI: Payroll > **Pay basis** tab (comparison, totals, per-row and "Switch IT to attendance / back" buttons with a mandatory reason).
* Attendance markings (status per day) are set with the existing attendance edit / regularize / manual endpoints.

## Phase 3 - implemented (2026-10-01): overtime tickets

* `OvertimeTicket` (migration `20261001160000_overtime_tickets`): the employee raises a ticket (day, hours <= 12 a day in total, optional project,
  reason); the reporting manager or an admin approves / rejects (rejection needs a reason); the employee can cancel a pending one.
  Only for people paid from **attendance** (`pay_basis = 'attendance'`, not contractors) - everyone else keeps the timesheet overtime flow.
  API: `GET|POST /timesheets/overtime-tickets` (`scope=mine|to_decide|all`), `POST .../:id/decision`, `POST .../:id/cancel`,
  `PATCH .../:id/admin` and `DELETE .../:id` (admin, reason required, audited as `overtime_ticket_edit|delete`; every decision raises a finance change so a
  locked month is flagged, not rewritten). No separate notification type yet (it would need a notification enum migration): managers see pending tickets
  in Time & Attendance > OT Tickets.
* **Pay:** approved ticket hours = OT paid at hourly rate x multiplier; pending hours are the projection; rejected pay nothing (`computeBreakdown({ ticketsByDate })`,
  attendance basis only). Timesheet hours never create overtime for these people, and logging `overtime_hours` on their timesheet is refused
  (`overtime_requires_ticket`).
* **Client billing:** an approved ticket that names a project is billed as overtime hours of that person on that project (billing engine; only where the
  project has `overtime_billable`, at rate / benchmark x multiplier). A pending ticket on an overtime-billing project blocks the month
  (`pending_overtime_tickets`).
* UI: Time & Attendance > **OT Tickets** (raise, my tickets with cancel, "waiting for your approval", admin: all tickets with approve / reject / edit / delete).
  The IT timesheet grid replaces the OT-hours box with "OT: use OT Tickets" for ticket people.

## Phase 4 - implemented (2026-10-01): vendor resources

* One timesheet for a contractor: the same approved entries drive the client bill (billing engine) and the vendor payout (vendor payment engine).
* The vendor payout counts a full day at the contractor's **own** `billable_hours_per_day` on that project (effective-dated assignment: 8, 9, ...), falling back to
  the project's `billable_day_hours`. So 18 full 9h days + 2 half days of a 9h contractor = 19 payable days of 22. The line reports `day_hours`.
  The project's "Hours in a full day" now only applies to client billing on the approved-hours basis.
* Tests: `overtime-tickets.test.js` (phases 3 and 4), `project-timesheet-cap.test.js` (1), `attendance-pay-basis.test.js` (2).

## FRD revision (2026-10-02): slice 1 - timesheet + attendance core

The product FRD ("Timesheet, Attendance, Billing & Finance") reverses two earlier choices. Built in this slice (sections 1-3, 16 of the FRD):

* **No project hour cap.** `projectDay.checkCap` and the `person_day_cap` / `project_day_cap` errors are gone; people log the hours actually worked on allocated projects (the 24h-a-day sanity rule and half-day-leave rule remain). `billable_hours_per_day` stays only as the contractor's day length for vendor payout (phase 4). `GET /timesheets/project-day` is now informational (`{ logged, mine, people[] }`, no capacity).
* **Project team visibility.** `GET /timesheets/project-team?account_id&year&month`: assigned members, who logged, per-person / date-wise / total hours (rejected excluded). Only people allocated to the project (that month) and admins; others get 403. UI: Time & Attendance > **Project Team**.
* **Timesheet Dashboard.** `GET /timesheets/dashboard?year&month` (every timesheet the caller may open: all for admin, own + direct reports otherwise) and `GET /timesheets/dashboard/calendar?year&month&org_membership_id` (per day: logged / approved / pending hours, attendance status, leave, OT row + OT tickets, approval status, lock, project-wise hours, notes). UI: Time & Attendance > **Timesheet Dashboard** (month + year pickers, list, calendar, day detail on hover / click).
* **Project Calendar removed** from Time & Attendance (Holiday Calendar tab no longer shows the project calendar panel or the client exceptions block; the Project Calendar stays in HR Settings).
* **Check-in / check-out removed.** `POST /attendance/check-in|check-out`, the header button, the Today card, the check-in/out columns and the checkout prompt are gone; manual / import forms no longer ask for times. Salary never used them (the engine only read `status`); the leave "present on date" guard now looks at `status` only. The legacy `check_in_at` / `check_out_at` / `overtime_minutes` columns stay in the table (no DROP: expand -> contract) and nothing writes them.
* **Daily attendance process** (`jobs/autoAttendance.js`, every 10 min, IST; `attendance/autoAttendance.service.js`). For "applicable" people (active full-time employees paid from attendance, or in the IT department) whose working-hour start time (Shift start, 09:00 without one) has passed, it marks TODAY present when it is a working day on their company calendar with no approved leave and no record yet. It never marks a future date and never overwrites a record. Half-day leave days are left to leave management / admin.
* **Previous-month backfill** `POST /attendance/backfill-month { year, month, reason, org_membership_ids?, dry_run }` (admin) + `GET /attendance/backfill-month/runs`: same rules over every working day of a PAST month (the current / a future month -> 422). Attendance > Team attendance > "Backfill previous month" (preview, then apply). **Audit:** `audit_logs` rows `attendance_backfill_month`, `attendance_manual_mark`, `attendance_import` (admin, time, month, employees, records, reason).

Not in this slice (FRD sections 4-15): leave-type flags / Comp Off balance, configurable manager approval + mandatory admin approval, OT as a separate Manager -> Admin workflow (tickets exist, manager-optional / admin-mandatory does not), monthly vs hourly billing statuses (PL / NPL / FH / SH), sales + salary Excel exports, Live Analytics invoice filters, 3-stage financial lock with per-record audit on bulk, Finance month-wise project view.

## FRD revision (2026-10-02): slices 2-4 - approval, locks, leave types, billing, finance (built)

Additive migration `20261002100000_approval_locks_leave_billing` (no DROP). Tests: `approval-locks-leave.test.js`, `finance-frd.test.js` (plus the older suites, rerun on a private DB).

**Approval chain (FRD 7).** `orgs.timesheet_manager_approval` / `timesheet_admin_approval` (both default on; the test helper `createOrg` turns admin approval off so the older suites keep a manager approval final). Employee -> Manager (optional) -> Admin (mandatory): a manager's approval only sets `manager_approved_by/at` (the entry stays `submitted`, not payable / billable), the admin's approval makes it final; a manager rejection is final; with manager approval off only the admin decides. `GET/PATCH /timesheets/approval-policy`. UI: Time & Attendance > **Timesheet Locks** (policy card).

**Overtime (FRD 8).** Tickets follow the same chain (`manager_approved` status; engines treat it as pending). Audit history in `overtime_ticket_events` (submitted, manager_approved, approved, rejected, cancelled, edited, with actor + time): `GET /timesheets/overtime-tickets/:id/history`; UI: OT Tickets > History.

**Three-stage lock + audit (FRD 13-14).** Stage 1 timesheet lock: per employee and month, bulk, due the 5th of the next month, reopen needs a reason (`monthLocks.service.js`, `timesheet_month_locks`; `GET /timesheets/locks/month-status`, `POST /timesheets/locks/month`, `POST /timesheets/locks/month/reopen`; locked members cannot add / change entries, the calendar shows every day locked). Stage 2 calculation lock and stage 3 financial lock (`kind = financials`) already existed; they now also write the lock audit. `lock_audits` (`lockAudit.service.js`): one append-only row per employee / project / record with actor, time, stage, previous and new status, change and reason; bulk actions write one row per record sharing a `bulk_id`. `GET /calculations/lock-audit`; `POST /calculations/bulk` (review / lock / reopen / recalculate many records). Day locks and calculation changes inside a locked period are on the trail too.

**Leave types for salary (FRD 4).** `leave_types.is_applicable / counts_in_balance / overflow_to_unpaid`, `PATCH /leave/types/:id` (admin, audited), the five types incl. **Comp Off** (balance = admin-set days + one per overtime day approved as comp off). Beyond the paid balance the rest becomes **Unpaid Leave** (a second request on the Unpaid Leave type) when the type has the overflow flag (on for the default types). UI: Leave > Leave type settings (admin).

**Client billing per resource (FRD 5-6).** `resource_billing_rates` (`POST/GET/DELETE /billing/resource-rates`): one resource monthly while another is hourly on the same project and month; resources without their own rate use the project rate. Hourly = approved hours x rate (no attendance, no cap); monthly = rate / working days x the fraction its **client billing status** earns (present, present + OT, full day, half day, PL, NPL, comp off, first half, second half, absent). Fractions are `accounts.billing_leave_rules` (defaults in `engines/resourceBilling.js`; `GET/PUT /billing/projects/:id/billing-rules`), separate from salary leave rules. OT stays separate (approved OT hours only). The project row reports `resource_rates` with per-status day counts; a project with different types is `mixed`.

**Salary adjustments (FRD 9).** `salary_adjustments` (TDS, OT adjustment, variable pay, reimbursement, other addition / deduction); `salary.engine` adds them to the payable salary (`net`, with `base_net` and `adjustments` per component) and a change in a locked month is flagged. `GET/POST/PATCH/DELETE /payroll/adjustments`; UI: Payroll > **Adjustments** (component table to the final payable).

**Finance (FRD 10-12, 15).** Live Analytics billing filters `invoice_status` (generated / not generated / paid / unpaid / sent / unsent) and `billing_type`, plus `invoice` per row and `totals.invoice_summary` (`invoiceStatus.js`; UI filters in Live Analytics > Billing & Sales). Month-wise project view `GET /calculations/finance/month-projects` (client, billing type, resources, logged hours, amount, invoice / payment / financial status, to-do flags); Sales and Salary Excel exports `GET /calculations/export/sales|salary?period_year&period_month` (`format=json` for rows). UI: Finance > **Month View**. Vendor billing: `PATCH /billing/vendor-invoices/:id/tracking` (sent / unsent, TDS, adjustment) and `GET /billing/vendor-invoices/:id/trace` (vendor -> project -> billing record -> timesheet entries -> invoice -> payment).

**Hardening round (same day).**

* **Admin approval before a lock:** a month is not locked for an employee while entries wait for approval (`pending_entries`); the admin can force it with a reason (`force`, written on the audit row). Day overtime (`/timesheets/overtime/:id/decision`) and regularisation tickets follow the same Employee -> Manager (optional) -> Admin chain (`manager_approved_by/at` columns; `awaiting_admin` in the response).
* **Lock order:** `orgs.enforce_lock_order` (default on). A calculation cannot be locked while the timesheets it is built from are open (`timesheets_not_locked`); the month's financials cannot be locked while timesheets are open or calculations are started but not locked (`calculations_not_locked`) - `calculations/financialLock.js`, shown as readiness blockers. The test helper `createOrg` turns it off for the older suites.
* **Financial freeze:** once the month's `financials` calculation is locked, client invoices (generate / edit / delete / sent / paid), vendor invoices (create / edit / delete / tracking) and vendor payments (decide / pay) of that month answer 423 `financial_locked` until an admin reopens the financial lock (audited).
* **Audit:** every timesheet / overtime / regularisation approval step (manager_approve, approve, reject) is on the lock audit trail (stage `timesheet`) with employee, month, previous / new status; attendance regularise / delete / manual / import / backfill write `audit_logs` rows.
* **Leave Manager:** `org_memberships.is_leave_manager` (admin sets it: `PUT /leave/managers/:membershipId`, `GET /leave/managers`, audited). Leave Managers list, apply, approve / reject and withdraw leave; balances, types and entitlements stay admin-only. A pending paid request longer than the balance is split when it is approved (paid part + approved Unpaid Leave), like at request time.
* **Daily attendance:** a day with one approved half-day leave is marked `half_day` (the leave pays the other half); two half-days or a full leave day are left alone.
* **Monthly billing by status for a normal project:** `POST /billing/projects/:id/resource-rates/apply-project-rate` copies the project's rate to every allocated resource that has no rate of its own, so the client billing statuses apply to them (a project billed on one project rate still bills by contract).
* **Vendor:** `GET /calculations/export/vendor` (Excel / `format=json`), vendor invoice list shows TDS, adjustment, net payable, sent and paid.
* **UI added:** Finance > Billing Setup (resource rates, apply project rate, status rules), Finance > Vendor Invoices (sent, TDS / adjustment, trace, Excel), Leave type settings > Leave Managers, Timesheet Locks (approval column, force option). Tests: `frd-hardening.test.js`.

Still manual / by design: locking a timesheet month is a manual admin action (no automatic lock on the 5th - the board shows the deadline and who is overdue); the previous-month attendance backfill is admin-only (no separate IT role exists in the system); leave that was already approved is not split retroactively.

All four phases are done. Remaining (not requested): a notification type for new tickets, a ticket-based OT report, and flipping IT to the attendance basis
in production (admin action, after the Pay basis comparison).

## Fix (2026-10-02): the cap is per person AND per project - SUPERSEDED by the FRD revision above (no cap at all)

Found on staging: with two people allocated (8h + 8h = 16h for the project day) one developer could log 9h or more on the project, using the other's hours.
`projectDay.checkCap` now applies two limits: an allocated person can log at most **their own** `billable_hours_per_day` on the project a day
(`person_day_cap`: "You have already logged Xh of your Yh a day..."), and everyone together stays within the project's day capacity
(`project_day_cap`). A team mate who is not allocated fills only what the allocated people left. `GET /timesheets/project-day` also returns `my_limit` /
`my_remaining`; the IT timesheet hint shows "you: Xh of your Yh (Zh left)". Admin entries still bypass both.
