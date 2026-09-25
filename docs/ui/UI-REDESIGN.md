# UI redesign guide

Status: **RD-133 DONE (Aug 21)** — list/create drawers, dashboard pipeline, reports. See [SPRINT-PLAN.md](../progress/SPRINT-PLAN.md).

## Table of contents

1. [Theme and CSS rules](#1-theme-and-css-rules)
2. [UI primitives](#2-ui-primitives)
3. [Lists, create, and peek panels](#3-lists-create-and-peek-panels)
4. [Permissions](#4-permissions)
5. [Department model](#5-department-model)
6. [Dashboard and charts](#6-dashboard-and-charts)
7. [Reports](#7-reports)
8. [Interview rounds](#8-interview-rounds)
9. [Human setup steps](#9-human-setup-steps)

## 1. Theme and CSS rules

- Layout, sizing, and component structure use **Tailwind classNames inline** on JSX.
- [`client/src/styles/global.css`](../client/src/styles/global.css) stays lean: CSS variables for spacing/radius, typography, fonts, colors, and button color/hover utilities (`.btn*`).
- Blue primary scale is unchanged (`#3763f4`). Radius default is `0.75rem` (`rounded-xl` / `rounded-2xl` on cards and tables).
- Inter is loaded from Google Fonts in [`client/index.html`](../client/index.html).

## 2. UI primitives

Under [`client/src/components/ui/`](../client/src/components/ui/):

| Component | Use |
|---|---|
| `Drawer` | **Only** form/detail overlay: fixed RHS column (`sm`/`md`/`lg`), scrollable body, optional `tone` (`create` / `edit` / `danger` / `info`) |
| `ListToolbar` | Shared filter strip above list tables |
| `DataTable` | Harmonious list tables; row click opens peek drawer (not a full page) |
| `KpiCard` | Simple KPI: label, real number, optional hint (no fake sparklines) |
| `FilterBar` | Date presets + individual + department pickers |
| `ChartCard` | Chart shell with title |
| `PeekFields` | `PeekField` / `PeekActions` helpers for row peeks |
| `Avatar` / `AvatarStack` | Initials avatars |
| `Dropdown` / `IconButton` | Header and toolbar menus |
| `EmptyState` / `Skeleton` | Empty and loading states |
| `Modal` | Prefer `Drawer` for product forms; keep Modal only for tiny confirmations if needed |

**Rule:** Create / edit / assign / interview-round forms must open as an RHS `Drawer`, never a centered page-wide modal.

## 3. Lists, create, and peek panels

| List | Create action | Row click |
|---|---|---|
| Accounts | RHS create drawer | Account peek + Edit |
| Requirements | RHS create drawer | Peek + Open board / Assign / Edit |
| Candidates | RHS add-candidate drawer | Peek + Edit / Put forward |
| Submissions | RHS put-forward drawer | Peek + Manage interviews |
| Users | RHS create-user drawer | (table only) |

Deep links `/accounts/new`, `/profiles/new`, `/requirements/new`, `/submissions/new` redirect to the list with `?create=1` so the same RHS panel opens.

## 4. Permissions

All UI role checks go through [`client/src/lib/permissions.js`](../client/src/lib/permissions.js):

- `can(role, capability)` / `usePermissions(user)` / `<Can>`
- Notable caps: `viewReports`, `viewPipeline`, `viewDashboardCharts`, `filterByDepartment`, `filterByIndividual`

Route guards: `RequirePermission` in [`client/src/app/App.jsx`](../client/src/app/App.jsx) wraps `/profiles/*`, `/reports`, and `/users`.

Verify: `node client/scripts/check-permissions.mjs`

## 5. Department model

- Prisma: `Department` + optional `User.department_id`
- Migration: `server/prisma/migrations/20260821170000_add_department/`
- API: `GET/POST/PATCH /api/v1/departments`
- Reports and dashboard accept `department_id`
- Seed creates Sales + Delivery departments

## 6. Dashboard and charts

- Shared colors/tooltip: [`client/src/lib/chartTheme.js`](../client/src/lib/chartTheme.js)
- **Pipeline first** for admin (and sales/recruiter via `viewPipeline`): stage chips + funnel bar + stage-mix pie from real `pipeline_funnel` counts
- KPI strip uses **real** `/dashboard/summary` fields only (stuck counts as hints)
- Stuck leads / stuck requirements / recent activity remain below

Dependencies: `framer-motion`, `lucide-react`, Recharts.

## 7. Reports

Admin report tabs (see [`client/src/pages/reports/reportViews.js`](../client/src/pages/reports/reportViews.js)):

| Key | Audience | Measures |
|---|---|---|
| `bda-performance` | admin | Lead funnel by BDA (`owner_id`) |
| `sales-performance` | admin | Requirements / joinings / margin by sales owner |
| `recruiter-performance` | admin, sales, recruiter | Pipeline metrics by recruiter |
| `vendor-performance` | admin, sales | Vendor submission outcomes |
| `aging` | admin, sales | Stuck leads/reqs/subs + past SLA |
| `closure` | admin, sales | Closures grouped by month/client/recruiter |

Important: **leads belong to BDA**, not sales. Do not put lead conversion on the sales report.

## 8. Interview rounds

- UI: [`InterviewRoundsPanel`](../client/src/pages/submissions/InterviewRoundsPanel.jsx) uses RHS `Drawer`
- **Interview date & time (`scheduled_at`) is required** when creating a round (client validation + Zod on `POST /submissions/:id/interview-rounds`)
- Round types use distinct colors; results use pass/fail/pending coloring

## 9. Human setup steps

```powershell
cd server
# DATABASE_URL → localhost:5434 when using compose Postgres
npx prisma migrate deploy
npx prisma db seed
```

Then `docker compose up --build` so API and client images pick up schema and UI.
