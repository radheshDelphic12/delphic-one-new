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
| `salary` | org + month | net salary (attendance-based) | payroll run processing, Resource Revenue, Financials |
| `resource_revenue` | org + month | total resource revenue | reporting |
| `vendor_payment` | org + month | owed to vendors (INR) | creates pending `VendorPayment` rows, Financials |
| `financials` | org + month | profit | Financials (finalized view) |

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

- **Salary**: per day = monthly CTC ÷ working days of the employee's own calendar (Mon–Fri less that
  calendar's holidays); loss of pay for absent / unpaid leave / unmarked working days (half day = ½).
  Live mode (`asOf` = today) reports "incurred to date" and never counts future days as loss of pay.
- **Billing (Managed Services)**: existing rule — monthly rate: day = rate × min(hours ÷ benchmark,
  1 ÷ project-calendar working days); hourly: hours × rate. Overtime = approved `overtime_hours`
  (plus weekend/holiday hours on a monthly contract) × hourly-equivalent × `overtime_multiplier`,
  only when `Account.overtime_billable`. Fixed price (`service_category = project`) is recognised but
  not calculated.
- **Vendor payment**: contractor `vendor_rate` × allocation share, spread over the project calendar
  like monthly billing; overtime at straight time where the project pays overtime.
- **Resource revenue**: resource's pro-rata share (by hours) of each project's billing; cost =
  attendance salary × allocation % (or the vendor payment line for a contractor).

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
