# Attendance Dashboard, Project Calendar, optional Book Keeping links (2026-10-16)

Branch `super_admin_branch`, built locally, not committed or pushed. Two migrations, both additive.

## 1. Time & Attendance: two new tabs (existing tabs untouched)

Both tabs sit in the Time & Attendance hub next to the old ones. The old "Timesheet Dashboard" is unchanged.

**Attendance Dashboard** (`client/src/pages/time/AttendanceDashboard.jsx`, API `/api/v1/attendance-dashboard`, `server/src/modules/attendanceDashboard/`)
- Attendance only (no project hours) for every IT and non-IT employee; contractors and vendor resources are left out.
- Month + year + prev/next, employee dropdown and an "All employees" table, so you never go back to a list to switch.
- Per day: status (leave shows its type), reporting office, work type (onsite / remote), and office / home.
- Right panel: day details, apply for WFH / WFO, leave balance for the month (start, applied, end).
- Visibility: admin everyone, manager their direct reports, employee themselves.
- **Reporting office with history:** table `employee_office_assignments` (membership, location, `effective_from`). The office on a day is the latest row on or before it, else the membership's `location_id`. Admin sets it with "from" date (`POST /offices`).
- **Office / home per day:** table `work_place_days`. No row = default (onsite -> office, remote -> home, attendance row `wfh` -> home). A change away from the default is a request: an employee's goes `pending` and the manager or an admin approves (`POST /place/:id/decide`); an admin applying is approved at once. Only an approved row changes the day; a pending / rejected one is shown beside the default. Remote employees cannot ask for office (422). Asking for the default again removes the row.
- Payroll is not affected: `wfh` already counted as present, and this does not touch `attendance_records`.

**Project Calendar** (`ProjectCalendarDashboard.jsx`, `/attendance-dashboard/projects`, `/projects/:id/calendar`)
- Project list is the Finance > Projects list (same source as Project Team: admin all, others the projects they are assigned to).
- Month calendar per project: hours, tasks (module name) and notes per person, who was on approved leave, holidays of the project's calendar. Click a day for the detail.

Tests: `server/tests/attendance-dashboard.test.js` (4).

## 2. Group Book Keeping: legal entity, bank account and wallet are independent (migration `20261018100000_group_cash_optional_links`)

- `bank_accounts.legal_entity_id` and `wallets.bank_account_id` are now nullable; both tables carry `org_group_id` (scoping no longer goes through the entity / account). Wallets carry their own `currency` (a mapped wallet must match its account). A wallet may have no owner (`wallets_one_owner_check` is now "at most one").
- A bank account no longer gets an "Unallocated" wallet on creation. Existing ones keep theirs.
- **Manual mapping:** Setup > Wallets has a "Bank account" selector per wallet (`PATCH /wallets/:id {bank_account_id}`; null un-maps). The mapping can change any time; entries never move, only where the wallet is counted. Bank account balance = sum of its mapped wallets; wallets with no account are listed apart as "Wallets not mapped" (not part of any bank balance) and still appear in the Fund view.
- **Bank statement:** `GET /accounts/:id/entries` (json / csv / pdf) = every live entry of the wallets mapped to it, date-wise, with the account's running balance. Bank view has a "Statement" link per account.
- **Delete:** entities, accounts, wallets can now be deleted (audited): an entity only with no accounts / wallets / invoices, an account only with no wallet mapped (its reconciliations go with it), a wallet only with no entries / transfers / invoices. Otherwise the API says to switch it off.
- Edits: bank account edit gains the legal entity selector; wallet edit gains "No owner".
- Invoices: the receiving wallet must be in the group and not tied to another legal entity (by its account or as owner); its currency is the wallet's.
- Tests: `group-cash*.test.js` (41, incl. mapping + statement + delete).

## 3. Job openings on the website

Delphic One side was already done (server-rendered pages under `/delphic/career/`, see [CAREERS-PUBLIC-LINK.md](CAREERS-PUBLIC-LINK.md) section 6 and [guides/CAREER-PAGE-REWRITE.md](../guides/CAREER-PAGE-REWRITE.md)). What is left lives on the website (delphic.in), outside this repo: the `/career` rewrite, then `PUBLIC_CAREERS_BASE=https://delphic.in/career` on the server. Nothing was changed in production env.

## Decisions taken without an answer (change if wrong)
- Leave balance "start" = remaining at the end of the day before the month; "applied" = approved taken in the month, pending shown as `+n pending`.
- Remote employees need no WFH approval; an admin's own choice is auto-approved.
- A wallet belongs to at most one bank account at a time; mapping changes re-attribute history (no effective dates).
