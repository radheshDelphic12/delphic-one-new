# Leave Balance <-> Timesheet <-> Payroll integration (spec, 2026-10-01)

Goal: integrate the Leave Balance system with the existing Timesheet and monthly-hours calculation without breaking current timesheet/payroll flow. Do NOT rebuild Leave/Timesheet/Payroll; inspect and extend (models, APIs, approval workflow, balance calc, monthly-hours calc, payroll calc, working-hours config, roles/permissions).

## Rules
1. **Leave types**: Paid / Unpaid; each Full Day or Half Day. Standard day = 9h (use existing company/employee working-hours config if present). Full paid = 9h, half paid = 4.5h, unpaid = 0 payable hours.
2. **Approval mandatory**: Apply -> Pending -> approver approves -> effective. Only APPROVED leave affects Timesheet, monthly hours, payroll, balance. Pending/rejected = no effect.
3. **Timesheet reflection**: approved leave shows automatically per date as Paid/Unpaid Leave with leave hours (e.g. "1 Oct - Approved Paid Leave - 9h", "2 Oct - 4.5h").
4. **Capacity**: full-day approved leave blocks normal timesheet entry for that date; half-day reserves 4.5h, working hours capped at remaining 4.5h; working + leave <= daily capacity.
5. **Monthly hours**: approved paid leave hours added to paid hours (140h worked + 2 full days = 158h; half day adds 4.5h). Unpaid never added. No double counting.
6. **Leave balance**: extend existing calc; deduct on approval only (pending keeps balance per existing rule).
7. **Admin apply**: admin picks employee, type, date/range, full/half, submits; can apply for self; same approval rules unless existing permission system supports admin auto-approve.
8. **Conflict validation** (on apply AND approve): full-day leave vs existing timesheet; half-day vs >4.5h working; overlapping leave; leave blocks conflicting timesheet creation. Never overwrite silently; clear message.
9. **Timesheet UI**: show Date, Leave Type, Paid/Unpaid, Full/Half Day, Leave Hours, Approval Status; distinguish normal / paid leave / unpaid leave / half-day leave + working.
10. **Payroll/Finance**: approved paid leave -> paid hours; unpaid none; pending none; rejected none; cancelled/revoked approved leave reverses impact; no duplicate calcs; existing approved-timesheet payroll logic stays intact.

## Deliverable order
First: short summary of current Leave -> Timesheet -> Payroll flow + exact files/modules to modify. Then implement.

## Tests required
Full/half paid, full/half unpaid, pending, approved, rejected, cancelled approved, full-day leave + timesheet conflict, half-day + working hours, admin for employee, admin for self, multi-day, spanning months, monthly paid-hour calc, payroll after approved paid leave, duplicate prevention, approval after timesheet already exists.

## Constraints (repo)
Targeted tests/lint only (see CLAUDE.md); no push; local-only.
