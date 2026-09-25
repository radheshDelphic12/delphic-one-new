# Features

Feature-level design + build specs — one document per non-trivial feature. Each spec is the single source of truth a developer opens before starting the work: goals, decisions, data model, backend, frontend/UX, extension points, test plan, and a rollout checklist. Smaller/ticket-sized work stays in [`../progress/TODO.md`](../progress/TODO.md); cross-cutting architecture stays in [`../architecture/`](../architecture/).

| Doc | Scope | Status |
|---|---|---|
| [RD-NOTIFICATIONS-AND-CALENDAR.md](RD-NOTIFICATIONS-AND-CALENDAR.md) | In-platform role-aware notifications, interview calendar (month + agenda), interviewer feedback, reminder cron; email + MS Teams extension points | Built (2026-09-04) |
| [RD-SUPERADMIN-RECORD-DELETION.md](RD-SUPERADMIN-RECORD-DELETION.md) | Superadmin soft-delete + restore for account/requirement/submission/profile/interview-round; global `$use` filter; `audit_logs` with snapshots; password + reason gate | Built (2026-09-08), migration pending |
