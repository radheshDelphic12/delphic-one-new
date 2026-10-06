# Testing guide - Zephyr Infrastructure workspace

Zephyr is a standalone company workspace (`Zx` tables, `/api/v1/zephyr`, `client/src/pages/zephyr`). It shares only login, company (org) tenancy and UI primitives with Delphic. Plans and work logs: [../features/ZEPHYR-INFRASTRUCTURE.md](../features/ZEPHYR-INFRASTRUCTURE.md) (base, phases Z0-Z8) and [../features/ZEPHYR-REAL-ESTATE-PLAN.md](../features/ZEPHYR-REAL-ESTATE-PLAN.md) (the real-estate / construction build, phases R0-R9).

## 1. Run it locally (own database, nothing of Delphic is touched)

```bash
# from server/, DATABASE_URL pointing at a database used only for Zephyr, e.g. zephyr_dev
DATABASE_URL='postgres://postgres:postgres@localhost:5432/zephyr_dev' npx prisma migrate deploy
DATABASE_URL='postgres://postgres:postgres@localhost:5432/zephyr_dev' npm run zephyr:seed   # idempotent
DATABASE_URL=... CORS_ORIGIN=http://localhost:5175 PORT=4000 npm run dev                     # API
cd ../client && npx vite --port 5175                                                         # UI -> http://localhost:5175
```

`npm run zephyr:seed` creates the Zephyr company, four logins and a full demo business: clients and vendors, leads for all five services, 5 projects (civil, interior and a consulting deal) with milestones and work orders, 4 properties with units, 3 tenants and leases with months of rent (one part-paid, some overdue), a bank loan, manual valuations, two sales (a unit and a whole property), tasks, a shared expense, 10 people with pay slips, 9 months of ledger, plans and two closed months. `ZEPHYR_NO_DEMO=1` seeds only the company and logins. `ZEPHYR_RESET=1` first clears the demo business of the Zephyr company (never the company, its logins, settings or categories) and rebuilds it - use it after upgrading an old demo. It refuses non-local databases unless `ALLOW_DESTRUCTIVE_SEED=1` is set (same guard as the other seeds; the Zephyr seed deletes nothing without `ZEPHYR_RESET`). To start over on a local database: `npx prisma migrate reset --force --skip-seed` on **that Zephyr database only**, then seed again.

| Role | Login | Password | Sees |
|---|---|---|---|
| Admin | `admin@zephyrinfra.in` | `Zephyr@2026!` | everything, incl. pay, valuation, Zephyr setup |
| Manager | `manager@zephyrinfra.in` | `Zephyr@2026!` | Leads, Client/Vendor, Projects, Properties (no money), Rent, Tasks, Revenue & Profit (no salaries / valuation), Employee/Contractor (no pay). Records project expenses only |
| Staff | `staff@zephyrinfra.in` | `Zephyr@2026!` | "My work" (own projects read only, own approved/paid slips) and own Tasks |
| Finance | `finance@zephyrinfra.in` | `Zephyr@2026!` | Properties with money, Rent, the full ledger, shared expenses, Revenue & Profit by service / property (no salaries, leads, people pay, settings or month closing) |

The sidebar, logo and green theme come from the company logo; a Delphic user never sees these pages and `/` redirects a Zephyr user to `/zephyr`.

## 2. Walkthrough per section (admin unless stated)

**Client / Vendor** - add a client with a bad GSTIN (rejected), a duplicate name (rejected, case-insensitive). Import `zephyr-parties-template.csv` with one good and one bad row (bad row reported, good row created). Open a party: upload a document with an expiry within 30 days (amber badge on the list), edit its details with the pencil, check the Money statement block. Delete is admin only (manager has no button).

**Leads** - board and list. The service strip and the stage strip filter the pipeline; more filters: employee, location, created date. A lead needs one of the five services; contact, address, expected start / end / profit and a free "deal details" list are optional. Stages: New, In discussion, Negotiation, On hold, Won, Closed, Dropped ("Dropped" asks for a reason). Won / Closed / Dropped leads are locked and only an admin sees Reopen. Add an activity with a follow-up date: it shows in the follow-ups panel, overdue in red; tick it done. On a won lead press **Convert to project** (once only; service, assignees, dates, profit and deal details carry over, the lead stays for history).

**Projects** - list with service tiles, filters (status, client, location, start dates) and actual profit. Open a project. Overview (contract value, expected profit, revenue and cost booked from the ledger, billing, committed vendor cost) and the service section: civil phases, interior costs, consulting commission (property value x percent, computed) with a **Book commission revenue** button. Milestones: set % done (progress is the weight-averaged %); "billed" needs 100%; a billed milestone cannot be deleted; completing the project needs every milestone at 100%. Work orders: vendor must be an active vendor/both party; billed cannot exceed value; a work order with billing cannot be cancelled. Team tab lists assigned people. Money tab: actual vs planned, budget used, category split and the project's own ledger.

**Employee / Contractor** - roster with filters; Add person (admin sees pay basis, rate, login and access role; manager does not and gets 403 from the API if forced). Assign to projects: overlapping assignments over 100% are refused. **Salaries tab** (admin): pick a month, Generate drafts; daily slips need days; deductions cannot exceed gross; Approve -> Mark paid; Reopen (approved or paid) needs a reason; project split editable and must total 100%. Staff: log in as staff and open My work.

**Properties** - portfolio list with filters (type, status, city, current use, tenant, valuation range) and an admin / finance **Sales** tab. Open a property: Overview (units, total invested, valuation, **unrealized** appreciation, this month's cash flow), Units (add / edit, rent out, sell), Tenants & leases, Rent, Finance (investment lines, manual valuation history, loans, sales), Timeline, Documents. A manager manages the property and units but sees no money.

**Rent** - month picker with due / collected / pending / overdue tiles; tabs Rent due, Overdue, Payments received, Leases, Tenants. Record a payment (method, reference, collector): it posts "Rental income" to the ledger. Overdue is computed from the due date. Waive needs a reason; deleting a payment reverses the ledger entry. A closed month refuses all of it until an admin reopens it.

**Tasks** - open / overdue / completed lists; create a visit, inspection, rent collection etc. for an employee or contractor, with property, unit, project, priority, due date and amount. The assignee starts and completes it (a rent task can record the payment on completion); an admin reopens a finished task with a reason.

**Revenue & Profit** - Overview: presets (this month, last month, quarter, FY to date, last 12 months, custom), filters (service, property, client / vendor), tiles with change vs previous period, 12-month chart, **unrealized appreciation** beside (not inside) the P&L, by service / by property / by project / by client-vendor tables, categories; click a tile or a project number to see the rows behind it. **By service** tab: the figures of each of the five services. Ledger tab: add revenue/expense (actual or planned) with service, property and unit, link a work order (expense) or milestone (revenue), attach bills, import CSV (`zephyr-ledger-template.csv`), and book a **Shared expense** split across projects and properties. Rent receipts, sales, commissions and shared expenses show as system entries (change them at their source). Manager: can add only project expenses and sees only those.

**Financials** (admin) - Plan vs actual: "Plan a month" (whole company or one project) and compare with actuals. Projection: six months ahead from a straight-line fit of finished months, with a confidence label. Month close: close a finished month (needs no draft slips); from then on every actual entry, rent payment, waiver and sale dated in it is refused (a pay-slip change still flags it "Changed since close"); Reopen needs a reason; close again to refresh. Statements: P&L by month / project / service / property / client-vendor, Excel, PDF and CSV downloads.

**Zephyr setup** (admin) - services (rename or hide the five services), valuation method (manual / revenue multiple / profit multiple), project code prefix, revenue and expense categories (add, rename, deactivate, delete), audit log.

## 3. Rules worth trying (each is covered by an automated test)

- Every lead and project belongs to one of the five services; lead stages and project statuses are the sets listed above.
- Total investment = purchase + brokerage + documentation + registration + construction + renovation + other. Appreciation = valuation - total investment is unrealized and never reaches the P&L; only a sale does (sale value in, cost of the property sold and selling costs out).
- Rent dues are generated monthly from the lease; overdue = past the due date with a balance; payments cannot exceed the balance or be dated in the future.
- A closed month is a hard lock for actual entries, rent, waivers and sales; system entries are changed only where they came from.
- A staff member sees and moves only their own tasks; finance sees money and rent but not leads, people pay or settings.
- Another company can never read or change Zephyr data (404 / empty), and an org without the `zephyr` module gets 403 on every Zephyr route.
- Staff get 403 on every business API; managers get 403 on settings, audit, salaries, financials; pay and login access are admin-only fields.
- Actual entries cannot be dated in the future (mark them planned); revenue needs a client, expense a vendor; manager entries must be project expenses.
- A change dated in a closed month flags it stale instead of rewriting the snapshot.
- Locks guard ordinary work, not admins: reopen a lead, an approved or paid slip, a closed month, or fix a document's details - each with a reason on the audit trail.

## 4. Automated tests

Run from `server/`, one or two files at a time (each uses `--runInBand`; a private database is required, set `TEST_DATABASE_URL`):

```bash
npx jest --runInBand tests/zephyr-foundation.test.js tests/zephyr-parties.test.js
npx jest --runInBand tests/zephyr-services.test.js tests/zephyr-leads.test.js
npx jest --runInBand tests/zephyr-projects.test.js tests/zephyr-people.test.js
npx jest --runInBand tests/zephyr-property.test.js tests/zephyr-rent.test.js
npx jest --runInBand tests/zephyr-trading.test.js tests/zephyr-finance-links.test.js
npx jest --runInBand tests/zephyr-tasks.test.js tests/zephyr-reports.test.js
npx jest --runInBand tests/zephyr-ledger.test.js tests/zephyr-financials.test.js
```

| File | Covers |
|---|---|
| `zephyr-foundation` | roles and capabilities, module gating, settings + audit, categories, isolation |
| `zephyr-parties` | directory CRUD, GSTIN/PAN, CSV import, documents (upload, expiry, edit, download rules) |
| `zephyr-services` | service master, client / vendor fields and filters, lead pipeline by stage and service, project sections, commission math, statuses |
| `zephyr-leads` | stages and locks, assignees, details, activities and follow-ups, summary, admin reopen, lead documents |
| `zephyr-projects` | codes, lead -> project carry-over, milestones and progress, work orders, closed-project locks |
| `zephyr-people` | roster, admin-only pay, assignments cap, salary slips (generate, approve, pay, reopen, split), My work |
| `zephyr-property` | every property formula, properties, units, valuation (never in the P&L), loans, finance walls, filters |
| `zephyr-rent` | tenants, leases, due generation, overdue, payments to the ledger, reversal, waiver, closed-month lock, cash flow |
| `zephyr-trading` | whole-property and unit sales, cost basis, realized profit in the P&L, reversal, rules |
| `zephyr-ledger` | entries, links, validation, manager scope, CSV import, project money, party statement |
| `zephyr-finance-links` | ledger dimensions, P&L by service / property / party, appreciation outside the P&L, period lock, shared expenses, commission booking |
| `zephyr-financials` | overview and valuation, plans, projection, month close, statements, Excel / PDF |
| `zephyr-tasks` | task lifecycle, assignee scope, reopen, rent collection through a task |
| `zephyr-admin-edits` | admin can edit valuations, manual timeline entries, rent payments, sales, shared expenses and lead activities; code prefixes; manager is refused |
| `zephyr-reports` | service-wise reports, dashboard per role, the finance role |

Zephyr suites: 122 tests, all passing (foundation 10 + parties 9, services 9 + leads 12, projects 12 + people 9, property 8 + rent 8, trading 5 + finance-links 7, tasks 5 + reports 8, ledger 10 + financials 10).

CI runs the whole server suite sharded; do not run it all locally (see AGENTS.md "Testing + CI speed rule").

## 5. Staging (Render + Neon)

Staging URL: https://delphic-one-new-staging.onrender.com/login (same logins and password as section 1; the free Render plan sleeps, the first load can take up to a minute).

- Deploy: push the branch (`git push origin zephyr-bug-fix-new-implementation:staging`), then `render deploys create srv-datoc5e0tbcc73elv730 --commit <sha> --wait --confirm`. The boot step runs `prisma migrate deploy` itself. Never push `main`.
- Seed (once, by hand; idempotent, deletes nothing, but the guard needs the flag for a non-local host). Use the Neon **direct** host from the Render `DATABASE_URL`, not the `-pooler` one, and no `channel_binding`:

```powershell
cd server
$env:DATABASE_URL="postgresql://<user>:<password>@<direct-host>/neondb?sslmode=require&connect_timeout=120&pool_timeout=120&connection_limit=3"
$env:ALLOW_DESTRUCTIVE_SEED="1"   # exactly 1
npm run zephyr:seed
```

- Never commit the connection string or password. Rotate the Neon password if it was pasted anywhere.
- After a deploy that carries new Zephyr migrations the old demo data is still there. To show the new demo, run the seed once with `ZEPHYR_RESET=1` (it clears only the Zephyr company's demo business and rebuilds it): `$env:ZEPHYR_RESET="1"` next to the other two variables above.

## 6. The click-by-click feature guide

`D:\Zephyr-Feature-Guide.docx` (outside the repo) is the tester's guide: one table per section with Feature / How it works / How to test. It was rewritten on 2026-10-06 for the real-estate build (sections 0-13: setup and logins, Home, Client / Vendor, Leads, Projects, Properties, Rent, Property trading, Employee / Contractor, Tasks, Revenue & Profit, Financials, Zephyr Settings, role and security rules). Keep it in step with this file: when a screen or rule changes, change its row there too.

UI notes (2026-10-06): lists use one Filters button with chips (Client / Vendor, Leads, Projects, Properties); Client / Vendor drawers close after Save; overdue cards are red and follow-ups due is amber; the guide on D: describes how to add rent (tenant, lease, record payment) and the new Home. No test changes: the work was client-only (lint and build).
