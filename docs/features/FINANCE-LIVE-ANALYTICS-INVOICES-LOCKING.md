# Finance — Live Analytics invoices, per-record locking, Financials = locked only

Client brief received 2026-10-01. Implementation status is tracked at the
bottom of this file. Reuse existing models, APIs, calculations, invoice and
lock mechanisms — smallest clean change, no rebuilds.

## Separation of concerns (the core rule)

| Area | Source of truth | Timesheet-based? |
|---|---|---|
| Project revenue (Finance → Projects) | contract / billing config + applicable dates (prorated, e.g. MetaFlow ending 16 Oct = 16 days) | **No** |
| Salary | existing approved-timesheet payroll rules | yes (unchanged) |
| Billing / invoice | project's billing/contract config | **No** — not just because timesheets exist |
| Expenses | live records until locked | — |
| Vendor billing | vendor / client / project billing config | — |
| Financials | **locked / finalized records only** | — |

## Requirements

1. **Finance → Projects:** keep the current revenue calculation and bold INR
   total exactly as is (date-prorated contract projection). Do not make it
   timesheet based.
2. **Project P&L:** hide the whole tab from the Finance UI. Keep backend and
   data structures (needs clarification later: partial-month salary on LWD,
   real project cost, profit).
3. **Client invoices:** remove Generate Invoice from Project P&L; add a
   Generate Invoice action at the end of every project row in
   **Live Analytics → Billing & Sales**, opening the invoice flow for that
   project.
4. **Vendor invoices:** remove from Project P&L; add Generate Invoice per vendor
   in **Live Analytics → Vendors**. The vendor invoice shows vendor, client /
   project, billing period, billing type, amount, currency, calculation
   details, rate, days / hours, final amount.
5. **Billing & Sales invoice area:** a Generate Invoice form at the top
   (invoice number, date, billing period, project, client, billing type,
   currency, rate, other existing fields). **Invoice number is editable**
   (e.g. `INV-2026-001`), not forced auto-numbering.
6. **Generated invoices** list below the form: number, project, client,
   period, amount, currency, status, Download. Reuse existing invoice code.
7. **Bug — wrong project / client / currency on invoices** (e.g. a Miicare
   project invoiced as "Ment Tech Labs" in the wrong currency). Trace
   Project → Client → Billing config → Currency → Invoice; fix at the root,
   no stale/shared/default project data.
8. **Invoice calculation details** shown on the invoice:
   - monthly: monthly rate, working days, worked days, billing period
     (e.g. 1–16 Oct), amount;
   - hourly: hourly rate, billable hours, rate × hours;
   - always billing type, period, currency, final amount. Based on the
     billing config, not on timesheets merely because they exist.
9. **Salary lock per employee** in Live Analytics → Salary
   (Unlocked → Locked; locked row moves to the Locked section and becomes
   finalized data).
10. **Locking across Live Analytics:** Billing (per project / record),
    Salary (per employee), Expenses (per record), Vendors (per vendor billing
    record). Unlocked → Locked; locked records appear in the Locked section.
11. **Locked vendor records** keep full info: vendor, client, project, period,
    billing type, rate, amount, currency (+ conversion), calculation, invoice,
    lock status. Never the wrong currency.
12. **Locked records:** View | Download wherever a document exists (reuse
    existing exports).
13. **Financials tab = locked / finalized records only.** Live Analytics holds
    unlocked / projected data. Nothing moves to Financials until locked.
14. **Locked / Unlocked (/All) filter** at the top of Financials; default =
    locked.
15. Preserve payroll / timesheet logic and the Projects revenue calculation.

## Acceptance checklist

- [ ] Projects revenue unchanged (date-prorated, not timesheet based)
- [ ] Project P&L hidden (backend kept)
- [ ] Generate Invoice removed from Project P&L
- [ ] Generate Invoice per project in Billing & Sales
- [ ] Generate Invoice per vendor in Vendors
- [ ] Generated invoices listed below the form
- [ ] Editable invoice number
- [ ] Correct project / client and currency on every invoice (INR, USD, …)
- [ ] Invoice shows calculation details (monthly vs hourly)
- [ ] Lock: salary per employee, billing, expenses, vendor billing
- [ ] Locked records in the Locked section with View / Download
- [ ] Vendor locked records show vendor, client, amount, currency, calculation
- [ ] Financials shows only locked data by default; Locked/Unlocked filter works
- [ ] Payroll / timesheet logic unchanged; no duplicate invoice calculation
- [ ] Tested across projects, clients, INR + USD, vendors, employees,
      locked / unlocked — no cross-project / cross-client leakage

## Decisions (user, 2026-10-01)

- **Monthly proration = working days** on the project's calendar:
  rate × working days inside the contract ÷ working days in the month.
  (Finance → Projects keeps its calendar-day projection.)
- **Contract rule everywhere:** a monthly project bills its contract amount in
  Billing & Sales, the billing lock, the invoice and Financials — no longer
  scaled by approved hours. Hourly = approved hours × rate. Overtime still
  needs approved hours and `overtime_billable`. Vendor (contractor) cost
  follows the same rule on the vendor rate.

## Root cause — wrong project / client / currency on invoices

The older "Compute revenue → Generate invoice" path (`billing.service
.createInvoice`, `POST /billing/invoices`) never set `currency` (every invoice
defaulted to INR) and the invoice list / print showed `Account.name`. A
project row's `name` is often the client account it was created from (local
example: project "Circle" has `name` "Apaar Information Systems", client
"Girnarsoft"), so a Miicare project printed as "Ment Tech Labs". Fix: one
invoice builder for both paths, currency from the project's billing rate, the
project's display name (`project_name || name`) and its linked client stored
on the invoice.

## Implementation status

**Backend — done (2026-10-01), tests green** (`finance-invoices-records`,
`finance-locking`, `erp-phase5-billing`, `erp-projects-phase2`):

- Contract rule: `billing.engine` (monthly = rate / working days per contract
  working day, rounding settled on the last day; hours only matter for hourly
  / billable OT) and `vendorPayment.engine` (same on the vendor rate).
  `billingEngine.invoiceDetails(raw)` = how the amount was worked out.
- One invoice builder `billing/invoices.service.js` (client + vendor);
  `POST /billing/invoices` and `POST /calculations/billing/invoice` both use it;
  old `billing.service.createInvoice` removed. New: `GET /billing/invoices/preview`,
  `GET /billing/vendor-invoices`, `GET /billing/vendor-invoices/preview`,
  `POST /billing/vendor-invoices/generate`. Migration
  `20261001100000_invoice_numbers_details` (invoice_number unique per org,
  invoice_date, notes; vendor invoice details/date).
- Per-record lock kinds `salary_employee`, `vendor_bill`, `expense`
  (migration `20261001110000_record_lock_kinds`) via the existing
  `/calculations/lock|reopen|recalculate`; billing locks store `amount_inr`.
  Payroll pays individually locked employees their locked line.
- `calculations/records.service.js`: `GET /analytics/expense-records`,
  `GET /calculations/locked`, `GET /calculations/financials/records?state=locked|unlocked|all`.
  Salary / Vendors live views overlay per-record locks.

**Frontend — in progress:** hide Project P&L; invoices + lock actions in
Billing & Sales; Vendors / Salary / Expenses per-record locks; Locked tab;
Financials Locked/Unlocked/All.

Known pre-existing failure (not from this work): `contractors-project-pnl` →
"payroll never pays a contractor".
