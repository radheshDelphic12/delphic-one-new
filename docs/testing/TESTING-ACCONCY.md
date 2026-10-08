# Testing the Acconcy Finance workspace

Plan and design: [../features/ACCONCY-FINANCE.md](../features/ACCONCY-FINANCE.md).

## 1. Run it locally

Use a private database so nothing shared is touched (never `requirement_dashboard`).

```powershell
# from server/, DATABASE_URL pointing at your own DB, e.g. acconcy_dev on localhost:5432
npx prisma migrate deploy
npm run acconcy:seed           # ACCONCY_NO_DEMO=1 for an empty company
npm run dev:server             # API on :4000 (or PORT=4200 for a second instance)
npm run dev:client             # Vite on :5173
```

Open http://localhost:5173/login. The seed is idempotent and refuses a non-local database. The demo business is only created while the company has no clients or vendors.

| Login | Password | Role |
|---|---|---|
| admin@acconcy.in | Acconcy@2026! | Admin (everything) |
| manager@acconcy.in | Acconcy@2026! | Manager: leads, deals, revenue/expenses, tasks, people (no salaries, investments, valuation) |
| finance@acconcy.in | Acconcy@2026! | Finance: money, investments, salaries, valuation, month close (no leads, people, settings) |
| staff@acconcy.in | Acconcy@2026! | Staff: assigned work only (My work, Tasks) |
| contractor@acconcy.in | Acconcy@2026! | Contractor: assigned work only |

The demo covers the last six months: 7 clients and vendors, 9 leads across all six services and every stage, 5 deals (3 converted from won leads), 24 revenue / expense entries, 4 investments (gold, silver, venture, one partly realised), 3 assets, salary sheets, tasks, one closed month and a recorded valuation.

## 2. Automated tests

```powershell
cd server
$env:TEST_DATABASE_URL = "postgres://postgres:<pw>@localhost:5432/acconcy_test"
npx prisma migrate deploy   # with DATABASE_URL set to the same DB
npx jest --runInBand tests/acconcy-calc.test.js tests/acconcy-workspace.test.js
```

- `acconcy-calc.test.js` (pure, no database): the valuation formula (10 Cr profit + 20 Cr assets = 2460 Cr, zero profit, zero assets, negative profit, changed multipliers), deal profit from ledger rows, investment gain / loss and the realised / unrealised split.
- `acconcy-workspace.test.js` (28 tests, real database): foundation and isolation, leads (six services, stages, drop / reopen, conversion), deals, the ledger, investments and realisation, salaries, the P&L, valuation and its history, month locking, permissions, dashboard, reports, group dashboard.

Every list and report filter has a test that compares the filtered response with the exact expected set, alone and combined: leads (service, stage, client, employee, source, location, created range, search), pipeline matrix (counts equal the list under the same filters), deals (service, status, client, vendor, employee, location, start range, delayed, loss-making, search), ledger (type, level, category, client, vendor, service, deal, range, search, and totals equal the sum of the rows), investments (type, service, deal, status, range, search), P&L (month, year, range, service, client, vendor, deal, employee, combinations) and the service-wise report.

`cleanDatabase()` is slow on Windows (10-20 s), so the workspace suite cleans once and every test builds its own org with a unique slug.

## 3. Live filter check on the demo data

With the API running on the seeded database (`PORT=4200`), the verification script logs in as the admin and checks every filter against the unfiltered list computed independently, plus the arithmetic: lead / deal / ledger / investment filters, P&L month totals, service and client slices, deal profit = revenue - expenses, valuation = profit x 240 + asset value x 3 for every month, salary totals, dashboard counts. 114 checks passed on the demo data (2026-10-08).

## 4. Browser walkthrough (admin)

1. **Dashboard** - lead pipeline, leads by service and stage, deal overview, financial / investment / valuation blocks. Change the service and the month filters; click any number to open the filtered list behind it.
2. **Leads** - board / list, pipeline-by-service table (click a cell), follow-ups. Open the "Seed round: AgriGrid" lead, move it to Won, convert it (a deal appears with the same client, service, description, amount, assignee, contractor, dates and notes; the lead stays). Try Dropped (asks for a reason).
3. **Deals** - filters; open a deal: Revenue & expenses tab (profit = revenue - expenses, never typed), Investments, Tasks, Documents.
4. **Revenue & Expenses** - P&L with all filters (month, year, range, service, client, vendor, deal, employee), chart, by service, by deal, CSV; Entries tab with every filter. An entry posted from an investment shows "from investment" and cannot be edited here.
5. **Investments** - gold / silver / venture. Open "FinPay Labs": the partial realisation posted only its gain to revenue. Record a sale on another holding and watch revenue and the P&L change by the gain only. Assets tab feeds the valuation.
6. **Salaries** - set a monthly salary on a person (Employee / Contractor, admin only), generate a month, edit, approve, pay. Only approved / paid rows reach the P&L.
7. **Financials & Valuation** - Service-wise (investments shown separately from revenue); Valuation (current, previous, change, month-by-month, history with the multipliers used, edit the multipliers as admin); Month close / reopen. After closing a month, add or edit a revenue entry, salary, investment or asset dated in it as the finance user: refused; as admin: asks for a reason.
8. **Group Dashboard** (group super admin) - Acconcy appears with its profit and valuation; its asset value is not editable from there (it is calculated from Assets and Investments).
9. **Roles** - sign in as manager / finance / staff / contractor and confirm the sidebar and pages match the table above (no salary figures for a manager).
10. **Theme** - plum and gold from the logo, light and dark where the app supports it; resize to phone width.
