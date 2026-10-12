# Reports drill-down (click a count or a row)

Status: **live on staging and production** (2026-10-12, main `89b69b1`).

## Goal
In the Reports page a count (for example "Sourcing: 5" or "Active requirements: 12") used to be just a number. Clicking it, or clicking the row, now opens a right-side panel with the individual records behind that number, each linked to its detail page.

## Where it works
Only the reports that appear in the Reports picker:

| Report | Table (section) | Count columns that open records |
|---|---|---|
| HR reports | Sourcing, Submissions | Count -> candidates / submissions for that sourcer and day |
| HR reports | Round 1 by sourcer / by interviewer | Scheduled, Completed, Shortlisted -> interview rounds |
| Joinings | By sourcer, by vendor, by sales POC, by interviewer (L1 / L2 / total) | Joinings -> closed submissions in that month |
| BDA reports | Accounts brought, Requirements from BDA clients (count) | Count -> accounts / requirements |
| BDA reports | Meetings scheduled, Meetings -> active | Scheduled, Converted to active -> accounts (one row per meeting event; converted = once per account) |
| Sales reports | Requirements created, Meetings attended, Profiles submitted to client | Count -> requirements / accounts / submissions |
| Clients without requirements | main | Active requirements -> that client's active requirements |
| Recruiter-vendor gaps | main | Sourced, Submitted -> profiles of that vendor |

The hidden reports (performance, aging, closure, pipeline explorer) are not wired; their rows were already single records.

## Behaviour
- Click a **count** -> panel with just that list.
- Click anywhere else in a **row** -> panel with the row's own fields (dates formatted) and one list per non-zero count of that row. Rows with nothing to drill into keep the old summary panel.
- First column of each record links to `/profiles/:id`, `/requirements/:id` or `/accounts/:id`.
- At most 500 records are returned; the panel says "first 500 of N" when truncated.

## API
`GET /api/v1/reports/drilldown` (`authorize('admin','sales','recruiter','bda')`, then the per-report role list in `drilldown.service.js`).

Query: `report`, `table` (the report's section key, `main` for single-table reports), `metric`, and the clicked row's identifiers (`person_id`, `person_name`, `account_id`, `date` = IST day, `month` = `YYYY-MM`) plus the report's filters (`date_from`, `date_to`, `source`, `client_id`, `account_type`).

Response: `{ title, columns:[{key,label}], rows:[{id, link, ...cells}], total, truncated }`.

Rules: each resolver rebuilds the same `where` the report used for that count (IST day / month rules shared via `reports.service` exports `dayKey`, `reportFrom`, `reportTo`, `optionalDateRange`), so the list adds up to the number clicked. A BDA is pinned to their own rows in `bda-reports`, a Sales user in `sales-reports`, a recruiter to their own sourced profiles in `recruiter-vendor-gaps`; a BDA can only open clients they own in `clients-without-requirements`.

Code: `server/src/modules/reports/drilldown.service.js`, route in `reports.routes.js`, schema `drilldownSchema`; client `client/src/pages/reports/DrilldownDrawer.jsx`, rules in `reportViews.js` (`DRILL_RULES`, `drillMetrics`, `drillParams`), wiring in `ReportsPage.jsx` (`withDrill`, `openRow`).

## Count fixes shipped with it
- **BDA reports -> converted to active** counted every meeting *event*, so an account rescheduled several times converted several times and "converted" could exceed "scheduled". It now counts each account once per row.
- **Coverage charts** (Clients without requirements, Recruiter-vendor gaps) had a fixed series name ("Clients w/o reqs", "Vendors w/o submissions") even though the bars counted every row of the selected view. The name now follows the selected view (All / Has requirements / No requirements, Active / Inactive / With live submissions).
- The "N shown" pill on those two reports is the number of rows in the chosen view: every active-stage vendor or client, nothing capped. If it looks wrong, open the list and compare it with the Accounts page.

## Tests
`cd server && npx jest --runInBand tests/reports-drilldown.test.js tests/reports-bda-sales.test.js` (8 + 15). Each drill-down test checks that the list size equals the count it was opened from, plus the role pinning and 403 / 422 cases.
