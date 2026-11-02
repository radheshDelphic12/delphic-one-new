# Group Dashboard > Companies & Stakes (+ new-business planner, phase 2)

Phase 1 built 2026-11-02, live on staging (Render, 2026-11-02, commit `6a9de4c`) and tested there with Playwright; **not on main / production yet**. Owner request (screenshot of a Notion "Gulati Industries Group" table): stake management of all companies along with
sectors, and a new-businesses planner that collects and analyses data in one place, for current and planned companies.

Decisions (owner, 2026-11-02): **register first, planner next**; a planned business is a **light group record** (no workspace); ownership has
**several holders per company**; the planner covers a financial plan, market / research notes, scoring and ranking, and milestones / tasks.

## Phase 1 - the register (built)
New Group Dashboard tab **Companies & Stakes** (group superadmin only). One row per business of the holding group:
- **Current companies**: a row exists for every company workspace (created the first time the tab is opened; a coming-soon workspace starts as
  Planning, the others as Operational). Its name is the workspace's name (renamed in its own Settings).
- **Businesses without a workspace**: added by hand (planned / future businesses, or an investee such as a company the group holds 40% of).
  They can be edited and removed; a workspace row cannot be removed.
- Fields: name, short name (initials shown when blank), sector (free text with suggestions from the existing sectors), tag line, foundation day
  (a planned date for a business not started), status (operational / planning / future), notes.
- **Ownership**: several holders per business. A holder is the group itself, another business of the register, or a named outsider; the
  percentages add up to at most 100%; a business cannot hold itself and ownership loops (A holds B holds A) are refused. "Set empty workspaces as
  wholly group-owned" fills 100% for the workspaces with no holder yet (it never touches a business that already has holders).
- **Views** (like the Notion tabs): Operational, Planning, Future, Group Sector (cards per sector), Overall (everything + "Who holds what" grouped
  by holder). Tiles: businesses, operational, planning + future, ownership not set.

### Data (migration `20261110100000_group_companies_stakes`, additive: two new tables)
- `group_companies` (`org_group_id`, `org_id` unique nullable -> the workspace, `name`, `short_code`, `sector`, `tagline`, `foundation_date`, `status`, `notes`).
- `group_company_stakes` (`held_company_id`, `holder_kind` group|company|external, `holder_company_id`, `holder_name`, `pct` decimal(7,3), `notes`).
  Deleting a business removes the stakes held in it and the ones it holds.

### API (`/api/v1/group-companies`, group superadmin, scoped to the caller's group; route table `admin`)
`GET /`, `POST /` (a business without a workspace), `PATCH /:id`, `DELETE /:id` (409 for a workspace), `PUT /:id/stakes` (replaces the holders),
`POST /stakes/group-default`.

### Code and tests
- Server: `server/src/modules/groupCompanies/`; client: `client/src/pages/groupOverview/GroupCompaniesTab.jsx`, tab added in `GroupOverviewPage.jsx`.
- `server/tests/group-companies.test.js` (5): register of the group's workspaces only, add / edit / sector roll-up / workspace name locked, stakes
  (several holders, over 100%, self, duplicate, unnamed, other group's business, loop, clear, cascade), quick start, access.

### Staging check
`pw/staging-today.js` (dummy "ZZ PW" businesses, cleaned up): the register lists all 8 workspaces, the five views, add a planned business, status moves it between views, the stake editor totals live and refuses over 100%, ownership saves and shows both holders, Group Sector card, Overall "who holds what", remove, and a workspace has no Remove button - all pass. Opening the tab on staging created the 8 `group_companies` rows (one per workspace); none have ownership yet ("Ownership not set" = 8).

## Phase 2 - new-business planner (not built; plan)
Built on the same `group_companies` rows (status planning / future), one workspace-free record per idea, "all data in one place":
1. **Financial plan**: investment needed, monthly revenue / cost projection, break-even month, ROI / payback; side by side with the current
   companies' actuals from the Group Dashboard.
2. **Market and research**: market size, competitors, risks and attached documents per business.
3. **Scoring and ranking**: admin-defined criteria (market, capital need, fit, risk) with weights; ranked list of ideas.
4. **Milestones and tasks**: timeline from idea to launch with owners and due dates (can reuse Group tasks).
5. A **"Start this business"** action that turns a planned record into a real company workspace and keeps its plan history.
Everything editable by the admin (see ADMIN-EDITABILITY); needs a short design pass on the criteria and the projection model before building.
