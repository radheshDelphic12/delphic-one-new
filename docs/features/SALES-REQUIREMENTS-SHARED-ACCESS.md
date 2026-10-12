# Sales requirements shared access + activity tagging

Status: committed locally on `super_admin_branch` (2026-10-12), not pushed.

## What changed
- **Requirements scope**: Sales users see all requirements by default (commit 0445fb1).
- **Shared Sales rule** (076f6c4): the whole Sales team can edit, assign, add seats and delete any requirement. The old owner-only rule is gone; `server/tests/requirements-sales-scope.test.js` and `backend-gaps.test.js` (e14ecf4, fixes CI shard 3) reflect the new rule.
- **Activity log tags who did what** on requirements (076f6c4) and on leads/accounts (f7e2fcc: `accounts.service.js`, `GET` activity route, `AccountDetailPage.jsx`, `accounts-activity.test.js`).
- **Empty-field fix** (9a4493e): saving untouched empty fields is not recorded as a change (requirements + accounts services).
- **Zephyr valuation** (0445fb1): owned properties are included automatically (`zephyr/money.service.js`, group finance tab).

## Tests
`cd server && npx jest --runInBand tests/requirements-sales-scope.test.js tests/accounts-activity.test.js tests/backend-gaps.test.js`

## Open
- Not pushed; branch `super_admin_branch` merged with origin/main at 4ae4403.
