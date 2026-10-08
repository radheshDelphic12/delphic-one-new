# Super Admin: Group Dashboard and company control

Branch `super_admin_branch` (off main `1901185`), built and tested locally 2026-10-08; code committed locally as `d4d86ee` ("implement Dashboard"), not pushed or merged to main. No migration.

## What it is

The **group superadmin** (`User.is_group_superadmin`, scoped by `OrgGroupMembership`) is one person who is also the admin of every company in the holding group. This feature gives them:

1. A **Group Dashboard** (they land on it right after login) with consolidated and per-company numbers.
2. **Full admin control inside every company** by switching into it (same admin experience as that company's own admin).

A normal company admin still sees only their own company. Nothing here replaces the existing multi-org architecture; it extends `super-dashboard`, `orgs`, the workspace switcher and each company's own finance service.

## How a number is produced (no duplicate calculations)

`server/src/modules/superDashboard/groupFinance.service.js` owns no money logic. Per company it calls that company's own service and only normalises and compares:

| Company kind (from `enabled_modules`) | Source |
|---|---|
| Gulati (`gulati`) | `gulati/finance.service.valuationTrend` |
| Zephyr (`zephyr`) | `zephyr/money.service.valuationTrend` |
| Delphic-type (anything else) | `financials/financials.service.trends` (+ `calculations/records.service` for drill-down) |

Valuation = profit x 240 + asset value x 3 (the formula already in those services). Monthly asset values stay in each company's own table (`financial_asset_values`, `gx_asset_values`, `zx_asset_values`): history is kept, a revised month updates that month and is audited with the previous value. Group figures add the **live** companies together; intra-group charges are not eliminated; group valuation is the plain sum (labelled as such).

## Company switching and access

- `server/src/lib/groupAccess.js`: a group superadmin gets an **admin `OrgMembership` on demand** in every active company of their own holding group (audited as `group_admin_access` in `audit_logs`). Existing RBAC, module access and audit actors therefore keep working unchanged. A company of another group is refused (403).
- The superadmin is left out of group headcount and out of the group org chart's company boxes.
- `POST /auth/switch-org` refuses a company that is **coming soon** (409).
- Default company on login: tie-break prefers the master workspace (Delphic Global).

## Coming soon

A company marked `coming_soon` (marker string in `Org.enabled_modules`, set from Group Dashboard > Projections & Valuation > company Settings) is listed everywhere as "Coming soon", cannot be opened, and is excluded from totals, graphs, rankings, alerts and the active-company count. `updateSettings` keeps markers it does not manage (`gulati`, `zephyr`, `coming_soon`). When the company is ready, untick the box; no code change.

## API (all gated by `authorizeGroupSuperadmin`, scoped to the caller's group)

- `GET /super-dashboard/group/overview` `?from=YYYY-MM&to=&granularity=month|quarter|year&state=all|locked|unlocked&org_ids=a,b&revenue_drop_pct=&profit_drop_pct=&expense_rise_pct=&valuation_drop_pct=` returns totals (with change vs the previous period of the same length), per-company rows, trends, contribution, rankings, alerts.
- `GET /super-dashboard/group/activity?limit=&days=7` recent audit rows, default last 7 days.
- `GET /super-dashboard/companies/:orgId/drilldown?from=&to=&state=` source breakdown (Zephyr projects, Gulati deals and trading types, Delphic categories).
- `GET|PUT /super-dashboard/companies/:orgId/asset-values` monthly asset values.
- `PATCH /orgs/:id/settings` also accepts `coming_soon`.
- Quarter and year follow the Indian financial year (April-March). Month is the finest period (books and asset values are monthly).

## UI (client)

- `/group-overview` (default tab **Group Finance**, `GroupFinanceTab.jsx`): Zephyr-style pill filters (period, group by, figures, company chips, export), live refresh every 30 s, numbered sections (at a glance, companies, trends with one metric toggle, contribution and rankings, recent activity timeline), company panel (valuation breakdown, history, drill-down, asset values), CSV and PDF export (`lib/groupExport.js`, print view for PDF).
- Tabs: Group Finance, Dashboard, Projections & Valuation (group revenue actual vs projected is a **line** chart), Org Chart, Billing Charges, Settings (`/group-overview/settings`: account, change password, companies, alert thresholds saved in the browser).
- **Org Chart** (group): one chart, Group Super Admin at the bottom, every company above, each company's teams and people above it (`layoutGroupChart` in `TeamChart.jsx`). For one company, Team, Designation/Role and Department views all use the same team-chart design (`regroupForTeamChart`).
- Navigation: **Group Dashboard** pinned at the top of every sidebar; in group view the sidebar shows only group items plus an "Open a company" list; the switcher reads "All Companies"; inside a company a banner offers "Back to Group Dashboard".
- Look: group view uses a light sage-green theme (`.theme-group` in `client/src/styles/theme.css`, switched on by `AppLayout` while the path is under `/group-overview`). Company logos in the switcher, sidebar list and login picker come from `lib/orgLogo.js` (the company's own `logo_url`, else the brand logo for known slugs delphic/gulati/zephyr/acconcy, else an initial tile).
- Logo: `client/public/group-logo.svg` is a redrawn Gulati Foundation logo; replace it with the original file.

## Tests

- `server/tests/super-admin-group-dashboard.test.js` (16): access, dynamic company list and isolation, valuation formula per company kind, locked snapshots, asset history and audit, validation, quarter/FY buckets, alerts, contribution, switching, drill-down, coming soon, previous-period change, 7-day activity.
- Run on an isolated DB with all migrations (`superadmin_test`); `gulati_test` lacks the Zephyr tables.
- Browser/API e2e (Playwright, throwaway DB `superadmin_e2e`, API 4100, vite 5190): 60 UI checks and 40 API checks (company-admin isolation, 172 read endpoints identical for the superadmin inside a company, add/edit in every company).

## Release notes

- Gulati and Zephyr must share the Delphic org group on staging/production for the superadmin to see them (they were seeded in separate groups; join them first).
- Local dev: `group.admin@delphic.in` was removed from the local dev DB and `super@delphic.in` (`Password123!`) created; Acconcy is marked coming soon locally.
