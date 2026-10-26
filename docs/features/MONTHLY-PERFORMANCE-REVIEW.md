# Monthly performance review (Reports)

Reports > "Monthly performance review" (admin only). One card per employee, one row per month from their joining month (or the chosen From month) to the chosen To month (never beyond today or their last working day). Newest month first.

## Columns
- Attendance: working days (holidays and weekly offs left out, inside the employment span), present, leave, absent. Same day logic as the Attendance Dashboard (`memberMonth` in attendanceDashboard.service.js). A past month with no attendance row and no leave shows "Data not available" instead of zeros.
- Measures by function (from the department; Sales, HR, IT, Other):
  - Sales, with the names of the first version: Client meetings scheduled; Clients now Active; Requirements brought; Won (brought) (closures on clients they brought); Requirements owned (running) [added later]; Requirements owned (created that month as owner); Won (owned); Meetings attended; Profiles submitted on owned requirements; Joinings (their requirements) [added later].
  - HR (in this order): profiles submitted to client (as submitter); interviews taken (held, not cancelled, person tagged as interviewer); shortlisted in interviews (round result pass); shortlisted who joined finally (the candidate closed with a joining date, counted once per month); joinings; vendors onboarded (Active, origin owner); meetings attended.
  - Meetings attended = a client's first meeting or an extra client meeting (not cancelled) the person is tagged on. A requirement is won / a joining counts when a candidate on it is closed with a joining date (counted in that month).
  - IT: a person counts on a project only inside the project's own agreement dates too (Finance > Projects) and their allocation dates (later start, earlier end); two contracts with one name show their project code, e.g. "Glut Network (P0001)".
  - IT: active, billable, non-billable projects in the month (allocation dates; billable = a billing rate above 0), and average projects per day (day list in the drill-down). The Billable / Non-billable checkboxes narrow all IT counts (default billable only).
  - IT dates come from the allocation (Finance > Project costing: start date, "Last day on this project"). The project counts open a list with Started / Ended dates and an "Ended this month" tag; "Avg projects per day" opens a day-by-day table (projects per day, names, last day / started markers). A project stops counting the day after its last day.
- Day-wise: every month row has a "Day-wise" link (all functions). It opens a table of each day with the attendance of the day and the function's records of that day (Sales/HR: meetings, submissions, joinings...; IT: projects, with last-day / started markers). Details metric `daywise`. The Excel export has a second sheet "Day-wise" (max 20000 rows) and the PDF a Day-wise page (first 600 days).
- Every count opens the records behind it (same query for the count and the list).

## Filters, paging, export
From/To month, Function, Team, Status (current / active / notice / exited / all), search by name or employee code, 10 employees per page. Excel and PDF export the whole filtered review (max 500 employees; PDF 400 rows).

## Where
Server: server/src/modules/reports/monthlyReview.service.js, routes `/reports/monthly-review`, `/details`, `/export` in reports.routes.js. Client: client/src/pages/reports/MonthlyReview.jsx. Tests: server/tests/monthly-review.test.js.

## Staging demo data (2026-10-23)
Seeded through the API on staging: attendance for Dheeraj, Tanvi, Diksha (from their joining date), "MR Demo Client 1-3" (3 meetings, 2 Active, brought by Dheeraj, Tanvi tagged as attendee), 2 requirements owned by Tanvi, "MR Demo Vendor 1-2" onboarded by Diksha. Won/joinings stay 0 there (no closed candidate).

## Won and joinings dates (2026-10-26)
Won requirements (Sales) count in the month the candidate was **closed** (the day the seat closed, else the joining date), once per requirement and month. Joinings (Sales and HR) count on the joining date, else the closing day. Before, both needed a joining date, so closures with no joining date (or one in a later month) were missing, e.g. October for the Sales team. A closed candidate counts as "joined finally" in the HR interview funnel even without a joining date.

## Project counting rules (approved 2026-10-26)
- **Source:** the same projects Finance > Projects lists (`projectListWhere`: active client accounts run as projects) and never a deleted account (Prisma's soft-delete filter does not reach nested relations, so the review says `deleted_at: null` explicitly; the same for requirements and clients in Sales / HR counts).
- **Overlap:** a project counts once for a person in a month when any day of the month falls inside BOTH the person's allocation dates and the project's own agreement dates (open ends allowed). "Avg projects per day" is counted day by day.
- **Manual status:** "on hold" still counts and is tagged; "completed" ends the project on its agreement end date; with no end date it keeps counting and is flagged "Marked completed, no end date" so someone gives it a date.
- **Same-name projects:** separate contracts (different project codes) show their code, e.g. "Dish Network (P0123)". `server/scripts/projects-duplicates-dry-run.js` (read only) lists deleted projects that still have allocations, live projects sharing a name and client, and allocated projects Finance does not list.
- **Sales closures:** "Won (brought)" follows the BDA who first added the client (origin owner); "Won (owned)" follows the requirement's sales owner. Previous Sales names are in use; a rename waits for approval.
