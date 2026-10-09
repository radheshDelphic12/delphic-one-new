# Delphic One

Multi-company group platform for the Delphic holding group. It started as the internal **Requirement Management Dashboard** (recruitment pipeline) and has grown into a shared-database, multi-company ERP: each company gets its own workspace, and a **group superadmin** sees and controls all of them from one **Group Dashboard**.

- **Recruitment core:** **client / vendor accounts → requirements → seats → candidate profiles → submissions → interview rounds**, with role-based dashboards, margin tracking, locking, and reporting.
- **Company platform:** HR directory, calendars, attendance, leave, project-centric timesheets, payroll, billing, expenses and vendor payments, accounting, org chart, and Live Analytics / Financials.
- **Company workspaces:** standalone **Zephyr Infrastructure**, **Gulati Industries** (trading) and **Acconcy Finance** modules, plus "coming soon" companies.

| | |
|---|---|
| **Tenancy** | Multi-company: `Org` / `OrgGroup` / `OrgMembership`, shared database with row-level isolation by `org_id` |
| **UI rule** | Jira-like dense lists and filters — [docs/ui/UI-UX-JIRA.md](docs/ui/UI-UX-JIRA.md) |
| **Detailed HLD** | [docs/architecture/HLD.md](docs/architecture/HLD.md) |
| **Field model** | [docs/architecture/Requirement-Dashboard-System-Design-v2.md](docs/architecture/Requirement-Dashboard-System-Design-v2.md) |
| **API contract** | [docs/architecture/API-Spec-and-Build-Plan.md](docs/architecture/API-Spec-and-Build-Plan.md) |
| **Multi-company design** | [docs/architecture/MULTI-COMPANY-ERP-PLATFORM-HLD.md](docs/architecture/MULTI-COMPANY-ERP-PLATFORM-HLD.md) |
| **Diagrams & journeys** | [docs/architecture/ARCHITECTURE-OVERVIEW.md](docs/architecture/ARCHITECTURE-OVERVIEW.md) |
| **Agent / contributor context** | [docs/AGENTS.md](docs/AGENTS.md) |

## Table of contents

1. [What it does](#what-it-does)
2. [Design principles](#design-principles)
3. [Architecture](#architecture)
4. [Multi-company platform](#multi-company-platform)
5. [Feature map](#feature-map)
6. [Domain model](#domain-model)
7. [User journeys](#user-journeys)
8. [Stage pipelines](#stage-pipelines)
9. [Roles and permissions](#roles-and-permissions)
10. [Security](#security)
11. [Reporting](#reporting)
12. [API surface](#api-surface)
13. [Codebase structure](#codebase-structure)
14. [Stack](#stack)
15. [Branching](#branching)
16. [Local setup](#local-setup)
17. [Deployment](#deployment)
18. [Further reading](#further-reading)

---

## What it does

| Role | Goal |
|---|---|
| **BDA** | Own the full account (lead) flow: capture, classify, schedule meetings, convert clients / vendors |
| **Sales** | Open job requirements and seats; assign recruiters |
| **Recruiter** | Source candidates, submit to seats, run interviews through join, track margin |
| **Admin / Group superadmin** | One role: manage users, unlock any locked entity, read org-wide reports, free-form stage overrides, locked-row edits, soft-delete / restore. As group admin: admin of every company in the holding group (on-demand membership) and owner of the Group Dashboard |

### In scope

- Full core pipeline with stage machines and append-only stage history
- Lead capture before client/vendor is known, with a one-way classify step
- Candidate on-bench flag and filter
- Role-based access and ownership scoping
- Record locking on terminal states, with admin unlock + reason
- Margin / commercials on submissions
- Role-scoped dashboard (including stuck lists)
- Reports with date range and Excel / PDF export
- Comments and documents on core entities
- Jira-like dense list / filter UX
- Multi-company tenancy with a group superadmin, Group Dashboard and per-company workspaces (see [Multi-company platform](#multi-company-platform))
- HR, attendance, leave, timesheets, payroll, billing, expenses, accounting and Live Analytics per company
- Admin-editable everything: every feature has an admin edit path, audited ([docs/guides/ADMIN-EDITABILITY.md](docs/guides/ADMIN-EDITABILITY.md))

### Deferred

- Notifications
- Vendor / client external portals
- JIRA / Sheets migration tooling
- Database-per-tenant isolation (current model is shared DB, row-level)
- Real-time collaboration (WebSockets)
- SSO

---

## Design principles

1. **Pipeline as state machines** — Account, seat, and submission progress only through documented transitions; every move is audited in `stage_history`.
2. **Auth and authorization at the edge** — JWT and role checks live in transport middleware; services receive a narrowed identity (user id, role).
3. **Thin transport, fat domain** — Route handlers parse HTTP and call services; stage advance, margin, ownership, and lock rules live in services.
4. **Account flow is BDA-owned; requirements are Sales-owned** — BDA may view and mutate **all** accounts (like admin on the account domain). Sales mutates **own** requirements; Recruiter works **assigned** requirements. Requirement create/edit stays Sales/Admin. Superadmin-only powers (stage override, edit locked rows in place) stay off ordinary BDA/Admin.
5. **Lock is editability, not visibility** — Terminal records stay in lists and reports; mutations are blocked until unlock with a reason (BDA may unlock **accounts**; Admin unlocks any entity type).
6. **Single source of schema truth** — Prisma models and migrations define persistence; API validation mirrors enums and required fields.
7. **Readable modules** — Domain folders follow `routes → controller → service → validation`.

---

## Architecture

### System context

```mermaid
flowchart LR
  subgraph Actors
    BDA[BDA]
    Sales[Sales]
    Rec[Recruiter]
  end

  Admin[Admin / Group superadmin]
  Ext[External CA / Legal]

  RMD[Delphic One platform]

  BDA --> RMD
  Sales --> RMD
  Rec --> RMD
  Admin --> RMD
  Ext -->|read-only access| RMD

  RMD --> PG[(PostgreSQL)]
  RMD --> Files[Document store]
```

### Access model (current)

```mermaid
flowchart TB
  subgraph Read
    AccR[All accounts]
    ReqR[Requirements]
  end

  subgraph AccountWrite[Account mutations]
    AccW[Edit · classify · stage · meeting · type · brought-by]
    AccU[Unlock account]
  end

  subgraph ReqWrite[Requirement mutations]
    ReqW[Create · edit · status · assign]
  end

  BDA[BDA] --> AccR
  BDA --> ReqR
  BDA --> AccW
  BDA --> AccU

  Sales[Sales] --> AccR
  Sales --> ReqR
  Sales --> ReqW

  Rec[Recruiter] --> AccR
  Rec --> ReqR

  Admin[Admin] --> AccR
  Admin --> ReqR
  Admin --> AccW
  Admin --> AccU
  Admin --> ReqW
  Admin --> UnlockAll[Unlock any entity]

  Super[Superadmin] --> Admin
  Super --> Override[Stage override]
```

POC credit stays on the account: `owner_id` is the current internal POC (reassignable); `origin_owner_id` is “Brought by” (set at create; admin/BDA/superadmin may correct).

### Containers and request path

```mermaid
flowchart TB
  User[Browser user]
  Nginx[Nginx — TLS, static SPA, /api proxy]
  Client[React client — Vite + Tailwind]
  API[Node Express API]
  DB[(PostgreSQL via Prisma)]
  Store[Uploads — disk / S3 later]

  User --> Nginx
  Nginx -->|/| Client
  Nginx -->|/api| API
  Client -->|REST + JWT| API
  Cron[Background jobs — reminders, locks] --> API
  API --> DB
  API --> Store
```

| Container | Responsibility |
|---|---|
| **Web client** | Screens, forms, JWT session, role-gated navigation |
| **API server** | Auth, validation, stage machines, ownership, reports, uploads |
| **PostgreSQL** | Durable entities, history, assignments |
| **Nginx** | TLS, static assets, API reverse proxy |
| **Document store** | Binary uploads (API gates access) |

### Server call graph

```mermaid
flowchart TB
  HTTP[HTTP request] --> Routes[Domain routes]
  Routes --> MW[Auth · role · lockCheck]
  MW --> Ctrl[Controller]
  Ctrl --> Val[Validation]
  Val --> Svc[Service — stage machines, ownership, margin]
  Svc --> Prisma[Prisma / filesystem]
```

Services do not import Express request types. Controllers stay thin.

---

## Multi-company platform

One database, many companies. Every tenant-owned row carries an `org_id`; a user belongs to one or more companies through `OrgMembership`, and companies are grouped by `OrgGroup`. The active company is chosen at login or with `POST /auth/switch-org`, and all module queries are scoped to it.

### Tenancy model

```mermaid
flowchart TB
  Group[OrgGroup — Delphic holding group]
  Group --> O1[Org — Delphic Global]
  Group --> O2[Org — Zephyr Infrastructure]
  Group --> O3[Org — Gulati Industries]
  Group --> O4[Org — Acconcy Finance]
  Group --> O5[Org — Coming soon]

  User[User] --> M[OrgMembership — role per company]
  M --> O1
  M --> O2
  GM[OrgGroupMembership] --> Group
  User --> GM
```

Each company has `enabled_modules`; route groups such as `/expenses/vendor-payments`, `/accounting` and `/external-access` are additionally gated by a per-company finance-module switch.

### Company workspaces

| Workspace | Module (API prefix) | Scope |
|---|---|---|
| **Delphic Global** | recruitment core + shared platform modules | Recruitment pipeline, HR, timesheets, payroll, billing, Live Analytics / Financials |
| **Zephyr Infrastructure** | `/zephyr` (`Zx`) | Real estate and construction: services, properties, units, rent, trading, consulting, tasks, finance, service P&L |
| **Gulati Industries** | `/gulati` (`Gx`) | Trading workspace (Copper Cathode and other deals): leads, deals, parties, ledger, finance, tasks |
| **Acconcy Finance** | `/acconcy` (`Ax`) | Finance services: leads, deals, investments, parties, ledger, salaries, valuation |
| **Coming soon** | marker in `enabled_modules` | Listed but not openable; excluded from all totals |

Zephyr, Gulati and Acconcy are standalone modules (own tables prefixed `zx_` / `gx_` / `ax_`, own access and audit helpers) that mirror one another's layout rather than sharing Delphic Global code.

### Group Dashboard and on-demand admin access

```mermaid
sequenceDiagram
  participant GSA as Group superadmin
  participant API as API
  participant GA as groupAccess
  participant Fin as groupFinance.service
  participant Co as Per-company finance services

  GSA->>API: Login
  API-->>GSA: Lands on Group Dashboard
  GSA->>API: GET /super-dashboard/group/overview
  API->>Fin: Build consolidated view
  Fin->>Co: Ask each live company for its own numbers
  Co-->>Fin: Revenue, profit, assets, valuation
  Fin-->>GSA: Totals, per-company rows, trends, alerts
  GSA->>API: POST /auth/switch-org (company)
  API->>GA: Ensure admin membership in own group
  GA-->>API: Membership created and audited (group_admin_access)
  API-->>GSA: Company admin experience
```

`groupFinance.service.js` holds no money logic: it calls each company's own service, then normalises and compares. Valuation = profit x 240 + asset value x 3. Coming-soon companies are excluded from totals. Details: [docs/features/SUPER-ADMIN-GROUP-DASHBOARD.md](docs/features/SUPER-ADMIN-GROUP-DASHBOARD.md).

### Time to money

```mermaid
flowchart LR
  Att[Attendance — presence only] -.-> TS
  Cal[Company calendar] --> TS[Timesheets — project entries]
  TS --> OT[Overtime approval]
  TS --> WH[workHours.service — approved hours]
  OT --> WH
  Leave[Leave balance — approval gated] --> WH
  WH --> Pay[Payroll run + payslips]
  TS --> Bill[Billing — invoices]
  Alloc[Allocations + resource rates] --> Bill
  Pay --> Fin[Financials / Live Analytics]
  Bill --> Fin
  Exp[Expenses + vendor payments] --> Fin
  Fin --> Lock[Per-record locks, versions, change detection]
  Lock --> Grp[Group Dashboard]
```

Pay comes from **approved timesheet hours**, never raw check-in / check-out. Weeks run Sunday to Saturday and lock Sunday 00:00 IST. See [docs/features/FINANCE-CALCULATIONS-AND-LOCKING.md](docs/features/FINANCE-CALCULATIONS-AND-LOCKING.md).

---

## Feature map

| Domain | Covers |
|---|---|
| **Auth & users** | Login, refresh, change password, admin user provisioning |
| **Accounts** | Client / vendor leads (type unset until classified), stage machine, classify, meeting mode / location / attendees, team-wide BDA mutate, specialization filter, lock on drop (BDA/Admin unlock) |
| **Requirements & seats** | Jobs (managed services / recruitment / project), seats, assign / unassign history, seat stages |
| **Profiles** | Candidates, skills, CTC, availability, on-bench flag, resume upload |
| **Submissions** | Put candidate forward, pipeline stages, margin, kanban by stage |
| **Interviews** | Six named rounds (`internal_r1/r2`, `client_r1/r2/r3`, `hr_cto_ceo`), schedule, feedback, rating, result; soft warning on missing mandatory rounds |
| **Collaboration** | Comments, documents, stage history audit |
| **Org & HR** | Orgs, departments, designations, teams, assets, org chart, invites, external CA / Legal access |
| **Time & leave** | Company and project calendars, attendance, leave balances, project-centric timesheets, overtime approval |
| **Money** | Payroll runs and payslips, billing / invoices, expenses and vendor payments, vendor commissions, accounting ledger and tax, finance categories, profitability |
| **Live Analytics** | Financials, calculations, contracts, projects, per-record locks, valuation trends |
| **Group** | Group Dashboard, org-wide alerts, company switching, coming-soon companies |
| **Company workspaces** | Zephyr (`/zephyr`), Gulati (`/gulati`), Acconcy (`/acconcy`), trading (`/trading`), leads (`/leads`) |
| **Ops & insights** | Role-scoped dashboard with click-through KPI cards, stuck lists, reports (incl. client / vendor performance), Excel / PDF export |

---

## Domain model

### Entity chain

```mermaid
flowchart LR
  User[User + role] --> Account
  Account --> Requirement
  Requirement --> Seat
  Seat --> Submission
  Profile --> Submission
  Submission --> Interview[Interview round]
```

Supporting entities: **RequirementAssignment**, **Comment**, **Document**, **StageHistory**.

### Entity catalogue

| Entity | Purpose | Lock trigger |
|---|---|---|
| **User** | Identity + role (`bda` \| `sales` \| `recruiter` \| `admin`) | Soft-deactivate via `active` |
| **Account** | Unified lead; `type` (`client` \| `vendor`) is null until a one-way classify | `dropped` |
| **Requirement** | Job / project on an **active client** | `closed` / `dropped` |
| **RequirementSeat** | One headcount slot | `closed` / `dropped`; `joined_at` counts as closure |
| **RequirementAssignment** | Recruiter / sales assignment history (never deleted) | Soft end via `unassigned_at` |
| **Profile** | Candidate | — |
| **Submission** | Candidate × seat + commercials | Terminal pipeline stages |
| **InterviewRound** | One of six named rounds (`internal_r1/r2`, `client_r1/r2/r3`, `hr_cto_ceo`) + feedback / rating | Completing result sets `completed_at` |
| **StageHistory** | Append-only audit of stage moves / unlock | Immutable |
| **Document** / **Comment** | Files and notes linked by entity type + id | — |

### Key invariants

1. An account's **`type`** is set once, one-way, via `POST /accounts/:id/classify` (logged to `stage_history`); a lead can sit unclassified.
2. A **requirement** may only attach to an account with `type = client` and `stage = active`.
3. **Submissions** target a seat (headcount), not only a requirement.
4. **Assignments** are historical rows; unassign sets `unassigned_at` instead of deleting.
5. **Interview rounds** use six named types; `offer_sent` is hard-gated on unresolved rounds and `closed` on uncleared BGV, plus a soft warning when mandatory rounds (`internal_r1`, `hr_cto_ceo`) are missing.
6. **Margin** is computed on the server from commercial fields.
7. **Unlock** requires Admin + mandatory reason; audited; next terminal transition re-locks.

---

## User journeys

### End-to-end handoff

```mermaid
sequenceDiagram
  participant BDA
  participant Sales
  participant Recruiter
  participant Admin

  BDA->>BDA: Create lead → meeting → classify → active client
  Sales->>Sales: Create requirement + seats
  Sales->>Recruiter: Assign recruiter
  Recruiter->>Recruiter: Profile → submit → interviews → join
  Admin-->>Admin: Users, unlock, org reports as needed
```

| # | Who | Handoff |
|---|---|---|
| 1 | BDA | Creates lead → converts client to **active** |
| 2 | Sales | Opens requirement + seats; **assigns** recruiter |
| 3 | Recruiter | Adds profile, submits to seat, runs interviews to **join** |
| 4 | Admin | Unlocks records, manages users, reads **org** reports |

### BDA — lead to active account

| Step | Action | Outcome |
|---|---|---|
| 1. Capture lead | Create account with company + POC; `type` may be left unset | Stage = `lead`; BDA is owner |
| 2. Schedule meeting | Move → `meeting_scheduled`; set mode, date, notes, `meeting_location` (required when offline), Sales attendees | Tracked; can appear on stuck list if idle |
| 3. Classify | `POST /accounts/:id/classify` → `client` or `vendor` (one-way, audited) | Commercial fields for that type become relevant |
| 4. Convert or loop | → `active`, or `rescheduled` → meeting again | Active client unlocks Sales requirements |
| 5. Exit | Drop with reason → record locks | Visible in reports; Admin can unlock |

### Sales — open job and assign

| Step | Action | Outcome |
|---|---|---|
| 1. Pick active client | Open an active client account | Requirements only on active clients |
| 2. Create requirement | JD, tech stack, budget, seats, SLA | Status = `open`; Sales is owner |
| 3. Add seats | One seat per headcount | Seat status = `open` |
| 4. Assign recruiters | Assign / unassign (history kept) | Recruiters see assigned jobs |
| 5. Steer status | `open` → `in_progress` → hold / closed / dropped | Terminal states lock the requirement |

### Recruiter — source through join

| Step | Action | Outcome |
|---|---|---|
| 1. Add profile | Candidate + resume + skills / CTC / source | Ready to submit |
| 2. Put forward | Submission: seat + rates; live margin | Stage = `sourced` |
| 3. Internal screen | → `internal_screening`; `internal_r1` interview + feedback | Pass → client; fail → rejected |
| 4. Client cycle | Schedule `client_r1..r3` / `hr_cto_ceo` rounds → `offer_sent` → BGV | Multi-round; `offer_sent` gated on resolved rounds |
| 5. Close | `closed` + `joined_at`, or backout / rejected + reason | Locks; counts in reports |

### Admin — keep the org unblocked

| Step | Action | Outcome |
|---|---|---|
| 1. Provision users | Create / deactivate BDA, Sales, Recruiter, Admin | Team can log in with roles |
| 2. Oversee pipeline | Dashboard: stuck lists, activity | Intervene when aging / SLA slips |
| 3. Unlock | Unlock locked entity with mandatory reason | Audited; re-locks on next terminal move |
| 4. Report & export | Recruiter / sales / vendor / aging / closure | Org-wide visibility |

---

## Stage pipelines

### Account (lead)

```mermaid
stateDiagram-v2
  [*] --> lead
  lead --> meeting_scheduled
  meeting_scheduled --> active
  meeting_scheduled --> rescheduled
  rescheduled --> meeting_scheduled
  lead --> dropped
  meeting_scheduled --> dropped
  active --> [*]
  dropped --> [*]
```

Same machine for `client` and `vendor`. Owner is the BDA.

### Requirement status

```text
open → in_progress → on_hold
                   → closed | dropped
```

### Seat status

```mermaid
stateDiagram-v2
  [*] --> open
  open --> interviewing
  interviewing --> offer
  offer --> bgv
  bgv --> closed
  open --> dropped
  interviewing --> dropped
  closed --> [*]
  dropped --> [*]
```

Usually derived from the furthest-advanced active submission; can be overridden. **`joined_at`** is what counts as closure for performance.

### Submission pipeline

```mermaid
stateDiagram-v2
  [*] --> sourced
  sourced --> internal_screening
  internal_screening --> submitted_to_client
  submitted_to_client --> interview_scheduled
  interview_scheduled --> interview_result
  interview_result --> offer_sent
  offer_sent --> bgv
  bgv --> closed
  sourced --> backout: reason required
  sourced --> rejected: reason required
  closed --> [*]
  backout --> [*]
  rejected --> [*]
```

From **any** stage: `backout` or `rejected` (reason required).

---

## Roles and permissions

| Capability | BDA | Sales | Recruiter | Admin |
|---|---|---|---|---|
| Accounts (view) | All | All | All | All |
| Accounts (edit / stage / meeting / type / brought-by) | All | — | — | All |
| Unlock accounts | Yes | — | — | Yes |
| Unlock requirements / seats / submissions | — | — | — | Yes |
| Requirements + seats (view) | All | Own + assigned | Assigned | All |
| Requirements + seats (mutate) | — | Own | — | All |
| Assign recruiters | — | Yes | — | Yes |
| Profiles + submissions | View | View | CRUD | Full |
| Stage override (any → any) | — | — | — | Superadmin only |
| Reports scope | Own-lead metrics | Own reqs | Own subs | Org-wide |

---

## Security

| Control | Design |
|---|---|
| Transport | HTTPS at the edge (Nginx / TLS) |
| AuthN | JWT access + refresh; bcrypt passwords |
| AuthZ | Role middleware on routes; ownership filters in services |
| Locking | `is_locked` on terminal states; unlock with audited reason (BDA: accounts; Admin: any entity) |
| Input | Schema validation on write paths; uniform response envelope |
| Login abuse | Rate limit on `/auth/login` |
| CORS | Locked to frontend origin |
| Secrets | Environment / `.env` (never committed); `.env.example` as template |

Response envelope: `{ success: boolean, data: T, message?: string, errors?: [] }`.

---

## Reporting

| Report | Intent |
|---|---|
| Recruiter performance | Sourced vs submitted vs interviewed vs closed; funnel; time-in-stage; interview feedback / ratings; missing-mandatory-round counts; closures |
| Sales performance | Lead conversion; requirements opened/closed; closure time; budget pipeline; margin; submissions missing the `hr_cto_ceo` round |
| Vendor performance | Vendor-sourced profiles through shortlist/close; margin; backout; time-to-submit |
| Client performance | Mirror of vendor performance anchored on `type = client` accounts |
| BDA performance | Lead funnel by owner; unclassified leads; leads via LinkedIn; avg days lead → meeting |
| Aging / SLA | Stuck leads, requirements with no submissions, submissions stuck in stage, past `sla_days` |
| Closure | Joins with dates, final rates, margins — by period / client / recruiter |

In-app tables and charts plus server-side **Excel / PDF export**. Dashboard adds live widgets: counts, stuck lists, recent activity — different per role. Each KPI card is a **click-through** into its list page, pre-filtered to exactly what the card counts.

---

## API surface

Base path: `/api/v1` (full contracts in the API spec).

| Area | Representative endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/change-password` |
| Users | `GET /users/me`, admin `GET/POST/PATCH /users` |
| Accounts | CRUD + `POST /accounts/:id/stage` + `POST /accounts/:id/classify` + `GET /accounts/specializations` + `?specialization=` |
| Requirements | CRUD + assign / unassign + status |
| Seats | List/create under requirement + `POST /seats/:id/stage` |
| Profiles | CRUD + resume via documents |
| Submissions | CRUD + `POST /submissions/:id/stage` |
| Interviews | `POST /submissions/:id/interview-rounds`, `PATCH /interview-rounds/:id` |
| Comments / documents | List/create/delete by entity |
| Admin | `POST /admin/:entity/:id/unlock` |
| Dashboard | Role-scoped summary + stuck lists |
| Reports | Recruiter / sales / vendor / client / bda / aging / closure + export |
| Orgs & access | `/orgs`, `POST /auth/switch-org`, `/invites`, `/teams`, `/departments`, `/designations`, `/org-chart` |
| Time & leave | `/calendars`, `/attendance`, `/leave`, `/timesheets`, `/allocations`, `/tasks` |
| Money | `/payroll`, `/billing`, `/expenses`, `/vendor-commissions`, `/accounting`, `/profitability`, `/finance-categories` |
| Analytics | `/financials`, `/analytics`, `/calculations`, `/contracts`, `/projects` |
| Group | `/super-dashboard` (`/group/overview`, `/group/activity`), `/external-access` |
| Workspaces | `/zephyr`, `/gulati`, `/acconcy`, `/trading`, `/leads` |
| Platform | `/notifications`, `/interviews` (calendar feed), `/pipeline` (board), `/client-errors`, `GET /health` |

---

## Codebase structure

```text
delphic_one/
  client/                   # React SPA
    src/app/                # Router + layout
    src/pages/<domain>/     # Screens by domain (accounts, requirements, payroll, time, finance, zephyr, gulati, acconcy, groupOverview, ...)
    src/components/         # UI primitives + layout
    src/lib/                # apiClient, auth context
  server/                   # Express API
    prisma/                 # schema, migrations, seed
    src/modules/            # domain: routes → controller → service → validation
    src/middleware/         # auth, lock, errors, request logging
    src/config/             # env, Prisma client, logger
    src/jobs/               # background jobs (e.g. interview reminders)
    src/lib/                # shared helpers (e.g. groupAccess)
    tests/
  docs/                     # architecture/, features/, ui/, testing/, progress/, guides/ + AGENTS.md
  scripts/                  # lint-changed, db-backup, ...
  docker-compose.yml        # local; docker-compose.prod.yml for production
  start-platform.sh|ps1     # one-command local dev
  start-delphic.sh          # production deploy script
```

**Domain modules (examples):**

- **Recruitment:** `auth`, `users`, `accounts`, `requirements` (incl. seats), `profiles`, `submissions` (incl. interview rounds), `comments`, `documents`, `admin`, `dashboard`, `reports`, `pipeline`, `interviews`, `notifications`.
- **Platform:** `orgs`, `access`, `invites`, `teams`, `departments`, `designations`, `assets`, `calendars`, `attendance`, `leave`, `timesheets`, `allocations`, `tasks`, `orgChart`, `externalAccess`.
- **Money:** `payroll`, `billing`, `expenses`, `vendorCommissions`, `accounting`, `profitability`, `financeCategories`, `financials`, `analytics`, `calculations`, `contracts`, `projects`.
- **Group and workspaces:** `superDashboard`, `zephyr`, `gulati`, `acconcy`, `trading`, `leads`.

---

## Stack

- **Client:** React + Vite + Tailwind CSS
- **Server:** Node.js / Express + Prisma ORM (PostgreSQL)
- **Edge:** Nginx (TLS, SPA, `/api` proxy)
- **Runtime:** Docker Compose (`db`, `server`, `client`) — see below
- **Jobs:** in-process background jobs for reminders and similar scheduled work
- **Logging:** Structured backend logger — [docs/guides/BACKEND-LOGGING.md](docs/guides/BACKEND-LOGGING.md)

---

## Branching

- `main` — production; pushes here trigger CI and the deploy workflow
- `staging` — pre-production integration
- `dev` — trunk for feature work before promotion to `staging`
- Feature branches (for example `super_admin_branch`, `acconcy-finance-workspace`) are built and tested locally; an agent never pushes to `main`, the human advances it

---

## Local setup

### One command (Postgres in Docker, API and client with hot reload)

```bash
./start-platform.sh            # db + migrate deploy, then API :4000 + client :5173
./start-platform.sh --restore  # restore the newest backup-*.dump, migrate, run
./start-platform.sh --seed     # synthetic CSV seed chain
./start-platform.sh --down     # stop the db container
```

PowerShell: `.\start-platform.ps1` with `-Restore`, `-Seed`, `-Fresh`, `-DbOnly`, `-Down`. Company demo data: `npm run zephyr:seed`, `npm run gulati:seed`, `npm run acconcy:seed`.

### Docker

```bash
docker compose up -d --build
docker compose run --rm --entrypoint "" server sh -c "node prisma/seed.js"
```

- Client: http://localhost:8081
- API: http://localhost:4000
- Postgres (host tools, e.g. `psql`): `localhost:5434`

Copy `.env.example` to `.env` to override ports, secrets, or `LOG_LEVEL`. API logs: `docker compose logs -f server`.

To generate a **new** Prisma migration after changing `server/prisma/schema.prisma`, run it from the host (not inside an ephemeral `docker compose run` container) with `DATABASE_URL` pointed at `localhost:5434`. See [docs/AGENTS.md](docs/AGENTS.md).

### Without Docker

```bash
npm install --workspaces

cp server/.env.example server/.env
# edit server/.env with DATABASE_URL, JWT secrets, optional LOG_LEVEL

npm run migrate
npm run seed

npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173
```

Seeded users (password `Password123!`):

- `admin@delphic.in` — admin
- `tanvi.saxena@delphic.in` — sales
- `chahak.pandya@delphic.in` — bda
- `dheeraj.kumar@delphic.in` / `Garv@delphic.in` — recruiter

Full roster: `server/prisma/team-roster.js`. Domain data: `npm run seed:accounts` then `npm run seed:jira` (optional `seed:vendors`).

---

## Deployment

### Pipeline

```mermaid
flowchart LR
  Dev[Feature branch] --> CI[CI — lint, client build, 4 test shards, compose smoke]
  CI --> Stg[staging]
  Stg --> Main[main — human push only]
  Main --> Deploy[deploy.yml — SSH to VPS]
  Deploy --> Script[start-delphic.sh --prod]
  Script --> Bak[Verified pg_dump to backups/]
  Bak --> Mig[prisma migrate deploy]
  Mig --> Up[Docker Compose up]
  Up --> Health[Health check]
```

`.github/workflows/ci.yml` skips docs-only changes and runs `build` plus four Jest shards (each with its own Postgres service) in parallel. `.github/workflows/deploy.yml` runs on push to `main`; enable it with repository variable `DEPLOY_ENABLED=true` and secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`. A separate workflow handles Render staging.

### Production layout

```text
Internet → host Nginx (TLS, Let's Encrypt)
             ├── /     → client container (React build)
             └── /api  → server container (Node)
                           → db container (PostgreSQL)
                           → upload volume
```

Images are defined in `docker-compose.yml` and `docker-compose.prod.yml`; `setup-vm.sh` prepares a VM and `nginx.conf.example` is the edge template.

Data safety: `start-delphic.sh --prod` takes a verified backup before building or migrating and aborts if it fails; seed scripts refuse to run against production; migrations shipped with feature code must be additive (no `DROP`, destructive type change, rename or `TRUNCATE`). Runbook: [docs/guides/DEPLOY-RUNBOOK.md](docs/guides/DEPLOY-RUNBOOK.md).

Operational expectations: health checks, `prisma migrate deploy` on server start, scheduled `scripts/db-backup.sh`, secrets only via environment.

---

## Further reading

| Doc | Contents |
|---|---|
| [docs/architecture/HLD.md](docs/architecture/HLD.md) | Full high-level design |
| [docs/architecture/ARCHITECTURE-OVERVIEW.md](docs/architecture/ARCHITECTURE-OVERVIEW.md) | Shareable diagrams and journeys |
| [docs/architecture/Requirement-Dashboard-System-Design-v2.md](docs/architecture/Requirement-Dashboard-System-Design-v2.md) | Field-level data model |
| [docs/architecture/API-Spec-and-Build-Plan.md](docs/architecture/API-Spec-and-Build-Plan.md) | Exact HTTP contracts |
| [docs/architecture/MULTI-COMPANY-ERP-PLATFORM-HLD.md](docs/architecture/MULTI-COMPANY-ERP-PLATFORM-HLD.md) | Multi-company design and phase status |
| [docs/features/README.md](docs/features/README.md) | Feature specs (finance, Zephyr, Gulati, Acconcy, Group Dashboard) |
| [docs/guides/DEPLOY-RUNBOOK.md](docs/guides/DEPLOY-RUNBOOK.md) | Manual deploy, backup, rollback |
| [docs/ui/UI-UX-JIRA.md](docs/ui/UI-UX-JIRA.md) | Frontend UX standing rule |
| [docs/testing/TESTING-DEMO-SEED.md](docs/testing/TESTING-DEMO-SEED.md) | Demo seed + UI walkthroughs |
| [docs/progress/SPRINT-PLAN.md](docs/progress/SPRINT-PLAN.md) | Sprint tickets |
| [docs/guides/BACKEND-LOGGING.md](docs/guides/BACKEND-LOGGING.md) | Logging guide |
| [docs/AGENTS.md](docs/AGENTS.md) | Agent / contributor context (docs index) |
