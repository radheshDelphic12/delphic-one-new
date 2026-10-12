# Group Dashboard: tasks and weekly plan (2026-10-12)

Group Dashboard > **Tasks & Weekly plan** tab (group super admin only).

- **Tasks**: one-time (due date) and recurring (daily / weekly on chosen weekdays / monthly / quarterly / yearly, every N, start/end, day of month) for one company or all companies. Month list + calendar view, overdue highlight, per-date tick (done by whom), edit/pause/cancel/delete.
- **Weekly plan**: Mon-Sun table; each company is linked to one or more weekdays ("Set company days"); today is highlighted; that day's tasks listed; week prev/next.
- API: `/super-dashboard/group/tasks*`, `/group/weekly-plan` (`groupTasks.service.js`, rules in `groupTasks.calc.js`).
- Migration `20261012090000_group_tasks` (additive: group_tasks, group_task_done, group_company_days).
- Tests: `server/tests/group-tasks.test.js`.

## OT hidden (Delphic Global)
Log time (`ItTimesheetPage.jsx`, flag `OT_HIDDEN`) no longer shows OT; Timesheet Dashboard shows OT chips/section only to admins (`canSeeOt`). OT Tickets tab untouched.
