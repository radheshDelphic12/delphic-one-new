# Valterra Resources - the 7th company: mining sites and site-wise finance (2026-10-14)

Status: built and committed locally; not pushed. Module key `valterra` (`enabled_modules` marker), tables `vt_*`, API `/api/v1/valterra`, UI `/valterra`. Built by cloning the Zklyrera Spirits workspace (same accounting, filters, reports, projections, month close, roles, Group Dashboard block) and adding **mining sites**. The logo spelling is "VALTERRA RESOURCES" (the spec says "Valtera Resource"); the app uses Valterra Resources.

## What is reused from Zklyrera Spirits

Everything in `server/src/modules/zklyrera` and the Zklyrera pages/components/lib was cloned (mechanical rename `zk` to `vt`) and then extended. The accounting rules are identical: capital placed is not an expense; principal recovered is never income; investment earnings and income entries are income; expenses = operating + other + salaries counted once; transfers ignored; planned/cancelled investments not counted; projections are plans only; variance = actual - projected; the opening balance is never invented; months lock like Foundation/Zklyrera; roles admin / manager / finance / staff / contractor (payroll only for finance and admin). Group valuation = profit x 240 + principal still invested x 3.

## Mining sites (new)

- `vt_sites`: code (auto `VS-001`, prefix editable in Setup), name, location, state, district, country, latitude/longitude, mining type, primary material, additional materials, description, status (planned / active / temporarily inactive / closed), start date, expected closure date, manager, notes. Never deleted.
- Mining types and materials are **categories** (`scope = mining_type | material`), editable in Setup (Stone / quarry, Gold, Iron ore, Copper, Coal, Other metal/mineral/material; Granite, Limestone, ...). No site or type is hard-coded in any calculation.
- `site_id` (optional) on investments, entries (revenue, expenses, salaries - not transfers) and projections. Returns follow their investment's site. A record with no site is **company level**: it is shown on its own row and is never spread over the sites.
- Backend checks company ownership of the site and of the mining type / material; a **closed** site keeps all history and reports but takes no new records (422); reopen by changing the status.
- Screens: Mining Sites (list with search, status, type, material, state, show closed; create/edit drawer), Site page (profile + its own dashboard for any period, investments, transactions), Overview "Site-wise results" (table, best / underperforming, four line charts by site), Revenue & Returns, Expenses, Salaries, Investments, Projections, Transactions and Reports all carry a Site column/selector.
- Filters (server-side, live, every KPI/chart/table/list together): period presets and custom dates, mining site (incl. "Company level"), mining type, material, investment/income/expense category, payment status, investment status, employee, projected vs actual.
- Reports: all Zklyrera reports plus **Site-wise profit and loss** (CSV/PDF); the investment register has a Site column.

## Site figures

Per site and period (same `summarize` / `position` rules): capital invested (period and to date), principal recovered, mining revenue (income entries), investment earnings, total income, operating / other expenses, salaries, net result, principal still invested, receivables / payables. `Net / capital %` = net result of the period / capital invested up to the end of the period (an explicit, labelled ratio; sites without capital are not ranked; the same period applies to every site). `Recovery %` = principal recovered / capital invested. The rows add up to the company total; shared overheads stay on the "Company level" row.

## Group Dashboard

`kindOf` gives `valterra`; the company's monthly figures use the same feed as Zklyrera (income = earnings + revenue, expenses incl. salaries, assets = principal still invested). The Group Finance and Projections tabs show a "Valterra Resources - mining sites, capital, returns and projections" block (KPIs, site table with drill-down to each site, projected income/expenses, overdue investments). Drill-down sections: months, sites, investments. Asset value is managed in the company (not typed on the group page). The Travel module's "Delphic Global" detection now also excludes the `valterra` marker.

## Valuation and number checks

- Valuation = profit of the month x 240 + principal still invested x 3 (the group formula). Financials shows the headline valuation, its two components, a month-on-month valuation line and a Profit x 240 / Still invested x 3 / Valuation column for every month; the Locked / Unlocked / All views and month close behave as for the other companies. The Group Dashboard shows the same figure (company valuation of the last month in view = group valuation).
- Overview KPIs follow the spec in four groups: Capital (investment added, principal recovered, principal still invested, active sites), Income (mining revenue, investment earnings, recognised income), Costs (site operating, other, salaries, recognised expenses) and Result (net profit / loss, receivables, payables, projected future returns). Projected future returns = planned principal recovery + planned investment earnings from this month on (a plan, never an actual; archived plans excluded).
- The per-site graphs have one line per site, plus "Other sites" (when there are more than eight) and "Company level", so the lines of every month add up to the company figure. The company cash balance is not shown while a site / type / material filter is on (it is a company-wide figure).
- Verified two ways: `server/tests/valterra-integrity.test.js` (plain arithmetic for valuation, graphs, filters, cash balance and projected returns) and an independent recomputation straight from the database against the API for every month, every site and the group valuation (all matched).

## Theme

`.theme-valterra` (maroon `#6B2A2A` from the excavator logo, gold `#C99A2E` accent from the ground line, warm sand surfaces). Logo `client/public/valterra-logo.png`, sidebar/switcher mark `valterra-mark.png`. Charts are line charts only.

## Going live on production (no manual seed)

Migration `20261015100000_valterra_company_registration` registers Valterra Resources as a company of the Delphic holding group and gives the group Super Admin(s) admin access to it, so it appears on the Group Dashboard and in the company switcher like the other companies as soon as the deploy runs. It creates ONLY the company row and that access: no sites, investments, categories, settings or demo data (the company creates those itself). It is idempotent (an existing Valterra company is left untouched) and does nothing on a database without the Delphic company. Test: `server/tests/valterra-registration.test.js`. The `valterra:seed-admin` script is therefore only needed for other databases.

## Run

`cd server && npx prisma migrate deploy && npm run valterra:seed` (local demo: 5 sites incl. a closed one, site-wise investments, returns, sales, costs, salaries, overheads, projections; logins `admin@ / manager@ / finance@ / staff@valterra.in`, password `Valterra@2026!`). Staging / production: migration `20261015090000_valterra_resources`, then `VALTERRA_ADMIN_EMAIL=<admin> npm run valterra:seed-admin` (non-destructive; with no email every group Super Admin becomes admin). Tests: `server/tests/valterra-workspace.test.js` (10), `valterra-sites.test.js` (6).

## Assumptions / open accounting decisions

- Mining revenue is recorded as income entries (amount + description); no production, sale-quantity or price tracking was invented.
- Salaries are entries (`kind=salary`) with an optional site, as in Zklyrera; no separate payroll integration.
- Sites are valued only through the company (principal still invested), not individually.
