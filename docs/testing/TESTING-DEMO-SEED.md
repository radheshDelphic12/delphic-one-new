# How to test with seeded Delphic / Jira data

| Field | Value |
|---|---|
| **Purpose** | Load real team + LeadMinds clients + Jira requirements so lists and pipeline are non-empty |
| **Order** | `seed` → `seed:accounts` → `seed:jira` → `seed:vendors` (optional) |
| **As of** | 2026-08-31 |
| **Password** | `Password123!` for every `*@delphic.in` user |

## Table of contents

1. [Run seed](#1-run-seed)
2. [What gets created](#2-what-gets-created)
3. [Quick login](#3-quick-login)
4. [Role walkthroughs](#4-role-walkthroughs)
5. [Re-seed / wipe](#5-re-seed--wipe)
6. [Common failures](#6-common-failures)

---

## 1. Run seed

### Local (host + Docker Postgres)

```powershell
npm run seed
npm run seed:accounts
npm run seed:jira
npm run seed:vendors
```

UI: http://localhost:5173 · API: http://localhost:4000

### Docker compose

```powershell
docker compose up -d --build
docker compose exec server mkdir -p /app/docs/jira
docker compose cp docs/jira/Jira_all.csv server:/app/docs/jira/Jira_all.csv
docker compose cp docs/jira/LeadMinds-Accounts.csv server:/app/docs/jira/LeadMinds-Accounts.csv
docker compose exec server node prisma/seed.js
docker compose exec server node prisma/seed-accounts.js
docker compose exec server node prisma/seed-jira.js
docker compose exec server node prisma/seed-vendors.js
```

UI: http://localhost:8081

VPS / after `git pull`: [guides/PRODUCTION-SEED.md](../guides/PRODUCTION-SEED.md).

---

## 2. What gets created

| Step | Entity | Highlights |
|---|---|---|
| `seed` | Departments | Sales, HR, Vendor |
| `seed` | Users (~13) | Real `@delphic.in` roster (admin, BDA, sales, recruiters) |
| `seed:accounts` | Client accounts (~78) | LeadMinds export; canonical names |
| `seed:jira` | Requirements (34) | Account-wise; full JD in `job_description`; seats; comments |
| `seed:jira` | Assignments | Multi-assignee recruiters + comment mentions (Krupali / Dheeraj / Nikhil) |
| `seed:vendors` | Vendor accounts (32) | Active rows from vendor tracker |

**Client name aliases** (Jira → LeadMinds): GirnarSoft / Girnarsoft_Pragya → **Girnarsoft**; Devlabs → **Devlabsalliance**; Protonshub → Protonshub Technologies; etc. See `server/prisma/client-aliases.js`.

**Sales owner:** Jira import prefers a `sales`-role owner (Tanvi) so Sales can edit recruiter assignments in the UI.

Named anchors:

- **Girnarsoft** — one client (both Jira Girnar variants merged)
- **Devlabsalliance** — Devlabs Jira reqs
- **Protonshub Technologies**, **Apaar Information Systems**, **TridhiyaTech**

---

## 3. Quick login

Open `/login`. Role buttons or:

| Role | Email |
|---|---|
| Admin | `admin@delphic.in` |
| BDA | `chahak.pandya@delphic.in` |
| Sales | `tanvi.saxena@delphic.in` |
| Recruiter | `sarthak.solanki@delphic.in` |

Password: `Password123!`. Hide buttons with `VITE_DISABLE_QUICK_LOGIN=true`.

---

## 4. Role walkthroughs

### Admin

1. Quick login **Admin**.
2. **Requirements** — paginated list (20/page); expect ~34 total.
3. Open a req — Job description filled when Jira had a Description; **Assign recruiters** editable.
4. **Accounts** — LeadMinds clients + vendors.

### Sales (Tanvi)

1. Quick login **Sales**.
2. Own requirements (sales owner) — assign / unassign recruiters.
3. Pipeline board shows all matching reqs (no 20-item page cap).

### BDA / Recruiter

1. Assignments are **view-only** (Admin or Sales owner edits them).
2. BDA owns LeadMinds accounts where Account manager / Sales POC maps to them.

---

## 5. Re-seed / wipe

`npm run seed` **deletes all** users and domain data, then recreates the team.

Then re-run accounts → jira → vendors.

Do not run the wipe seed against a shared production DB with real data. Use `seed-admin` on live prod — see [PRODUCTION-SEED.md](../guides/PRODUCTION-SEED.md).

---

## 6. Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Only 20 requirements in list | Pagination default | Use Previous / Next; pipeline shows all |
| Empty JD on detail | Empty Description in CSV, or old seed | Re-run `seed:jira` |
| Assign recruiters greyed out | Not Admin / not sales owner | Login as Admin or Tanvi |
| Duplicate Girnarsoft | Old import before aliases | Full `seed` then accounts + jira |
| `CSV not found` in Docker | `docs/` not in image | `docker compose cp` the CSV files first |

---

## Related docs

- [PRODUCTION-SEED.md](../guides/PRODUCTION-SEED.md) — VPS post-pull commands  
- [AGENTS.md](../AGENTS.md) — local setup  
- [TESTING-RD-103-104.md](TESTING-RD-103-104.md) — requirements UI  
- [TESTING-RD-111-125-112.md](TESTING-RD-111-125-112.md) — pipeline  
