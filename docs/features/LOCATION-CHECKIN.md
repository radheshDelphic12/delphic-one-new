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
`server/tests/location-checkin.test.js` (14 tests); `access-model.test.js` still green after the route-rule and catalog additions.

## Not built / open
- Not browser-checked (camera and GPS need HTTPS or localhost).
- Employees who never check in are not listed (the report shows check-ins only).
- Late is measured in the org timezone; no per-day override.
- Other companies are not included.
