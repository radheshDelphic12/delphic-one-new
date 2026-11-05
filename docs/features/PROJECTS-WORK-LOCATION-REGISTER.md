# Projects survive a sales drop, work location away from base, attendance register totals

Built locally (not pushed). Three parts, each its own commit.

## A. A sales drop never removes a project from billing
- A project is on or off by its own `contract_status` and agreement dates only. `projectListWhere` (server/src/lib/projectScope.js) no longer requires the client's `stage = 'active'`, so Projects, billing, P&L, timesheets, calendars, attendance, group invoices, PM linking and `endingSoon` keep the project after a drop.
- `GET /accounts/:id` returns `live_projects` (the client row when it is also the project, plus its non-completed project rows). The stage drawer (AccountStageMoveDrawer) fetches it and warns before a drop; the drop still goes ahead.
- Sales counts (`is_project: false, stage: 'active'`) are unchanged.
- After deploy (finance, in the app): review the hidden projects in the Projects edit form, mark the ended ones Completed or set an end date, run and lock October billing for the ones that stay, recheck Ugap's September calculation (change_detected). No SQL on prod.

## B. Work location away from the base office (project site or travel)
- Tables `work_sites` (client / other sites, separate from `locations`) and `work_location_assignments` (dated, one place: another office or a site; purpose project / travel / other; optional project). `location_checkins` gets `work_site_id` and `assignment_id`. Migration `20261119100000_work_locations` is additive. Both models are in `changeCapture` TRACKED.
- `workLocation.service.js`: `placeOn(orgId, member, date)` returns the assignment's place (site fence from `work_sites`, office fence from `office_geofences`) or falls back to the base office. Check-in and check-out use it; a day inside an assignment defaults to planned place office (not home). Overlapping active assignments for a person are refused.
- Routes (`/attendance-dashboard`): `GET /work-locations/:membershipId`, `POST /work-locations`, `POST /work-locations/:id/cancel` (cancel, or `end_from` to end early), `GET|POST|PATCH /work-sites`. Writes are admin (rule `hr_settings.update`).
- Register and calendar days carry `away: { place_name, city, purpose, project_name, kind }`. The `location_id` filter still means base office.
- UI: Attendance dashboard > person > "Working away" (list + add + cancel); Location check-in > Settings > Work sites; register shows an amber corner marker, a tooltip ("Pune – Client site (project)") and a legend entry; the check-in card shows what the day is measured against.
- Group Deployments: on an approved / running deployment, "Put people on the client site" (`POST /super-dashboard/group/deployments/:id/work-locations`) gives every active person who works at the client office a work site (named after the client; set its map point under Location check-in > Work sites) and a dated assignment over their own dates (else the deployment's), with `deployment_person_id` set. Repeating it is safe; people without an employee record, not at the client office, or with clashing dates are listed as skipped.
- Permission `attendance_dashboard.work_location` (Settings > Permissions): lets a manager's role set and cancel work locations for direct reports only; admin and HR (`hr_settings.update`) can do it for anyone. Work sites stay admin / HR.

## C. Attendance register: real leave types and correct totals
- The day editor (`POST /attendance/day`) already creates real approved leave per type. Added: `cancel_leave` (a day with approved leave can be set to present / absent / ... after withdrawing that leave) and `confirm_span` (a several-day leave is withdrawn whole after a confirm that names its dates; the other days are put back with the same type).
- `register()` totals gain `office`, `worked` and `leave_by_code` (CL, SL, CO, UL, L = type not set). `present` keeps its meaning (all worked days), so the monthly review is unchanged.
- Register table and CSV: Present (office) / WFH / Total worked / one column per leave code in use / Holidays / (Weekly offs in CSV) / Absent. Old generic leave rows show as "L" with the label "Leave (type not set)".
- Register days also carry `leave_request_id`, `half_day_session`, `unspecified_leave`.

## Verification state
Lint is clean and the changed files parse. The Jest suites could not be run on this machine (the local Postgres login failed), so new tests are written but unrun: `projects-vs-accounts.test.js` (A), `work-locations.test.js` (B), `attendance-day-editor.test.js` (C). Run `npx prisma generate` and `prisma migrate deploy` against a test database first; Part B changes the schema, so run the full suite.
