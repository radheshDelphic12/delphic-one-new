# Database connection pooling & latency

How this repo manages Postgres connections today, and the concrete triggers
for the next steps (PgBouncer, read replica) called out but deliberately
deferred in [architecture/MULTI-COMPANY-ERP-PLATFORM-HLD.md](../architecture/MULTI-COMPANY-ERP-PLATFORM-HLD.md) §8.

## What's in place

- **One `PrismaClient` per process** (`server/src/config/db.js`), required
  everywhere via `require('../../config/db')`. Never `new PrismaClient()`
  anywhere else — a second instance means a second, uncoordinated connection
  pool. (Verified: `grep -rn "new PrismaClient"` returns exactly one hit.)
- **Explicit pool size per process**, not Prisma's default guess. Without
  `connection_limit`/`pool_timeout` on the connection string, Prisma computes
  the pool size as `num_physical_cpus * 2 + 1` — unreliable under Docker
  Desktop's cgroup CPU reporting, and invisible/undocumented to whoever's
  debugging a `pool_timeout` error later. Every `DATABASE_URL` in the repo
  now carries `?connection_limit=10&pool_timeout=20` (dev/test) or a
  `DB_POOL_SIZE`/`DB_POOL_TIMEOUT`-driven value (docker-compose, prod
  overlay defaults to 20).
- **Headroom on Postgres itself**: the local Docker Postgres
  (`docker-compose.yml`) runs with `max_connections=200` (default is 100).
  This matters now specifically because one Postgres instance
  (`localhost:5434`) is shared by more than one consumer: the normal dev
  server, the isolated `requirement_dashboard_erp` stack
  (`feature/multi-company-erp`), and `jest --runInBand` test runs — each is
  its own process with its own capped pool, but they all draw from the same
  `max_connections` ceiling.
- **Graceful shutdown**: `src/index.js`'s `SIGTERM`/`SIGINT` handler now
  calls `prisma.$disconnect()` after the HTTP server closes, instead of
  relying on process exit to drop the sockets.

## Where the extra per-request queries come from (and why they're fine)

`authorizeSuperadmin` / `loadSuperadminFlag` (pre-existing) and the
multi-company ERP work's `authenticate` → `resolveOrgContext` and
`authorizeGroupSuperadmin` (Phase 1) each re-read one row from the DB per
request, by design — the alternative is trusting a JWT claim for something
security-sensitive (role, superadmin flag), which means a demoted/offboarded
user keeps their old access until the token expires. Each of these is a
single point lookup on a unique/indexed key
(`users.id`, `org_memberships(person_id, org_id)`), sub-millisecond locally.
This is not a connection-pool problem (they reuse the same pooled
connection any other query on the request would) and not worth caching
until profiling actually shows it — the HLD's own Redis plan (§8) already
covers exactly this if/when multi-org traffic makes it hot: cache the
directory/membership lookups with a short TTL (30-60s) once there's real
concurrent load to justify it.

## Composite indexes for the actual query patterns

Every ERP time-series table added so far carries the two indexes the
super-dashboard and per-company dashboards both need (HLD §8):
`(org_id, date)` for company-wide date-range scans, `(org_membership_id,
date)` for per-employee lookups. `AttendanceRecord`/`LeaveRequest`
denormalize `org_id` directly (rather than only being reachable by joining
through `OrgMembership`) specifically so that first index is real, not a
join — see the Phase 2 log in
[MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md](../architecture/MULTI-COMPANY-ERP-IMPLEMENTATION-PLAN.md).

## Next steps — deferred on purpose, with concrete triggers

**PgBouncer** (transaction-pooling mode) in front of Postgres:
- **Trigger**: total connections across all app instances + background job
  processes starts approaching `max_connections`, or you deploy more than
  one server replica. Not needed today — one prod server instance at
  `connection_limit=20` is nowhere near 200.
- **The gotcha** (this is what actually breaks when people add PgBouncer
  later without reading this): PgBouncer's transaction-pooling mode
  multiplexes many client connections over few real Postgres backends, which
  is incompatible with prepared statements — Prisma caches prepared
  statements per connection by default. Add `?pgbouncer=true` to the
  `DATABASE_URL` Prisma uses (not PgBouncer's own connection string) to make
  Prisma skip prepared-statement caching. Skipping this step is the #1 way
  this integration silently misbehaves (random "prepared statement already
  exists" errors under load).

**Read replica** for `reports`/`profitability`/`super-dashboard` reads:
- **Trigger**: real multi-company write volume where heavy aggregate report
  queries start contending with OLTP writes (attendance check-ins,
  submission stage moves). Because DB access already goes through the
  service layer (no scattered raw queries), pointing specific services at a
  replica connection string later is additive, not a rewrite.

**Do not** reach for either of these speculatively — both add operational
surface (a proxy to run, a replica to keep in sync) that has no payoff at
current scale, per the HLD's own stated posture.

## Diagnosing a real pool problem

- Prisma throwing `pool_timeout` errors under load → the pool is exhausted
  faster than connections free up. Check for a query holding a transaction
  open too long before reaching for a bigger pool.
- `SELECT count(*) FROM pg_stat_activity;` on the Postgres container shows
  current connections across every consumer sharing the instance — use this
  before assuming a leak in this app specifically.
- A leak looks like connection count climbing and never coming back down
  between requests; a legitimately busy pool looks like it climbing and
  draining with traffic.
