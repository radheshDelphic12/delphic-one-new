# Zephyr Infrastructure - standalone company workspace plan

Branch: `zephyr-bug-fix-new-implementation` (never pushed to `main` by an agent). Started 2026-10-01.
Status: **Plan v4 approved - Z0 PAUSED by user (partly built, uncommitted).** This doc is the live tracker: tick boxes and add a dated line in "Work log" as each slice lands.

## 1. Principle: Zephyr is its own product inside the platform

Zephyr Infrastructure is a construction / infrastructure company. It has **nothing in common with Delphic Global's business logic**, so:

- **Do NOT use or extend** any Delphic Global business module: recruitment (accounts, pipeline, requirements, profiles, submissions), timesheets, attendance, leave, payroll, billing/invoices, Live Analytics, Financials/locks, vendor payments, expense claims, org chart, trading. Also not the earlier generic `Lead` / `Contract` / `SelfProject` / `ProjectFinanceEntry` vertical models (shared with Acconcy); they stay untouched for other orgs.
- **All Zephyr features live in their own namespace:** server `modules/zephyr/*`, routes under `/api/v1/zephyr/*`, tables prefixed `Zx` (model names `ZxParty`, `ZxLead`, ...), client `pages/zephyr/*`, tests `server/tests/zephyr-*.test.js`.
- **Only shared platform plumbing is reused** (it is not Delphic business logic): login/JWT, `User`, `Org` + membership (tenancy), the `Drawer` / `DataTable` / `SearchableSelect` UI primitives, the logger, and the Prisma client. Without these there is no login and no company boundary. If you want a hard split later (separate DB or deployment), the `Zx` namespace makes that a clean cut.
- **Isolation rule:** every `Zx` row carries `org_id`; every Zephyr route requires the caller's active org to have the `zephyr` module and uses `org_id` from the token, never from the request body. A Delphic user can never read Zephyr data and vice versa (tested).

## 2. The six sections (the whole product)

| # | Section | Purpose |
|---|---|---|
| 1 | Leads | Opportunities from first contact to won / lost |
| 2 | Client/Vendor | One directory of clients and vendors / subcontractors |
| 3 | Projects | Self (own-developed) and client projects: budget, vendors, milestones, documents |
| 4 | Revenue/Expense/Salaries/Profit/Valuation | Live company money picture and valuation |
| 5 | Employee/Contractor management | People roster, assignments, salary records |
| 6 | Financials | Monthly plan vs actual, month close (lock), projections, statements |

Sidebar = exactly these six + Settings (own profile / password). Nothing else appears for a Zephyr user.

## 3. Today (audit 2026-10-01)

Zephyr exists as an org (`zephyr`) seeded with the generic vertical modules and Delphic-shaped sidebar items (Calendar, Attendance, Finance, Payroll). Those are to be removed from its view, not built on. The Zephyr workspace is therefore **greenfield** on top of the platform plumbing.

## 4. Review findings (v4, against the real platform code)
1. **Roles already exist per company.** `resolveOrgContext` (`server/src/middleware/auth.js:20-28`) sets `req.user.role` from `OrgMembership.role` for the active org, and a contractor membership is forced to `employee`. So Zephyr access = membership role (`admin` / `employee` / ...), no new role enum needed. Capability map is client-side `ROLE_CAPS` in `client/src/lib/permissions.js`; server truth is `authorize()`.
2. **Org isolation is half-automatic.** `config/db.js` auto-stamps `org_id` on create only for models listed in `ORG_SCOPED_ON_CREATE` (line 70). Reads are never auto-filtered. Every `Zx` service must filter `where: { org_id: req.user.org_id }` explicitly, and each `Zx` model is added to that set (one-line shared-infra edit).
3. **Admin lands on a Delphic page.** `HomePage` (`client/src/app/App.jsx:77`) redirects admins to `ADMIN_HOME` and shows the Delphic `DashboardPage` to others. Zephyr needs its own home: when the active org has the `zephyr` module, `/` redirects to `/zephyr`.
4. **Sidebar has no "only these items" mode.** `AppLayout` filters `NAV_ITEMS` additively; core items (Calendar, People, Attendance, Finance, Payroll) show for every org. Need a separate `ZEPHYR_NAV` list, chosen the same way `CONTRACTOR_NAV` is (`AppLayout.jsx:75-88`), plus route guards so typed URLs to Delphic pages redirect.
5. **Settings page carries Delphic tabs.** Zephyr users keep only the personal tabs (profile, password, notifications); Zephyr settings (categories, valuation, numbering) live at `/zephyr/settings`.
6. **People vs logins.** Most site workers/contractors never log in. `ZxPerson` is the roster; an optional `user_id` links the few who do. Not `OrgMembership` (that is Delphic HR plumbing with payroll/vendor fields).
7. **Tests are cheap to isolate.** `tests/helpers.js` `cleanDatabase()` truncates `orgs ... CASCADE`, so `Zx` tables with an `org_id` FK `onDelete: Cascade` clean themselves. Pattern to copy: `setup()` in `server/tests/erp-verticals.test.js:24`.
8. **Existing Zephyr seed** uses generic `Lead`/`Contract`/`SelfProject` with modules `leads/contracts/projects`. The Zephyr org gets `enabled_modules = ['zephyr']` only; old rows stay untouched (Acconcy still uses those modules).

## 5. Architecture and access roles
- Server: `server/src/modules/zephyr/<area>/<area>.{routes,service,validation}.js`, mounted once in `app.js` as `app.use('/api/v1/zephyr', zephyrRouter)`; the router applies `authenticate, requireOrgMembership, requireModule('zephyr')` (reuse `server/src/middleware/requireModule.js`). Response helpers `ok/created/fail` (`utils/response`), `asyncHandler`, zod schemas, `ERRORS` map + `failFor` - same shape as `modules/leads/leads.routes.js`.
- Client: `client/src/pages/zephyr/*`, `lib/zephyr/api.js` on top of `lib/apiClient.js`; UI primitives `DataTable` (with `maxHeight`), `Drawer size="xl"` + `FormActionsBar`, `SearchableSelect`, `StatCard`, `Badge`. Jira-like dense lists; plain hyphen in copy.
- Data: Prisma models prefixed `Zx`, table names `zx_*`, `org_id` FK cascade, `deleted_at` soft delete, `Decimal(16,2)` money, single org currency (INR). Additive migrations only, generated from the host per AGENTS.md.
- Audit: one `ZxAudit` table written by a small `zephyr/audit.js` helper (entity, id, action, before/after JSON, actor, reason) - not the Delphic `audit_logs`.
- Access roles (user decision: admins + managers + staff all log in): Zephyr role is resolved **without touching the global `UserRole` enum**. Rule: org membership role `admin` -> `zx_admin`; otherwise the linked `ZxPerson.access_role` (`manager` | `staff` | `none`). Resolved once per request by `zephyr/access.js` middleware into `req.zx = { role, person_id }`, and returned by `GET /zephyr/me` so the client gates on it (`zxCan(zxRole, cap)` in `client/src/lib/zephyr/permissions.js`, same style as `can()`).

| Capability | Admin | Manager | Staff |
|---|---|---|---|
| Leads, Client/Vendor: view + edit | yes | yes | no |
| Projects: view | all | all | assigned only (read) |
| Projects: edit, milestones, work orders | yes | yes | no |
| People roster: view / edit | yes / yes | yes / yes (no pay fields) | own profile only |
| Salary records | full | no | own, read-only |
| Money ledger entries | full | create/edit project expenses, no salaries | no |
| Overview (section 4) incl. valuation | yes | revenue/expense/profit per project, no salaries, no valuation | no |
| Financials (section 6), month close | yes | no | no |
| Zephyr settings, overrides, reopen month, delete | yes | no | no |

Sidebar per role: admin = six + Settings; manager = Leads, Client/Vendor, Projects, Overview (limited), Employee/Contractor + Settings; staff = "My work" (assigned projects, own profile, own salary slips) + Settings. Every server route enforces the same table (`zxAuthorize(cap)`); staff queries are always filtered to `req.zx.person_id`.
- Inviting a login: admin creates/links a `User` + `OrgMembership(role: 'employee')` for the Zephyr org from the person drawer ("Give login", sets `access_role`); reuses the platform user-create path only.

## 6. Data model (by phase)
| Phase | Models |
|---|---|
| Z0 | `ZxSetting` (org currency, valuation method/multiple, numbering prefixes), `ZxCategory` (revenue/expense categories, editable), `ZxAudit` |
| Z1 | `ZxParty` (kind client/vendor/both, name, contact, phone, email, GSTIN, PAN, address, payment terms, status, notes), `ZxDocument` (polymorphic owner: party/project/person/lead; category, ref no, issue/expiry, file via existing uploads) |
| Z2 | `ZxLead` (category self/client/other, stage new -> contacted -> site_visit -> proposal -> negotiation -> won/lost, value, expected close, owner, party, location, self-project basis, lost reason, project_id), `ZxLeadActivity` (call/visit/meeting/note, follow-up date) |
| Z3 | `ZxProject` (code, kind self/client, party, lead, location, status, dates, contract value or budget, progress %, manager), `ZxMilestone` (due date, weight, % done, billing amount, status), `ZxWorkOrder` (vendor party, scope, value, billed to date, status) |
| Z0 | `ZxPerson` minimal (name, user_id, access_role) so roles work from day one; Z4 extends it |
| Z4 | `ZxPerson` full (employee/contractor, designation, contact, joining date, status, pay basis monthly/daily, rate, optional vendor party for contractor firms), `ZxAssignment` (person, project, role, from/to, allocation %), `ZxSalaryRecord` (person, month, gross, deductions, net, status draft/approved/paid, project split JSON) |
| Z5 | `ZxLedgerEntry` (date, type revenue/expense, category, project, party, work order, milestone, amount, tax, status planned/actual, payment mode, reference, attachment) |
| Z7 | `ZxPlan` (month, optional project, planned revenue/expense/salaries), `ZxPeriodClose` (month, open/closed, snapshot totals, closed by/at, reopen reason, `stale` flag) |

Formulas (single service `zephyr/money/money.service.js`, used by Z6 and Z7 so numbers never disagree): revenue = actual revenue entries; expense = actual expense entries; salaries = approved+paid salary records; profit = revenue - expense - salaries; margin = profit / revenue; valuation = setting method (manual value | revenue multiple x trailing 12m revenue | profit multiple x trailing 12m profit). An edit dated inside a closed month sets that close's `stale = true` (never silently changes the snapshot).

## 7. Phases (9, built in order)
| Phase | Sections | Delivers | Size |
|---|---|---|---|
| **Z0 Foundation** | shell | `zephyr` module, `/api/v1/zephyr` router, access middleware + `GET /zephyr/me`, role-based `ZEPHYR_NAV`, `/` -> `/zephyr` home with section cards, route guard blocking Delphic pages, `ZxSetting`/`ZxCategory`/`ZxAudit`/minimal `ZxPerson`, `/zephyr/settings`, seed org switched to `['zephyr']`, isolation + role tests | M |
| **Z1 Client/Vendor** | 2 | Party list (Client / Vendor / All tabs, search, status filter), peek drawer, create/edit drawer, deactivate, documents with expiry, CSV import | M |
| **Z2 Leads** | 1 | List + stage board, activity log, follow-ups due panel, stage rules (won/lost closed, lost needs reason, self-project basis), party link | M |
| **Z3 Projects** | 3 | Self/client projects, "Convert to project" from won lead, milestones + progress roll-up, vendor work orders, project documents, project detail tabs (Overview / Milestones / Work orders / Documents / Money placeholder) | L |
| **Z4 Employee/Contractor** | 5 | Roster with type filter, "Give login" (role manager/staff), assignments to projects, documents, monthly salary records (user decision: fixed rate - generate the month from monthly rate or daily rate x days entered, admin adjusts days/deductions, approve, mark paid), staff "My work" page | M |
| **Z5 Money ledger** | 4 (inputs) | Revenue/expense entries, links to project/party/work order/milestone, planned vs actual, attachments, CSV import; project detail Money tab; party statement | M |
| **Z6 Overview** | 4 | Revenue / Expense / Salaries / Profit / Valuation tiles for month, quarter, YTD, custom; 12-month trend; profit by project; every number drills to its rows; admin edits valuation settings (audited) | M |
| **Z7 Financials** | 6 | Monthly plan entry, plan vs actual, 6-month projection (least squares with confidence label), month close/reopen with snapshot + stale flag, P&L by month / project / party, Excel + PDF export | L |
| **Z8 Hardening** | all | Idempotent demo seed `server/prisma/zephyr/seed.js`, `docs/testing/TESTING-ZEPHYR.md`, admin-editability checklist pass, empty/error states, browser QA (both themes, mobile) | S |

Dependency order: Z0 -> Z1 (everything references a party) -> Z2 -> Z3 (lead conversion) -> Z4 (salaries) -> Z5 -> Z6 -> Z7 -> Z8. Sidebar items show "coming soon" until their phase lands.

## 8. Per-phase done gate
Zod validation + `failFor` errors; every list/read filtered by `org_id`; role matrix enforced server-side with a test per role (admin / manager / staff / other org); admin edit + `ZxAudit` with reason on overrides/reopen; soft delete only; client page via `can()`; new `server/tests/zephyr-<area>.test.js` covering CRUD, rules, admin edit, and cross-org isolation (second org cannot read/write); docs work log + PROGRESS/TODO updated; local only, no push.

## 9. Critical files
- Edit (shared, once in Z0): `server/prisma/schema.prisma`, `server/src/config/db.js` (`ORG_SCOPED_ON_CREATE`), `server/src/app.js` (mount), `client/src/app/App.jsx` (routes, `HomePage`, guard), `client/src/components/layout/AppLayout.jsx` (+ new `zephyrNav.js`), `client/src/lib/permissions.js`, `server/prisma/erp/seed-verticals-demo.js` (Zephyr modules -> `['zephyr']`).
- New: `server/src/modules/zephyr/**`, `client/src/pages/zephyr/**`, `client/src/lib/zephyr/**`, `server/tests/zephyr-*.test.js`, `server/prisma/zephyr/seed.js`.
- Reuse (platform only): `middleware/auth.js` (`authenticate`, `authorize`, `requireOrgMembership`), `middleware/requireModule.js`, `utils/response`, `utils/asyncHandler`, uploads module for files, `tests/helpers.js` (`createOrg`, `createOrgMembership`, `loginAs`, `authed`).

## 11. Decisions made (2026-10-01)
- Standalone `Zx` module, nothing from Delphic Global; single INR currency; valuation default 3x trailing-12m revenue (admin editable).
- Logins: admins + managers + staff (role from `ZxPerson.access_role`, no new global role).
- Salaries: fixed rate (monthly or daily x days), adjusted and approved monthly.
- Build in dependency order Z0 -> Z8.

## 12. Work log
- 2026-10-01 - Brief received (six sections); initial audit and plan written. No code changed.
- 2026-10-01 - Plan v2: working decisions and phases P1-P7 (reused Delphic finance pieces).
- 2026-10-01 - Plan v3 (this version): user ruled out any Delphic Global reuse. Rewritten as a standalone `Zx` module with 9 phases (Z0-Z8), new data model, isolation rules and per-phase gates. Supersedes P1-P7.
- 2026-10-01 - Plan v4: reviewed against platform code (auth roles, org stamping, home/sidebar, tests); added admin/manager/staff access model and fixed-rate salaries. Approved by user. Starting Z0.
- 2026-10-01 - Z0 started, then paused at the user's request. **Done (uncommitted):** Prisma models `ZxSetting`, `ZxCategory`, `ZxAudit`, `ZxPerson` (+ back-relations on `Org` and `User`) in `server/prisma/schema.prisma`; migration `20261001121426_zephyr_foundation` (4 `zx_*` tables, additive; the unrelated `RenameIndex` that Prisma drift added was removed by hand, so the file has no DROP/RENAME); the four models registered in `ORG_SCOPED_ON_CREATE` in `server/src/config/db.js`. **Not done:** `modules/zephyr/` (access.js capability matrix + `zxAccess`/`zxAuthorize`, audit.js, core service/routes for `GET /zephyr/me`, settings, categories, people, audit), mount in `app.js`, client (`ZEPHYR_NAV`, `/zephyr` home, route guard, `lib/zephyr/permissions.js`, settings page), seed change (Zephyr org -> `enabled_modules ['zephyr']`), `server/tests/zephyr-foundation.test.js`. No server/client code was written, nothing run beyond migration generation.
- Resume notes: private DB `zephyr_z0_test` on localhost:5432 (URL in `%TEMP%/zephyr_db_url.txt`, same creds as `server/.env`). Its applied migration checksum no longer matches the hand-edited file, so run `npx prisma migrate reset --force` on that DB only before testing (never on `requirement_dashboard`). `prisma migrate dev` also rewrote `migration_lock.toml` line endings; it was restored with `git checkout`. Files are CRLF in the working tree on Windows: edit with CRLF-aware tools. Shared-infra edits (schema, `db.js`, `app.js`) mean one wider run of `erp-verticals`, `workspace-isolation`, `auth` suites at the end of Z0.
