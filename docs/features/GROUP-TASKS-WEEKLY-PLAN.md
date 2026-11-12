# Group Dashboard: tasks and weekly plan (2026-10-12)

Group Dashboard > **Tasks & Weekly plan** tab (group super admin only).

- **Tasks**: one-time (due date) and recurring (daily / weekly on chosen weekdays / monthly / quarterly / yearly, every N, start/end, day of month) for one company or all companies. Month list + calendar view, overdue highlight, per-date tick (done by whom), edit/pause/cancel/delete.
- **Weekly plan**: Mon-Sun table; each company is linked to one or more weekdays ("Set company days"); today is highlighted; that day's tasks listed; week prev/next.
- API: `/super-dashboard/group/tasks*`, `/group/weekly-plan` (`groupTasks.service.js`, rules in `groupTasks.calc.js`).
- Migration `20261012090000_group_tasks` (additive: group_tasks, group_task_done, group_company_days).
- Tests: `server/tests/group-tasks.test.js`.

## OT hidden (Delphic Global): only the automatic OT
Log time (`ItTimesheetPage.jsx`, flag `OT_HIDDEN`) no longer shows OT; Timesheet Dashboard shows OT chips/section only to admins (`canSeeOt`). OT Tickets tab untouched.

## State (2026-10-12)
- Weekly plan also has an "All companies at a glance" grid, a banner + "Link them now (spread Mon-Fri)" button, and "Spread evenly Mon-Fri" in the day editor. The company filter narrows tasks only, not the linked companies.
- OT rule: only the *derived* OT (hours beyond the expected day: per-day/month label in Log time, "Timesheet OT" on the dashboard) is hidden from non-admins. OT tickets, the "OT hrs" box and Holiday OT stay visible.
- Verified: backend tests 9/9, Playwright on local dev and on staging (add one-time/recurring, tick with done-by, link companies, filters). OT hiding not browser-tested.
- Branches: super_admin_branch = 2e8b7d4 (includes test fix `erp-phase2.test.js`: fixed Oct-2026 leave date went stale, now 2099). Staging deployed at 1ac9a51 (Render dep-db66jko76l7s73cdvllg, migration applied). main/production not yet.
- Staging data: companies were linked to weekdays by the test (Link them now); change via "Set company days".
