# Project Management (Delphic Global)

Built 2026-10-29. Brief (Paras): multiple projects, each with its own ticketing system (tasks, assignee, progress, deadlines, resolutions); projects and tickets work on their own, and a project can be tagged to actual project contracts later so progress can be tracked against them. Delphic Global only.

## Decisions (answers proposed to the owner, built as such)
- A project can be linked to **several contracts** (one marked primary); a contract belongs to **one** project (`pm_project_contracts.contract_id` is unique). A ticket can optionally be tagged to one of the project's contracts.
- **Ticket statuses are admin-editable data** (`pm_statuses`): add, rename, reorder, switch off. Each status has a fixed *meaning* (`todo` / `in_progress` / `blocked` / `done`); progress counts the `done` ones. A ticket moves to a done status only with a **resolution** note.
- Assignees must be **members of the project**, and only Delphic Global employees (no client/vendor access yet).
- Contract progress is **shown, never overwritten automatically**: the contract's own (manual) percentage sits beside the ticket-based one; an admin can copy the ticket figure over with one click.

## Which "contracts" a project links to (corrected 2026-10-30)
The first build linked to rows of the Contracts module (`contracts` table), which is not what the business calls contracts. A project now links to the company's **Finance projects** (Finance > Projects: P0045 Delphic One, P0007 ... : `accounts` rows that `lib/projectScope.projectListWhere` treats as projects), shown with their code, client, agreement dates and contract state (Running / Not started / About to end / On hold / Completed, from `lib/contractState`). `pm_project_contracts.contract_id` simply holds that account id (still one project per Finance project). A Finance project has no manual progress or money figure here, so only the ticket progress is shown and "copy progress" is refused for it (422). Links made earlier to a Contracts-module row still display and work. `GET /pm/contracts/linkable` now lists unlinked Finance projects.

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
`server/tests/pm.test.js` (20): access, numbering, status flow and resolution, progress, statuses, contract link/unlink, my tickets. Browser flows checked locally on an isolated instance: main flow (12 of 13 steps asserted, the 13th was a test timing issue) and board / attachments / clearing / notification link (11 of 11), and custom fields / sharing / guest page (8 of 8).

## Added later the same day
- **Notifications** (migration `20261029110000_pm_notifications_attachments`): `pm_ticket_assigned`, `pm_ticket_status_changed`, `pm_ticket_commented` (to the people on the ticket, never the actor, no copy to every admin) and `pm_ticket_due_soon` (nightly job `pmDueSoon`, 08:30 IST, once per ticket per day). Clicking one opens the ticket in its project.
- **Board view** on a project's Tickets tab (List / Board toggle, remembered). Drag a card between status columns; dropping on a done column opens the ticket so the resolution is written first.
- **Attachments** on tickets (pdf, Office, csv, txt, png, jpg; size limit = `MAX_UPLOAD_MB`). Files are read only through the authenticated `GET /pm/attachments/:id/download`; the uploader, a project lead or an admin removes them.
- The project edit drawer can now clear the owner, dates and description.

## Custom fields and sharing with a client or vendor (migration `20261029120000_pm_custom_fields_sharing`)
- **Custom fields per project** (`pm_custom_fields`): text, number, date or pick-one, optional "required". Managers (admin, project owner or lead) add, rename, change options, switch off (old values stay on old tickets). Values sit in `pm_tickets.custom_values` by key and are validated by type; a required field cannot be blanked.
- **Share a project read-only** (project > Sharing): a link for a client or vendor, built on the existing external-access tokens (`external_accesses`, scope `{resources:['project_management'], pm_project_id, can_comment, label}`). The plain token is shown once, only its hash is stored; expiry 1 to 365 days; revoke any time.
- What a guest sees (`/guest-project#token=...`, API `/api/v1/pm-guest`): the project, progress and its tickets that are not marked **Hide from shared links** (`internal_only`), with description, status, priority, due date, resolution, custom fields and comments marked **Visible to client / vendor**. Never: assignees or any staff name (public staff comments read "Delphic team"), internal comments, attachments, contracts, money. With "They can comment" the guest adds comments tagged with the name given when the link was made; the assignee and reporter are notified.
- A share covers one project only; a normal login token does not work on the guest API and the guest token does not work anywhere else.

## Not built
Nothing from the brief is left. Ideas for later, only if wanted: guest file attachments, an email that carries the link, saved board filters.
