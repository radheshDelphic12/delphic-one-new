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

## Theme

`.theme-valterra` (maroon `#6B2A2A` from the excavator logo, gold `#C99A2E` accent from the ground line, warm sand surfaces). Logo `client/public/valterra-logo.png`, sidebar/switcher mark `valterra-mark.png`. Charts are line charts only.

## Run

`cd server && npx prisma migrate deploy && npm run valterra:seed` (local demo: 5 sites incl. a closed one, site-wise investments, returns, sales, costs, salaries, overheads, projections; logins `admin@ / manager@ / finance@ / staff@valterra.in`, password `Valterra@2026!`). Staging / production: migration `20261015090000_valterra_resources`, then `VALTERRA_ADMIN_EMAIL=<admin> npm run valterra:seed-admin` (non-destructive; with no email every group Super Admin becomes admin). Tests: `server/tests/valterra-workspace.test.js` (10), `valterra-sites.test.js` (6).

## Assumptions / open accounting decisions

- Mining revenue is recorded as income entries (amount + description); no production, sale-quantity or price tracking was invented.
- Salaries are entries (`kind=salary`) with an optional site, as in Zklyrera; no separate payroll integration.
- Sites are valued only through the company (principal still invested), not individually.
