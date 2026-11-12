# Novarex Pharmaceuticals - the 8th company: outlets, franchise, inventory, logistics and finance (2026-10-15)

Status: **built locally (N1-N6), uncommitted, not pushed.** See "As built" at the end. Module key `novarex` (`enabled_modules` marker), tables `nx_*`, API `/api/v1/novarex`, UI `/novarex`, theme `.theme-novarex`. Built the same way as Valterra Resources: clone the Zklyrera/Valterra workspace (finance core), then add the pharma operations modules on top.

## 1. Reuse map (from inspection)

| Need | Reused | New |
|---|---|---|
| Company registration, switcher, isolation, `requireModule`, `org_id` scoping | `orgs`, `enabled_modules`; Valterra-style **registration migration** (company row + group Super Admin admin access, no data, idempotent) | `novarex` marker |
| Roles, people, logins, account | Valterra `access.js`, `people`, `users`, `account` services | extra roles (see 8) |
| Month lock, audit, filters, period presets, CSV/PDF export, projections, line charts, drawers | Valterra `lock.js`, `periods.js`, `audit.js`, `NxFilters` (from `VtFilters`), `groupExport.js`, Recharts | `nx_period_closes`, `nx_audit` |
| Finance accounting (investments principal vs earnings, entries, salaries, receivables/payables, valuation profit x 240 + principal still invested x 3) | `zklyrera.calc.js` rules, cloned as `novarex.calc.js` | sales/COGS/inventory/freight lines added to the same calc |
| Group Dashboard | `groupFinance.service` (`kindOf`), `groupTravel` markers, `ZklyreraGroupSection` pattern, `orgLogo`, App.jsx/AppLayout wiring | `novarex` block, outlet drill-down |
| Products / batches / warehouses / stock ledger / purchase orders / sales orders / shipments / vehicles / franchise | **Nothing exists in the repo** (only client/project invoices and `gx_purchases/sales`, which are deal-based, not stock-based) | all new `nx_*` tables |
| Invoice numbering | existing `InvoiceCounter` pattern | `nx_invoices` (own register, company-scoped) |

Outlet-level separation is done with `outlet_id` on every transactional table, plus `ownership_type` on the outlet. This is a sub-scope of one company, not new organisations.

## 2. Data model (additive migrations, `nx_*`)

**Foundation:** `nx_settings`, `nx_categories` (product category, dosage form, expense, income, return reason, ... all editable data), `nx_audit`, `nx_people`, `nx_period_closes`, `nx_investments` + `nx_returns` (cloned), `nx_entries` (income / expense / salary / transfer, optional `outlet_id`, `warehouse_id`, `shipment_id`, `source_type/source_id` to stop double counting), `nx_projections` (cloned lines + sales, purchases, inventory investment, logistics, franchise fees, outlet opening).

**Outlets & franchise:** `nx_outlets` (code, name, `ownership_type` company_owned | franchise | third_party | other, legal entity, parent, address/city/state, GSTIN, drug licence no + expiry, manager, opening date, status active/inactive/archived, supply warehouse, price list, agreement ref, notes), `nx_outlet_user_scope` (which users see which outlets), `nx_franchise_agreements` (outlet, partner, dates, initial fee, royalty %, revenue share %, purchase discount %, security deposit, payment terms, status, renewal date), `nx_franchise_charges` (fee/royalty invoices) and `nx_franchise_settlements`.

**Products & stock:** `nx_products` (SKU, brand, generic, category, manufacturer, strength, dosage form, pack size, UoM, HSN, GST %, MRP, purchase/selling price, barcode, status, regulatory class, requires_prescription, cold_chain, reorder min), `nx_price_overrides` (outlet price/discount), `nx_warehouses`, `nx_batches` (product, batch no, mfg/expiry, supplier, cost, quality status released/quarantine/rejected/recalled), `nx_stock_ledger` (**append-only**: product, batch, location, movement type, qty +/-, ref doc, user), `nx_stock_balances` (derived per product/batch/location: available, reserved, damaged, in_transit), `nx_stock_adjustments`, `nx_transfers` + `nx_transfer_lines`.

**Procurement:** `nx_suppliers` (licences, credit terms, catalogue, supplier prices), `nx_purchase_orders` + lines, `nx_goods_receipts` + lines (received/damaged/rejected, batch + expiry), `nx_purchase_returns`.

**Sales & billing:** `nx_customers` (outlet-linked or external), `nx_sales_orders` + lines (reserved/allocated/shipped qty, backorder), `nx_invoices` (type sales / purchase / franchise fee / credit note / debit note; one invoice per source via unique key), `nx_payments` (customer receipt / supplier payment), `nx_sales_returns` + lines (disposition: restock / quarantine / destroy / return-to-supplier).

**Logistics:** `nx_logistics_partners`, `nx_rate_cards` (model: fixed | per_km | per_unit | per_weight | zone | handling/cold chain), `nx_vehicles` (reg no, type, capacity, driver person, insurance/permit expiry), `nx_shipments` + lines (order/transfer, source, destination, method own|partner, vehicle/partner, estimated + actual freight, tracking ref, status, POD, damaged/missing), `nx_trips` (own-vehicle fuel/toll/maintenance link to entries).

**Recall:** `nx_recalls` (batch, reason, status) with traceability query across receipts, transfers, sales, shipments.

## 3. Business and accounting rules (one `novarex.calc.js`, client only displays)

- **Inventory only moves through the stock ledger**; posting is idempotent (`source_type + source_id + line` unique), so re-processing or editing a receipt cannot double-add. Edits of a posted document create a reversing + new ledger pair.
- **Receipt** adds stock at the warehouse (available) and a purchase invoice payable. **Transfer**: dispatch moves source available -> in-transit; destination available only increases on receipt confirmation; shortage/damage recorded; no revenue or purchase for same-entity transfers. Transfer between different legal entities (franchise/third party) is treated as a sale through a sales order, not a transfer.
- **Allocation is FEFO**; expired, quarantined, rejected or recalled batches are excluded from allocation and dispatch (server-enforced, configurable warning days in settings).
- **Sales order -> reserve -> allocate -> pick/pack -> shipment -> delivery -> invoice -> payment**; order, shipment, invoice and payment statuses are four separate fields. Invoice-before-dispatch is a setting.
- **Revenue recognition by outlet type:** company-owned outlet sales = Novarex revenue. Franchise and third-party outlets: Novarex revenue is only what Novarex invoices them (goods sold to them, franchise fee, royalty, revenue share). Their own retail sales/salaries/expenses are NOT booked into Novarex; they appear only in franchise reports where visibility is authorised.
- **Profit:** Gross profit = recognised sales revenue - COGS (batch cost of goods shipped/sold, not purchases). Net = gross + other income - operating expenses - salaries - logistics (freight booked once: a shipment's actual freight creates one expense, flagged so it is never counted again as a plain expense). Capital placed is not an expense; principal recovered is never income (as Zklyrera).
- **Inventory value** = sum(balance x batch cost). Receivables/payables = open invoices minus payments. Cash collected, sales revenue, outstanding and inventory value are always shown as separate figures.
- **Valuation (group formula)** = profit of month x 240 + (principal still invested x 3). Asset valuation of inventory is shown but is **not** added unless you decide so (open decision 2).
- **GST:** per-product rate; CGST/SGST vs IGST decided from outlet/customer state vs warehouse state; e-invoice / e-way bill fields stored as "pending - not filed", never marked verified without a real integration.
- **Returns:** reference original invoice/shipment; returned goods go to quarantine until a disposition is recorded; credit note created on approval.
- **Locks:** month close reuses the Zklyrera pattern; locked months block edits of entries/invoices/payments/settlements; corrections via admin override with reason (audited). Stock ledger history is never edited; a post-lock stock correction is a new adjustment dated in the open period.

## 4. Screens (`/novarex`, all filters server-side and live, every KPI/chart/table together)

Overview (KPIs in groups: Capital, Sales & Margin, Costs, Result, Stock health, Receivables/Payables; outlet-wise and warehouse-wise table) - Outlets (list + profile + own dashboard) - Franchise (agreements, fees/royalties, settlements, renewal alerts) - Products & Batches - Suppliers & Purchase Orders - Goods Receipts - Warehouses & Stock (balances, ledger, adjustments, reorder, near-expiry, expired) - Transfers - Sales Orders - Invoices & Payments - Returns & Recalls - Logistics (partners, rate cards, vehicles, trips) - Shipments - Investments - Income & Expenses - Salaries - Projections - Reports - Financials (valuation + month lock) - Setup (categories, settings, roles, thresholds).

**Filters:** period presets (today, week, month, last month, 3/6 months, quarter, previous quarter, year, previous year, financial year, custom), outlet, ownership type, warehouse, city/state, product, category, batch/expiry status, supplier, customer, franchise, logistics partner, order/invoice/payment/shipment status, payment status, actual vs projected.

**Charts: line charts only** (Recharts, plain XAxis/YAxis/Grid elements - not wrapped). Breakdowns (by category/outlet/product) are lines over the category axis, one line per outlet where compared.

**Reports (CSV + PDF):** monthly sales; sales by outlet/product; order status; purchases; stock on hand; stock movement and transfers; batch & expiry; returns & damages; invoice & payment status; receivables; payables; franchise fees & settlements; outlet expenses & salaries; logistics cost & delivery performance; gross/net profit; **outlet-wise P&L**; projected vs actual; recall traceability.

## 5. Group Dashboard

`kindOf` returns `novarex`; monthly feed = income (recognised revenue + earnings), expenses (COGS handled inside gross profit, opex, salaries, freight), assets = principal still invested. A "Novarex Pharmaceuticals - outlets, stock, franchise, logistics and projections" block on Group Finance and Projections tabs: KPIs, outlet table with drill-down, franchise performance, inventory value, receivables/payables, logistics cost, projected vs actual. Also add `novarex` to `MARKERS` (groupTravel), `groupInsights`, SettingsPage `canSeeDeleted`, `orgLogo`, `App.jsx`/`AppLayout` wiring, `headerTitle`. Inter-company items and stock transfers are excluded from group totals.

## 6. Theme and logo

Palette: deep **teal/emerald (`#0F766E`)** with a **medical blue accent (`#2563A8`)** and cool white surfaces, distinct from Zklyrera (ink+brass), Valterra (maroon+gold) and Gulati (green+copper). Logo: I will draw an SVG (capsule + leaf/cross mark, "NOVAREX / PHARMACEUTICALS" wordmark), exported to `client/public/novarex-logo.png` and `novarex-mark.png`, plus `.theme-novarex` in `theme.css`. Replaceable later by uploading a real logo in Setup.

## 7. Admin-editability (standing rule)

Every record type above has create / edit / archive endpoints, UI action, audit entry and a test. Statuses, categories, thresholds, tax classes, rate-card models, warning days, numbering prefixes and roles are data in Setup. Locks, approvals and computed totals (e.g. freight, invoice amount) can be overridden by the multi-org admin with a reason. Nothing is deleted when history exists (outlets, warehouses, products, batches are archived).

## 8. Roles and permissions

Backend-enforced on every query. Company roles: admin (= Super / multi-org admin), manager, finance, procurement, warehouse, sales, logistics, outlet_manager, hr, staff, contractor (+ optional `franchise_partner` for external access, limited to its own outlet). Salary data: finance/admin/hr only. Outlet managers and warehouse managers are scoped through `nx_outlet_user_scope`. Franchise users can only see their own outlet/agreement.

## 9. Phases (each ends with targeted tests + lint:changed, then a local commit; no push)

1. **N1 Foundation:** registration migration + tables, finance core clone (investments, entries, salaries, projections, lock, audit, roles), theme + logo, switcher/sidebar, Group Dashboard block (basic KPIs), outlets CRUD with ownership types.
2. **N2 Products, suppliers, warehouses, batches, stock ledger, POs and goods receipts, adjustments, transfers + in-transit, expiry/reorder alerts.**
3. **N3 Customers, sales orders (reserve/FEFO allocate/partial/backorder/cancel), invoices, payments, credit notes, returns, recalls.**
4. **N4 Logistics partners, rate cards, vehicles/trips, shipments, freight posting, franchise agreements, fees/royalties/settlements.**
5. **N5 Reports, projections vs actual, outlet P&L, valuation, month lock for new documents, full Group Dashboard drill-down.**
6. **N6 Verification:** arithmetic integrity test (like `valterra-integrity.test.js`) independent of the app calc, end-to-end flow test, isolation/RBAC tests, regression on Zklyrera/Valterra, browser click-through, docs + "As built".

Tests live in `server/tests/novarex-*.test.js` on a private `novarex_test` DB. Local demo seed `npm run novarex:seed` (local only; **never seeded on prod**; prod gets only the registration migration).

## 10. Decisions I need from you (defaults used if you just say "go")

1. **Scope of build:** this is very large (roughly 40 tables, 20 screens). Default: build all phases N1-N6 in order, starting with N1+N2, and stop for your review after each phase.
2. **Valuation:** default = the group formula on profit and principal still invested only (same as Zklyrera/Valterra); inventory value shown but not added.
3. **Invoice timing:** default = invoice after delivery confirmation (switchable per outlet/customer in Setup).
4. **Franchise sales visibility:** default = Novarex sees only its own sales to the franchise and fees; franchise retail figures are only recorded if the franchisee's data is entered with the "visible to Novarex" setting.
5. **Tax:** default = GST from product rate, intra/inter-state split from state codes; no government filing.
6. **Name/logo:** "Novarex Pharmaceuticals", generated logo as above.

## 11. Out of scope (stated, not faked)

No live GPS/carrier tracking (manual status + tracking reference), no real e-invoice/e-way-bill filing, no prescription/legal-compliance claims beyond configurable flags, no bank feed. Cash/bank balance only after an explicit opening balance, as in Zklyrera.


## As built (2026-10-15)

**Migrations** (all additive): `20261017090000_novarex_pharmaceuticals` (10 finance tables, a clone of Valterra with outlets), `20261017100000_novarex_company_registration` (company row + group Super Admin access only, no data, idempotent), `20261017110000_novarex_operations` (23 `nx_*` operations tables + `source_type/source_id/non_cash` on `nx_entries`), `20261017120000_novarex_settings_scope` (policy settings, `credited_amount`, `outlet_ids`).

**Code:** server `modules/novarex/*` (finance core cloned from Valterra; outlet = Valterra site with an ownership type that carries an accounting `kind`) and `modules/novarex/ops/*` (masters, stock ledger, purchasing, transfers, sales orders, logistics, billing, returns and recalls, franchise, dashboard and reports); API `/api/v1/novarex` and `/api/v1/novarex/ops`; client `pages/novarex`, `components/novarex/ops`, theme `.theme-novarex` (teal `#0F766E`, blue `#2563A8`), logo `client/public/novarex-logo.svg` / `novarex-mark.svg`; Group Dashboard block (finance + operations KPIs, line chart, outlet table).

**Rules as implemented**
- Stock is an append-only ledger (`nx_stock_ledger`, buckets available / reserved / in_transit / damaged / quarantine / lost). Posting is idempotent (`posting_key` unique + status claims) and runs under a per-company advisory lock; a bucket can never go negative.
- Goods receipt posting is the only stock-in; it creates batches, accepted / damaged units, and a supplier invoice (payable). Purchases are inventory, never an expense.
- Orders reserve stock FEFO (earliest expiry first); expired, quarantined, rejected and recalled batches are never allocated, dispatched or transferred. Backorders stay on the line.
- Dispatch moves reserved stock out; delivery confirmation puts damaged / missing / undelivered goods in damaged / lost / quarantine. The invoice (one per shipment, unique) is for accepted goods only. Order, fulfilment, invoice and payment status are separate fields.
- Revenue = sales invoice amount without GST (one income entry per invoice, unpaid until settled); cost of goods = batch cost, a non-cash expense entry in the same period; gross profit = revenue - COGS. Credit notes are negative income entries in their own month; restocked returns reverse COGS.
- Transfers between company locations are never sales; a customer that is a company-owned outlet cannot be sold to; a transfer to a franchise / third-party outlet is refused (sell to it). Franchise discount applies to the selling price; fees / royalties are invoiced from settlements and booked as income on the franchise outlet only. The franchisee's own retail sales are only a royalty basis.
- Freight: one expense entry per partner shipment that follows its actual cost; company-vehicle cost = one entry per trip. COGS and freight are inside operating expenses, so net profit is never double counted.
- Month lock reuses the existing close: invoicing, payments, returns credit, freight and trips dated in a closed month need an admin with a reason (audited).
- Roles: admin, manager, finance, staff, procurement, warehouse, sales, logistics, hr, outlet_manager, franchise_partner (outlet-bound roles see only their `outlet_ids`; they have no company finance overview).
- Everything is admin-editable: master data (edit / archive / restore), batch status, settings (invoice timing, expiry windows, transfer approval, prefixes, default GST), categories, agreements, settlements, projections (new lines: sales revenue, franchise income, cost of goods, logistics). Every change is audited.

**Tests:** `server/tests/novarex-workspace|outlets|integrity|operations|registration.test.js` (operations includes an independent recomputation of stock, inventory value, receivables, revenue and cost from the raw tables). Run on a private DB: create `novarex_test`, `prisma migrate deploy` with `DATABASE_URL` set to it, run jest with `TEST_DATABASE_URL`. Regression: Zklyrera, Valterra, Super Admin group dashboard, group insights and travel suites pass.

**Run:** `cd server && npx prisma migrate deploy && npm run novarex:seed` (local demo; logins `admin@ / manager@ / finance@ / procurement@ / warehouse@ / sales@ / logistics@ / outlet@ / franchise@novarex.in`, password `Novarex@2026!`). Production gets only the registration migration, never the seed.

**Known limits / decisions to confirm:** supplier payments are tracked on invoices (payables) but are not a cash-outflow line in the cash view (no opening balance is invented); GST e-invoice / e-way bill fields are stored as "not filed" (no integration); no GPS / carrier feed; inventory value is shown but not added to the group valuation (profit x 240 + principal still invested x 3); outlet-specific price lists are not built (the franchise purchase discount covers the pricing case).
