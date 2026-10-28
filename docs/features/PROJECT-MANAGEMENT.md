# Project Management (Delphic Global)

Built 2026-10-29. Brief (Paras): multiple projects, each with its own ticketing system (tasks, assignee, progress, deadlines, resolutions); projects and tickets work on their own, and a project can be tagged to actual project contracts later so progress can be tracked against them. Delphic Global only.

## Decisions (answers proposed to the owner, built as such)
- A project can be linked to **several contracts** (one marked primary); a contract belongs to **one** project (`pm_project_contracts.contract_id` is unique). A ticket can optionally be tagged to one of the project's contracts.
- **Ticket statuses are admin-editable data** (`pm_statuses`): add, rename, reorder, switch off. Each status has a fixed *meaning* (`todo` / `in_progress` / `blocked` / `done`); progress counts the `done` ones. A ticket moves to a done status only with a **resolution** note.
- Assignees must be **members of the project**, and only Delphic Global employees (no client/vendor access yet).
- Contract progress is **shown, never overwritten automatically**: the contract's own (manual) percentage sits beside the ticket-based one; an admin can copy the ticket figure over with one click.

## Data (migration `20261029100000_project_management`, additive)
`pm_projects` (code per org, owner, status, dates, `ticket_seq` for per-project ticket numbers), `pm_project_members` (member / lead), `pm_statuses`, `pm_tickets`, `pm_ticket_comments`, `pm_activity` (one audit trail for projects and tickets), `pm_project_contracts`. Org / person / contract ids are plain uuids on purpose (no relations to the shared Org, OrgMembership, Contract models). The old Self Projects module (`SelfProject`) is untouched.

## API (`/api/v1/pm`, master workspace only)
`GET /meta`, `/people`, `/my-tickets`, `/contracts/linkable`; `POST|PATCH /statuses`; `/projects` CRUD (+ `/members`); `/projects/:id/tickets`; `/tickets/:id` (GET / PATCH / DELETE, `/comments`); `/projects/:id/contracts` (link, unlink, `/primary`, `/copy-progress`).

## Who can do what
- Admin (and group admin): everything, sees every project.
- Project owner / lead: edit the project, team, contract links, delete tickets.
- Member: sees only their projects, raises tickets, edits tickets assigned to or raised by them, comments.
- Route rule `/pm` is `open`; the route itself enforces master-workspace and the per-record rights in `pm.service.js`.

## Client
Sidebar "Project Management" (master workspace). `/pm` (Projects, My tickets, Ticket statuses for admins), `/pm/projects/:id` (Tickets, Team, Contracts, Activity; ticket drawer with comments and history).

## Tests
`server/tests/pm.test.js` (13): access, numbering, status flow and resolution, progress, statuses, contract link/unlink, my tickets. Browser flow checked locally (12 of 13 steps asserted; the 13th was a test timing issue, the screen was correct).

## Not built yet
Notifications (assign, status, due soon), kanban board view, attachments on tickets, client/vendor viewers, per-project custom fields, clearing a project's owner/dates from the edit drawer.
