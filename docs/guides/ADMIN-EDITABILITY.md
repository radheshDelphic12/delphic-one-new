# Admin editability rule

**Standing rule (set 2026-10-01):** every feature, existing or future, must be editable by an admin after the fact. Nothing a user can create or configure may be a "write once, stuck forever" record.

## What this means

For every entity or setting a feature introduces:

1. **Edit path exists.** There is a `PATCH`/`PUT` (or equivalent) endpoint, gated with `authorize('admin', ...)` at minimum (superadmin keeps its extra powers, see AGENTS.md "Superadmin").
2. **Locks do not block admin.** Where records have a lock (finance per-record locks, locked accounts, approved timesheets, closed periods), admin must be able to unlock or edit with a reason. Locking guards ordinary users, not admins.
3. **Derived or auto-calculated values are overridable** (or recalculable) by admin: rates, billed amounts, pay hours, OT approvals, balances, stages/status.
4. **Configuration is data, not code.** Rates, calendars, thresholds, shift lengths, leave policies, billing terms live in editable DB rows with an admin UI, not hardcoded constants or env vars.
5. **Edits are audited.** Admin edits write an audit trail (who, when, before/after or reason), reusing `audit_logs` / `stage_history` patterns. Dependent recalculation hooks still run (e.g. `workHours.syncDayOvertime` after timesheet changes).
6. **Frontend exposes it.** The UI shows an edit action to admins via `can()` / `usePermissions()` / `<Can>`, in an RHS `Drawer` (see AGENTS.md working conventions).
7. **Tested.** Each new feature has at least one test showing an admin can edit it (and a non-admin cannot, where relevant).

## Checklist for new work

- [ ] Admin can edit every field a creator could set
- [ ] Admin can edit/unlock past a lock or approval (with reason)
- [ ] Computed values can be overridden or recomputed
- [ ] Settings are in the DB with an admin screen
- [ ] Audit row written on edit
- [ ] Frontend edit action behind `can()`
- [ ] Test for admin edit

## Backfill: existing features to audit

The rule applies to everything already built. Review and close gaps in:

- Finance: contract-based billing, invoice builder, per-record locks, Live Analytics / Financials
- Timesheets, overtime approvals, pay hours (`workHours.service.js`)
- Leave balance <-> timesheet <-> payroll integration
- Payroll, expenses, vendor payments, accounting
- Org chart, calendars, shifts, holidays, project/client calendars
- Accounts, requirements, submissions, profiles (stages already have admin/superadmin override)

Track findings and fixes in [../progress/TODO.md](../progress/TODO.md).
