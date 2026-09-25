# Testing RD-114 + RD-128 (Reports UI + Change password)

Manual checks for reports product behaviour (no infra).

## Prerequisites

- Stack running (`docker compose up --build` or local API + Vite).
- Seeded users. Prefer **Admin** for the full report list.

## RD-114 — Reports

1. Log in as **Admin** → **Reports**.
2. Confirm tabs include at least:
   - **BDA performance**
   - **Sales performance**
   - Recruiter / Vendor / Aging / Closure
3. Confirm default date range is this month (or FilterBar preset).
4. Run each report:
   - **BDA performance** → one row per BDA; leads / meeting / converted / stuck match seeded accounts owned by `bda1`.
   - **Sales performance** → requirements opened/closed, joinings, revenue/margin (not BDA lead counts).
   - Recruiter / Vendor → bar chart + dense table.
   - Aging → threshold days + four section tables.
   - Closure → group-by (month / client / recruiter).
5. Change dates / department / individual filter → table and chart refresh.
6. Click a report row → RHS peek drawer (not a full page).
7. Click **Excel** and **PDF** — usable download.
8. Log in as **Recruiter** → only Recruiter performance; no Excel/PDF.
9. Log in as **Sales** → no BDA/Sales performance tabs; can export Vendor / Aging / Closure / Recruiter as allowed.
10. Log in as **BDA** → Reports nav hidden (no `viewReports`).

### Why BDA vs Sales are separate

| Report | Groups by | Ownership field |
|---|---|---|
| BDA performance | `role = bda` | Account `owner_id` |
| Sales performance | `role = sales` | Requirement `sales_owner_id` |

## RD-128 — Change password

1. Avatar menu → **Change password**.
2. Wrong current password → error.
3. New password under 8 chars or mismatch → client validation error.
4. Valid change → success; login with new password works.

## Automated

```bash
cd server && npm test -- reports-ui.test.js auth.test.js
```

Note: host Prisma tests need `DATABASE_URL` on a DB that has applied migrations (including `department_id`). Prefer Docker Postgres on `localhost:5434` after `migrate deploy`.
