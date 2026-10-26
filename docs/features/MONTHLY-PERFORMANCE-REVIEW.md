# Monthly performance review (Reports)

Reports > "Monthly performance review" (admin only). One card per employee, one row per month from their joining month (or the chosen From month) to the chosen To month (never beyond today or their last working day). Newest month first.

## Columns
- Attendance: working days (holidays and weekly offs left out, inside the employment span), present, leave, absent. Same day logic as the Attendance Dashboard (`memberMonth` in attendanceDashboard.service.js). A past month with no attendance row and no leave shows "Data not available" instead of zeros.
- Measures by function (from the department; Sales, HR, IT, Other):
  - Sales: client meetings scheduled (stage history `meeting_scheduled` by the person), clients now Active, requirements brought (account origin owner) / owned (sales owner), Won for each (a candidate on the requirement closed with a joining date, counted once in the joining month), meetings attended (meeting attendee), profiles submitted on owned requirements.
  - HR: profiles submitted to client (submitter), joinings, vendors onboarded (Active, origin owner).
  - IT: active, billable, non-billable projects in the month (allocation dates; billable = a billing rate above 0), and average projects per day (day list in the drill-down). The Billable / Non-billable checkboxes narrow all IT counts (default billable only).
- Every count opens the records behind it (same query for the count and the list).

## Filters, paging, export
From/To month, Function, Team, Status (current / active / notice / exited / all), search by name or employee code, 10 employees per page. Excel and PDF export the whole filtered review (max 500 employees; PDF 400 rows).

## Where
Server: server/src/modules/reports/monthlyReview.service.js, routes `/reports/monthly-review`, `/details`, `/export` in reports.routes.js. Client: client/src/pages/reports/MonthlyReview.jsx. Tests: server/tests/monthly-review.test.js.

## Staging demo data (2026-10-23)
Seeded through the API on staging: attendance for Dheeraj, Tanvi, Diksha (from their joining date), "MR Demo Client 1-3" (3 meetings, 2 Active, brought by Dheeraj, Tanvi tagged as attendee), 2 requirements owned by Tanvi, "MR Demo Vendor 1-2" onboarded by Diksha. Won/joinings stay 0 there (no closed candidate).
