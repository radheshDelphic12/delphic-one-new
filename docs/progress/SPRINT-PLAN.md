# Sprint Plan — Aug 21 → Aug 28

Plain-language ticket breakdown for two full-stack developers. Goal: everything — including testing — is finished by end of day **Aug 27**. **Aug 28 is deploy day only**, no new feature work.

Where things stand as of Aug 26: product UI + backend + **RD-114 reports** + **RD-128 change password** + **RD-116 linter** + **RD-120 Docker compose CI smoke** + **RD-133 UI redesign** + **RD-121 deploy story** are **done**. **Open (2):** RD-119 E2E · RD-122 deploy day — see [PROGRESS.md](PROGRESS.md) and ticket snapshot below.

**Aug 27 — V2 initiative (no RD ticket numbers assigned yet):** lead capture (nullable account type, classify flow, meeting location/attendees), candidate interview round taxonomy (named rounds + soft mandatory-round warning + Sales client-round access), requirement types (managed services/recruitment/project), candidate on-bench flag, new client-performance report. Implemented, tested (117/117), lint-clean, builds clean — on local branch `feature/v2-lead-pipeline-requirements`, not committed/pushed. Full detail: [V2-LEAD-PIPELINE-REQUIREMENTS.md](../architecture/V2-LEAD-PIPELINE-REQUIREMENTS.md).

**Aug 27 — Interviewer multiselect + alert banners (`7ba5c90`):** internal rounds pick multiple active users; dismissable alert banners replace many inline errors.

**UI/UX standing rule:** all product screens must feel **Jira-like** (dense filters + issue list). See [UI-UX-JIRA.md](../ui/UI-UX-JIRA.md) and the reference screenshot before building or polishing FE tickets. Post–Aug 21 list/create flows also follow the **RHS drawer** rules in [UI-REDESIGN.md](../ui/UI-REDESIGN.md).

Both developers are full-stack. Each owns complete features end-to-end so neither is stuck waiting on the other.

---

## Ticket status key

| Mark | Meaning |
|---|---|
| *(no mark)* | Open — still to build |
| **DONE (Aug 21)** | Finished. Keep the original ticket text; do not strikethrough it. |

---

## Ticket status snapshot (Aug 21)

### Done (30)

| Ticket | Name |
|---|---|
| RD-101 | Client/Vendor detail page + stage move |
| RD-102 | Add/Edit Client/Vendor forms |
| RD-103 | Job Requirement detail + seat stage controls + assignees |
| RD-104 | Add/Edit Job Requirement + status + Add seat |
| RD-105 | Candidate detail + Add/Edit + resume upload |
| RD-106 | Assign recruiter popup + assignment history |
| RD-107 | Submission detail page |
| RD-108 | Put candidate forward (create submission) |
| RD-109 | Reusable Notes + Files components |
| RD-110 | Drop Notes/Files on all four detail pages (Account, Job, Candidate, Submission) |
| RD-111 | Submission stage pipeline buttons |
| RD-112 | Kanban board for one job |
| RD-113 | Real role dashboard (widgets) |
| RD-114 | Reports tables/charts + date range + export UX |
| RD-115 | Spec UI walkthrough + Jira-like UX check |
| RD-116 | Basic ESLint (client + server) |
| RD-117 | Stage-machine automated tests |
| RD-118 | Auth + locking automated tests |
| RD-120 | CI Docker / compose smoke (login) |
| RD-123 | Stuck leads / stuck requirements on dashboard (API) |
| RD-124 | Avg days on recruiter + vendor reports |
| RD-125 | Interview rounds UI |
| RD-126 | Admin Users page |
| RD-127 | Unlock UI (admin) |
| RD-128 | Change password UI |
| RD-129 | Ownership on mutate + dashboard role scoping (BE) |
| RD-130 | Split admin / comments / documents modules |
| RD-131 | Temporary one-click role login |
| RD-132 | Interview feedback API + richer interview/closure report metrics |
| RD-133 | UI redesign — blue theme, RHS drawers, list peeks, pipeline KPIs, BDA/Sales reports |
| RD-121 | Live deploy story — `setup-vm.sh` + `start-delphic.sh --prod` (Docker Compose, not PM2), `deploy.yml` SSHs and runs it |

Also done (not an RD ticket): structured backend logging — [BACKEND-LOGGING.md](../guides/BACKEND-LOGGING.md); role-specific pipeline boards with drag-and-drop; server entity access guards + fail-closed prod env validation; `seed-admin.js` prod bootstrap.

### Open (2)

| Ticket | Name |
|---|---|
| RD-119 | Full E2E click-through (all roles) |
| RD-122 | Deploy day — needs `DEPLOY_ENABLED` + VPS secrets set for a real run |

---

## Day 1 — Fri Aug 22 — Clients & Jobs get real pages

| Ticket | Owner | What to build |
|---|---|---|
| RD-101 | Dev A | Full detail page for one Client/Vendor — all their info, current status, stage history, a button to move them to the next stage (popup for reason / meeting fields when required) **DONE (Aug 21)** |
| RD-102 | Dev A | "Add new Client/Vendor" and "Edit" forms (company, POC, vendor/client-specific fields) **DONE (Aug 21)** |
| RD-103 | Dev B | ~~Full detail page for one Job Requirement — info panels, **seats table with per-seat stage controls** (Open → Interviewing → Offer → BGV → Closed/Dropped, including `joined_at` when closing), who's assigned~~ **DONE (Aug 21)** — `/requirements/:id` |
| RD-104 | Dev B | ~~"Add new Job Requirement" form, requirement status button (Open → In Progress → On Hold → Closed/Dropped), and **Add seat**~~ **DONE (Aug 21)** — `/requirements/new`, `/:id/edit`, status + add-seat on detail |

## Day 2 — Sat Aug 23 — Candidates & putting them forward

| Ticket | Owner | What to build |
|---|---|---|
| RD-105 | Dev A | Candidate detail page and "Add/Edit Candidate" form, including uploading a resume (documents API) **DONE (Aug 21)** |
| RD-106 | Dev A | Popup for assigning a recruiter to a job, plus assignment history (assign / unassign) **DONE (Aug 21)** |
| RD-107 | Dev B | ~~Submission detail page — candidate, job/seat, stage stepper, commercials/margin, BGV fields, history~~ **DONE (Aug 21)** — `/submissions/:id` |
| RD-108 | Dev B | ~~"Put a candidate forward for a job" flow — pick candidate + seat, enter rates, live margin~~ **DONE (Aug 21)** — `/submissions/new` |

## Day 3 — Sun Aug 24 — Moving people through the pipeline

| Ticket | Owner | What to build |
|---|---|---|
| RD-109 | Dev A | One reusable "Notes" (comments) box and "Files" (documents) uploader **DONE (Aug 21)** |
| RD-110 | Dev A | Drop Notes + Files onto all four detail pages (Client, Job, Candidate, Submission) **DONE (Aug 21)** |
| RD-111 | Dev B | ~~Submission stage buttons through the full pipeline (`sourced` → … → closed), with reason popups for backout/rejection~~ **DONE (Aug 21)** |
| RD-125 | Dev B | ~~**Interview rounds UI** on the submission detail page~~ **DONE (Aug 21)** — add/edit internal + client rounds |
| RD-132 | Dev B | ~~Interview feedback API + richer interview/closure report metrics~~ **DONE (Aug 21)** — feedback/rating on create+update; recruiter/sales reports include interviews done, by type/result, feedback coverage, avg rating, turnaround days, closures |
| RD-112 | Dev B | ~~Visual board (like Trello) showing all candidates for one job, grouped by stage~~ **DONE (Aug 21)** — `/requirements/:id/board` |

## Day 4 — Mon Aug 25 — Dashboard & Reports that are actually useful

| Ticket | Owner | What to build |
|---|---|---|
| RD-113 | Dev A | Real home-screen dashboard: summary numbers, stuck list (API already returns data), recent activity — different widgets per role (BDA / Sales / Recruiter / Admin). Backend already role-scopes the summary. **DONE (Aug 21)** |
| RD-114 | Dev B | Reports: real tables/charts per report type (not raw JSON), date-range picker, Excel/PDF download that saves a usable file (endpoint already exists) **DONE (Aug 21)** — `/reports` |
| RD-133 | Both | ~~UI redesign~~ **DONE (Aug 21)** — blue theme + lean `global.css`; shared `DataTable`/`ListToolbar`; create + row-peek as **RHS drawers only**; real KPI cards + admin-visible pipeline charts; required interview date/time; admin **BDA performance** + sales-by-owner reports. Guide: [UI-REDESIGN.md](../ui/UI-REDESIGN.md) |

## Day 5 — Tue Aug 26 — Catching what's missing, admin UX, tests

| Ticket | Owner | What to build |
|---|---|---|
| RD-115 | Dev A | Spec walkthrough page-by-page — every screen/button in the design/API docs exists; fix gaps found; **must pass Jira-like UX check** ([UI-UX-JIRA.md](../ui/UI-UX-JIRA.md)) **DONE (Aug 21)** — see [RD-115-SPEC-WALKTHROUGH.md](../ui/RD-115-SPEC-WALKTHROUGH.md); Dev B gaps left open |
| RD-126 | Dev A | **Admin Users page** — list / create / deactivate users (BDA, Sales, Recruiter, Admin). Only admin can create; share creds with the team. **DONE (Aug 21)** — `/users` page + nav (admin only); API was already admin-gated |
| RD-127 | Dev A | **Unlock UI** — on locked account / requirement / seat / submission detail pages, admin-only "Unlock" with mandatory reason (`POST /admin/:entity_type/:entity_id/unlock`) **DONE (Aug 21)** |
| RD-128 | Dev B | **Change password** — reachable from the header/profile menu (`POST /auth/change-password`) **DONE (Aug 21)** — avatar menu modal |
| RD-131 | Dev A | Temporary one-click role login on `/login` for seeded Admin/BDA/Sales/Recruiter **DONE (Aug 21)** — remove / disable (`VITE_DISABLE_QUICK_LOGIN=true`) when real auth lands |
| RD-123 | Dev A | Stuck leads / stuck requirements on dashboard **DONE (Aug 21)** |
| RD-124 | Dev A | Avg days on recruiter + vendor reports **DONE (Aug 21)** |
| RD-117 | Dev B | Stage-machine automated tests **DONE (Aug 21)** |
| RD-118 | Dev B | Auth + locking automated tests **DONE (Aug 21)** |
| RD-129 | Dev B | Ownership on mutate + dashboard role scoping (BE) **DONE (Aug 21)** |
| RD-130 | Dev B | Split admin / comments / documents into routes/controller/service/validation **DONE (Aug 21)** |

## Day 6 — Wed Aug 27 — Full run-through and getting ready to switch on

| Ticket | Owner | What to build |
|---|---|---|
| RD-119 | Both, together | Click through the entire app as each role (BDA, Sales, Recruiter, Admin) end-to-end — including an **internal recruiter interview round**, seat close, unlock, and create a real user. Log and fix bugs same day. |
| RD-116 | Dev A | Turn on a basic linter so typos and obvious mistakes get flagged automatically **DONE (Aug 21)** — `npm run lint` (ESLint 9 flat config for `server/src` + `client/src`) |
| RD-120 | Dev A | CI builds Docker images / compose smoke (at least login) **DONE (Aug 21)** — `.github/workflows/ci.yml` lint + build + `docker compose` health/seed/login |
| RD-121 | Dev B | Decide live deployment story (Docker vs old PM2/Nginx `deploy.yml`) and get it ready so Aug 28 is "press go" |

## Day 7 — Thu Aug 28 — DEPLOY DAY

| Ticket | Owner | What to build |
|---|---|---|
| RD-122 | Both, together | Final check, deploy, smoke-test live, create real team accounts (prefer RD-126 Users UI; seed/API fallback if needed). Stay available for urgent issues. |

---

## Backend vs frontend (quick map)

| Area | Backend | Frontend ticket(s) |
|---|---|---|
| Accounts CRUD + stages | Done | **RD-101, RD-102 DONE** |
| Requirements + seats + assign | Done | **RD-103 DONE**, **RD-104 DONE**, **RD-106 DONE** |
| Profiles + resume upload | Done | **RD-105 DONE**; resume via RD-109 FilesPanel |
| Submissions + margin + stages | Done | **RD-107/108/111 DONE** |
| Interview rounds (incl. **internal** + feedback) | Done | **RD-125 DONE** |
| Recruiter interview/closure report metrics | Done (RD-132) | **RD-114 DONE** |
| Comments + documents | Done (split Aug 21) | **RD-109 / RD-110 DONE** (all four detail pages) |
| Kanban by stage | Done | **RD-112 DONE** (`/requirements/:id/board`) |
| Dashboard stuck + role scope | Done (RD-123/129) | **RD-113 DONE** |
| Report avg days + export API | Done (RD-124) | **RD-114 DONE** |
| UI redesign (drawers, peeks, pipeline, BDA report) | Done (BDA report + required `scheduled_at`) | **RD-133 DONE** — [UI-REDESIGN.md](../ui/UI-REDESIGN.md) |
| Admin unlock API | Done | **RD-127 DONE** |
| Users admin API | Done | **RD-126 DONE** |
| Change password API | Done | **RD-128 DONE** |
| One-click test login (temporary) | N/A (FE only) | **RD-131 DONE** — replace before prod |
| Stage/auth/locking tests | Done (RD-117/118) | — |

---

## Rules for the week

- **No new features on Aug 28.** If it's not done and tested by end of Aug 27, it waits for the next release.
- If a ticket runs long, the other developer helps rather than starting new work — better to finish Day N's tickets a bit late than to start Day N+1 short-handed going into deploy day.
- Update [PROGRESS.md](PROGRESS.md) and [TODO.md](TODO.md) as tickets land.
- Do not commit or push unless the human asks.
