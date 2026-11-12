# Sales requirements shared access + activity tagging

Status: **live on staging and production** (2026-10-12, main `89b69b1`).

## Goal
Every Sales user must see and work on every requirement. Before this, a requirement created by one Sales user (for example Tanvi) was invisible to another (Chahak) and the other way round.

## What changed
- **Requirements scope**: Sales users see all requirements by default (commit 0445fb1). "My requirements" (`?scope=mine`) narrows to their own.
- **Shared Sales rule** (076f6c4): the whole Sales team can edit, assign, add seats and delete any requirement. The old owner-only rule is gone; `server/tests/requirements-sales-scope.test.js` and `backend-gaps.test.js` (e14ecf4, fixes CI shard 3) reflect the new rule. Changing the *sales owner* stays admin-only (`forbidden_owner_change`).
- **Activity log tags who did what** on requirements (076f6c4) and on leads/accounts (f7e2fcc: `accounts.service.js`, `GET` activity route, `AccountDetailPage.jsx`, `accounts-activity.test.js`).
- **Empty-field fix** (9a4493e): saving untouched empty fields is not recorded as a change (requirements + accounts services).
- **Zephyr valuation** (0445fb1): owned properties are included automatically (`zephyr/money.service.js`, group finance tab).
- **Notes and files on any requirement** (ae98979): the requirement side panel loads comments and documents through a separate checker, `server/src/lib/entityAccess.js` (`canAccessRequirement`). It still had the owner-only rule, so Sales saw the requirement but got **"Not permitted"** on the panel. Sales are no longer owner-checked there; recruiters stay limited to requirements they are assigned to.
- **Pipeline shows every requirement** (ae98979): `requirementScopeWhere(user, { sharedSales, mine })` in `server/src/modules/access/requirementScope.js`. The pipeline board passes `sharedSales: true`, so Sales get every requirement by default and `scope=mine` (new optional query field on `GET /pipeline/board`) narrows to their own. The reports explorer keeps its old scope on purpose.

## How a request is checked (read path vs write path)
Read (list): `authenticate` -> `requireMasterWorkspace` -> `controller.list` (recruiter limited to assigned; Sales unscoped unless `scope=mine`) -> `service.list`.
Write (edit, status, assign, seats, delete): the same two middlewares, then `authorize('sales','admin')` on the route, `lockCheck`, Zod validation, and `canMutateRequirement` in the service (admin or any Sales). Comments and documents on a requirement go through `entityAccess.canAccessRequirement`.

## Role note
Chahak's login is `sales` on the real environments, but `bda` in the seed (`team-roster.js`). A `bda` can see requirements but the mutate routes are `sales`/`admin` only.

## Tests
`cd server && npx jest --runInBand tests/requirements-sales-scope.test.js tests/accounts-activity.test.js tests/backend-gaps.test.js tests/pipeline-board.test.js tests/entity-access.test.js`

Use a private test DB (`TEST_DATABASE_URL`); the suites TRUNCATE.

## Verified in the UI (local, Playwright)
Logged in as Chahak (sales): Requirements list showed Tanvi's and Chahak's requirements; opening Tanvi's requirement panel gave no 403; Pipeline Requirement map showed 34 (17 + 17); Jobs "My requirements" sent `scope=mine` and showed only 17.
