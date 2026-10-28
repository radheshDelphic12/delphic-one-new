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
`server/tests/pm.test.js` (17): access, numbering, status flow and resolution, progress, statuses, contract link/unlink, my tickets. Browser flows checked locally on an isolated instance: main flow (12 of 13 steps asserted, the 13th was a test timing issue) and board / attachments / clearing / notification link (11 of 11).

## Added later the same day
- **Notifications** (migration `20261029110000_pm_notifications_attachments`): `pm_ticket_assigned`, `pm_ticket_status_changed`, `pm_ticket_commented` (to the people on the ticket, never the actor, no copy to every admin) and `pm_ticket_due_soon` (nightly job `pmDueSoon`, 08:30 IST, once per ticket per day). Clicking one opens the ticket in its project.
- **Board view** on a project's Tickets tab (List / Board toggle, remembered). Drag a card between status columns; dropping on a done column opens the ticket so the resolution is written first.
- **Attachments** on tickets (pdf, Office, csv, txt, png, jpg; size limit = `MAX_UPLOAD_MB`). Files are read only through the authenticated `GET /pm/attachments/:id/download`; the uploader, a project lead or an admin removes them.
- The project edit drawer can now clear the owner, dates and description.

## Not built
Client / vendor viewers (needs a decision: which accounts, read-only or comment, what they may see), per-project custom fields.
