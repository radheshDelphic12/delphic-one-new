# Link a requirement to a project (Finance > Projects)

Built 2026-11-02. Live on staging (Render, 2026-11-02, commit `6a9de4c`) and tested there with Playwright; **not on main / production yet**. One additive migration (applied on staging boot).

## Problem
In Finance > Projects, a project's drawer showed a disabled **Requirement (not linked yet)** field. The server deliberately returned an empty
string ("linking a requirement comes later").

## What it does now
- The Requirement field is a searchable picker. With a client chosen on the project it offers **that client's requirements**; with no client it
  offers the company's requirements (latest 100, client name shown). A closed / on-hold one is labelled with its status. The linked one is always
  in the list, even if it is closed or belongs to another client.
- Picking one shows an **Open this requirement** link; clearing the field (x) unlinks it. Saving without touching the field never changes the link
  (the client only sends `requirement_id` when it changed).
- The **Requirement** column in the Finance > Projects list and the list search now show the linked requirement's title.
- Several projects may point at the same requirement (a second resource later is a separate project); a project has at most one requirement.
- Admin / `billing` write permission only, like the rest of the project profile.

## Data
- Migration `20261109100000_project_requirement_link`: `accounts.requirement_id uuid NULL` -> `requirements(id)` `ON DELETE SET NULL`, plus an index.
  (A project is an `accounts` row with `is_project = true`.) Additive, no data change.
- `schema.prisma`: `Account.requirement_id` / `Account.requirement` (relation `ProjectRequirement`), back-relation `Requirement.linked_projects`. The
  existing client relation between the two models is now named `RequirementClient` on both sides (needed because there are two relations; no DB change,
  Prisma field names unchanged).

## API
- `PATCH /api/v1/billing/projects/:id` accepts `requirement_id` (uuid or `null`). A requirement that is not in the caller's company -> 400
  `requirement_not_found`.
- `GET /billing/projects` and `GET /billing/projects/:id` return `requirement` (title, `''` when none, so the existing column keeps working),
  `requirement_id` and `requirement_link { id, title, status, client }`.

## Code / tests
- Server: `billing.service.js` (`PROFILE_SELECT`, `serializeProfile`, `updateProjectProfile`), `billing.validation.js`, `billing.routes.js` (error map).
- Client: `client/src/pages/finance/ProjectsTab.jsx` (`RequirementSelect`, form + submit).
- Tests: `server/tests/erp-projects-phase2.test.js` (new test: link, list column, unrelated edit keeps it, several projects, other company and unknown id
  refused, employee refused, unlink); the whole file passes (30). Playwright against a local API + Vite on an isolated seeded DB (13 checks: picker offers only
  the client's requirements, closed one labelled, link + open link, save, list column, reopen, unrelated save does not resend, clear unlinks) - all pass.

## Notes
- Staging check (pw/staging-project-req.js, dummy "ZZ PW Project P0115" - there is no project delete, so it stays): picker lists the company's requirements, link + save, list column, unlink - all pass. Not on main yet. Release order when asked: `super_admin_branch` -> `staging` (Render auto-deploys; the migration applies on boot) -> `main`
  (the deploy script rehearses migrations on a DB copy).
- The link is informational for now: it does not change billing, P&L or timesheets. Possible next steps: show the linked requirement's
  submissions / joined resources on the project, or filter requirements by project.
