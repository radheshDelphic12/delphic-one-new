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

- [ ] 0.1 `scripts/restore-point.sh`: full verified dump, per-table row counts, uploads listing, git tag, settings copy without secrets, written to `backups/restore-points/<name>/`.
- [ ] 0.2 `scripts/restore-org.js` (one-customer restore): restore a dump into a scratch DB, copy one org's rows back; generic over tables with `org_id`; dry-run default; `--apply` needed.
- [ ] 0.3 `scripts/release-tag.sh`: tag `vYYYY.MM.DD-<stage>-N` for the commit that is live, with notes.
- [ ] 0.4 `scripts/branch-diff-report.sh`: what is on dev but not on staging/main, and staging but not main.
- Acceptance: scripts run locally against the dev DB; restore-org dry-run lists tables and row counts; shell syntax checked; a test for the table-ordering/dry-run logic.

## Phase 1 - Catalogue, group kind, platform admin, customer groups

- [ ] 1.1 Migration: `org_groups.kind` (default `owner`; all existing rows stay `owner`). Tag shown in the Group Dashboard company list. Acceptance: existing group tests unchanged and green.
- [ ] 1.2 Platform-admin gate: table `platform_admins` (named list) + `requirePlatformAdmin` middleware, separate from company roles. Acceptance: company admins and group super admins are refused.
- [ ] 1.3 Module catalogue tables: `saas_modules` (code never changes), `saas_module_dependencies` (all-of and any-of), `saas_price_books` + `saas_module_prices` (dated), seeded with the 28 modules + BASC + admin price. Admin-editable through platform-admin routes.
- [ ] 1.4 Platform-admin screen (client): catalogue, dependencies, price books, platform admins.
- [ ] 1.5 Convert lead to customer (Delphic One workspace): creates a customer group (kind `trial`), a clean company, trial row (15 days, 2 users), admin invitation. Flagged by `SAAS_CUSTOMER_PROVISIONING` (off by default). Clean template means no data from our companies.
- [ ] 1.6 Isolation tests: owner-group reports never include customer-group rows, and the reverse; platform routes refuse non-platform admins.
- Acceptance: targeted tests green; existing group/Delphic One tests green; lint clean.

## Phase 2 - Slots, credits, daily counter, entitlement lookup (enforcement OFF)

- [ ] 2.1 Tables: `saas_customers` (links customer org/group to plan, trial dates), `saas_slots` (email, role, transfer date), `saas_slot_credits` (slot, module code, days left), `saas_credit_ledger` (every change, audit).
- [ ] 2.2 Services: add credits, move slot (7-day rule), pause, prerequisites check, run-out dates.
- [ ] 2.3 Daily counter job: remove 1 day from every active credit, never below 0, idempotent per day (a double run changes nothing), alert at 5 days. Registered but only runs when `SAAS_COUNTER_ENABLED` is on.
- [ ] 2.4 Entitlement lookup `entitlementsFor(user)` and a middleware `requireModuleCode(code)` that is a no-op unless `SAAS_ENFORCE_ENTITLEMENTS` is on and the company is a customer/trial company. Our own companies are never subject to it.
- [ ] 2.5 Tests: counter clock cases (missed day, double run, reaching 0), slot move, dependency rules, middleware off = identical behaviour.

## Phase 3 - Trial flow (later)
Website early-access form, Sales creates customer, setup wizard, Excel import, demo company, read-only at the end. Not started.

## Phase 4 - Billing (later)
Billing portal, gateway, webhook, GST invoices, usage credits. Not started.

## Work log

- 2026-11-12 plan written; worktree created from 0d86f4e (super_admin_branch).
