# Superadmin record deletion (soft-delete)

**Status:** Built (2026-09-08) — branch `feature/superadmin-record-deletion`. Migration
applied to local dev + test DBs; server suite 33/238 green. Staging/prod
`migrate deploy` + manual click-through still pending (rollout checklist).

## Goal

Give a superadmin a guarded, audited, reversible way to remove duplicate / mistaken
records — accounts (client/vendor), requirements, submissions, profiles, interview
rounds — from the application without hand-writing SQL against production. The
trigger was vendor `ACC-F637AC68` "Spiral TechnoLabs Pvt. Ltd." being entered twice
and only parkable in a terminal `dropped` + `Locked` state.

## Decisions

- **Soft-delete, not hard delete.** A "delete" only stamps `deleted_at` /
  `deleted_by` / `delete_reason`; the row is retained and can be restored. Avoids
  FK cascades (`Requirement.account` is `Restrict`; `Profile.vendor_account` is
  `SetNull`) and keeps recovery a one-field `UPDATE`.
- **One global filter, not ~150 edited call sites.** The codebase has zero raw SQL,
  so a single `prisma.$use` middleware hides stamped rows from every read.
- **Strict check = the superadmin re-enters their own login password** (bcrypt-verified
  server-side) plus a mandatory free-text reason. No new shared secret.
- **Audit trail.** Every delete and restore writes an `audit_logs` row with a full
  JSON snapshot of the row at that moment.
- **Dependency counts inform, never block.** The delete response reports live
  dependents (e.g. an account's requirements); since the action is reversible there
  is no hard stop and no cascade.

## Data model (`server/prisma/schema.prisma`)

Added to `Account`, `Requirement`, `Submission`, `Profile`, `InterviewRound`:

| column | type | notes |
|---|---|---|
| `deleted_at` | `DateTime?` | null = live. Indexed. |
| `deleted_by` | `String? @db.Uuid` | user id; no FK back-relation (kept plain) |
| `delete_reason` | `String?` | required at the API layer |

New model `AuditLog` → table `audit_logs`:

`id`, `actor_id` (uuid), `action` (`'soft_delete'` \| `'restore'`), `entity_type`,
`entity_id` (uuid), `reason`, `snapshot` (`Json`), `created_at`. Indexed on
`(entity_type, entity_id)` and `actor_id`.

Migration: `server/prisma/migrations/20260908120000_soft_delete_and_audit/migration.sql`
— additive only, `ADD COLUMN / CREATE INDEX / CREATE TABLE ... IF NOT EXISTS`.

## The global soft-delete filter (`server/src/config/db.js`)

`prisma.$use` middleware:

- Models: `Account`, `Requirement`, `Submission`, `Profile`, `InterviewRound`.
- `findMany` / `findFirst` / `count` / `aggregate` / `groupBy` → inject
  `deleted_at: null` into `where` unless the caller already referenced `deleted_at`
  (recursively checks `AND` / `OR` / `NOT`).
- `findUnique` / `findUniqueOrThrow` → rewritten to `findFirst` / `findFirstOrThrow`
  (a unique filter can't also carry `deleted_at`), then the same injection.
- Writes (`update`, `updateMany`, `delete`, `create`) are untouched — the admin
  service reads and flips deleted rows by passing an explicit `deleted_at` clause.

**Limitation:** `$use` does not rewrite nested relation reads, so a soft-deleted
parent can still appear via an existing child's `include: { account: true }`.
Accepted — deleted records are duplicates / terminal and the top-level lists,
boards, dashboard and reports (all top-level queries) are filtered.

## Backend API — `server/src/modules/admin/`

All three routes are `authorizeSuperadmin` (re-reads `is_superadmin` from the DB
each call). Mounted under `/api/v1/admin`.

| Method + path | Body | Behaviour |
|---|---|---|
| `POST /admin/:entity_type/:entity_id/delete` | `{ password, reason }` | bcrypt-check the caller's own password → 401 `bad_password` on mismatch. Load the live row (404 `not_found` / 409 `already_deleted`). Compute `dependencyCounts`. Transaction: stamp the 3 columns + write an `audit_logs` `soft_delete` row with the pre-image snapshot. Returns `{ entity_type, entity_id, deleted_by, reason, dependency }`. |
| `POST /admin/:entity_type/:entity_id/restore` | `{ reason }` | 409 `not_deleted` if the row isn't currently deleted. Transaction: null the 3 columns + `audit_logs` `restore` row. |
| `GET /admin/deleted?entity_type=` | — | Lists stamped rows (id, name/title, `deleted_at`, `deleted_by` + `deleted_by_name`, `delete_reason`), newest first, for the recovery page. |
| `GET /admin/audit?entity_type=&limit=` | — | Full delete + restore trail from `audit_logs` (action, entity, snapshot name, reason, `actor_name`, `created_at`). |

`entity_type` ∈ `account` \| `requirement` \| `submission` \| `profile` \|
`interview_round` (422 otherwise). `reason` 1–500 chars.

## Frontend

- `client/src/lib/permissions.js` — new superadmin-only cap `deleteRecords`.
- `client/src/components/DeleteRecordButton.jsx` — self-contained button + `Modal`
  with a `PasswordInput` and a reason `textarea`; Delete disabled until both are
  filled. On success: toast (mentions any dependents) + `onDeleted()` callback.
  401 keeps the modal open.
- Wired (superadmin only) into `AccountDetailPage`, `SubmissionDetailPage`,
  `ProfileDetailPage`, `RequirementDetailPage` (header actions, navigates to the
  list on success) and per-round in `InterviewRoundsPanel` (reloads).
- **`client/src/components/admin/DeletedRecordsPanel.jsx`** rendered in the
  **Settings → Deleted records** tab (tab shown only when `userCan(user,
  'deleteRecords')`) — a "Currently deleted" table (Restore action, reason modal)
  + the full delete/restore audit trail.
- Deletions and restores are merged into the dashboard **Recent activity** panel
  (`dashboard.service.recentActivity` now unions `stage_history` + `audit_logs`,
  sorted, top 10; department-scoped dashboards skip audit rows).

## Test plan — `server/tests/admin-soft-delete.test.js`

Happy path + audit row/snapshot; wrong password 401 + row intact; non-superadmin
admin 403; reason required 422; double-delete 409; restore + restore-on-live 409;
delete response dependency counts; soft-deleted submission drops out of
`GET /submissions`; unknown entity_type 422; `GET /admin/deleted` + `/admin/audit`
content and superadmin-gating; a deletion appears in `GET /dashboard/summary`
`recent_activity`. 12 cases. `helpers.cleanDatabase` TRUNCATE list extended with
`audit_logs`.

Related: `server/tests/users-directory.test.js` covers `GET /users/directory`
(the roster endpoint the filter/owner pickers moved to so they work for every
role) — see PROGRESS.md 2026-09-08.

## Rollout checklist

- [x] Migration applied to local dev + test DBs.
- [x] `admin-soft-delete` 9/9; full server suite 33/238, no regressions.
- [ ] Manual superadmin pass on Spiral TechnoLabs (`ACC-F637AC68`): delete → gone
      from `/accounts`, `/dashboard`, `/reports`; `GET /admin/deleted` lists it;
      restore returns it everywhere; `audit_logs` has both rows.
- [ ] `cd client && npm run build && npx eslint src` clean.
- [ ] Merge to `staging`; hand the human `npx prisma migrate deploy` for
      staging/prod (agents never advance `main`).

## Future extensions

- Filter nested-include reads (Prisma client extension) if a deleted parent
  surfacing through a child becomes a real problem.
- Widen `audit_logs` to record other privileged mutations (stage overrides, user
  edits) so there's one trail.
- Auto-purge `audit_logs` / hard-delete rows older than N months once storage matters.
