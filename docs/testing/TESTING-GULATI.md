# Testing the Gulati Industries workspace

Plan and design: [../features/GULATI-INDUSTRIES.md](../features/GULATI-INDUSTRIES.md).

## 1. Run it locally

Use a private database so nothing shared is touched (never `requirement_dashboard`).

```powershell
# from server/, DATABASE_URL pointing at your own DB, e.g. gulati_dev on localhost:5432
npx prisma migrate deploy
npm run gulati:seed            # GULATI_NO_DEMO=1 for an empty company
npm run dev:server             # API on :4000
npm run dev:client             # Vite on :5173
```

Open http://localhost:5173/login. The seed is idempotent; the demo business is only created while the company has no clients or vendors.

| Login | Password | Role |
|---|---|---|
| admin@gulatiindustries.in | Gulati@2026! | Admin (everything) |
| manager@gulatiindustries.in | Gulati@2026! | Manager: leads, deals, expenses, tasks, people |
| finance@gulatiindustries.in | Gulati@2026! | Finance: money, payments, P&L, month close |
| staff@gulatiindustries.in | Gulati@2026! | Staff: assigned work only (My work, Tasks) |
| contractor@gulatiindustries.in | Gulati@2026! | Contractor: assigned tasks only |

## 2. Walkthrough (admin)

1. **Dashboard** - lead pipeline, active trading, financial block, deal performance; click any number to open the records behind it.
2. **Leads** - board / list, pipeline-by-trading-type table, follow-ups. Open the Shree Metals lead, move it through stages. Try "Dropped" (asks for a reason).
3. **Convert** - open the won lead "Copper Cathode for ABC Industries" (already converted: shows "Deal GD-0001"). Win another lead and press "Convert to deal": everything carries forward and the lead stays.
4. **Trading Deals** - open GD-0001: Overview (quantity bars: ordered / sourced / supplied / remaining), Purchases, Sales, Expenses, Tasks, Documents. Expected figures: purchase 90 L, sale 1 Cr, gross 10 L, expenses 2 L, net 8 L, margins 10% and 8%.
5. **Partial supply** - on GD-0002 add a sale larger than the ordered quantity: blocked for managers, an admin is asked for a reason.
6. **Payments** - pay a vendor or receive from the client; outstanding amounts update; over-payment needs an admin reason.
7. **Finance** - Overview (company inputs and valuation), P&L with all filters, By trading type, Expenses, Month close.
8. **Month close** - close last month as finance, then try to add an expense dated in it as manager (refused); as admin it asks for a reason and the month shows "Changed since close"; reopen with a reason.
9. **Gulati setup** (admin) - add a trading type, unit and category; change valuation; read the Audit log.
10. **Employee / Contractor** - roster, Logins tab (create a login, change a role, deactivate).

## 3. Test map

| File | Covers |
|---|---|
| `server/tests/gulati-trading.test.js` | masters, isolation, parties, lead stages / margin / lock / reopen, conversion, gross and net profit (1 Cr / 90 L / 2 L), partial supply, payables and receivables, deal status flow, delayed flag, month lock, roles, tasks and My work, dashboard |
| `server/tests/gulati-admin-edits.test.js` | admin edits of lines, payments and closed months, logins and roles, admin-added trading types, documents, cross-company isolation |

Run only these (isolated DB via `TEST_DATABASE_URL`):

```powershell
cd server
npx jest --runInBand tests/gulati-trading.test.js tests/gulati-admin-edits.test.js
```

Shared files touched (schema, `app.js`, uploads service) were re-checked with `uploads-auth`, `zephyr-parties`, `zephyr-foundation`, `workspace-isolation`, `auth` and `erp-verticals`; CI runs the full suite.

## 4. Known behaviour to be aware of

- Profit follows record dates: a purchase counts as cost in its month even before the material is sold, so a month with only purchases shows a loss until the sale is recorded. Payments never change profit.
- Quantities are summed across whatever unit each record uses; keep one unit per deal.
- Tax (GST) is stored separately and excluded from profit.
