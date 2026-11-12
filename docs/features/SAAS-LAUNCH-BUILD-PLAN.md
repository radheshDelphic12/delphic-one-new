# SaaS launch - build plan and work log

Source: `D:\chinu\Delphic One SaaS Launch Plan.docx` (version 3, sections 1-26). Branch: `saas-launch-platform` (local worktree `D:\Delphic-One\saas-launch-worktree`). Nothing here is pushed or deployed.

## Ground rules (from the owner)

1. **No existing feature or company changes behaviour.** Everything is additive: new tables/columns with safe defaults, new routes and screens.
2. **Every enforcement is OFF by default.** Entitlement checks, credit burning, trial limits: behind `SAAS_ENFORCE_ENTITLEMENTS` (env, default off) and per-feature switches. With the flag off the product behaves exactly as today.
3. Local only. No push, no deploy, no staging/prod access.
4. Targeted tests only (isolated DB `saas_launch_test`), `npm run lint:changed`, explicit-path commits.
5. Admin-editable everything: prices, modules, dependencies, trial length and trial users are rows, not constants (docs/guides/ADMIN-EDITABILITY.md).

## Assumptions (open decisions use the docx recommendations)

| # | Decision | Assumption used | Source |
|---|----------|-----------------|--------|
| A1 | Customer = own group, not a company in our group | Yes; `org_groups.kind` = owner / customer / trial / demo | s21, Q20 |
| A2 | Who sees customer data from our side | Nobody by default (no memberships in customer groups) | Q21 |
| A3 | Platform admins | Named allow list, separate from company roles; env `PLATFORM_ADMIN_EMAILS` plus a DB table, max 2 at first | Q22 |
| A4 | Trial | 15 days, 2 users (admin + 1), all modules; values stored in a settings row | s7, s22 |
| A5 | Module prices | As in the pricing sheet (28 modules = Rs 215, BASC Rs 50, admin Rs 500) per 30 days, before GST | s2, s6, Q7 |
| A6 | Basic View | per user per 30 days, required on every slot | Q2 |
| A7 | Zero credits | Read-only for 3 grace days, then blocked | Q3 |
| A8 | Slot transfer | One move per 7 days per slot | Q5 |
| A9 | Credits on an unassigned slot | Do not burn; the admin slot always burns | Q13 |
| A10 | Prerequisites | Added automatically at checkout as separate lines | Q14 |
| A11 | Launch with GST/TDS and Banking | Catalogue lists them, flagged "coming soon" | Q15 |
| A12 | Price change for existing customers | Dated price books; old price kept 12 months | Q4 |

## Phase 0 - Safety, backup and release tooling

Goal: a restore point before any work, a one-customer restore, release tags. Pure scripts, no application behaviour change.

- [x] 0.1 `scripts/restore-point.sh`: full verified dump, per-table row counts, uploads listing, git tag, settings copy without secrets, written to `backups/restore-points/<name>/`.
- [x] 0.2 `scripts/restore-org.js` (one-customer restore): restore a dump into a scratch DB, copy one org's rows back; generic over tables with `org_id`; dry-run default; `--apply` needed.
- [x] 0.3 `scripts/release-tag.sh`: tag `vYYYY.MM.DD-<stage>-N` for the commit that is live, with notes.
- [x] 0.4 `scripts/branch-diff-report.sh`: what is on dev but not on staging/main, and staging but not main.
- Acceptance: scripts run locally against the dev DB; restore-org dry-run lists tables and row counts; shell syntax checked; a test for the table-ordering/dry-run logic.

## Phase 1 - Catalogue, group kind, platform admin, customer groups

- [x] 1.1 Migration: `org_groups.kind` (default `owner`; all existing rows stay `owner`). Tag shown in the Group Dashboard company list. Acceptance: existing group tests unchanged and green.
- [x] 1.2 Platform-admin gate: table `platform_admins` (named list) + `requirePlatformAdmin` middleware, separate from company roles. Acceptance: company admins and group super admins are refused.
- [x] 1.3 Module catalogue tables: `saas_modules` (code never changes), `saas_module_dependencies` (all-of and any-of), `saas_price_books` + `saas_module_prices` (dated), seeded with the 28 modules + BASC + admin price. Admin-editable through platform-admin routes.
- [x] 1.4 Platform-admin screen (client): catalogue, dependencies, price books, platform admins.
- [x] 1.5 Convert lead to customer (Delphic One workspace): creates a customer group (kind `trial`), a clean company, trial row (15 days, 2 users), admin invitation. Flagged by `SAAS_CUSTOMER_PROVISIONING` (off by default). Clean template means no data from our companies.
- [x] 1.6 Isolation tests: owner-group reports never include customer-group rows, and the reverse; platform routes refuse non-platform admins.
- Acceptance: targeted tests green; existing group/Delphic One tests green; lint clean.

## Phase 2 - Slots, credits, daily counter, entitlement lookup (enforcement OFF)

- [x] 2.1 Tables: `saas_customers` (links customer org/group to plan, trial dates), `saas_slots` (email, role, transfer date), `saas_slot_credits` (slot, module code, days left), `saas_credit_ledger` (every change, audit).
- [x] 2.2 Services: add credits, move slot (7-day rule), pause, prerequisites check, run-out dates.
- [x] 2.3 Daily counter job: remove 1 day from every active credit, never below 0, idempotent per day (a double run changes nothing), alert at 5 days. Registered but only runs when `SAAS_COUNTER_ENABLED` is on.
- [x] 2.4 Entitlement lookup `entitlementsFor(user)` and a middleware `requireModuleCode(code)` that is a no-op unless `SAAS_ENFORCE_ENTITLEMENTS` is on and the company is a customer/trial company. Our own companies are never subject to it.
- [x] 2.5 Tests: counter clock cases (missed day, double run, reaching 0), slot move, dependency rules, middleware off = identical behaviour.

## Phase 3 - Trial flow (later)
Website early-access form, Sales creates customer, setup wizard, Excel import, demo company, read-only at the end. Not started.

## Phase 4 - Billing (later)
Billing portal, gateway, webhook, GST invoices, usage credits. Not started.

## Work log

- 2026-11-12 plan written; worktree created from 0d86f4e (super_admin_branch).
- 2026-11-12 Phase 0 done. `scripts/restore-point.sh` (dump, row counts, uploads list, git tag, settings without secrets, `--compare`), `server/scripts/restore-org.js` (one-company restore, dry run by default, tested against a cloned database: only the named company is restored, other companies untouched), `scripts/release-tag.sh`, `scripts/branch-diff-report.sh`. restore-point.sh is syntax-checked only: this machine has no pg_dump/psql, so the dump path must be tried once on a machine with Postgres tools or in Docker. Finding from branch-diff-report: origin/dev is far behind staging (hotfixes and features went to staging/main directly), so the dev->staging->main path needs dev brought up to date once before it can be the rule.
- 2026-11-12 Slice 1.1 done: `org_groups.kind` (migration 20261212100000_saas_group_kind, default owner, check constraint), Group Dashboard company cards carry `org.group_kind` and show the tag. Catalogue tables created (migration 20261212110000_saas_catalogue: platform_admins, saas_modules, saas_module_dependencies, saas_price_books, saas_module_prices, saas_settings) and seeded with the 29 modules (28 = Rs 215 + BASC Rs 50), 31 dependency rows, a launch price book (admin Rs 500, effective 2026-11-12) and the settings. Tests: saas-group-kind, group-insights, super-admin-group-dashboard, group-tasks all green (36). Routes/screens for the catalogue come next (1.2-1.4).
- 2026-11-12 Slices 1.2 and 1.3 done: `server/src/modules/platform/` (service + routes at `/api/v1/platform`, route-table path opened because the route has its own gate). Gate = platform_admins table or env PLATFORM_ADMIN_EMAILS; company admins and group super admins get 403. Admin-editable: modules (code immutable, retire with active=false), dependencies (all-of groups and any-of alternatives, loops refused), dated price books (copy latest, edit, effective date), settings (trial days etc.). `withPrerequisites()` adds checkout prerequisites automatically. Tests: saas-platform-admin (9 green). Assumption A3 limit of two admins is not enforced in code (decide later). Audit trail for catalogue edits is NOT built yet (settings keep updated_by); open item.
- 2026-11-12 Slices 1.5, 1.6 and Phase 2 foundations done (migration 20261212120000_saas_customers_slots: saas_customers, saas_slots, saas_slot_credits, saas_credit_ledger, saas_counter_runs).
  - Provisioning: `POST /api/v1/delphic-one/customers/:id/provision` (Delphic One admins only) creates a NEW group (kind trial) with one clean company, a first admin login (one-time password returned once), an admin slot, trial dates and user limit from the settings (15 days, 2 users). Off unless `SAAS_CUSTOMER_PROVISIONING=true`. It refuses an email that already has a login (one person in two groups needs the section 21 checks first), a second workspace, and a missing contact email.
  - Credits: `credits.service.js` (slots, top-up/remove with ledger, 7-day slot move, pause, daily counter). The counter keeps one row per day (so a double run does nothing), catches up missed days (up to 31), never goes below 0 (also a database check), raises a low-credit alert once. Job `src/jobs/saasCounter.js` is registered but does nothing unless `SAAS_COUNTER_ENABLED=true`. Only customers with status `active` (paid) burn credits; a trial runs on its dates (assumption).
  - Entitlements: `entitlements.service.js` (`entitlementsFor`, `effectiveModules` pause rule, `requireModuleCode(code)` guard). The guard is a no-op unless `SAAS_ENFORCE_ENTITLEMENTS=true` and then only for companies that are SaaS customers; the guard is not attached to any existing route yet (the screen-to-module mapping, SaaS plan section 10, comes first).
  - Isolation tests: owner Group Dashboard never lists a customer company, customer admin gets 403 on the Delphic One workspace, group dashboard and platform routes. Tests: saas-customers-credits (12 green).
  - Platform routes added: customers, slots, credits, move, status, counter/run, entitlements preview.
  - Still open in phase 1: 1.4 (platform-admin screen in the client), audit trail for catalogue edits, a "Provision workspace" button in the Delphic One customers screen (backend route is ready).
- 2026-11-12 Slice 1.4 done: platform screen `client/src/pages/platform/PlatformPage.jsx` at `/platform` (reached by address only, no menu link; shows "only for platform administrators" to anyone else). Tabs: Modules (price, on/off, coming soon, dependencies as `EMPM, ATLV` = both, `CLHR|INHR` = either), Price books (new = copy of the latest, edit prices), Settings, Customers, Platform admins. Delphic One > Customers gains a "Create workspace" button (trial customers, Delphic One admins, only when `SAAS_CUSTOMER_PROVISIONING=true`); it shows the first admin login once. Client builds (vite) and lints clean; the screens were NOT clicked through in a browser. Tests: saas-customers-credits + delphic-one-workspace 18 green; earlier access-model + delphic-one 31 green.

## Switches (all off by default)

| Switch | What it turns on |
|--------|------------------|
| `SAAS_CUSTOMER_PROVISIONING=true` | The "Create workspace" action that makes a customer's own trial group and company |
| `SAAS_COUNTER_ENABLED=true` | The nightly credit counter job and the manual `POST /platform/counter/run` |
| `SAAS_ENFORCE_ENTITLEMENTS=true` | The module guard `requireModuleCode` (not attached to any existing route yet) |
| `PLATFORM_ADMIN_EMAILS=a@x.com,b@y.com` | Names the first platform admins before any row exists |

## Not done / next

- Wire `requireModuleCode(code)` onto routes once the screen-to-module mapping (SaaS plan section 10) is agreed; then the entitlement matrix test (every route x module code).
- Sidebar: modules the user may use, lock icon for expired ones (needs entitlements in the login payload).
- Audit trail for catalogue and price edits; limit of two platform admins (assumption A3) is not enforced.
- Checks for one person in two groups (sign-in, reset, invitation, company switch) before provisioning may attach an existing email.
- Phase 3 (website early-access form, setup wizard, Excel import, demo company, read-only end of trial) and Phase 4 (billing portal, gateway, GST invoices, usage credits).
- Dev -> staging -> main: origin/dev is far behind staging; bring it up to date once before using the path in plan section 25.
- Try `scripts/restore-point.sh` on a machine with pg_dump/psql or in Docker.
## Round 2 (owner decisions, 2026-11-12)

Owner decisions recorded: (1) the seeded catalogue is only the DEFAULT: Paras decides every rate, prices may rise or fall by season, so all prices live in dated price books edited on /platform and no amount is hard-coded anywhere else (GST rate and every other number will be a platform setting too). (2) The three switches are stored in the database, turned on/off from /platform by platform admins, audited, default OFF; the environment variable is only the initial fallback. (3) Confirmed: only active (paid) customers burn credits; trials run on their dates.

- 2026-11-12 (a) done, with decision 2: `saas_audit` table (migration 20261212130000_saas_audit) and `audit.service.js`. Every platform edit (module create/edit, dependencies, price book create/edit with changed prices only, setting edit, switch on/off, platform admin add/remove) writes who + before + after; read at `GET /platform/audit`, shown on the Audit trail tab. Switches: `switches.service.js` stores `switch.provisioning|counter|enforce` as rows in saas_settings (10 s cache, cleared on change); no row = env var, no env = off; a value set on the screen wins. `PUT /platform/switches/:name` needs `{ on, confirm: true }`; the Switches tab shows the state and where it was set and asks for a confirm. Provisioning, the counter job/manual run and the entitlement guard now read these switches. Tests: saas-platform-admin + saas-customers-credits 26 green.
Owner instruction (round 2): ALL SaaS work stays only on branch `saas-launch-platform`; never merge into or push main, staging, dev or super_admin_branch until the owner says so. Only `git push origin saas-launch-platform` (plain, non-force) is allowed, after each finished slice, and `git ls-remote` is checked that no other branch moved (tips before the first push: dev f781d6c, main/staging/super_admin_branch 821ee28).

- 2026-11-12 (b) done: `GET /platform/access` (any signed-in person; `platform_admin` true/false) and a Platform link in the sidebar (also inside company workspaces and the Group Dashboard view, `/platform` added to the shared paths) shown only when it says yes. Tests: saas-platform-admin 13 green; client lint clean.
- 2026-11-12 (c) done: screen-to-module mapping as data. Table `saas_route_modules` (migration 20261212140000_saas_route_modules, 53 draft rows from SaaS plan section 10: API address -> module code, optional client menu path, longest address wins, no row = not gated; client-only menu paths such as /hiring-setup have no API address so they are not seeded). The guard runs inside `authenticate()` (`saasGate.check`, after the permission check): a no-op beyond a cached switch read unless "Module access checks" is ON; then it refuses only when the person's company is a SaaS customer, the address is mapped and the slot has no usable days (a read-only/ended-trial customer may still GET; a trial has every module for its dates). Fails open on an internal error. `GET /platform/my-modules` tells the menu what to hide (client hides those sidebar entries). Mapping is edited on the new "Screen mapping" tab (`PUT/DELETE /platform/route-modules`, audited, takes effect at once). Entitlement-matrix test `saas-entitlement-matrix` (11 green): every mapped route x refused without days / open with days, unmapped routes open, a company that is not a customer never blocked even with the switch ON, switch OFF blocks nobody, paused slot, no slot, read-only, trial, prerequisites, menu list, mapping edits. Because `middleware/auth.js` changed (shared infra) the FULL suite is run once at the end on its own database.
- Known gaps in the mapping: BASC "own data" screens (home, people directory, own attendance...) are not gated at all today (they share APIs with other modules); OTRG, RFBN, JOBP (public pages), ANNC have no API address yet; the company workspaces (Zephyr, Gulati, ...) are not gated for customers (they are not sold). To be settled with the owner.
- 2026-11-12 (d) done, with a BLOCKER found and fixed for the SaaS case: the one-person-in-two-groups tests (`saas-person-in-two-groups`, 10 green) showed that most services READ their tables without filtering by org_id (only writes are stamped in `config/db.js`), so once customers share the database a customer would see our accounts and we would see theirs. Fix: `config/tenantGuard.js`, one Prisma middleware installed at the end of db.js. While no company is a SaaS customer (saas_customers empty, today) it does nothing and queries pass untouched (tested); once a company is a customer, a request made inside it only sees its own rows (models with an org_id column), and requests from every other company stop seeing customer rows. A query that names org_id itself is left alone; OrgMembership is never filtered (company switcher/sign-in). Limits: nested includes are not rewritten, raw SQL is not covered, findUnique without org_id in the selection cannot be judged, background jobs see everything as today. The cache is cleared when a workspace is provisioned. This means customers can safely use the recruitment-layer modules (CLVN/RQLD/CLHR/...) only because of this guard: still to be proven module by module in the tenant isolation audit.
- Checks done (login, reset, invite, switch): a chosen workspace gives that workspace only (`org_slug`); each workspace shows only its own records both ways and an id from the other is 404 / not changed; switch-org and refresh stay in the chosen company; a group super admin of our group cannot enter a customer company and sign-in adds no membership there; the password belongs to the person (a change applies in both workspaces); creating a user with an existing email is refused with a message that names no company (note: email addresses are unique across the whole platform, so one email = one login, and a customer cannot add someone who already has a login elsewhere); calendar invites reach only people of the same company; provisioning refuses an email that already has a login (decision for the owner: attach existing people to customer workspaces only after a consent step). There is no forgot-password flow in the product today, only change-password.
