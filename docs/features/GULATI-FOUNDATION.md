# Gulati Foundation - the 5th company (2026-10-09)

A foundation / NGO workspace inside Delphic One: initiatives, campaigns, budgets, planned versus actual investment, funding,
projections, and everything on the Super Admin's Group Dashboard. Built on branch `super_admin_branch`, module key `foundation`
(`enabled_modules` is the company "type", as for Gulati, Zephyr and Acconcy), tables `fx_*`, API `/api/v1/foundation`, UI `/foundation`.

## Reuse map

| Need | What is reused | What is new |
|---|---|---|
| Company registration, switcher, isolation | `orgs`, `enabled_modules`, `requireModule`, company switcher, `org_id` on every row | `foundation` module, `prisma/foundation/seed-admin.js` (non-destructive) |
| Access roles | Acconcy pattern: org-admin + a person with an access role (`FxPerson`) | roles admin / manager / finance / staff / contractor (`foundation/access.js`) |
| Employees and contractors, logins | Acconcy people + users services copied with Foundation names | campaign manager picker, no salary fields |
| Month close and locks | same lock / period pattern as Acconcy | snapshot = income, expenses, surplus, fund balance |
| Audit | own `fx_audit` (same shape as the others) | budget revisions, status, entries, settings, plan |
| Group Dashboard | `groupFinance.service` (one place), Filters, charts, drill-down, switcher | `kind: foundation`, a `foundation` campaign block, N/A valuation |
| Reports / export | `groupExport.js` (CSV, PDF), FilterBar, charts | 13 foundation reports |
| Finance P&L | foundation's own entries (a foundation has no sales / deals) | `fx_entries`: expense / funding / transfer |

## Accounting rules (one place: `modules/foundation/campaign.calc.js`)

Nothing is kept on the campaign except the plan. Every actual figure is derived from `fx_entries`; the client only displays.

- **Allocated budget** - assigned to the campaign. Not spent, not revenue. **Planned investment** - the part intended for the programme.
- **Actual expenditure** = entries `expense` + `paid`. **Actual investment** = the paid ones classed `programme` (a *subset*, so a payment is never counted twice). Operational spending is expenditure but not investment.
- **Commitments** = `expense` + `approved` (approved, unpaid). **Funds received** = `funding` + `received`; `pledged` is shown apart.
- Pending, rejected, cancelled and reversed (refund) entries never count. **Transfers** are neither income nor expense.
- `remaining_allocated` = allocated - actual (never shown below 0, the excess is `overspend`); `uncommitted` = allocated - actual - commitments (excess = `over_committed`, only the part due to commitments); `planned_remaining` = planned investment - actual investment.
- **Overspend guard**: approving or paying spending that would pass the allocated budget is refused (409 `over_budget` with the numbers). An admin may override with a reason (stored on the entry and in the audit). Setting `block_overspend` off allows it with a warning.
- **Budget revision** (`POST /campaigns/:id/budget`): reason required, history row (who / when / previous / new), cannot drop below spent unless admin. Money fields are not changed through PATCH.
- **Status** life cycle draft / planned / active / on_hold / completed / cancelled keeps the actual dates consistent (completed needs an end, reopening is admin + reason). A draft or cancelled campaign cannot take spending.
- **Projection** is a label, never a transaction: `plan` (remaining planned investment spread over the remaining months, by the monthly plan or evenly) or `run_rate` (average of recent complete months, needs two, otherwise it says so and uses the plan). Completed / cancelled campaigns show final actuals; not-started ones use the plan; no end date = no projection. Projected final = actual + max(planned remaining, commitments).
- **Progress**: schedule-elapsed % only; objective progress is "not tracked" (budget used is not work completed).
- **Foundation P&L for the group**: income = funds received, expenses = paid spending, surplus = difference, assets = fund balance (running surplus, floored at 0). **Valuation does not apply** (null / N/A, left out of the group valuation sum).

## What is on screen

Foundation workspace (`/foundation`): Dashboard (KPIs for date range and filters, planned vs actual vs projected chart, budget by initiative, needs-attention list, campaign table), Campaigns (search, initiative, status, state, city, manager, budget range, attention, sort, paging; create), Campaign detail (all figures, timeline, month-by-month chart, projection, monthly plan editor, budget revision, status actions, transactions with approve / pay / refund, budget history, activity), Funds & Expenses (every entry, filters, totals, approvals), Initiatives & Categories (initiatives, spending categories and funding sources are data, add / rename / switch off), Reports (13), Financials (income / expenses / fund balance, Locked / Unlocked / All, month close), Employee / Contractor, Foundation setup (budget rules, projection method, audit log).

Group Dashboard: the foundation is a company like the others (Group Finance, Dashboard, Projections, Org Chart, Billing Charges, switcher with its logo). A "Gulati Foundation - campaigns and fund projections" section shows campaign counts, allocated / planned / actual / received / remaining / uncommitted / projected, projected spending by month and quarter, and campaigns over budget, forecast to overrun, ending soon with funds left, behind plan; each row opens the foundation at that campaign. Asset value is the fund balance (cannot be typed in from the group). The Super Admin is an admin of the foundation (a membership is created on sign-in, which also fixes a new company missing from the sidebar until the second login).

## Files

Server: `prisma/schema.prisma` (+9 `Fx*` models), migration `20261010090000_gulati_foundation`, `modules/foundation/*` (access, audit, periods, lock, core, people, users, account, campaign.calc, campaigns, entries, finance, routes), `app.js`, `modules/superDashboard/groupFinance.service.js` (+ routes), `modules/auth/auth.service.js`, `prisma/foundation/seed-admin.js` + `seed.js`, `tests/foundation-workspace.test.js` (12) and 2 more in `super-admin-group-dashboard.test.js`.
Client: `lib/foundation/*`, `components/foundation/*`, `pages/foundation/*`, `pages/groupOverview/FoundationGroupSection.jsx`, App routes, AppLayout (nav, brand, theme), headerTitle, orgLogo, theme `.theme-foundation`, logos `public/foundation-logo.svg` and `foundation-mark.svg` (the uploaded flower mark; the wide logo adds the wordmark).

## Running it

- `cd server && npx prisma migrate deploy` then `npm run foundation:seed` (local demo: 6 campaigns, a roster, funding, spending, a refund, a transfer; refuses a non-local DB; `FOUNDATION_NO_DEMO=1` skips the demo). Demo logins (password `Foundation@2026!`): admin@, manager@, finance@, staff@gulatifoundation.in. The group Super Admin sees it and can open it from the company list.
- Staging / production: `FOUNDATION_ADMIN_EMAIL=<admin> [FOUNDATION_ADMIN_PASSWORD=...] npm run foundation:seed-admin`. With no email, every group Super Admin of the Delphic group becomes an admin of the foundation. Creates only the missing org (in the Delphic holding group), settings and membership; deletes nothing.
- Tests: `cd server && npx jest --runInBand tests/foundation-workspace.test.js tests/super-admin-group-dashboard.test.js`.

## Assumptions and limits

- Document / receipt attachments on entries are not built (the schema leaves room; reference numbers are recorded). Salaries are recorded as ordinary spending entries (category "Salaries and stipends"), there is no separate payroll for the foundation.
- Valuation and the Delphic profit x 240 + asset x 3 formula are deliberately not applied to a foundation.
- Allocated budgets are not assumed to be funded: funding is recorded separately and compared (net funds).
