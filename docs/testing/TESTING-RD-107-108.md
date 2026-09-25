# How to test RD-107 / RD-108 (Submissions UI)

**Tickets:** RD-107 (submission detail) · RD-108 (put candidate forward)  
**Owner:** Dev B · Day 2 (Aug 23)  
**Automated coverage:** `cd server && npm test` — includes `submissions-crud-ui.test.js` and `submission-stage-machines.test.js` (**72** tests total).

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Automated tests](#2-automated-tests)
3. [Manual UI walkthrough](#3-manual-ui-walkthrough)
4. [Role matrix](#4-role-matrix)
5. [What “done” looks like](#5-what-done-looks-like)
6. [Common failures](#6-common-failures)

---

## 1. Prerequisites

```powershell
docker compose up -d --build
docker compose exec server node prisma/seed.js
```

- UI: http://localhost:8081  
- Seed password: `Password123!`  
- Use quick login **Recruiter** for create/detail edits; **Sales** to ensure a requirement + open seat exists (RD-103/104).

You need:

1. An **active client** + **open requirement with at least one open seat** (Sales: Requirements → Create).  
2. An **active candidate profile** (Profiles list / seed / API). Put-forward UI loads `GET /profiles?is_active=true`.

---

## 2. Automated tests

```powershell
cd server
npm test
```

Focused:

```powershell
npx jest --runInBand tests/submissions-crud-ui.test.js tests/submission-stage-machines.test.js tests/submissions-stage.test.js
```

| Suite | Proves |
|---|---|
| `submission-stage-machines.test.js` | Pipeline helpers + margin formula |
| `submissions-crud-ui.test.js` | Create + margin, vendor rate gate, sales 403 on create, get detail/history, PATCH commercials/BGV |
| `submissions-stage.test.js` | Full stage machine (existing) |

Expect **72** green tests.

---

## 3. Manual UI walkthrough

### A. Put forward (RD-108)

1. Login as **Recruiter** (or Admin).  
2. **Submissions** → **+ Put forward**.  
3. Select candidate, job, open seat.  
4. Enter proposed rate `100` INR and vendor rate `70` INR — live margin shows **30 (30%)**.  
5. Optional notes / relevancy → **Create submission** → lands on detail.

### B. Detail page (RD-107)

1. From list, click candidate name (or stay on detail after create).  
2. Confirm: stage stepper, candidate panel, job/seat panel, commercials, offer/BGV, interview rounds list (may be empty), history.  
3. Change proposed/vendor rates → preview updates → **Save commercials & BGV**.  
4. Set BGV status / notes → save again.  
5. **Open job** link goes to requirement detail.

### C. Negative checks

1. As **Sales**, **+ Put forward** is hidden; direct `/submissions/new` shows not allowed.  
2. Vendor-sourced candidate without vendor rate → API rejects (form marks vendor rate required).

---

## 4. Role matrix

| Action | Recruiter | Admin | Sales / BDA |
|---|---|---|---|
| List / open detail | yes | yes | yes (read) |
| Put forward (create) | yes | yes | no |
| Edit commercials / BGV | yes | yes | no |
| Stage move buttons | RD-111 | RD-111 | — |

---

## 5. What “done” looks like

- [ ] Routes: `/submissions`, `/submissions/new`, `/submissions/:id`  
- [ ] Create: profile + requirement + seat + live margin  
- [ ] Detail: stepper, candidate/job, commercials/margin, BGV, history  
- [ ] `npm test` green  
- [ ] Stage **buttons** deferred to RD-111; interview **CRUD** deferred to RD-125 (rounds still listed if present)

---

## 6. Common failures

| Symptom | Likely cause |
|---|---|
| No candidates in dropdown | No active profiles — create/activate one |
| No seats | Requirement seats closed/locked — add seat or use open job |
| Margin preview blank | Missing one rate or currency mismatch |
| 403 on create | Not recruiter/admin |
| Duplicate submission | Same profile already active on that seat |
