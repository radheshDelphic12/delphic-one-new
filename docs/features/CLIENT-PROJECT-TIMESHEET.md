# Client / project timesheet - source of truth per person (design, 2026-10-01)

Status: **design agreed, not implemented.** Decisions below were answered by the product owner on 2026-10-01.

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

All four phases are done. Remaining (not requested): a notification type for new tickets, a ticket-based OT report, and flipping IT to the attendance basis
in production (admin action, after the Pay basis comparison).
