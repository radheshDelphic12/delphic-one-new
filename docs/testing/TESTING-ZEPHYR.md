# Testing guide - Zephyr Infrastructure workspace

Zephyr is a standalone company workspace (`Zx` tables, `/api/v1/zephyr`, `client/src/pages/zephyr`). It shares only login, company (org) tenancy and UI primitives with Delphic. Plan and work log: [../features/ZEPHYR-INFRASTRUCTURE.md](../features/ZEPHYR-INFRASTRUCTURE.md).

## 1. Run it locally (own database, nothing of Delphic is touched)

```bash
# from server/, DATABASE_URL pointing at a database used only for Zephyr, e.g. zephyr_dev
DATABASE_URL='postgres://postgres:postgres@localhost:5432/zephyr_dev' npx prisma migrate deploy
DATABASE_URL='postgres://postgres:postgres@localhost:5432/zephyr_dev' npm run zephyr:seed   # idempotent
DATABASE_URL=... CORS_ORIGIN=http://localhost:5175 PORT=4000 npm run dev                     # API
cd ../client && npx vite --port 5175                                                         # UI -> http://localhost:5175
```

`npm run zephyr:seed` creates the Zephyr company, three logins and a full demo business (9 clients/vendors, 7 leads, 4 projects with milestones and work orders, 10 people with pay slips, 9 months of ledger, plans, two closed months). `ZEPHYR_NO_DEMO=1` seeds only the company and logins. It refuses non-local databases (same guard as the other seeds). To start over: `npx prisma migrate reset --force --skip-seed` on **that Zephyr database only**, then seed again.

| Role | Login | Password | Sees |
|---|---|---|---|
| Admin | `admin@zephyrinfra.in` | `Zephyr@2026!` | everything, incl. pay, valuation, Zephyr setup |
| Manager | `manager@zephyrinfra.in` | `Zephyr@2026!` | Leads, Client/Vendor, Projects, Revenue & Profit (no salaries / valuation), Employee/Contractor (no pay). Records project expenses only |
| Staff | `staff@zephyrinfra.in` | `Zephyr@2026!` | only "My work": own projects (read only), own approved/paid slips |

The sidebar, logo and green theme come from the company logo; a Delphic user never sees these pages and `/` redirects a Zephyr user to `/zephyr`.

## 2. Walkthrough per section (admin unless stated)

**Client / Vendor** - add a client with a bad GSTIN (rejected), a duplicate name (rejected, case-insensitive). Import `zephyr-parties-template.csv` with one good and one bad row (bad row reported, good row created). Open a party: upload a document with an expiry within 30 days (amber badge on the list), edit its details with the pencil, check the Money statement block. Delete is admin only (manager has no button).

**Leads** - board and list; move a lead through stages; "Lost" asks for a reason; won/lost leads are locked (edit disabled) and only an admin sees Reopen. A self-project lead needs a basis (investor / customer deal / project type) and its value. Add an activity with a follow-up date: it shows in the follow-ups panel, overdue in red; tick it done. On a won lead press **Convert to project** (once only; the lead then links to the project and cannot be reopened).

**Projects** - list with progress bars; open a project. Overview (contract value or budget, billing, committed vendor cost). Milestones: set % done (progress is the weight-averaged %); "billed" needs 100%; a billed milestone cannot be deleted; completing the project needs every milestone at 100%. Work orders: vendor must be an active vendor/both party; billed cannot exceed value; a work order with billing cannot be cancelled. Team tab lists assigned people. Money tab: actual vs planned, budget used, category split and the project's own ledger.

**Employee / Contractor** - roster with filters; Add person (admin sees pay basis, rate, login and access role; manager does not and gets 403 from the API if forced). Assign to projects: overlapping assignments over 100% are refused. **Salaries tab** (admin): pick a month, Generate drafts; daily slips need days; deductions cannot exceed gross; Approve -> Mark paid; Reopen (approved or paid) needs a reason; project split editable and must total 100%. Staff: log in as staff and open My work.

**Revenue & Profit** - Overview: presets (this month, last month, quarter, FY to date, last 12 months, custom), tiles with change vs previous period, 12-month chart, profit by project, categories; click a tile or a project number to see the rows behind it. Ledger tab: add revenue/expense (actual or planned), link a work order (expense) or milestone (revenue), attach bills, import CSV (`zephyr-ledger-template.csv`). Manager: can add only project expenses and sees only those.

**Financials** (admin) - Plan vs actual: "Plan a month" (whole company or one project) and compare with actuals. Projection: six months ahead from a straight-line fit of finished months, with a confidence label. Month close: close a finished month (needs no draft slips); add an entry dated in it and the month shows "Changed since close"; Reopen needs a reason; close again to refresh. Statements: P&L by month / project / party, Excel, PDF and CSV downloads.

**Zephyr setup** (admin) - valuation method (manual / revenue multiple / profit multiple), project code prefix, revenue and expense categories (add, rename, deactivate, delete), audit log.

## 3. Rules worth trying (each is covered by an automated test)

- Another company can never read or change Zephyr data (404 / empty), and an org without the `zephyr` module gets 403 on every Zephyr route.
- Staff get 403 on every business API; managers get 403 on settings, audit, salaries, financials; pay and login access are admin-only fields.
- Actual entries cannot be dated in the future (mark them planned); revenue needs a client, expense a vendor; manager entries must be project expenses.
- A change dated in a closed month flags it stale instead of rewriting the snapshot.
- Locks guard ordinary work, not admins: reopen a lead, an approved or paid slip, a closed month, or fix a document's details - each with a reason on the audit trail.

## 4. Automated tests

Run from `server/`, one or two files at a time (each uses `--runInBand`; a private database is required, set `TEST_DATABASE_URL`):

```bash
npx jest --runInBand tests/zephyr-foundation.test.js tests/zephyr-parties.test.js
npx jest --runInBand tests/zephyr-leads.test.js tests/zephyr-projects.test.js
npx jest --runInBand tests/zephyr-people.test.js tests/zephyr-ledger.test.js tests/zephyr-financials.test.js
```

| File | Covers |
|---|---|
| `zephyr-foundation` | roles and capabilities, module gating, settings + audit, categories, isolation |
| `zephyr-parties` | directory CRUD, GSTIN/PAN, CSV import, documents (upload, expiry, edit, download rules) |
| `zephyr-leads` | stages and locks, activities and follow-ups, summary, admin reopen, lead documents |
| `zephyr-projects` | codes, lead -> project, milestones and progress, work orders, closed-project locks |
| `zephyr-people` | roster, admin-only pay, assignments cap, salary slips (generate, approve, pay, reopen, split), My work |
| `zephyr-ledger` | entries, links, validation, manager scope, CSV import, project money, party statement |
| `zephyr-financials` | overview and valuation, plans, projection, month close and stale flag, statements, Excel / PDF |

CI runs the whole server suite sharded; do not run it all locally (see AGENTS.md "Testing + CI speed rule").
