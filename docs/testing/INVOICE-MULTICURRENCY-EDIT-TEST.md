# Invoice multi-currency + edit — manual test guide

Feature (built 2026-10-01): optional invoice currency (INR, USD, AED, SAR, EUR, GBP) converted with Finance exchange rates; `PATCH /billing/invoices/:id` to edit draft invoices.

## Behaviour to verify

- Currency is optional; default stays the project's billing-rate currency.
- Amount, rate and resource lines convert via Finance exchange rates (INR 210000 → USD 2530.12 at the test rate). Original figures are kept in `details.conversion`.
- Missing rate for the chosen currency → **422**, nothing saved.
- PATCH edits invoice number, date, notes, currency. Duplicate number → **409**. Currency change recalculates the amount. Sent/paid invoice → **409** (open question: allow editing sent invoices?).
- UI: "Invoice currency" dropdown in the drawer, "converted from…" in the preview, "Converted from" line on the printed invoice, "Edit" button on draft rows only.

## Automated

```powershell
npm run lint:changed
npm run test:changed
cd server; npx jest --runInBand tests/finance-invoices-records.test.js
```

(Targeted only — no full suite. Use the isolated test DB.)

## Manual

1. Finance → Exchange Rates: set USD, AED, SAR, EUR; leave GBP unset.
2. Drawer: INR 210000, pick USD → preview shows converted amount; save; reopen; print.
3. Pick GBP → 422, no invoice created.
4. Draft invoice: Edit notes/date; duplicate number → 409; change currency → amount recalculates.
5. Mark invoice sent → Edit hidden / PATCH returns 409.
6. Edge: empty PATCH, INR→INR, non-finance role (permission error).

## Related open issue — Live Analytics → Vendors amounts

Reported as "not calculated correctly" (2026-10-01). Not reproduced: no contractor rows in the local DB; engine logic (`calculations/engines/vendorPayment.engine.js`) matches the documented rule. ekamNext ₹36,818.18 = ₹90,000 × 9 / 22 (looks like mid-month allocation/agreement start). Needs the "By contractor and project" table (rate, allocation %, working days) and the expected amount to proceed.
