# Finance calculations, locking & change detection

Built 2026-09-29 (branch `delphic-one-bugFix-and-newImplementation`). Admin panel.

**Principle:** Operational data → Calculation → Approval → Finalization → Lock → Financial snapshot.
A finalized result never changes silently. A later change to its source data is
**Detected → Flagged → Reviewed → Explicitly recalculated → Re-finalized**.

## Where things live

| Concern | Code |
|---|---|
| Shared period helpers | `server/src/modules/calculations/period.js` |
| Attendance-based salary (the only salary formula) | `calculations/engines/salary.engine.js` (+ `payroll.service.computeBreakdown`) |
| Billing & Sales (Managed Services) | `calculations/engines/billing.engine.js` |
| Resource Revenue | `calculations/engines/resourceRevenue.engine.js` |
| Vendor payments (contractor timesheets) | `calculations/engines/vendorPayment.engine.js` |
| Financials, category-wise | `calculations/engines/financials.engine.js` |
| Lock / version / change detection | `calculations/calculations.service.js`, routes `/api/v1/calculations` |
| Live Analytics queries | `calculations/live.service.js`, routes under `/api/v1/analytics` |
| Change hook called by operational writes | `server/src/lib/financeChanges.js` |
| Group Charge / Expense categories | `modules/financeCategories`, routes `/api/v1/finance-categories` |
| UI lock bar (every kind) | `client/src/components/finance/CalculationLockBar.jsx` |

## Calculation kinds

| Kind | Scope | Amount | Used by |
|---|---|---|---|
| `billing` | one project (Account id) + month | approved base + overtime (if the project pays OT) | invoice draft, Resource Revenue, Financials |
| `salary` | org + month | net salary (approved timesheet hours + approved OT) | payroll run processing, Resource Revenue, Financials |
| `resource_revenue` | org + month | total resource revenue | reporting |
| `vendor_payment` | org + month | owed to vendors (INR) | creates pending `VendorPayment` rows, Financials |
| `financials` | org + month | profit | Financials (finalized view) — UI hidden since 2026-10-01 |
| `salary_employee` | one employee (membership id) + month | that employee's net | Payroll (overrides the computed line), Locked, Financials |
| `vendor_bill` | one vendor (account id) + month | owed to the vendor (INR) | pending `VendorPayment`, Locked, Financials |
| `expense` | `claim:<id>` / `charge:<id>` + its month | the record in INR | Locked, Financials |

Since 2026-10-01 Live Analytics locks **record by record** (billing per project, salary per employee,
each expense, billing per vendor) and **Financials shows locked records only** (filter Locked /
Unlocked / All) — see [FINANCE-LIVE-ANALYTICS-INVOICES-LOCKING.md](FINANCE-LIVE-ANALYTICS-INVOICES-LOCKING.md).
The org-wide `salary` / `vendor_payment` locks still work and count as locked for anyone without
their own lock.

Statuses: `draft → reviewed → locked → change_detected → (recalculate → locked vN+1 | reopen → reopened → lock)`.
Each lock/recalculation writes an immutable `FinancialCalculationVersion` holding the full computed
result; readers of a locked month use that snapshot. Every action also writes `AuditLog`
(`entity_type: 'financial_calculation'`).

Lock blockers: billing — pending or un-corrected rejected entries, no rate, unsupported engine
(fixed price), period not ended (through the contract end); org kinds — month not ended, pending /
rejected contractor entries (vendor), missing exchange rates.

## Change detection

`detectFinanceChange()` is called after: timesheet approve/reject, timesheet regularisation approval,
attendance check-in and admin regularisation, leave approval / withdrawal of an approved leave,
salary structure create/edit (from its effective date onward). It finds locked calculations for the
affected month(s) (billing only for the affected project; vendor payments only for contractors),
records old/new values, who/when, the locked amount and the new potential amount, and flips the
status to `change_detected`. Nothing is recalculated automatically.

## Formulas

- **Salary** (updated 2026-09-30, `timesheets/workHours.service.js`): expected hours = working days
  of the employee's ONE company calendar (Mon–Fri less its holidays, plus any `is_working_day`
  exception) × daily shift hours (default 9). Hourly rate = monthly CTC ÷ expected hours. Paid =
  **approved** timesheet hours up to the shift per day (paid leave = a full shift); short hours are
  deducted at the hourly rate. Overtime (hours beyond the shift, or any hours on a weekend / company
  holiday) is paid only when its `TimesheetDayOvertime` row is `approved`; `comp_off` earns time off
  instead. Pending hours / OT only feed `projected_net`. Check-in / check-out never feeds pay.
  Project / client calendars never change expected hours.
- **Timesheet weeks** run Sunday → Saturday and auto-lock Sunday 00:00 IST; still-pending entries get
  `admin_review` after `TIMESHEET_ADMIN_REVIEW_GRACE_DAYS` (default 3).
- **Billing (Managed Services)** (contract rule since 2026-10-01): monthly rate — every working day
  inside the agreement bills rate ÷ project-calendar working days, whatever hours were logged (a full
  month = exactly the rate; rounding settled on the last working day); hourly — approved hours × rate. Overtime = approved `overtime_hours`
  (plus weekend/holiday hours on a monthly contract) × hourly-equivalent × `overtime_multiplier`,
  only when `Account.overtime_billable`. Fixed price (`service_category = project`) is recognised but
  not calculated.
- **Vendor payment**: contractor `vendor_rate` × allocation share × contract working days ÷ working
  days on the project calendar (contract rule, like monthly billing); overtime at straight time where
  the project pays overtime.
- **Invoices**: one builder (`billing/invoices.service.js`) — the project's Billing & Sales month
  (locked version when locked), in the billing rate's currency, under the project's own name and
  client, with an editable invoice number; `billingEngine.invoiceDetails` explains the amount.
- **Resource revenue**: resource's pro-rata share (by hours) of each project's billing; cost =
  timesheet-based salary × allocation % (or the vendor payment line for a contractor).
- **Finance → Projects "Contract billing · <month>" total**: `projectPnl.monthContractByProject` —
  the contract projection (fixed fee, or minimum / benchmark hours × rate), prorated by calendar days;
  not timesheet based.

## Project identity

Project name is a label, not a key. Every project has its uuid and an org-unique `project_code`
(`P0001`…), backfilled by migration `20260929150000_finance_locking_categories_overtime`.

## Allocation % vs internal cost rate

- **Allocation %** — share of a person's capacity / monthly cost charged to a project (P&L, Resource
  Revenue, vendor payments). Empty = even split.
- **Cost rate / hr** — internal cost per approved hour on a contract. When set, P&L charges
  hours × rate *instead of* the salary allocation; also drives budget burn. It is **not** added on top
  of salary in the nightly profitability batch any more (that double-counted), and never used for
  client billing.
