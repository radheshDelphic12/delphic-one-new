# Seeding data on production / VPS

How to get users and domain data into a **server** database after a manual
`git pull`. Production runs via `./start-delphic.sh --prod` on the VPS
(`/opt/delphic`), which is Docker Compose with **both** compose files and the
service name `server`. Migrations (`npx prisma migrate deploy`) run automatically
on every `server` container start — **seeding never does**, you run it by hand.

> Always run compose with both files, exactly as `start-delphic.sh` does:
> ```bash
> docker compose -f docker-compose.yml -f docker-compose.prod.yml <cmd>
> ```
> Run from `/opt/delphic`. Shorthand below: `dc`.
> ```bash
> alias dc='docker compose -f docker-compose.yml -f docker-compose.prod.yml'
> ```

## Seed scripts

| Script | npm (from repo root) | Destructive? | Use on live prod? |
|---|---|---|---|
| `seed-admin.js` | `npm run seed:admin` | **No** — one admin if none exists | ✅ Safe bootstrap |
| `seed.js` | `npm run seed` | **YES — wipes all domain data + users** | 🚫 Disposable / first-boot only |
| `seed-accounts.js` | `npm run seed:accounts` | Upserts LeadMinds clients by name | ⚠️ Staging / demo |
| `seed-jira.js` | `npm run seed:jira` | Replaces prior Jira-tagged requirements | ⚠️ Staging / demo |
| `seed-vendors.js` | `npm run seed:vendors` | Replaces `source: vendor_csv` vendors | ⚠️ Staging / demo |

**Recommended order (full CSV dataset on a disposable DB):**

```text
seed → seed:accounts → seed:jira → seed:vendors
```

Login after full seed: `*@delphic.in` / `Password123!`  
Quick login: Admin / BDA (Chahak) / Sales (Tanvi) / Recruiter (Sarthak).

## After a manual `git pull` on the VPS

### A) Safe production — first admin only (no wipe)

```bash
cd /opt/delphic
git pull

# rebuild so containers pick up new code
./start-delphic.sh --prod
# or: dc up -d --build

dc exec \
  -e ADMIN_EMAIL='you@delphic.in' \
  -e ADMIN_PASSWORD='<strong-password-min-10-chars>' \
  -e ADMIN_NAME='Your Name' \
  server node prisma/seed-admin.js
```

Create the rest of the team from **Admin → Users**.

### B) Full team + LeadMinds + Jira + vendors (staging / throwaway only)

`seed.js` **deletes everything**. Backup first if the DB has anything you care about.

```bash
cd /opt/delphic
git pull
./start-delphic.sh --prod   # or dc up -d --build

# optional backup
dc exec -T db pg_dump -U postgres requirement_dashboard | gzip > ~/delphic-$(date +%F-%H%M).sql.gz

# CSVs live under docs/ — not baked into the server image, so copy them in
dc exec server mkdir -p /app/docs/jira
dc cp docs/jira/Jira_all.csv              server:/app/docs/jira/Jira_all.csv
dc cp docs/jira/LeadMinds-Accounts.csv    server:/app/docs/jira/LeadMinds-Accounts.csv

# prisma scripts are in the image after rebuild; copy if you did not rebuild
dc cp server/prisma/seed.js               server:/app/server/prisma/seed.js
dc cp server/prisma/team-roster.js        server:/app/server/prisma/team-roster.js
dc cp server/prisma/client-aliases.js     server:/app/server/prisma/client-aliases.js
dc cp server/prisma/seed-accounts.js      server:/app/server/prisma/seed-accounts.js
dc cp server/prisma/seed-jira.js          server:/app/server/prisma/seed-jira.js
dc cp server/prisma/seed-vendors.js       server:/app/server/prisma/seed-vendors.js

dc exec server node prisma/seed.js
dc exec server node prisma/seed-accounts.js
dc exec server node prisma/seed-jira.js
dc exec server node prisma/seed-vendors.js
```

What each step loads:

1. **seed** — departments (Sales, HR, Vendor) + 13 Delphic team users  
2. **seed:accounts** — ~78 LeadMinds client accounts (canonical names; Girnarsoft merges Pragya variant; Devlabs → Devlabsalliance)  
3. **seed:jira** — 34 requirements under those accounts (full JD → `job_description`, recruiter assignments, comments)  
4. **seed:vendors** — 32 active vendor accounts  

### C) Re-import Jira only (keep users + LeadMinds accounts)

```bash
dc cp docs/jira/Jira_all.csv server:/app/docs/jira/Jira_all.csv
dc cp server/prisma/seed-jira.js server:/app/server/prisma/seed-jira.js
dc cp server/prisma/client-aliases.js server:/app/server/prisma/client-aliases.js
dc cp server/prisma/team-roster.js server:/app/server/prisma/team-roster.js
dc exec server node prisma/seed-jira.js
```

## Local (host, no Docker)

```powershell
npm run seed
npm run seed:accounts
npm run seed:jira
npm run seed:vendors
```

UI: http://localhost:5173 · API: http://localhost:4000 · DB: `localhost:5434`

## Migrations (reference — automatic)

```bash
dc exec server npx prisma migrate deploy
```

Never run `prisma migrate dev` against production.

## Verifying

```bash
dc exec server node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); Promise.all([p.user.count(),p.account.count(),p.requirement.count()]).then(([u,a,r])=>{console.log({users:u,accounts:a,requirements:r}); return p.\$disconnect();})"
curl -sf http://127.0.0.1:4000/api/v1/health
```
