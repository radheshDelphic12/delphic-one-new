# Contractor check-in / check-out (Delphic Global)

Shipped 2026-11-03 (commit f8da951; on `super_admin_branch`, `staging` and `main`). One additive migration: `20261115100000_contractor_checkin`.

A plain in / out clock for contractors in the master workspace (Delphic Global). It is **separate from the Workplace (location) check-in**:
no location, no selfie, no late rule, and it never feeds attendance, payroll, leave or the project timesheet.

## What it does
- A contractor (`org_memberships.worker_type = 'contractor'`, status active / notice period) sees a **"Check in / out"** card at the top of the
  contractor portal. Check in and check out ask for a confirmation. After a check-out they can **check in again**: a day holds several
  in / out pairs. An open pair (no out time) means "at work now".
- The card shows today's pairs and the time at work (closed pairs only), and the last 14 days.
- HR / admins read the report under **Time & Attendance -> Contractor Check-in**: one row per contractor per day with vendor, first in,
  last out, time at work and every pair. Filters: date range (max 93 days), contractor. CSV download.
- An admin can **edit** a pair (in / out time; clearing the out time re-opens it) or **remove** it. A reason (3+ characters) is mandatory and
  every change is written to `audit_logs` (`entity_type = contractor_checkin`, actions `edit_session` / `delete_session`).

## Rules
- Contractors only. A full-time employee gets 403 (`not_eligible`); `today` answers `eligible: false`.
- Delphic Global only (`requireMasterWorkspace`); another workspace gets 403.
- One open pair at a time (409 `already_checked_in`); check-out needs an open pair of today (409 `not_checked_in`).
- A pair left open overnight stays open (the report shows "at work"); an admin closes it with the edit action. It is not carried into the next day.
- Edit rules: the in time must stay on the pair's own IST day, out after in, no overlap with another pair of the same day.

## API (`/api/v1/contractor-checkin`)
| Route | Who |
|---|---|
| `GET /today`, `POST /check-in`, `POST /check-out`, `GET /mine?from&to` | the contractor (open route, contractor scope allows them) |
| `GET /people`, `GET /report?from&to&org_membership_id`, `GET /report.csv` | `location_checkin.view` (admin by default) |
| `PATCH /sessions/:id`, `DELETE /sessions/:id` (body `reason`) | `hr_settings.update` (admin by default) |

Access rules live in `server/src/lib/access/routeRules.js` and the module key in `guard.js` (`location_checkin`, shared with the location check-in
report); the contractor allow-list is `server/src/middleware/contractorScope.js`.

## Where things are
| Part | Path |
|---|---|
| Table | `contractor_checkins` (model `ContractorCheckin`; no FKs; columns: org_id, org_membership_id, date, in_at, out_at, edited_by, edited_at) |
| Module | `server/src/modules/contractorCheckin/` (routes, service, validation) |
| Client | `client/src/pages/time/ContractorCheckinTab.jsx` (`ContractorCheckinPortalCard`, report tab); tab wired in `TimeAttendanceHubPage.jsx`; card in `pages/contractor/ContractorPortalPage.jsx` |
| Tests | `server/tests/contractor-checkin.test.js` (5) |

## Notes
- The old Workplace check-in still has the "full-time only" setting; if an admin turns it off, contractors can still reach the location API
  directly (backend unchanged). Only the portal card was swapped to the new clock.
- Not configurable (no settings table): nothing to set per company.
- Staging Playwright 2026-11-03: 21 / 21 (contractor portal in / out / in again, 403s, admin tab, CSV, edit + delete with reason, cleanup).
  Script: session scratchpad `pw/contractor-staging.js` (dummy "ZZ PW CC" users, ended + deactivated afterwards).
