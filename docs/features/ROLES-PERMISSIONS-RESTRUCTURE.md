# Roles & permissions restructure

Built locally 2026-10-22 on branch `super_admin_branch` (uncommitted). Source: "Delphic One - Roles & Permissions Restructure (Design Proposal)", Ayush Tiwari, 2026-10-22.

**Nothing changes on deploy.** Every company starts in `orgs.access_mode = 'legacy'` (exactly the old behaviour). A company moves to `'permissions'` only when the Super Admin approves and applies the migration for it (Settings > Permissions > Migration). The migration is additive (no `DROP`), one migration file: `20261022120000_access_model`.

## The model

| Level | Who | How it is stored |
|---|---|---|
| Super Admin | one account, the Gulati Industries group ID | `users.is_group_superadmin` |
| Admin | one account per company (Paras's company ID) | `users.is_superadmin` + admin role on that company's membership |
| Employee | everyone else | no flag; access = default basic access + permission set + own grants - own removals |

`lib/access/effective.js` (`levelOf`, `effectivePermissions`) is the whole calculation. The Role field stops being access: in a company on permissions a new user is created as `employee`, and `role` / `is_superadmin` cannot be edited through `PATCH /users/:id` (409 `managed_by_permissions`).

**Permission** = `module.action` + scope (own / team / all), catalogue in `server/src/lib/permissions.js` (`CATALOG`, six categories, `BASIC_ITEMS`). **Permission set** = a named bundle (the existing `custom_roles` table, now shown as "Permission set"; the "plain role it builds on" is gone from the UI, it is derived). **Grant / removal** = `permission_grants` (`effect` grant or deny; a deny takes a default basic item or a set item away from one person).

Super Admin grants anything to anyone in the company they have open. Admin: own company only, never the Super Admin or another Admin. Employee: never, even holding every permission (`/access/people*` and `/roles*` re-read the flags from the database).

## Enforcement (phase 1)

- **One central check.** `middleware/auth.js` `authenticate` calls `lib/access/guard.js` `check()` for every request of a person in a company on permissions. The route table is `lib/access/routeRules.js` (first match wins; `open` / `admin` / `basic.x` / `module.action` / any-of; method-split rules). **A route nobody listed needs the Admin**, and `tests/access-model.test.js` fails if any registered route has no rule: add the rule when you add a route.
- **Live.** Level, set, grants and removals are read on every request; an Admin's change reaches an open session on its next call (and the app re-reads `/users/me` on focus and every 5 minutes).
- **Older gates keep working.** `authorize('admin')` etc. still run after the central check. The plain role they see is derived (`deriveLegacyRole`), and `custom_permissions` carries the aliases the old `can('financials.view')` checks read (`legacyPermissions`: any of finance / payroll / billing / analytics / financials implies `financials.<verb>`).
- **Per-request admin role.** A service that shows everyone's records to an admin and only yours to anyone else must not treat an HR lead as an admin in Payroll. `roleForRequest` gives `req.user.role = 'admin'` only for the module the request belongs to, and only if the person holds that module at scope **all**; holding People does not open Payroll, and a team-scoped holder is treated as a manager. (Example: HR Lead opening `/payroll/payslips/:id` sees only their own.)
- **Fields.** Without `people.view`, `GET /orgs/memberships` and `/orgs/memberships/:id` return the directory fields only (name, designation, department, office, work email, manager); `vendor_rate`, role, phone, notice/bench dates, POCs and shift are removed from the response (`lib/access/fields.js`). A person's own record is whole. `/orgs/memberships/:id/details` (bank, identity numbers) needs `people.view`; the person's own details stay open.
- **Super Admin protection.** `PATCH /users/:id`, `PATCH/DELETE /orgs/memberships/:id` refuse to touch the Super Admin unless the caller is the Super Admin.
- **Audit.** `PermissionGrant` and `CustomRole` are tracked by `config/changeCapture.js` (entity types `permission_grant`, `permission_set`): who, when, old and new values. The permission editor writes one row per grant.

## Default basic access (phase 2)

`BASIC_ITEMS`: home, offices, published policies, internal jobs, people directory (basic fields), org chart, calendar, own attendance + regularization requests, own leave, own timesheet, own payslips, **own expense claims (added by us, see open questions)**, own account settings. Automatic for everyone including new joiners (they are created as `employee`). Sensitive fields are never part of it.

## Permission editor (phase 3)

Settings > **Permissions** (Super Admin and Admin only; `client/src/components/admin/PermissionsPanel.jsx`, `PermissionGrid.jsx`): People tab (per-person set, default basic access with removals, categories grid with Own/Team/Everyone, **Review changes before Save**), Permission sets tab, Migration tab (Super Admin). API: `GET /access/catalog`, `GET /access/me`, `GET /access/people`, `GET|PUT /access/people/:id`, `POST /access/people/:id/preview`.

## Menu and page visibility (phase 4)

`client/src/lib/access.js` + `userCan()` in `lib/permissions.js`: in a company on permissions, every capability check (menu, routes, buttons) answers from `user.access` (from `/users/me`), via `CAPABILITY_NEEDS`. Sidebar items carry a `need`; hub tabs (People, Time & Attendance, Finance, Payroll) show only with View on that tab; opening a page by URL without permission shows `NoAccess` ("You don't have access to this page" + a link to the dashboard). The Group Dashboard and workspace switcher are Super Admin only. Admin-looking controls on pages go through `adminFor(user, need)`; the client `user.role` for an employee is never `admin` (`uiRole`).

## Migration (phase 5)

Settings > Permissions > Migration (Super Admin), per company, starting with Delphic Global:

1. **Backup**: `POST /access/migration/backup` stores everyone's roles, custom roles, flags and grants (`access_backups`). Required (less than 24 h old) before apply.
2. **Preview**: `GET /access/migration/preview` writes nothing. Per person: today -> proposed (level + set), a diff of permissions lost / narrowed / gained, flags `access_down`, `access_up`, `was_admin`. `plan_hash` pins the proposal.
   - group account -> Super Admin; the one `Paras Gulati` company account -> Admin (or the owner chooses; a company with no Admin account is shown as such, create it in People > Users first);
   - named people (by employee code, as before): Diksha Yadav E0001 -> **HR Lead**, Biswajit Dey E0034 -> **Sales Team** (curated sets in `migration.service.js`, suggestions to edit), the rest of the named list -> their starter set;
   - a custom role -> a set of the same name with the same ticks **plus what its base role used to give** (`legacyMap.materializeSet`; gated actions stay exactly as ticked);
   - plain roles -> `Legacy Admin / Sales / Recruiter / BDA` sets that equal what the role could do (`ROLE_EQUIVALENT`); plain employees -> basic access only.
3. **Approve and apply**: `POST /access/migration/apply` with the chosen Admin and the (possibly edited) set per person. One transaction: sets written, memberships assigned, old values kept in `legacy_role`, `legacy_custom_role_id`, `legacy_was_superadmin`, `legacy_locked_until` (30 days), the `is_superadmin` flag cleared for everyone but the Admin, `access_mode = 'permissions'`.
4. **Restore** (inside the 30 days): `POST /access/migration/restore` puts roles, custom roles and flags back from the backup and returns the company to `legacy`.
5. **Clean-up** (after 30 days): `POST /access/migration/cleanup` ends the restore window and sets the stored role of anyone who is not the Admin to their derived role.

## Clean-up (phase 6)

What is done: roles/flags are read-only in a company on permissions from the moment it moves; the starter sets "Admin" and "Super Admin" are retired when unused; the clean-up step above. What is **not** removed: the `base_role` column and the `role` columns (they feed the older gates, see limits), the old "Roles & permissions" tab (still used by companies on the old model), the old `mapping-preview` / `mapping-apply` endpoints (superseded by Migration). Dropping any column is a separate expand/contract release (HARD RULE in AGENTS.md).

## Decisions taken for the open questions (change them if Paras answers differently)

| Question | What is built |
|---|---|
| Admin grants only inside their own company? | Yes. No cross-company reporting-line grants. |
| Field-level control? | No per-field editor. Module + action + scope, plus a fixed rule: without `people.view` only directory fields are returned. |
| Default basic access same in all companies? | Yes, one global list (`BASIC_ITEMS`); per-person removal exists, a per-company default is not built. |
| Employees granting? | Never. |
| Is the default list right? | We added **own expense claims** (employees file claims today; without it they would lose the screen). Remove it from `BASIC_ITEMS` if Paras disagrees. |
| Diksha and Biswajit? | Their current working access as the HR Lead / Sales Team sets, shown in the preview with every lost permission listed (Finance, Payroll, Live Analytics, Financials go). |
| Modules only the Super Admin sees? | The Administration category (settings, deleted records, logs) is admin-default; Group Dashboard / company switcher / Offices overview are Super Admin only. Financials, Projections and Valuation are ordinary grantable permissions (`financials.*`). |

## Known limits (honest list)

- **Scope is checked centrally only as "holds the action at any scope".** Own / team / all is applied where the service already did it (requirements, profiles, submissions via `canOn`; timesheet / OT / expense approvals by manager; attendance dashboard; payslips) and by `roleForRequest`; there is no generic row filter. Where a service has no scope logic, a team-scoped holder gets the same list as before for that endpoint.
- **Older role-based checks remain** inside ~70 services (`user.role === 'admin'`). They are neutralised per request by `roleForRequest`, but a module that is not in `modulesOf` / `OPEN_MODULES` falls back to non-admin for an employee. Converting those checks to permission checks is the follow-up that lets `base_role` and the role columns go.
- **Not covered:** the company workspaces (Zephyr, Gulati Industries, Acconcy, Foundation, Zklyrera, Valterra, Novarex) keep their own role system; contractors stay on the contractor portal.
- Trading, contracts and own projects are one new module `business` (the proposal does not name them). Leads follow `accounts`.
- Creating a missing company Admin account is not automated (it needs an email and password): the Migration tab shows the gap.
- UI was built and linted (client build passes) but **not click-tested in a browser**; the API and the migration are covered by `server/tests/access-model.test.js`.

## Tests

`cd server && npx jest --runInBand tests/access-model.test.js` (24 tests: levels, effective permissions, derived role, route coverage, enforcement for basic / set / grant / removal / legacy company, field stripping, Super Admin protection, grant authority, change log, migration preview/apply/restore/clean-up). Use a private DB (`TEST_DATABASE_URL`): `cleanDatabase` truncates.
