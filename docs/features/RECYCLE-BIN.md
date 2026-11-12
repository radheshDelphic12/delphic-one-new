# Recycle bin (soft delete everywhere)

Built 2026-11-06, local only. Migration `20261120120000_recycle_bin` (table `deleted_records`).

**Rule:** a delete a person makes in the app is never final. `server/src/config/recycleBin.js` (a Prisma middleware next to the change log) copies the whole row into `deleted_records` (who, why, when) and then deletes it as before. No query, report or calculation changes, because the live table simply no longer holds the row.

- **Covered:** every `delete` / `deleteMany` made inside a user request, for any model not in `SKIP`. Models that already soft delete (`deleted_at`: accounts, requirements, submissions, profiles, rounds, applicants, memberships, expense claims, client invoices) keep their own restore in Settings > Deleted records.
- **Not covered (on purpose):** seeds, scripts and background jobs; derived or replace-the-list rows (`SKIP`: daily revenue, permission grants, attendee / interviewer lists, counters, lock toggles ...); rows the database removes by cascade (restoring a parent brings back the parent only).
- **Reason:** taken from `req.body.reason` when the request has one (`middleware/auth.js` puts it in the request context).
- **Restore:** Settings > Deleted records > Recycle bin (superadmin; permissions `deleted_records.view` / `.restore`). `POST /admin/recycle-bin/:id/restore` re-creates the row with its old id. Refused with a clear message when the id / a unique value exists again (409) or the parent record is gone (409). A restored timesheet entry rebuilds that day's revenue and overtime.
- **Kill switch:** `RECYCLE_BIN=off` disables the archiving.
- **Test:** `server/tests/recycle-bin.test.js`.
