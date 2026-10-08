# Acconcy Finance - finance / investment / advisory company workspace plan

Branch: `super_admin_branch` base (create a feature branch before coding; local only, never pushed to `main` by an agent). Plan written 2026-10-08.
Status: **Plan approved with the defaults on 2026-10-08; phases A0-A9 built and tested locally (uncommitted, on branch `acconcy-finance-workspace`; browser click-through pending).** Q1-Q3 were not answered, so the defaults apply (see section 3). This doc is the live tracker: add a dated line in "Work log" as each slice lands.

## 1. Principle

Acconcy Finance is a **finance, investment and advisory company** inside the same multi-company ERP. It follows the pattern Zephyr and Gulati established: its own namespace on top of shared platform plumbing, so nothing Acconcy does can break Zephyr, Gulati or Delphic Global (and vice versa).

- Server `modules/acconcy/*`, routes `/api/v1/acconcy/*`, tables prefixed `Ax` (`ax_*`), client `pages/acconcy/*`, `lib/acconcy/*`, `components/acconcy/*`, tests `server/tests/acconcy-*.test.js`.
- Every `Ax` row carries `org_id` (FK cascade); every route requires the active org to have the `acconcy` module; `org_id` comes from the token, never the body; every service filters `org_id` explicitly; each model is added to `ORG_SCOPED_ON_CREATE` in `config/db.js`.
- Reused platform plumbing only: login/JWT, `User`, `Org` + membership, uploads, logger, Prisma client, UI primitives (`DataTable`, `Drawer` + `FormActionsBar`, `SearchableSelect`, `StatCard`, `Badge`), `tests/helpers.js`.
- Additive migrations only (no DROP/RENAME), generated from the host. Existing Acconcy rows in the generic `leads` / `contracts` tables are left untouched (see D7).

## 2. Reuse map (the brief's "existing vs new" table, checked against the real code)

| Requirement | What exists today | Action |
|---|---|---|
| Company / multi-company | `Org`, `enabled_modules`, `requireModule`; `acconcy` org already seeded (modules `leads`,`contracts`, marked `coming_soon` on the Group Dashboard) | Reuse; add `acconcy` module marker, drop `coming_soon` when live |
| Client / Vendor | `GxParty` / `ZxParty` (kind client/vendor/both) | **Copy pattern** into `AxParty` (isolation rule: no cross-company tables) |
| Leads + pipeline | `GxLead` (+ activities, stage rules, pipeline matrix, follow-ups); generic `Lead` has different stages | **Copy `GxLead` pattern**, `service_type` replaces trading_type; stages per brief |
| Deal | `GxDeal` + lead conversion | **Copy pattern** into `AxDeal`; lead->deal carries all listed fields, lead stays |
| Revenue / Expense | `GxLedgerEntry`, `ledgerPosting.js`, Zephyr `money.service.js` | **Copy pattern** `AxLedgerEntry` (deal-linked, client/vendor/category, source_type for auto rows) |
| Salaries | `zephyr/salaries.service.js` + `ZxSalary` (monthly generate, approve, pay, month flag). Gulati has none | **Copy Zephyr salaries** as `AxSalary` |
| Employee / Contractor | `ZxPerson` / `GxPerson` + assignments + optional login | **Copy pattern** `AxPerson`, `AxAssignment` |
| Tasks | `GxTask` | **Copy pattern** `AxTask` (deal / lead / client linked) |
| Profit / P&L / filters | `gulati/finance.service.js`, `zephyr/overview+financials+reports` | **Copy pattern**; profit always computed from ledger rows, never typed |
| Financial locking | `GxPeriodClose` + `periods.js` (snapshot, stale flag, admin reopen with reason) | **Copy pattern** `AxPeriodClose`; locks revenue, expense, salary, investment financial edits |
| Audit | `GxAudit` + `audit.js` | **Copy pattern** `AxAudit`; also logs valuation multiplier changes, asset value, investment value |
| Permissions | `gulati/access.js` caps | **Copy pattern**: admin / manager / finance / staff / contractor |
| Valuation | Gulati: `gx_asset_values` + `finance.service` valuation = (net profit x 240) + (asset x 3), month by month | **Copy and extend** (D3): configurable multipliers, history table, previous / change |
| Assets | Gulati `GxAssetValue` (admin-entered per month); `modules/assets` is Delphic Global's | **Build minimal** `AxAsset` (D4) plus monthly asset total |
| Investment management | none | **Build** `AxInvestment` (+ `AxInvestmentValuation` snapshots, see 5) |
| Group Dashboard feed | `superDashboard/groupFinance.service.js` branches on kind (`gulati` / `zephyr` / `delphic`) | Add `acconcy` kind; supplies profit + asset value to the group view |
| UI shell / nav / theme | `sections.js`, `AppLayout`, `theme.css`, `.theme-gulati` | Reuse mechanism; add `.theme-acconcy`, `acconcyNavFor` |

## 3. Decisions (defaults applied unless you change them)

- **D1. Own tables vs shared.** Same call as Gulati: `Ax` namespace mirroring Gulati/Zephyr (same behaviour, look, lock semantics, zero risk to the other companies). Generalising `Zx*`/`Gx*` into shared tables would mean rewriting working code; not recommended.
- **D2. Profit recognition.** Deal profit = revenue entries - expense entries linked to the deal, by entry date. Realised only. Investment current value / unrealised gain is never posted to revenue or P&L (brief rules 13-14). A gain becomes revenue only when an admin records a realisation (sale / redemption) on the investment, which posts one revenue entry.
- **D3. Valuation.** Valuation = (profit from sub-companies x profit_multiplier) + (asset value x asset_multiplier), multipliers **240** and **3** stored once in `AxSetting`, read only by `acconcy/valuation.calc.js` (pure, unit tested; the client displays server numbers and never re-computes). Every calculation is saved to `AxValuationHistory` (date, profit, asset value, both multipliers, both components, total, notes) so it is auditable even after multipliers change. Dashboard shows current, previous, change. Valuation never enters revenue or P&L.
- **D4. Inputs to valuation.** "Profit from Sub-Companies": see open question Q1 - default is Acconcy's own net profit (deals revenue - deal expenses - salaries - other expenses, realised) for the month, same as Gulati. "Asset value": sum of active `AxAsset` values at the month end + current value of active investments (toggle in settings, default **on**, recorded in the history row). If you prefer a single admin-entered monthly figure like Gulati, say so.
- **D5. Currency and display.** INR, shown in Lakh / Crore with exact value on hover. Valuation in Crore as in the brief example.
- **D6. Lead stages.** The brief's list is new, in_discussion, qualification, proposal, negotiation, won, dropped, on_hold, closed. Stored as an enum on `AxLead`. Won -> Deal conversion once per lead (like Gulati); admin can reopen a lead with a reason.
- **D7. Old generic Acconcy data.** The earlier demo leads/contracts (`leads`, `contracts` tables, recurring revenue) are not migrated or deleted. Acconcy workspace reads only `Ax*`. Org `enabled_modules` becomes `['acconcy']` (old modules stay in the DB, unused), exactly how Zephyr was handled.
- **D8. Tax.** Amounts stored pre-tax with optional tax amount beside them (as Gulati/Zephyr); profit uses pre-tax. Say if GST should be ignored.

### Open questions (need your answer before Phase A7)
- **Q1.** Which companies count as "sub-companies" for the valuation profit: only Acconcy's own deals, or also profit of other group companies (Gulati, Zephyr) pulled in from the group dashboard? Default above = Acconcy's own.
- **Q2.** Do Acconcy employees need payroll with PF/TDS like Delphic, or the simple Zephyr salary sheet (gross, deductions, net, paid date)? Default = Zephyr salary sheet.
- **Q3.** Gold/Silver: one holding record per purchase (quantity x price) with a manually updated "current rate", or live market rate feed? Default = manual current value / rate, optional purity, weight, unit.

## 4. Theme (from the logo)

The logo is the wordmark "Acconcy" in a dark serif with a chevron mark (">>>" in graduated plum) - sampled brand colour about `#722F50` (plum / burgundy). File: `client/public/acconcy-logo.png` (274 x 68). A transparent SVG redraw can follow if you send the source; the PNG is used for sidebar, login and favicon crop meanwhile.

- Brand scale around `#722F50` at 700: 50 `#FBF3F7`, 100 `#F5E3EC`, 200 `#EAC7D8`, 300 `#D9A0BA`, 400 `#C0709A`, 500 `#9E4A78`, 600 `#843A63`, 700 `#722F50`, 800 `#5C2641`, 900 `#481E34`.
- Must read as different from Zephyr/Gulati (both sage green) and Delphic: warm off-white page `#FAF7F8`, sidebar `#F4ECF0`, borders `#E6D8DF`, and a restrained **muted gold accent** (`#B08D3C`, finance / gold-investment nod) used sparingly for key figures, Gold & Silver badge and the active-tab underline.
- Service-type badge colours are distinct but low-saturation: Gold & Silver (gold), Financial Consulting (plum), Venture Capitalist (indigo), Corporate Finance (slate), Transaction Advisory (teal), Valuation (rose).
- Implemented like Gulati: `.theme-acconcy` on `<html>` for orgs with the `acconcy` module, set by `AppLayout`; Tailwind `primary-*` already reads CSS variables so no Tailwind config change. Quiet cards, thin borders, uppercase small labels, tabular numerals for money, no gradients. Charts follow the dataviz skill palette rules, using the plum scale plus gold.

## 5. Data model

| Phase | Models |
|---|---|
| A0 | `AxSetting` (currency, numbering prefixes, `profit_multiplier` 240, `asset_multiplier` 3, include_investments_in_assets), `AxCategory` (expense/income categories: Professional fees, Travel, Documentation, Legal, Consulting, Advisory, Transaction, Bank charges, Other - editable), `AxAudit`, `AxPerson` |
| A1 | `AxParty` (client / vendor / both, contact, location, GST/PAN optional), `AxDocument` |
| A2 | `AxLead` (code, name, `service_type` enum of the six, party, contact person, company, phone, email, location, source, stage, assignee, contractor, expected_amount / revenue / profit / start / end, large `description`, notes, details JSON, deal_id), `AxLeadActivity` |
| A3 | `AxDeal` (code, name, lead_id, party, vendor, service_type, status, start / expected / actual end, deal_amount, assignee, contractor, description, notes, additional details; revenue / expense / profit are **computed**, never stored as typed values) |
| A4 | `AxLedgerEntry` (type revenue / expense, deal, party, vendor, category, date, amount, tax, source_type / source_id, note) |
| A5 | `AxInvestment` (code, name, type gold / silver / venture / other, deal, service_type, date, amount, quantity, purchase_price, current_value, optional purity / weight / unit / storage, startup name + equity % for venture, status active / partly_realised / realised, description, notes), `AxInvestmentRealisation` (date, amount received, cost basis released; posts a revenue ledger row), `AxAsset` (name, category, value, as-of date, notes) |
| A6 | `AxAssignment`, `AxTask`, `AxSalary` |
| A7 | `AxPlan`, `AxPeriodClose`, `AxValuationHistory` |

Deal statuses: planned, active, on_hold, completed, cancelled. Lead stages as D6.

### Server-side formulas (pure modules, unit tested)
- `deal.calc.js`: deal revenue = sum revenue entries; expense = sum expense entries; profit = revenue - expense; margin % = profit / revenue (null when revenue is 0); duration, delayed flag (past expected end and not completed).
- `investment.calc.js`: total invested = sum amount; current value = sum current value; gain/loss = current - invested; gain/loss % = (current - invested) / invested x 100 (null when invested is 0); realised gain = realisation amount - released cost; unrealised = current value of open holdings - their cost. Gold/Silver profit/loss = qty x current rate - qty x purchase price when those exist, else value-based.
- `valuation.calc.js`: `valuation = profit x profit_multiplier + asset x asset_multiplier`. Tests: 10 Cr profit + 20 Cr asset = 2460 Cr; zero profit; zero asset; negative profit (valuation can fall, shown as is); changed multipliers; history rows keep the multipliers used at the time.
- Company P&L = deal revenue + other revenue - deal expenses - salaries - other expenses. Investments reported in their own block, outside P&L.

## 6. Filters: every filter on real data (explicit requirement)

Filters are server-side (query params validated by Zod), never client-side slicing of a page of rows, so totals, counts and drill-downs always agree with the list.

| Screen | Filters |
|---|---|
| Leads (list + board + pipeline matrix) | service type, stage, client, assignee, contractor, source, location, created date range, search |
| Deals | service type, status, client, vendor, assignee, date range (start / end), delayed only, search |
| Client / Vendor | kind tab, location, search, active |
| Ledger (revenue / expenses) | type, deal, client, vendor, category, service type, date range / month, search |
| Investments | type, service type, deal, status, date range, search |
| Salaries | month, person, status |
| Financials / P&L / Reports | month, year, range, service type, deal, client, vendor, employee |
| Valuation | from / to month, live vs closed |
| Dashboard | month / range + service type; every KPI links to the filtered list behind it |

Verification (done gate for every phase): the seed produces a deterministic dataset spanning all six services, several clients/vendors/employees, months and stages; a **filter matrix test** per list endpoint asserts, for each filter and for combinations, that returned rows equal the independently counted expected set and that summary totals equal the sum of the rows; plus a browser click-through of each filter against the seeded data recorded in `docs/testing/TESTING-ACCONCY.md`. Empty-result and invalid-filter states are handled.

## 7. Phases (built in order, each with its own tests and a work-log line)

| Phase | Delivers |
|---|---|
| **A0 Foundation** | `acconcy` module, `/api/v1/acconcy` router, access + `GET /acconcy/me`, nav, home, theme + logo, settings (categories, multipliers, numbering), audit, org marker, isolation tests |
| **A1 Client/Vendor** | Party list (Client / Vendor tabs), filters, drawers, documents, CSV import |
| **A2 Leads** | List + board, six service types, brief stages, big description field, activities + follow-ups, pipeline matrix (service x stage) with all filters |
| **A3 Deals** | Won lead -> deal conversion (once, carries lead id, client, service, description, expected amount, assignee, contractor, dates, notes; lead stays), deal list / detail, status flow |
| **A4 Revenue / Expenses** | Ledger with deal / client / vendor / category links, deal financial summary (revenue, expense, computed profit, margin) |
| **A5 Investments + Assets** | Investment records (gold, silver, venture, other), performance block, realisation flow, asset list with total |
| **A6 People, Tasks, Salaries** | Roster (employee / contractor), assignments, tasks on leads / deals, salary sheet |
| **A7 Financials + Valuation + Locking** | P&L with all filters, service-wise report, month close / reopen with snapshot + stale flag, valuation page + history + dashboard block, audit of multiplier / asset / investment value changes |
| **A8 Dashboard + Reports + Group feed** | Acconcy dashboard (pipeline, deals, financial, investment, valuation; drill-downs), reports list, Group Dashboard `acconcy` kind, remove `coming_soon` |
| **A9 Hardening** | Idempotent demo seed (`npm run acconcy:seed`, refuses non-local DB like Gulati), `docs/testing/TESTING-ACCONCY.md`, admin-editability pass (docs/guides/ADMIN-EDITABILITY.md), empty / error states, mobile check, browser QA of every filter |

Access: admin full; manager = leads, deals, parties, tasks, expenses; finance = money, investments, P&L, salaries, locking, valuation view; staff / contractor = assigned leads, deals, tasks only. Server-enforced per route (`axAuthorize(cap)`), staff queries scoped to their person id.

## 8. Done gate per phase

Zod validation + error map; `org_id` filter on every read; role matrix tested (admin / manager / finance / staff / contractor / other org); locked-period writes rejected for revenue, expense, salary and investment financial fields; edits audited with reason on overrides; admin can edit / override everything; soft delete only; one `acconcy-<area>.test.js` per phase covering CRUD, rules, formulas, locking, filters, cross-org isolation; docs + TODO updated; **only affected tests run** (`npm run test:changed`, single files) on an isolated test DB; full suite only for the shared-infra files touched (`schema.prisma`, `config/db.js`, `app.js`) once at the end of A0; no push.

## 9. Risks and conflicts

- Shared-infra edits (small but real): `schema.prisma`, `config/db.js` set, `app.js` mount, `AppLayout`, `App.jsx`, `theme.css`, `groupFinance.service.js`, `orgs.service.js` module markers, seed scripts. Wider `erp-verticals`, `workspace-isolation`, `auth`, super-dashboard suites run once after A0 and after A8.
- The older Acconcy demo data (`leads`, `contracts`) still exists; the workspace hides it. If you want it migrated into `Ax*` instead, that is a separate, explicit task.
- Valuation base is the biggest ambiguity (Q1/Q4): a wrong profit base would make the headline number wrong, so it is shown with its inputs and recorded in history on every calculation.
- Scope is large (10 phases). Trim candidates if you want it faster: A8 reports beyond the dashboard, Gold/Silver optional fields, CSV import, group feed.
- Production rollout needs the additive migration deployed and an Acconcy admin seeded (same non-destructive seed-admin approach as Gulati, runbook to be written in A9). Nothing is pushed or deployed from here.

## 10. Work log

- 2026-10-08 - Brief + logo received; Zephyr and Gulati implementations and the existing Acconcy org inspected; plan v1 written; logo saved to `client/public/acconcy-logo.png`. No code changed.
- 2026-10-08 - **A0-A9 built (uncommitted, local only).** Migration `20261008120000_acconcy_foundation` (17 additive `ax_*` tables, no DROP / RENAME). Server `modules/acconcy/*` under `/api/v1/acconcy` (roles admin / manager / finance / staff / contractor; core masters; clients and vendors with documents; leads with the six services, brief stages, pipeline matrix and follow-ups; deals with lead conversion and ledger-computed profit; revenue / expense ledger; investments with realisation, assets, salaries, tasks, people; P&L with every filter; service-wise report; valuation with configurable multipliers, history and month-close recording; month close / reopen; dashboard; lead and deal reports) plus pure `deal.calc.js`, `investment.calc.js`, `valuation.calc.js`. Shared-file edits: `schema.prisma`, `app.js`, `uploads.service.js` (Acconcy document downloads), `superDashboard/groupFinance.service.js` + routes (Acconcy kind; asset value computed, not set from the group view). Client `pages/acconcy/*`, `lib/acconcy/*`, `components/acconcy/*`, logo `client/public/acconcy-logo.png`, `.theme-acconcy` in `theme.css`, nav / theme / header wired in `AppLayout` / `App.jsx` / `headerTitle.js`. Seeds `npm run acconcy:seed` (local demo) and `prisma/acconcy/seed-admin.js` (staging / production, non-destructive). Tests: `acconcy-calc.test.js` (13) and `acconcy-workspace.test.js` (29) pass on the isolated DB; live filter check on the seeded demo data: 114 / 114. `vite build` OK, eslint clean. Docs: [../testing/TESTING-ACCONCY.md](../testing/TESTING-ACCONCY.md), [../guides/ACCONCY-ADMIN-SEED.md](../guides/ACCONCY-ADMIN-SEED.md). Not done: browser click-through (no browser available to the agent).

## 11. Decisions as built

- **Deal status filter:** `open` (not finished) is a filter alias; `active` is a real status, so each status can be filtered exactly.
- **Profit never typed:** deal revenue, expense and profit come from ledger rows; the typed deal amount does not move them. A realised investment gain posts one revenue row (a loss, one expense row); unrealised value never reaches the ledger.
- **Valuation:** profit = company net profit of the month (deal and company-level revenue minus deal and operating expenses, approved / paid salaries and contractor costs). Asset value = active assets dated on or before the month end plus (switchable) the current value of open investments. Multipliers live in settings only; every recorded valuation keeps the values used. Closing a month records one automatically.
- **Group Dashboard:** Acconcy reads live (no per-month lock view); its monthly asset value cannot be typed there because it is calculated.
- **Salaries:** simple sheet (gross, deductions, net; draft -> approved -> paid) generated from each person's monthly salary, admin-only pay figures; contractors' monthly fee counts as a contractor cost.
- **Locking:** a closed month blocks revenue / expense entries, salary rows, investments (create, amount / date edits, realisation) and assets dated in it; admin may edit with a reason and the close is flagged as changed.

## Financials = Gulati layout (2026-10-08)

Acconcy > Financials now opens on **Financial trends**, the same page as Gulati Industries: Locked / Unlocked / All toggle, start and end month, three month-on-month charts (Revenue, Profit, Valuation) and a "how each month's valuation is worked out" table with Lock month / Reopen. `GET /acconcy/finance/valuation` gained `?state=locked|unlocked|all` and each month now carries `revenue` (locked = frozen close snapshot, 0 until closed; unlocked = open months only). Service-wise, Valuation (formula + history) and Month close stay as extra tabs. Asset value still comes from Investments & assets (not a separate monthly form). Test: `acconcy financial trends` in `tests/acconcy-workspace.test.js`.
