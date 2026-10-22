# Features

Feature-level design + build specs — one document per non-trivial feature. Each spec is the single source of truth a developer opens before starting the work: goals, decisions, data model, backend, frontend/UX, extension points, test plan, and a rollout checklist. Smaller/ticket-sized work stays in [`../progress/TODO.md`](../progress/TODO.md); cross-cutting architecture stays in [`../architecture/`](../architecture/).

| Doc | Scope | Status |
|---|---|---|
| [RD-NOTIFICATIONS-AND-CALENDAR.md](RD-NOTIFICATIONS-AND-CALENDAR.md) | In-platform role-aware notifications, interview calendar (month + agenda), interviewer feedback, reminder cron; email + MS Teams extension points | Built (2026-09-04) |
| [RD-SUPERADMIN-RECORD-DELETION.md](RD-SUPERADMIN-RECORD-DELETION.md) | Superadmin soft-delete + restore for account/requirement/submission/profile/interview-round; global `$use` filter; `audit_logs` with snapshots; password + reason gate | Built (2026-09-08), migration pending |
| [SALES-REQUIREMENTS-SHARED-ACCESS.md](SALES-REQUIREMENTS-SHARED-ACCESS.md) | Whole Sales team sees and manages every requirement (list, Pipeline, notes/files); activity log tags who did what | Live (2026-10-12) |
| [REPORTS-DRILLDOWN.md](REPORTS-DRILLDOWN.md) | Reports: click a count or a row to see the records behind it (`GET /reports/drilldown`); meeting-conversion and coverage-chart count fixes | Live (2026-10-12) |
| [ZKLYRERA-SPIRITS.md](ZKLYRERA-SPIRITS.md) | 6th company: investments (principal vs earnings), income, expenses, salaries, reports, projections, Group Dashboard block | Live (2026-10-12), org seeded on staging + production |
| [OWNER-REVIEW-PHASES.md](OWNER-REVIEW-PHASES.md) | Owner product-review brief, 8 phases: report-count bugs, applicants flow, change log + soft delete, FnF / increments / bench, filters and travel, custom roles and permissions, vendor email; decisions, root causes, migrations, open [CONFIRM] items | Built locally on `super_admin_branch` (2026-10-21), not pushed |
| [ZEPHYR-INFRASTRUCTURE.md](ZEPHYR-INFRASTRUCTURE.md) | Zephyr Infrastructure workspace: exactly six sections (Leads, Client/Vendor, Projects, Revenue/Expense/Salaries/Profit/Valuation, Employee/Contractor, Financials); standalone `Zx` module with no Delphic Global reuse, data model, phases Z0-Z8, live work log | Planned (2026-10-01), branch `zephyr-bug-fix-new-implementation` |
- [ATTENDANCE-DASHBOARD-AND-BOOKKEEPING-LINKS.md](ATTENDANCE-DASHBOARD-AND-BOOKKEEPING-LINKS.md) - Time & Attendance: Attendance Dashboard + Project Calendar tabs (office history, WFH/WFO approval, leave balance); Book Keeping: optional entity/account/wallet links, manual wallet-to-bank mapping, bank statement, delete (2026-10-16)
- [RELEASE-2026-10-22.md](RELEASE-2026-10-22.md) - 22 Oct 2026 release: Attendance Register, applicant Reject, exited-employee rules, live role changes, Graph mail.
