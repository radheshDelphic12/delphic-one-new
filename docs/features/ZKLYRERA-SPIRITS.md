# Zklyrera Spirits - the 6th company (2026-10-12)

Status: **built (Z0-Z6) and live on staging and production (2026-10-12, commit 89b69b1).** Migrations applied on both; the company row + Super Admin membership were created with `seed-admin.js` on staging (Neon) and on production. See "As built" at the end; the plan below is what it followed. A capital / investment-tracking and monthly-reporting workspace. Module key `zklyrera`
(`enabled_modules` marker, like `foundation`, `acconcy`), tables `zk_*`, API `/api/v1/zklyrera`, UI `/zklyrera`.

## 1. What the inspection found (reuse map)

| Need | Reused as-is | New |
|---|---|---|
| Company registration, switcher, isolation, `requireModule`, `org_id` scoping | `orgs`, `enabled_modules`, company switcher | `zklyrera` marker; `prisma/zklyrera/seed-admin.js` (non-destructive, same as foundation) |
| Roles / people / logins | Foundation `access.js`, `people`, `users`, `account` services (same shape as Acconcy) | roles admin / manager / finance / staff / contractor; Super Admin = Multi-org admin = admin of the company (membership ensured at login, as today) |
| Filters, period presets, charts, tables, drawers, export | `lib/foundation/*`, `components/foundation/*` (FilterBar patterns), `groupFilters.jsx`, `groupExport.js` (CSV / PDF), Recharts | Zklyrera preset set (current/previous month, last 3/6 months, current/previous quarter, current/previous year, financial year, custom) |
| Month close / lock, audit | Foundation `periods.js`, `lock.js`, `audit.js` pattern | `zk_period_closes`, `zk_audit` |
| Group Dashboard | `groupFinance.service` (`kindOf`, per company-month cache, projections endpoint), `FoundationGroupSection` pattern | `kind: zklyrera`, a `zklyrera` block, valuation = profit x 240 + principal still invested x 3 (same group formula) |
| Investments | Acconcy investments hold *asset value* (gain/loss, realisations) - **not** principal-vs-earnings, so they are not reused | `zk_investments` + `zk_returns` (principal / earnings kept apart) |
| Salaries | Foundation records salaries as ordinary entries; Acconcy has `ax_salaries` | salaries are entries with `kind=salary` (one register, no second payroll, no double count) |

## 2. Data model (one migration, additive, `zk_*`)

- `zk_settings`, `zk_categories` (income / expense / investment types, data not code), `zk_audit`, `zk_people`, `zk_period_closes` (locks).
- `zk_investments`: code, name, type, investor / source, investment_date, amount (original), expected_return_amount / date / rate, status `planned|active|partially_returned|completed|cancelled` (+ computed `overdue`), notes.
- `zk_returns`: investment_id, date, `principal` and `earnings` as **two separate amounts** (a return may carry both; never guessed), status, reference, notes. Multiple per investment.
- `zk_entries`: the transaction register for everything that is not an investment return: `kind = income | expense | salary | transfer`, category, amount, date, payment_status `paid|unpaid|pending|rejected|cancelled|reversed`, due_date, payer / payee, person_id (salary), account, notes. Unpaid = payable (expense) / receivable (income).
- `zk_projections`: month, line (`new_investment|principal_recovery|investment_earnings|other_income|operating_expense|salary|other_expense`), category?, investment_id?, amount, status `draft|approved|archived`, notes. **Plan records only: never create a transaction.**

## 3. Accounting rules (one file `zklyrera.calc.js`, the client only displays)

- Total investment added = sum of `zk_investments.amount` (not revenue). Principal returned = sum `zk_returns.principal` (**not income**). Investment earnings = sum `zk_returns.earnings` (income). Outstanding principal = amount - principal returned (never < 0).
- Other income = `income` entries paid. Recognised income = earnings + other income. Expenses = `expense` entries, salaries = `salary` entries, **separate buckets, summed once** (total expenses = operating + other + salaries). Net result = recognised income - recognised expenses; capital in and principal back are excluded.
- Cash view (inflows / outflows) shown separately from the recognised view; cash only from paid items; no opening balance is invented (shown only after an explicit opening balance setting, otherwise "not set").
- Receivables / payables = unpaid income / expense entries (due dates shown); omitted when none exist.
- Transfers are neither income nor expense and never reach the group totals.
- Projection vs actual: `variance = actual - projected`, % only when projected != 0, an expense over budget is flagged unfavourable; remaining expected = max(projected - actual, 0); planned investment kept apart from confirmed, expected returns apart from received.
- Locked months: no edits to entries / returns / investments dated in them without admin override + reason (audited), same as Foundation.

## 4. Screens (`/zklyrera`)

Overview (10 KPIs, current / previous month, YTD, MoM change, trends, actual vs projected) - Investments (register, add / edit, record returns with the principal / earnings split, expected vs actual, overdue) - Income & Returns - Expenses - Salaries - Monthly Report (the full table of section 9, filters, CSV / PDF export) - Projections (grid by month and line, variance) - Transactions (unified list: entries + returns, search / sort / paging, detail drawer with related record) - Financials (month close) - People - Setup (categories, rules, audit log).
Every filter (period preset, custom dates, investment / income / expense category, payment status, investment status, employee, actual vs projected) drives KPIs, charts, tables and the transaction list together, server side, on live data (same pattern as the Foundation filter bar).
Nothing is code-only: categories, settings, statuses, projections, people, locks can all be added / edited by the Multi-org (Super) admin and the company admin.

## 5. Theme from the logo

The logo is monochrome: a black bottle with a padlock, serif wordmark "Zklyrera Spirits" on white. Theme `.theme-zklyrera`: ink / charcoal (`#111`, `#262626`) as the primary, warm antique-brass accent (`#B08D57`) for highlights, off-white surfaces, serif display headings (Playfair / Cormorant via the existing font setup, body stays Inter), charts in charcoal / brass / slate / muted wine. The uploaded logo is added as `client/public/zklyrera-logo.png`, plus a cropped mark for the sidebar and Group Dashboard tile (`orgLogo.js`).

## 6. Group Dashboard

`kindOf` -> `zklyrera`; per-company-month cache entry: income = investment earnings + other income, expenses = expenses + salaries, profit = difference, assets = outstanding principal, funding (capital added) and principal returned shown in its drill-down but **not** as revenue or profit. Valuation: N/A. Appears in company lists, comparison charts, filters, projections (projected income / expense / net from `zk_projections`) and consolidated reports; sidebar logo and switcher included. A "Zklyrera Spirits - capital and returns" block, like the foundation block.

## 7. Build order (each slice tested before the next)

1. **Z0** schema + migration + org / seed-admin + access + people/users + shell, nav, theme, logo, routes, Group Dashboard `kind`.
2. **Z1** calc module + investments and returns (principal / earnings), unit tests.
3. **Z2** entries (income / expense / salary / transfer), categories, payment status, locks, audit.
4. **Z3** overview KPIs, charts and filter bar (period presets, categories, statuses, actual vs projected).
5. **Z4** projections + variance, monthly report, exports, transaction register.
6. **Z5** Group Dashboard integration + Projections tab; seeds (local demo data only).
7. **Z6** tests (jest suite `zklyrera-workspace.test.js`, group dashboard tests), Playwright pass, docs, memory.

## 8. Decisions I will take unless you say otherwise

- Currency INR, Indian numbering, financial year April-March.
- Salaries are entries with `kind=salary` (no separate payroll); payroll visibility limited to admin / finance roles.
- Zklyrera is valued by the group formula "profit x 240 + asset x 3", where asset = principal still invested (only the Foundation has no valuation).
- Demo data only on local; staging / production get the org + admin only (non-destructive seed).
- No attachments in v1 (reference numbers recorded), as in the Foundation.

## 9. Open questions

1. Should the company sit in the Delphic group (like the others) - assumed yes.
2. Any real opening balance to enter, or start from zero?
3. Should salaries also come from the existing Delphic payroll, or be entered inside Zklyrera (assumed: entered inside).

## As built (2026-10-12)

- Backend `server/src/modules/zklyrera/*` (access, audit, periods, lock, account, people, users copied from the foundation pattern; `zklyrera.calc.js` = every rule; investments, entries, projections, finance, routes), migrations `20261013090000_zklyrera_spirits` + `20261013090100_zk_expense_class` (additive, `zk_*`), `/api/v1/zklyrera`.
- Client `/zklyrera`: Overview (10 KPIs, current/previous month, financial YTD, MoM change, 9 charts, actual vs projected, attention), Investments (+ returns drawer: principal and earnings separate), Income & Returns, Expenses, Salaries (payroll cap), Monthly Reports (+ 6 other reports, CSV/PDF), Projections, Transactions register, Financials (month close), People, Setup (opening balance, FY start, categories, audit log). Period presets: current/previous month, last 3/6 months, current/previous quarter, current/previous year, financial year, previous FY, custom; the same filters drive KPIs, charts, tables and the list.
- Theme `.theme-zklyrera` (ink + brass, Playfair headings), logo `client/public/zklyrera-logo.png` / `zklyrera-mark.png`.
- Group Dashboard: `kind: zklyrera`; P&L = earnings + other income vs expenses + salaries (capital placed and principal returned are NOT revenue/profit; transfers ignored); assets = principal still invested; valuation = profit x 240 + principal still invested x 3; block "Zklyrera Spirits - capital, returns and projections" on Group Finance and Projections tabs; drill-down; asset value is managed in the company.
- Assumptions: the company places capital and recovers it (investments are money out, returns money in); INR; salaries are entries (`kind=salary`, restricted to finance/admin); no opening balance unless set; no attachments in v1; the opening cash balance is never invented.
- Run: `cd server && npx prisma migrate deploy && npm run zklyrera:seed` (local demo, logins `admin@/manager@/finance@/staff@zklyrera.in`, password `Zklyrera@2026!`). Staging / production: `ZKLYRERA_ADMIN_EMAIL=<admin> npm run zklyrera:seed-admin` (non-destructive; with no email every group Super Admin becomes admin).
- Rollout (2026-10-12): deploying code is not enough. The migrations only create the `zk_*` tables; the `zklyrera` org row comes from the seed-admin step. Until it ran, staging and production still showed 5 companies on the Group Dashboard. Staging: run `node prisma/zklyrera/seed-admin.js` with the staging `DATABASE_URL`. Production: `docker exec -w /app/server delphic-server-1 node prisma/zklyrera/seed-admin.js` (no email, so the group Super Admin, `paras.gulati@multiorg.in`, becomes the admin). Both are idempotent; neither loads demo data, so the company starts empty.
- Tests: `server/tests/zklyrera-workspace.test.js` (10) + group dashboard suite; Playwright pass on all pages.
- All charts are line charts (user request 2026-10-12); the selected sidebar item stays readable on hover (`.theme-zklyrera nav a.bg-primary-600:hover`).
- Release state: committed locally on `super_admin_branch`, not pushed; staging/production need the two migrations then `zklyrera:seed-admin`.
