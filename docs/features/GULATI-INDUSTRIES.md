# Gulati Industries - trading company workspace plan

Branch: `gulati_industry_bug_and_implementation` (local only, never pushed to `main` by an agent). Started 2026-10-07.
Status: **Plan approved 2026-10-07 with the default decisions; phases G0-G9 built and tested locally (uncommitted, browser QA pending).** This doc is the live tracker: add a dated line in "Work log" as each slice lands.

## 1. Principle

Gulati Industries is a **trading company** (Copper Cathode, and other "Deals") inside the same multi-company ERP. It follows the pattern Zephyr established: its own namespace on top of shared platform plumbing, so nothing Gulati does can break Zephyr or Delphic Global (and vice versa).

- Server `modules/gulati/*`, routes `/api/v1/gulati/*`, tables prefixed `Gx` (`gx_*`), client `pages/gulati/*`, tests `server/tests/gulati-*.test.js`.
- Every `Gx` row carries `org_id` (FK cascade); every route requires the active org to have the `gulati` module; `org_id` comes from the token, never the body; every service filters `org_id` explicitly.
- Reused platform plumbing only: login/JWT, `User`, `Org` + membership, uploads, logger, Prisma client, UI primitives (`DataTable`, `Drawer` + `FormActionsBar`, `SearchableSelect`, `StatCard`, `Badge`), `tests/helpers.js`.
- Additive migrations only (no DROP/RENAME), generated from the host.

## 2. Reuse map (what the brief asks vs what exists)

| Gulati requirement | Existing | Action |
|---|---|---|
| Company / multi-company | `Org`, `enabled_modules`, `requireModule` | Reuse; add `gulati` module + seed org |
| Client / Vendor | `ZxParty` (kind client/vendor/both, vendor_category, materials_services) | **Copy pattern** into `GxParty` (Zephyr isolation rule: no cross-company tables) |
| Lead + pipeline | `ZxLead` + activities, stage rules, follow-ups | **Copy pattern**, add trading fields (trading_type, product, qty, unit, expected purchase/sale/margin) and stages sourcing, proposal_order |
| Trading Deal | none (Zephyr "trading" = property sale, different) | **Build** `GxDeal` |
| Purchase / Sales | none | **Build** `GxPurchase`, `GxSale` (+ `GxPayment`) |
| Expenses / Revenue | `ZxLedgerEntry`, `ledgerPosting.js`, `money.service.js` | **Copy pattern**, `GxLedgerEntry`; sales/purchases post automatically |
| P&L, filters, exports | `overview.service`, `financials.service`, `reports.service` | **Copy pattern**, add trading-type / client / vendor / deal / employee filters |
| Employee / Contractor | `ZxPerson` (+ assignments, access_role) | **Copy pattern**, `GxPerson` (no salaries unless you want them, see open questions) |
| Task | `ZxTask` | **Copy pattern**, `GxTask` linked to deal / lead |
| Locking | `ZxPeriodClose` + `periods.js` (snapshot, stale flag, admin reopen with reason) | **Copy pattern** as `GxPeriodClose` (see decision D1) |
| Audit | `ZxAudit` + `audit.js` | **Copy pattern**, `GxAudit` |
| Permissions | `access.js` CAPS (admin/manager/staff/finance) | **Copy pattern**, `gx` caps; contractor = staff-like |
| UI shell / nav / theme | `sections.js`, `AppLayout`, `theme.css` | Reuse mechanism; add `.theme-gulati` + gulati nav |

## 3. Decisions (approved with the defaults on 2026-10-07)

- **D1. Own tables vs shared.** Your brief says "reuse existing locking/finance/leads", but Zephyr was deliberately built standalone (`Zx` namespace, its own ledger and month-lock) because the existing Delphic lock/finance is Delphic-Global-specific (timesheets, invoices). Recommended: **`Gx` namespace mirroring Zephyr** (same behaviour, same look, same lock semantics, zero risk to Zephyr/Delphic). The alternative (generalise `Zx*` into shared company-neutral tables) means rewriting working Zephyr code and re-testing it; I advise against it.
- **D2. Cost recognition.** Deal gross profit = sale records - purchase records (by record date, accrual style). Payments to vendors / from clients are tracked separately for payable / receivable and do not change profit. Confirm.
- **D3. GST.** Copper Cathode trading carries GST. Plan: store amount before tax + tax separately (as Zephyr's ledger does); profit uses the pre-tax amount. Confirm, or tell me to ignore tax.
- **D4. Salaries.** Gulati brief has no salary section. Plan: no salary records in v1 (people roster + tasks only); company net profit = deal profit - non-deal company expenses. Confirm.
- **D5. Currency / display.** INR, shown in Lakh / Crore style (as ₹90 Lakh) with full amounts on hover. Confirm.

## 4. Theme (from the logo)

The mark is a circular mandala of 14 leaf petals in one flat sage green (`#67A87A` / `#66A87A`), no text. Professional treatment: calm, single-hue, lots of white space.

- Brand scale built around `#67A87A` at 500: 50 `#F2F8F4`, 100 `#E1EFE6`, 200 `#C3DFCC`, 300 `#9CC8AB`, 400 `#82B896`, 500 `#67A87A`, 600 `#508A62`, 700 `#3F6E4E`, 800 `#34583F`, 900 `#2A4833`.
- Zephyr is also a sage green, so Gulati must read as a different company: a **cooler, slightly teal-leaning page/sidebar surface** (page `#F3F7F6`, sidebar `#E8F0EE`, borders `#D5E2DE`) instead of Zephyr's warm tint, and a **copper accent** (`#B06A3B`, a nod to Copper Cathode) used sparingly: Trading-type "Copper Cathode" badge, key figures, active-tab underline.
- Implemented exactly like Zephyr: `.theme-gulati` class on `<html>` set by `AppLayout` for orgs with the `gulati` module; Tailwind `primary-*` already reads CSS variables so no config change.
- Logo: save your SVG as `client/public/gulati-logo.svg` (sidebar, login page, favicon). Wordmark "GULATI INDUSTRIES" set in the app font next to the mark.
- Style: quiet cards, thin borders, uppercase small-caps section labels, tabular numerals for money, no gradients beyond Zephyr's faint canvas glow.

## 5. Data model

| Phase | Models |
|---|---|
| G0 | `GxSetting` (currency, numbering prefixes, valuation method/multiple), `GxCategory` (expense categories: Transportation, Loading/Unloading, Brokerage, Documentation, Storage, Logistics, Handling, Bank Charges, Other - editable), `GxUnit` (Kg, MT, Ton, Piece, Other - editable), `GxAudit`, `GxPerson` (minimal) |
| G1 | `GxParty` (client / vendor / both; fields per brief; vendor_category, materials_services), `GxDocument` |
| G2 | `GxLead` (code, name, trading_type `copper_cathode` / `trading_deals`, party (client), vendor, contact, location, source, stage, assignee, contractor, product, material_type, quantity, unit, expected_purchase_amount, expected_sale_amount, expected_margin, expected_start / end, large `description`, details JSON, deal_id), `GxLeadActivity` |
| G3 | `GxDeal` (code, name, lead_id, trading_type, client, status, start / expected / actual completion, location, assignee, contractor, ordered_quantity, unit, description, notes; duration derived) |
| G4 | `GxPurchase` (deal, vendor, qty, rate, amount, tax, date, reference, payment_status, notes), `GxSale` (deal, client, same), `GxPayment` (side vendor / client, purchase_id or sale_id, amount, date, mode, reference) |
| G5 | `GxLedgerEntry` (deal expenses and other company expenses/revenue; source_type/source_id for auto-posted rows) |
| G6 | `GxAssignment`, `GxTask` |
| G7 | `GxPlan`, `GxPeriodClose` |

Deal statuses: planned, sourcing, purchase_pending, material_sourced, ready_for_supply, supplied, completed, cancelled, on_hold. Lead stages: new, in_discussion, negotiation, sourcing, proposal_order, won, dropped, on_hold, closed.

### Server-side formulas (one module `gulati/deal.calc.js`, pure + unit tested)

- purchase amount = qty x rate (editable override with reason, audited); sale amount likewise.
- Sourced qty = sum purchases; supplied qty = sum sales; remaining to source = ordered - sourced; remaining to supply = ordered - supplied. Over-supply beyond ordered is blocked unless admin overrides with a reason. Partial sourcing/supply is native (many purchases / sales per deal).
- Gross profit = sales - purchases. Net profit = gross - deal expenses. Gross margin % = gross / sales; net margin % = net / sales.
- Vendor outstanding = purchases - paid to vendor; client outstanding = sales - received.
- Duration (days) = completion (actual, else expected) - start; delayed = past expected date and not completed.
- Company: revenue, purchase cost, expenses, gross, net, receivables, payables, active deal value, completed deal value. **Valuation is separate** (setting-driven method x trailing 12 months, same as Zephyr), never edited by a deal.

## 6. Phases (built in order, each with its own tests and a work-log line)

| Phase | Delivers |
|---|---|
| **G0 Foundation** | `gulati` module, `/api/v1/gulati` router, access + `GET /gulati/me`, nav, home, theme + logo, settings (units, categories, valuation), audit, seed org, isolation tests |
| **G1 Client/Vendor** | Party list (Client / Vendor tabs), search, drawers, documents, CSV import |
| **G2 Leads** | Lead list + board, trading-type filter/tabs, big description field, activities + follow-ups, stage rules, pipeline summary (trading type x stage table) |
| **G3 Trading Deals** | Won lead -> deal conversion (once, carries all fields, lead stays), deal list/detail, status flow, duration, delayed flag |
| **G4 Purchases, Sales, Payments** | Multi-vendor purchases, multi-client sales, qty tracker (ordered / sourced / supplied / remaining), payables / receivables |
| **G5 Expenses + deal financial summary** | Deal expenses, auto-posting of sales (revenue) and purchases (cost), deal summary card with gross / net / margins |
| **G6 People + Tasks** | Roster (employee / contractor), assignments, tasks on deals/leads, "My work" |
| **G7 Finance** | P&L with filters (month, range, trading type, client, vendor, deal, employee), trading-type reports (Copper Cathode vs Deals), month close / reopen with snapshot + stale flag, Excel/PDF export, valuation inputs |
| **G8 Dashboard** | Pipeline, active trading, financial, deal-performance blocks, every number a drill-down |
| **G9 Hardening** | Idempotent demo seed (`npm run gulati:seed`), `docs/testing/TESTING-GULATI.md`, admin-editability pass, empty/error states, both themes + mobile check |

Access: admin full; manager = leads, deals, parties, tasks, expenses; finance = money, payments, P&L, locking (no leads); staff / contractor = assigned leads, deals, tasks only. Server-enforced per route (`gxAuthorize(cap)`), staff queries scoped to their person id.

## 7. Done gate per phase

Zod validation + error map; `org_id` filter on every read; role matrix tested (admin / manager / finance / staff / other org); edits audited with reason on overrides; admin can edit/override everything (ADMIN-EDITABILITY checklist); soft delete only; client gating via caps; one `gulati-<area>.test.js` per phase covering CRUD, rules, formulas, locking, cross-org isolation; docs + PROGRESS/TODO updated; **only affected tests run** (`npm run test:changed`, single files), private test DB; no push.

## 8. Risks

- Shared-infra edits are small but real (`schema.prisma`, `config/db.js` `ORG_SCOPED_ON_CREATE`, `app.js` mount, `AppLayout`, `App.jsx`, `theme.css`, seed); these trigger the wider `erp-verticals`, `workspace-isolation`, `auth` run once at the end of G0.
- Palette similarity to Zephyr (both sage green): mitigated by cooler surfaces + copper accent; confirm in browser.
- Large pasted brief: scope is big (about 9 phases); trimming candidates if you want it faster: G7 Excel/PDF export, G8 drill-downs, G6 "My work".
- Money correctness: all amounts server-side, `Decimal(16,2)`, rounding tests for qty x rate.

## 9. Work log

- 2026-10-07 - Brief + logo received; codebase and Zephyr patterns inspected; plan v1 written. No code changed.
- 2026-10-07 - **G0-G9 built (uncommitted, local only).** Migration `20261007130000_gulati_foundation` (17 additive `gx_*` tables, no DROP/RENAME). Server `modules/gulati/*` under `/api/v1/gulati` (access roles admin / manager / finance / staff / contractor; core masters; parties + documents; leads with pipeline matrix and follow-ups; trading deals with lead conversion, purchases, sales, payments and the pure `deal.calc.js`; expense ledger; tasks; people + logins; finance P&L, trading-type report, overview + valuation, month close / reopen, dashboard). Client `pages/gulati/*`, `lib/gulati/*`, `components/gulati/*`, logo `client/public/gulati-logo.svg`, `.theme-gulati` in `theme.css`, nav + theme wired in `AppLayout` / `App.jsx`. Seed `npm run gulati:seed`. Tests `server/tests/gulati-trading.test.js` (13) and `gulati-admin-edits.test.js` (8) pass on the isolated DB; shared-infra suites `uploads-auth`, `zephyr-parties`, `zephyr-foundation`, `workspace-isolation`, `auth`, `erp-verticals` also pass. `vite build` OK, eslint clean. Test guide: [../testing/TESTING-GULATI.md](../testing/TESTING-GULATI.md). Not done: browser click-through (no browser available to the agent).

## 10. Admin editability (standing rule)

| Area | Admin can |
|---|---|
| Trading types, units, expense/income categories | add, rename, switch off, (units / categories) delete; trading types stay on old records |
| Settings | valuation method, multiple, manual value, numbering prefixes (audited with a reason); company name and timezone |
| Parties, leads, deals, tasks, people | create, edit, soft delete (delete is admin only) |
| Finished leads (won, dropped, closed) | edit in place with a reason, or reopen (even after conversion; the deal stays) |
| Completed / cancelled deals | edit, change status back with a reason, edit all their lines |
| Purchases, sales, payments, expenses | edit, reprice, override the amount (qty x rate is only the default), delete |
| Limits | over-supply and over-payment blocked for others; admin overrides with a reason |
| Closed months | edit or delete money dated in a closed month with a reason (month is flagged "changed since close"), reopen a month with a reason |
| Logins and roles | create logins with any role, change a person's access role, link / unlink a login, deactivate / reactivate |
| Documents | upload, edit details, delete |
| Computed values | never typed in: profit, margins, duration, outstanding, quantity position are recalculated server-side from the lines |

Known gaps (by design): the lead stage list, deal status list, task statuses and the numbering counters are fixed because logic depends on them; an admin can move any record freely between them with a reason.
- 2026-10-07 - Gulati demo data seeded into the local `requirement_dashboard` DB with `npm run gulati:seed` (additive migration applied first). Logins admin / manager / finance / staff / contractor @gulatiindustries.in, password `Gulati@2026!`. The existing `gulati` org there had its modules set to `['gulati']`.
- 2026-10-07 - Related Delphic Global work done the same day (not Gulati code): Financials valuation now = (Delphic profit x 240) + (asset value x 3) in `financials.service.js`; salary slip uses `client/public/delphic-logo.svg`; Financials month loading made faster (`financialRecords` and `trends` process months 4 at a time) and both tabs show "Updating for the new filter" while loading. Staging got main + Gulati merged (Render deploy done). Financials tab still filters one calendar year at a time (Trends tab spans years).

- 2026-10-07 - **Valuation (Delphic formula).** Valuation = (Gulati net profit x 240) + (asset value x 3), month by month, same as Delphic Global. New table `gx_asset_values` (migration `20261007150000_gulati_asset_values`, additive): admin-recorded asset value per month, carried forward to later months. API `GET /finance/valuation?from&to&state=live|closed`, `PUT /finance/asset-values`, `DELETE /finance/asset-values/:month` (cap `valuation`, admin). Finance page has a Valuation tab (monthly working, edit/remove asset value); the Overview and Dashboard KPI use the current month. The old method / multiple / manual valuation settings are no longer used or shown. Also fixed: deals dropdown on Finance / Tasks sent `status=all` and got 422.

- 2026-10-07 - **Valuation (Delphic formula).** Valuation = (Gulati net profit x 240) + (asset value x 3), month by month, same as Delphic Global. New table `gx_asset_values` (migration `20261007150000_gulati_asset_values`, additive): admin-recorded asset value per month, carried forward to later months. API `GET /finance/valuation?from&to&state=live|closed`, `PUT /finance/asset-values`, `DELETE /finance/asset-values/:month` (cap `valuation`, admin). Finance page has a Valuation tab (monthly working, edit/remove asset value); the Overview and Dashboard KPI use the current month. The old method / multiple / manual valuation settings are no longer used or shown. Also fixed: deals dropdown on Finance / Tasks sent `status=all` and got 422.

- 2026-10-07 - Gulati demo data seeded into the local `requirement_dashboard` DB with `npm run gulati:seed` (additive migration applied first). Logins admin / manager / finance / staff / contractor @gulatiindustries.in, password `Gulati@2026!`. The existing `gulati` org there had its modules set to `['gulati']`.
- 2026-10-07 - Related Delphic Global work done the same day (not Gulati code): Financials valuation now = (Delphic profit x 240) + (asset value x 3) in `financials.service.js`; salary slip uses `client/public/delphic-logo.svg`; Financials month loading made faster (`financialRecords` and `trends` process months 4 at a time) and both tabs show "Updating for the new filter" while loading. Staging got main + Gulati merged (Render deploy done). Financials tab still filters one calendar year at a time (Trends tab spans years).
