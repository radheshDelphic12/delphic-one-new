# Group Dashboard > Offices

Built 2026-11-02 on `super_admin_branch`. **Local only until pushed** (not on staging / main yet). Read-mostly: **no migration, no new table**
(it uses the existing `locations` and `org_memberships`).

Owner request: on the Group Dashboard add a section that shows, for every company, the count and the employees at each office location, and
let the admin add office locations for all companies from there.

## What it shows (new tab "Offices", after Headcount & Hiring)
- Four tiles: Companies, Office locations, People (matching the filters), With no office set.
- Filters: employee status (default = working now: active + serving notice + on leave), work mode, user type.
- **By office, whole group**: one row per office name, case-insensitive, added up across companies (Indore = Alpha 2 + Beta 1), with a chip per
  company.
- **Company by company**: a card per company (incl. "coming soon" ones) with its offices (name, default flag, city / country, address, people)
  and a "No office set" row for people with no location. Zero counts are plain text.
- **Every count is clickable** and opens a drawer with the employees: name + email, employee code, company, office, designation, department,
  status (+ contractor), work mode. Max 2000 rows.
- **Add / edit / delete an office** from a company card ("Add office" there, or the top button with a company picker). The default office
  moves (never two). A name already used in the same company is refused (409); an office still used by employees, calendars or expense
  claims cannot be deleted (409, says what uses it). The same locations feed Settings > Locations and the company's own Offices page.

## API (`/api/v1/group-offices`, group superadmin only, scoped to the caller's holding group(s); another group's company = 403)
- `GET /` -> `{ totals, by_office[], companies[{ org, locations[], no_office_count, total_people }] }`, optional `status`, `work_mode`, `user_type`.
- `GET /people?org_id&location_id|none&office_name&status&work_mode&user_type` -> `{ total, items[] }`.
- `POST /locations` `{ org_id, name, city?, country?, address?, is_default? }`; `PATCH /:orgId/locations/:id`; `DELETE /:orgId/locations/:id`
  (reuse `orgs.service` createLocation / updateLocation / deleteLocation, so the rules match the per-company screens).
- Route table: `/group-offices` -> `admin` in `lib/access/routeRules.js`; the handlers use `authorizeGroupSuperadmin`.

## Code
- Server: `server/src/modules/groupOffices/groupOffices.service.js`, `groupOffices.routes.js`; mounted in `app.js`.
- Client: `client/src/pages/groupOverview/GroupOfficesTab.jsx`; tab added in `GroupOverviewPage.jsx`.
- Tests: `server/tests/group-offices.test.js` (3: counts + roll-up + group isolation, people lists, add / edit / delete + permissions).
  Playwright against a local API + Vite on an isolated seeded DB (scratchpad `pw/verify-offices.js`, 25 checks incl. counts, drawer, filters,
  add from card and from the top, duplicate refused, edit, in-use delete refused, unused delete) - all pass.

## Notes / not done
- No change-log / audit entry for a location added from here (the per-company screens do not write one either).
- Placing people in an office is still done on the employee profile; a bulk "assign office" is not built.
- Not yet pushed / deployed. Release order when asked: `super_admin_branch` -> `staging` -> `main`.
