# Team availability (Time & Attendance > Team availability)

Requested 2026-11-18 ("team-wide attendance visibility"): every employee should see the daily working status of their manager, their direct reports and their teammates, so nobody has to assume or ask whether someone is in.

## What people see
- New tab **Team availability** in Time & Attendance, for every employee (`basic.attendance`, same as the Attendance tab). No new permission.
- One day at a time (today by default; previous / next day, a date picker, a Today button) with the **week around it** as seven dots per person; clicking a day jumps to it.
- Status per person: **Present**, **Working remotely**, **At a work site**, **Half day**, **On leave** (or Half-day leave), **Unavailable** (a past working day with nothing recorded), **Not in yet** (today, nothing recorded yet), **Day off** (holiday / weekly off). Summary chips above the list count each status and filter the list when clicked.
- Who is shown: you, your manager, **your manager's manager**, your direct reports, people with the same manager (peers) and people in your team (HR Settings > Teams). Sorted you, manager, manager's manager, reports, peers / team. Contractors, vendor resources and exited people are left out; a person serving notice is marked.
- An **admin** also gets an "Everyone" toggle (the whole company). Anyone else asking for `scope=all` is silently kept on their own team.
- Someone with no manager and no team sees only themselves plus a hint to ask HR to set their manager / team.

## Privacy (on purpose)
Colleagues see a status only: no hours, no projects, no reporting office and no check-in place or time. The **leave type** (Sick, Casual, Maternity ...) is added (`detail` on the day, shown when you **hover** the day dot or the status badge) only for the person themselves, their own direct manager and an admin; everyone else sees just "On leave" (decided 2026-11-18). The existing Attendance Dashboard (admin everyone, manager their reports, employee themselves) is unchanged.

## How it works
- `GET /api/v1/attendance-dashboard/team-status?date=YYYY-MM-DD&scope=team|all` (`attendanceDashboard.service.teamStatus`). The route group is already `open` in the central table; the service decides who is in the circle.
- It reuses the Attendance Register's day logic (`registerCode`: holiday / weekly off / approved leave / attendance record / approved work-from-home day), so a person's status here always agrees with the register and payroll inputs. Nothing is written.
- Response: `{ date, today, week[7], scope, can_see_all, team_name, summary{key: count}, people[{ name, designation, department, team, relation, is_me, on_notice, days[7]{date,key,label} }] }`.
- Client: `client/src/pages/time/TeamAvailability.jsx`, tab registered in `TimeAttendanceHubPage.jsx`.

## Tests
`server/tests/attendance-dashboard.test.js` > "team availability" (4 tests: an employee sees manager / peers / self with statuses and no outsiders or contractors; a manager sees reports and `scope=all` is admin-only; a person with no team sees only themselves and a bad date is refused).

## Open / decisions taken without an answer
- "Team" = manager circle + the manager's manager + HR Settings team. Only ONE level up is shown (not the whole chain), and a manager's manager sees their own circle, not their manager's reports (say if the whole chain should be shown both ways).
- Work-site days show as "At a work site" without the place or project.
