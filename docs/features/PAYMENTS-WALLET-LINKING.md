# Payments, wallets and central Book Keeping (all companies)

Status: requirements captured 2026-10-27 (Paras meeting + replies). Built in phases; see "Phases" for what is done.

## 1. What Paras asked for

**Mark paid / payment received (any money coming in) and any money going out** must open one popup:

- how much was received / paid: full or part; the rest stays **pending** (part payments allowed everywhere, also Live Analytics invoices which today go draft -> sent -> paid only);
- currency (INR, USD, AED) and the **exchange rate, asked at the time of payment** (typed each time; an admin rate list may pre-fill it later), the INR value shown;
- **bank charges** and **other deductions with a note**, so net received is tracked (this replaces an automatic exchange gain / loss);
- **"Track in a wallet?" Yes / No, default No.** Yes -> choose the wallet (money in adds to it, money out deducts from it); No -> nothing reaches the wallet (money may have landed in another account, or we do not want to show it);
- wallets hold INR and USD only. AED exists for invoices, payments and reporting only;
- the payment counts in the company's INR totals **once it is locked**, whether or not a wallet was used. Receiving / deducting wallet money is a separate matter (the "wall in between").

**Where it must work** (every company, same options, everything editable / updatable):

| Company | Money in | Money out |
|---|---|---|
| Delphic Global | project invoices (Live Analytics > Billing & Sales), GST / USD invoices (Book Keeping) | reimbursement (expense claims), vendor payments, salary, group expenses |
| Zephyr | rent receipts, customer payments | expenses, **group expenses** (one cost split over projects / properties / units: one wallet deduction for the whole amount), salaries |
| Gulati Industries | deal client payments | deal vendor payments, ledger |
| Acconcy | deal payments received | investee funding, salaries, ledger |
| Novarex | invoice payments | franchise settlements |
| Foundation, Zklyrera, Valterra | ledger entries | ledger entries |
| Group | | Group Debt: EMI paid, money returned (optional yes / no wallet) |

Yes in a company's popup posts the amount to the wallet in the **group** Book Keeping (Group Dashboard > Book Keeping); No leaves it out.

**Finance > Invoicing (new tab, each company):** every invoice raised, month by month, paid / partly paid / unpaid, filters, totals, and payments recorded from there with the same popup. GST / USD / AED invoice creation is its own segment (it also stays in Book Keeping where it is today).

**Bug to fix:** a reimbursement marked by mistake cannot be undone. Undo is **only for the multi-org group admin (Paras)**, with a reason, history kept, the wallet entry removed and the claim back to approved.

## 2. Decisions taken (defaults, change on request)

- Invoicing tab: one list with a type filter (project invoice / GST / USD / AED).
- Undo follows the month lock (reopen the lock first); override with reason can be added if Paras asks.
- Wallet direction: in on receipts, out on payments; group expense = one deduction for the full amount.
- Existing paid records are not touched; the new popup applies to payments recorded after it ships. The old "wallet required after go-live" rule becomes optional, default No.
- Dirham: invoices and reporting only.

## 3. What exists today (read from the code, 2026-10-27)

- `cashPosition/cash.hooks.js` links four Delphic Global flows to wallets (client invoice, vendor payment, expense, salary) and demands a wallet after the group's go-live date; it also unlinks on un-marking.
- `billing` client invoices: status draft -> sent -> paid, forward only, no part payments.
- `expenses`: claim approved -> reimbursed, no way back (the bug); vendor payments approved -> paid.
- `groupInvoices` (Book Keeping): part payments and remaining amount exist, with wallets.
- Zephyr, Gulati, Acconcy, Novarex, Foundation, Zklyrera, Valterra, Group Debt: payments exist but nothing reaches the wallets.

## 4. Design

1. One **payment record** per payment (kind, reference, direction, date, amount, currency, rate, INR amount, bank charges, deductions + note, notes, optional wallet entry, who, soft-deleted when undone). A record can have many.
2. One server **payment service** used by every module: creates the record, optionally the wallet entry (via the existing cash hook code), undoes both together, audited.
3. One **payment popup** component used by every screen.
4. Invoice status stays as is; "paid / partly paid / unpaid" is derived from the sum of its payments.
5. All amounts are Decimal; INR, USD and AED are never added together.

## 5. Phases

1. Payment record + service + popup; Delphic Global invoices with part payments; reimbursement undo (group admin); vendor payments and salary on the new popup.
2. Finance > Invoicing tab.
3. Zephyr and Gulati (rent, deals, ledger, group expenses).
4. Acconcy, Novarex, Foundation / Zklyrera / Valterra.
5. Group Debt; exchange-rate list; reports.

Each phase ends with tests, a staging check and a deploy. Migrations are additive. Prod deploys need free disk space on the server (see the deploy notes).

## 6. Progress log

(append below as phases are built)

### 2026-10-28 - Phase 1 built locally (not pushed)

- Migration 20261028090000_payment_records: table payment_records (kind, reference, direction, amount, currency, exchange_rate, inr_amount, bank_charges, other_deductions + note, optional wallet_transaction_id, soft-delete for undo).
- server/src/modules/payments/payments.service.js: prepare() / commit (rate rules, deductions <= amount, optional wallet entry: net amount; an INR wallet takes a foreign payment at the rate; AED never goes into a wallet), totals(), summarize(), list(), undoWithin(). Wallet entries from payments use reference_type payment.
- Client invoices (billing/invoicePayments.service.js): POST/GET /billing/invoices/:id/payments, DELETE /billing/invoices/:id/payments/:pid (group admin, reason). Invoice list / get carry paid_amount, pending_amount, payment_status, payments_count. status paid = a payment of what is pending. Invoice stays sent until the payments reach its amount.
- Expenses: reimburse and vendor payment pay now take the same body (rate, bank charges, deductions, optional wallet_payment, default no wallet); POST /expenses/claims/:id/undo-reimbursement and /expenses/vendor-payments/:id/undo-paid (group admin only, reason; the claim / payment goes back to approved). Deleting a claim also removes its payment records.
- Salary keeps the old rule (wallet needed after go-live) until a later phase.
- Client: components/payments/usePaymentDialog.jsx (the one popup), InvoicePaymentsModal.jsx, UndoReasonModal.jsx; wired into Live Analytics invoices (ClientInvoices), Finance > Accounting > Invoicing, Finance > Expenses (reimburse + undo) and Finance > Vendor payments (pay + undo).
- Tests: tests/payments.test.js (12) and the updated group-cash-hooks tests; regression suites for billing, expenses, finance invoices green.
- Next: Finance > Invoicing month-wise paid / unpaid view with filters, then Zephyr and Gulati (phase 3).

### 2026-10-28 - Phases 2 to 5 built locally (not pushed)

- **Generic wallet link (every company):** POST /payments/track (kinds: rent_payment, ledger_income / ledger_expense, group_expense, salary, deal_client_payment, deal_vendor_payment, investee_funding, investment, invoice_payment, franchise_settlement, debt_emi, debt_repayment, debt_received, other_in / other_out), GET /payments/track?kind&reference_id, DELETE /payments/track/:id (group admin, reason). Route rule: admin (routeRules.js). The company module's own record is never touched.
- **Client:** lib/payments/trackInWallet.js + components/payments/TrackInWalletHost.jsx (mounted once in main.jsx). After a payment is saved the api wrapper opens the same popup (wallet No by default; Cancel skips). Wired in: Zephyr (rent received, salary paid, group expense = one deduction for the whole amount), Gulati (deal client / vendor payments), Acconcy (investee funding, salary paid), Novarex (invoice pay), Foundation (expense, funding), Zklyrera and Valterra (income / expense / salary entries marked paid), Group Debt (EMI marked paid).
- **Finance > Accounting > Invoicing:** filters (search, year, month, status, paid / partly / unpaid) and totals per currency (invoiced, paid, pending).
- **Also done afterwards:** Delphic salary (payroll) - the wallet is a choice now (cash.hooks prepare no longer demands one); after a NEW salary payment is saved the screen asks the same popup (kind salary); marking it not paid undoes that payment record. Hand-typed ledger entries (Zephyr, Gulati, Acconcy) ask the popup too (revenue / income = money in, expense = money out). Group Book Keeping > Payments (GET /group-cash/payments, CSV): every company's payments with INR value, rate, bank charges, deductions + note, net, wallet; filters by date, company, type, in / out.
- **Not built (no screen to hang it on):** Acconcy deals have no payment field (money against a deal is entered in the ledger, which now asks the popup); debt repayment / money received kinds exist on the server only (Group Debt has EMIs only). Non-admin staff of a company cannot use the popup (route rule is admin; their request is skipped).
- **Checked:** tests/payments.test.js (17), group-cash-hooks, access-model, billing / expenses / finance regression green; Playwright on a local invoice: popup (wallet No by default), part payment, Payments list + undo shown for the group admin.

### 2026-10-28 - Staging verification and fixes (all on staging, not main)

Bugs found by testing and fixed: Zephyr rent response is the due (no payment_id) and salary response is the record itself; Novarex purchase invoices are money out; the payroll save response is the payment itself (res.data, not res.data.payment); invoices paid before payments were recorded showed as fully pending (now counted as fully paid); Finance > Accounting (and the Invoicing section in it) is switched off by the client's finance scope brief (FINANCE_DISABLED_MODULES), so Invoicing is now its own Finance tab (with an invoice number column).

Verified with Playwright on staging (as the group admin, dummy rows tagged ZZ PW, removed afterwards): Live Analytics invoice popup, part payment, wallet net amount, Payments list, undo; reimbursement popup + wallet + undo; POST /payments/track; group Payments report + CSV; Finance > Invoicing filters / totals / popup; Zephyr salary (a real approved record: popup, wallet out, record restored); Group Debt EMI popup + payment record; Delphic payroll salary popup + wallet. Client wrapper test (node --test --experimental-test-module-mocks src/lib/payments/trackWrappers.test.mjs) covers every company's wrapper with the real response shapes. Jest: payments (19), group-cash-hooks, billing / expenses / salary regressions.

Not testable on staging: vendor payments (disabled by config; jest covers the API and undo). Checked by the wrapper test only, not in a browser: Zephyr rent / group expense / ledger, Gulati, Acconcy, Novarex, Foundation, Zklyrera, Valterra (the same popup host was proven in Zephyr, Group Debt and payroll).

