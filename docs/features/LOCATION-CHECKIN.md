# Location Check-in & Late Reporting

Delphic Global only (master workspace), full-time employees only. Built 2026-11-02, local and uncommitted.

A **separate** record of where each person checked in and out and how late they were. It never marks anyone present and is never read by attendance, payroll, leave or timesheets. The only things it reads are the work arrangement (`work_place_days`, `work_mode`, an attendance row marked `wfh`), the office assignment and the shift.

## Rules (from Paras, 2026-10-29) - all three are admin-editable (Time & Attendance > Location Check-in > Settings)
- **Selfie:** Required / Optional / Off (default Required). Required: no check-in without one. Optional: the employee chooses. Off: never kept.
- **Late time per shift:** by default shift start + the shift's grace (same rule attendance uses for late_minutes). An admin can set a different late time for any shift here; that never changes the shift or attendance. No shift: the company default (10:00).
- **Who:** full-time employees only by default. Untick "Full-time employees only" and contractors can check in too (their portal shows the check-in card).
- Delphic Global only. One check-in and one check-out per person per day.
- A person whose day is **work from home** (approved office/home choice, remote work mode, or a day recorded as `wfh`) can check in from anywhere and is never flagged. Their result is `work_from_home`; the distance and coordinates are still stored.
- A pending or rejected office/home request does not change the day.

## Data (4 new tables, migration `20261102100000_location_checkin`, no foreign keys, existing models untouched)
- `office_geofences`: latitude, longitude, radius (default 150 m) per office (`Location`).
- `location_checkin_settings`: `selfie_mode`, `full_time_only`, `default_cutoff_minutes`.
- `location_checkin_shift_rules`: an admin-set late time for a shift (no row = shift start + grace).
- `location_checkins`: one row per person per day. Stores the planned place (office/home), the result (`in_office`, `outside_office`, `work_from_home`, `location_unavailable`), distance, accuracy, `at_office`, lateness, selfie file name and the check-out equivalents. Planned place and result are stored as they were that day.

## API (`/api/v1/location-checkin`, master workspace only)
| Route | Who |
| --- | --- |
| `GET /today`, `POST /check-in` (multipart: latitude, longitude, accuracy_m, selfie), `POST /check-out`, `GET /mine` | the employee |
| `GET /report`, `GET /report.csv`, `GET /people`, `GET /offices` | `location_checkin.view` (admin by default) |
| `GET /records/:id/selfie` | its owner, or a report reader |
| `GET /settings` | any signed-in member |
| `GET /shifts` | `location_checkin.view` |
| `PUT /settings`, `PUT /shifts/:shiftId`, `PUT/DELETE /offices/:locationId` | `hr_settings.update` (admin) |

Distance is worked out on the server (haversine); the device only sends coordinates. Selfies are saved as `lci-*` files in the upload dir and served only through the selfie route.

## Report
Per check-in: planned (office/home), check-in/out time, late minutes, where they checked in from, distance, map link, selfie, and **planned vs actual** (`as_planned`, `office_day_outside`, `home_day_at_office`, no-location cases). Filters: dates, employee, planned place, late only, outside only, not as planned. Summary tiles, a late-by-person table, CSV export. Range up to 93 days.

## UI
Time & Attendance > **Location Check-in** (master workspace only): My check-in (camera selfie + GPS), Report, Settings (selfie Required / Optional / Off, full-time only switch, late time per shift, default late time, office map points with "Use my location"). When contractors are allowed, their My Portal shows the same check-in card.

## Tests
`server/tests/location-checkin.test.js` (20 tests); `access-model.test.js` still green after the route-rule and catalog additions.

## Several check-ins a day, breaks, corrections (2026-10-29, migration `20261104100000_location_checkin_sessions`)
- New table `location_checkin_sessions`: one row per check-in / check-out pair. The day row keeps the first check-in (late is judged on that one only) and the latest check-out. Existing days are copied in as session one by the migration.
- Check-in and check-out ask for confirmation (a dialog). The check-out dialog takes an optional reason (lunch / break / meeting / other). After a check-out the card offers "Check in again" (a mistaken check-out, or back from a break); the selfie rule applies again.
- **Out of desk** = the gaps between one check-out and the next check-in of the day. Shown per day (total, number of breaks, longest) and averaged in the report.
- Admin (`hr_settings.update`): `PATCH /sessions/:id` edits the in / out time (clearing the out time re-opens it) or the break reason; `DELETE /sessions/:id` and `DELETE /records/:id` remove one check-in or the whole day. A reason is mandatory and every change is written to `audit_logs` (entity `location_checkin`). The day row is recomputed (first in, late, last out). Nothing touches attendance.
- Report: each row also shows the **attendance status** (Present / Half day / Absent / Holiday / Work from home, or the approved leave type such as CL / SL), read only from attendance and leave. "Not as planned" now includes an office-day check-in whose location was unavailable (a home day without a location is not flagged). Working days with attendance marked but no check-in are listed ("Working day, no check-in"); a person on leave who still checked in is flagged. New filters: attendance status, no check-in only. CSV gained attendance status, sessions, out of desk, breaks.

## Register: every employee x every day (Workplace Check-in > Register)
- `GET /location-checkin/register?year=&month=` (needs `location_checkin.view`): one row per current employee (contractors have no attendance and are not listed), one cell per day, built on the Attendance Dashboard register so weekly offs, holidays, leave and employment dates follow the same rules. Cell = where the person checked in (O office, WFH home, AW away, ? location unavailable, red ring = late), or what attendance says (leave code, WO, H). **M = missing**: a working day, not a full day of leave, with no check-in. Totals per person: checked in, late, missing, away, no location, average out of desk.
- Two views: **Month grid**, and **One day** (a table of everyone with attendance, planned, first in, last out, late, out of desk, entries, where from, status). Search, "Missing only". Click a cell for that day's entries. Editing and deleting stay in the Report tab.
- The attendance register's day rows gained `day_type` and `in_employment` (additive).

## Check-ins on the Attendance Dashboard register (Time & Attendance > Attendance Dashboard > Register)
- `GET /attendance-dashboard/register` (Delphic Global only; `?checkin=0` leaves it out) now also returns, per day, `checkin` (first in, last out, late, where from, distance, planned vs actual, out of desk, entries), `checkin_state` (`checked_in`, `missing`, `not_yet`, `leave`, `off`, `none`) and `checkin_flags`, plus `checkin_totals` per person and `checkin: { enabled, scope }` on the response. One extra query for the month; no per-cell requests. Built by `locationCheckin.service.attachToRegister`, which shares `compare()`, `dayTotals()` and the stored late values with the report; the Workplace Check-in Register tab uses the same `checkinOverlay`.
- Visibility: people with the Workplace Check-in view permission (and admins) see everyone's check-ins; everyone else only their own row (`scope: own`). Other companies get no check-in data.
- "Not checked in" = a working day (not a holiday, weekly off or a full day of leave) with no check-in. Today only counts once the person's late-after time (their shift rule, else shift start + grace, else the company default) has passed; until then it is "not yet".
- UI: the status code is unchanged; a dot in the cell corner shows where they checked in (green office, blue home, amber no location, red away), a red underline means late, a dashed outline means not checked in. Hover shows In / Out, late, checked in from, distance, planned vs actual, out of desk. Extra totals columns (Checked in, Not checked in), a "Today: N checked in, M not checked in" line, a "Not checked in only" filter and a "Show check-ins" switch. The existing Month / Year / Status / Work type / Office / Employee filters drive it; Export CSV and the Project hours register are unchanged.

## Not built / open
- Contractors are not in the register (they have no attendance). A register CSV export is not built (the Report tab exports records).
- Late is measured in the org timezone; no per-day override.
- Other companies are not included.
