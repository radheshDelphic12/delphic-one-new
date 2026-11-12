# Group Dashboard > GST & TDS (tax tracking)

Brief: Paras, 2026-11-09 (Group Dashboard > Book Keeping screenshot + voice notes). Phase 1 built 2026-11-09, local, not pushed.

## 1. What was asked

Book Keeping now holds every bank account and wallet of every company (cash, savings, cards, "Advance & Deposits", "GST Wallet", "Income (TDS Wallet)",
"Payable (TDS Wallet)", "Receivable"). Those tax / receivable wallets are typed by hand today. The group needs the same numbers **from the invoices**, with the
trail behind each one:

1. **Invoice-wise tax**: for every invoice, the base amount, the GST charged, the TDS the client deducts, and what is actually paid, in the invoice's own currency.
   An invoice paid by the client's foreign company (USD / AED) carries no GST and no TDS and must read as such.
2. **Period totals** (for example September to October): billing (base), GST and TDS, each visible on its own.
3. **TDS receivable**: the client deducts about 10% and deposits it with the government, which refunds it about 1.5-2 years later. Track how much was deducted on
   which invoice, keep it for as long as it takes, record the refund when it arrives, and show the outstanding TDS as an **asset** (future money), clickable down to
   the invoices.
4. **GST payable**: the GST collected on invoices is paid to the government monthly or quarterly. Show what is due for a period, record the payment, and keep the history.
5. **Vendor side**: a payment to a vendor is base + GST - TDS. The TDS withheld is paid to the government; track what is withheld and what is deposited.

Worked example from the brief: invoice 15,00,000 + GST 18% (2,70,000) - TDS 10% (1,50,000) = 16,20,000 paid by the client; the 1,50,000 comes back from the government later.

## 2. Decisions (defaults, change on request)

- A new Group Dashboard tab **GST & TDS** (group superadmin only), next to Book Keeping. Book Keeping and its wallets are not changed.
- **Invoices come from what exists**: Delphic's client invoices (Live Analytics / Finance invoices, with the contract's GST / TDS charge lines) and the Book Keeping
  invoice generator (GST lines: CGST / SGST / IGST). A charge line counts as **GST** when its label contains "GST" (IGST, CGST, SGST), as **TDS** when it contains "TDS";
  anything else is "other". So the existing contract charges keep working; naming a line "TDS 10%" is what makes it TDS.
- **TDS is deducted when the client pays.** Expected TDS = the TDS lines of the invoice; deducted so far = expected x (paid / payable). The receivable is
  deducted-so-far minus the refunds recorded. Invoices not yet paid show their TDS under "yet to be deducted".
- **GST is due on the invoice date** (accrual). Payable for a period = GST on the invoices of that month / quarter, minus GST payments and credits recorded for it.
  Quarters are the Indian ones (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar). Only INR invoices count in the GST figures.
- Financial year = April to March, by invoice date.
- INR, USD and AED are never added together; totals are per currency.
- Refunds, GST payments and TDS deposits are separate records (soft delete, audited), never edits of an invoice.

## 3. Phase 1 (built)

Tables (migration `20261124100000_group_tax_tracking`, additive): `tds_receipts` (a refund received against an invoice) and `tax_challans` (every deposit made with
the government, below).

API (`/api/v1/group-tax`, group superadmin; filters `from` / `to` = YYYY-MM, `org_id`, `currency`):
`GET /options`, `GET /invoices` (rows + totals per currency), `GET /tds-receivable` (+ `POST /tds-receipts`, `DELETE /tds-receipts/:id`),
`GET /gst?by=month|quarter`, `GET /tds-payable` (salary TDS from Payroll > Salary adjustments > TDS, vendor TDS from the vendor invoice), and the challans:
`GET /challans`, `GET /parties`, `POST /challans` (multipart: form fields + optional `file`), `PATCH /challans/:id`, `DELETE /challans/:id`, `GET /challans/:id/file`.

Screen (`client/src/pages/groupOverview/GroupTaxTab.jsx`): Invoices (cards: billing, GST, TDS, net; invoice-wise table with the lines behind each), TDS receivable
(cards, invoice list by financial year, record a refund), GST payable (by month or quarter; "Record challan"), TDS payable (employees' salary TDS and vendors' TDS, what is
withheld and what is deposited), Challans (every deposit with the government).

Code: `server/src/modules/groupTax/` (`groupTax.service.js`, `groupTax.routes.js`). Test: `server/tests/group-tax.test.js`.

## 4. Not in Phase 1 (next)

- GST on **vendor** invoices (input credit) and the vendor payable as base + GST - TDS per contract (needs GST / TDS fields on vendor invoice tracking and per-vendor
  defaults).
- TDS deducted on the Book Keeping invoice generator's own invoices (a TDS % on those invoices).
- Posting refunds / GST payments / deposits into the Book Keeping wallets, and showing these balances next to the wallets (GST Wallet, Income (TDS Wallet)) to reconcile.
- Reminders for the GST due date and for refunds older than 12 / 18 months.
- A balance-sheet style "money to come in" total on the Group Dashboard.

## Challans (added 2026-11-09)
Money deposited with the government - GST, TDS on salaries (employees), TDS on vendor / contractor payments, advance tax, PF, ESI, professional tax, other - is one record,
a **challan**: type, challan number (CIN / CRN), BSR code, bank, the period it settles (a month, or the quarter ending that month), amount, paid-on date, the company
(or all), the **employees and / or vendors it covers** (multi-select, optionally an amount for each), a note and the **uploaded challan** (PDF or image, downloaded only by the
group superadmin). `gst_credit` is a credit set against GST (no challan). GST payable and TDS payable read their "paid / deposited" from the challans, so recording a
challan from the GST or TDS screen and from the Challans tab is the same thing. Every add / edit / remove is audited; remove keeps the row (soft delete).
