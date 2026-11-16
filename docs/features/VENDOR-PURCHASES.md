# Vendor Invoices: normal purchases

2026-11-16 - local, not pushed. Finance > Vendor Invoices can now hold a **normal purchase**: a vendor bill that is *not* tied to a client project (office, software, equipment, services), next to the project vendor invoices generated from Live Analytics > Vendors.

## What it does

| Piece | Behaviour |
| --- | --- |
| Add purchase | Button on Finance > Vendor Invoices > Invoices. Vendor, vendor bill number, bill date, optional due date, optional category (Finance > Categories, *group charge* kind), amount **before GST**, currency, GST, TDS, adjustment (+ note), optional office, description. |
| Payable | `amount + GST - TDS + adjustment` (same formula as a project vendor invoice). Shown live in the form. |
| Expense | One linked expense row is posted in the **bill date's month** for the amount before GST (a `group_billing_charges` row, `vendor_purchases.charge_id`). Live Analytics > Expenses, the per-record lock and Financials read it like any other expense (type `charge`). |
| Group Charges lists | The rows posted by purchases are left out of Finance > Group Charges and the group "Billing Charges" list (they are managed in Vendor Invoices). |
| Paid / unpaid | Recorded on the purchase (date, mode, amount, reference). It never moves the expense. Marking paid works even in a locked month (cash tracking only). |
| Edit | Changes the purchase and its expense row; moving the bill date moves the expense to the new month. |
| Cancel | Keeps the purchase (who / when / why) but removes its expense row. A paid purchase must be marked unpaid first. A cancelled purchase cannot be changed; its bill number can be reused. |
| Files | The vendor's bill attaches with **Files** (document entity type `vendor_purchase`, admins of the same company). |
| Locking | Create / edit / cancel are refused (423) when the month's financials are locked (the month it is in, and the month it moves to). Same rule as vendor invoices. |
| Duplicates | A vendor bill number is used once per vendor among active purchases (not case sensitive). |
| Access | Admins with the financials permission (same as the vendor invoices routes). Every write is audited (`vendor_purchase` in the change log). |

## Where it lives

- Migration `20261216100000_vendor_purchases` (additive: table `vendor_purchases` + document entity type `vendor_purchase`; no column added to existing tables).
- Server: `modules/billing/vendorPurchases.service.js`, routes `GET/POST /billing/vendor-purchases`, `PATCH /:id`, `POST /:id/cancel`, `/:id/pay`, `/:id/unpay` in `billing.routes.js`, schemas in `billing.validation.js`.
- Client: `pages/finance/VendorInvoicesTab.jsx` (one list: Type = Project invoice / Purchase) and `pages/finance/VendorPurchaseDrawers.jsx` (Add / edit purchase, Mark paid).
- Tests: `server/tests/vendor-purchases.test.js` (8).

## Not included (decide later)

- The **Bank payout** panel and the vendor Excel still list project invoices only; purchases are not in the bank payout file yet.
- GST is tracked for the payable only; the expense is booked before GST (input-credit handling is not modelled).
- Partial payments: one payment per purchase.
