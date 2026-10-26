# Monthly performance review (Reports)

Reports > "Monthly performance review" (admin only). One card per employee, one row per month from their joining month (or the chosen From month) to the chosen To month (never beyond today or their last working day). Newest month first.

## Columns
- Attendance: working days (holidays and weekly offs left out, inside the employment span), present, leave, absent. Same day logic as the Attendance Dashboard (`memberMonth` in attendanceDashboard.service.js). A past month with no attendance row and no leave shows "Data not available" instead of zeros.
- Measures by function (from the department; Sales, HR, IT, Other):
  - Sales (in this order): client meetings scheduled; meetings that became Active clients; requirements brought by them; closures on their clients (requirements won on clients they brought); requirements owned (running that month); requirements created as owner; requirements won as owner; meetings attended; profiles submitted to client (on their requirements); joinings (on their requirements).
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
