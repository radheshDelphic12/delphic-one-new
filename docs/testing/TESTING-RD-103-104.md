# How to test RD-103 / RD-104 (Job requirements UI)

**Tickets:** RD-103 (requirement detail + seat stages + assignees) · RD-104 (create/edit form + status + add seat)  
**Owner:** Dev B · Day 1 (Aug 22)  
**Automated coverage:** `cd server && npm test` — includes `requirements-crud-ui.test.js` and `stage-machines.test.js` (**62** tests total).

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Automated tests](#2-automated-tests)
3. [Manual UI walkthrough](#3-manual-ui-walkthrough)
4. [Role matrix](#4-role-matrix)
5. [What “done” looks like](#5-what-done-looks-like)
6. [Common failures](#6-common-failures)

---

## 1. Prerequisites

Stack running (Docker recommended):

```powershell
docker compose up -d --build
docker compose exec server node prisma/seed.js
```

- UI: http://localhost:8081  
- API: http://localhost:4000  
- Seed password: `Password123!`  
- Quick login on `/login`: **Sales** (`sales1@delphic.local`) for create/edit; **Recruiter** for seat stages; **Admin** for everything.

Without Docker: `npm run migrate` / `npm run seed` / `npm run dev:server` + `npm run dev:client` (API on 4000, Vite on 5173).

Demo seed includes active clients (**Acme Active Client**, **Nova Softwares**). Full inventory: [TESTING-DEMO-SEED.md](TESTING-DEMO-SEED.md).

Check active clients if create still fails:

```powershell
docker compose exec server node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); p.account.findMany({where:{type:'client',stage:'active'}}).then(r=>{console.log(r); return p.`$disconnect();});"
```

---

## 2. Automated tests

From repo:

```powershell
cd server
npm test
```

Focus suites for these tickets:

```powershell
npx jest --runInBand tests/requirements-crud-ui.test.js tests/stage-machines.test.js tests/requirements-stage.test.js
```

| Suite | What it proves |
|---|---|
| `stage-machines.test.js` | Next-status helpers match UI buttons (req + seat maps, reason / joined_at rules) |
| `requirements-crud-ui.test.js` | Create with tech stack, reject inactive client, PATCH edit fields, detail+seats+assignments+history, add seat, full seat path to closed with `joined_at`, status → `in_progress` |
| `requirements-stage.test.js` | Broader stage machine (drop reason, cannot close req with open seats, assign/unassign) |

Expect **62** green tests after this change set.

---

## 3. Manual UI walkthrough

### A. List + Create (RD-104)

1. Log in as **Sales** (or Admin).
2. Open **Requirements**.
3. Confirm **+ Create** is visible (hidden for BDA/Recruiter).
4. Click a title link — opens detail (RD-103). Click **+ Create**.
5. Select an **active client**, title, type, seats (≥1). Optionally fill tech stack as `Python, React`.
6. Submit → lands on `/requirements/:id` detail.
7. Confirm seats table has N rows (`Seat 1` …).

### B. Edit form (RD-104)

1. On detail (as owner sales/admin), click **Edit**.
2. Change title / location / priority → **Save changes**.
3. Confirm detail shows updated fields.

### C. Requirement status (RD-104)

1. On detail, under **Requirement status**, click **Move to in progress**.
2. Confirm badge updates; history lists the change.
3. Try **Move to dropped** without reason → Confirm disabled until reason entered; with reason → locks.

### D. Add seat (RD-104)

1. Click **+ Add seat**, optional label `Seat 2 — Backend`, confirm.
2. Seats count and table grow by one; `seats_total` on header increments.

### E. Seat stages (RD-103)

1. Log in as **Recruiter** (or stay as Sales/Admin).
2. Open the same requirement.
3. On an **open** seat, click **→ interviewing**, then **→ offer**, then **→ bgv**.
4. Click **→ closed** → date picker for **Joined date** required → confirm.
5. Seat shows Locked + joined date. (Closing the last open seat may auto-close the parent requirement.)

### F. Assignees panel (RD-103 read-only)

1. Detail shows **Assigned recruiters** and **Assignment history**.
2. Assign UI itself is **RD-106** (not this ticket) — empty list is OK until that lands.

---

## 4. Role matrix

| Action | BDA | Sales (owner) | Sales (other) | Recruiter | Admin |
|---|---|---|---|---|---|
| List (scoped) | yes* | own only | own only | assigned only | all |
| Create | no | yes | yes | no | yes |
| Edit / status / add seat | no | own | 403 | no | yes |
| Seat stage moves | no | yes | yes | yes | yes |

\*BDA may see empty list depending on API filters — they are not the primary audience for requirements.

---

## 5. What “done” looks like

- [ ] Routes work: `/requirements`, `/requirements/new`, `/requirements/:id`, `/requirements/:id/edit`
- [ ] Create requires active client; creates seats
- [ ] Detail shows info panels, seats table with stage buttons, assignees, history
- [ ] Status + seat modals enforce reason / `joined_at`
- [ ] `npm test` green
- [ ] Compared roughly to [UI-UX-JIRA.md](../ui/UI-UX-JIRA.md) (dense table, Create, status chips) — full Jira chrome polish can continue under RD-115

---

## 6. Common failures

| Symptom | Likely cause |
|---|---|
| Create form: “No active client accounts” | No `stage=active` clients — activate one first |
| 403 on edit/status | Logged in as non-owner sales or recruiter |
| Cannot close requirement | Seats still open — close/drop seats first |
| Seat close 400 | Missing `joined_at` |
| Drop 400 | Missing `reason` |
| Blank list as sales | Only own requirements are listed |
