#!/usr/bin/env bash
#
# start-platform.sh — run the whole Delphic stack locally for development:
#   • Postgres in Docker (compose `db` service → localhost:5434)
#   • API server via nodemon  (localhost:4000, hot reload)
#   • Client via Vite         (localhost:5173, hot reload, proxies /api → :4000)
#
# The server + client run together with live output from both. Ctrl+C stops both
# dev servers and the script; the Postgres container is left running (stop it with
# `docker compose stop db`, or pass --down).
#
# Usage:
#   ./start-platform.sh                 # db + migrate, then server + client
#   ./start-platform.sh --restore       # restore the newest backup-*.dump (real-like data), migrate, run
#   ./start-platform.sh --restore=FILE  # restore a specific pg_dump -Fc file
#   ./start-platform.sh --seed          # instead: run the synthetic CSV seed chain
#   ./start-platform.sh --fresh         # wipe the DB volume, migrate, CSV-seed, run
#   ./start-platform.sh --db-only       # set the DB up (with --restore/--seed) then exit
#   ./start-platform.sh --down          # stop the db container and exit
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
  *) IS_WINDOWS=0 ;;
esac

DEV_PORTS="4000 5173"

SEED=0
FRESH=0
DB_ONLY=0
DOWN=0
RESTORE=0
RESTORE_FILE=""
for arg in "$@"; do
  case "$arg" in
    --seed)        SEED=1 ;;
    --fresh)       FRESH=1; SEED=1 ;;
    --restore)     RESTORE=1 ;;
    --restore=*)   RESTORE=1; RESTORE_FILE="${arg#*=}" ;;
    --db-only)     DB_ONLY=1 ;;
    --down)        DOWN=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg (try --help)"; exit 2 ;;
  esac
done

if [ "$RESTORE" = 1 ] && [ "$SEED" = 1 ]; then
  echo "--restore and --seed/--fresh are mutually exclusive — pick one data source"; exit 2
fi

PG_USER="${POSTGRES_USER:-postgres}"

# start-platform.sh is a LOCAL DEV tool. --restore drops & recreates the database
# and --fresh wipes the Docker volume — never acceptable against production. Refuse
# both if the target looks non-local (NODE_ENV=production or a remote DATABASE_URL
# host). Prod deploys go through start-delphic.sh, which backs up first.
guard_local_db() {
  local why="" url host
  [ "${NODE_ENV:-}" = "production" ] && why="NODE_ENV=production"
  url="${DATABASE_URL:-$(grep -E '^DATABASE_URL=' "$ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"')}"
  host="$(printf '%s' "$url" | sed -nE 's#^[a-z]+://[^@/]*@?([^:/?]+).*#\1#p')"
  case "$host" in
    ""|localhost|127.0.0.1|::1|db|postgres|host.docker.internal) ;;
    *) why="${why:+$why; }DATABASE_URL host '$host' is not local" ;;
  esac
  if [ -n "$why" ] && [ "${ALLOW_DESTRUCTIVE_SEED:-}" != "1" ]; then
    echo "REFUSING destructive operation ($why)."
    echo "This wipes data and is local-dev only. Prod deploys use ./start-delphic.sh (backs up first)."
    echo "Override with ALLOW_DESTRUCTIVE_SEED=1 only if you have a fresh, verified backup."
    exit 1
  fi
}
if [ "$RESTORE" = 1 ] || [ "$FRESH" = 1 ]; then
  guard_local_db
fi

log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  if [ "$IS_WINDOWS" = 1 ]; then
    taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
  else
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

# Kill anything still listening on the dev ports (orphaned nodemon / vite from a
# previous run — these also hold Prisma's query engine DLL open on Windows and
# break `prisma generate`).
free_dev_ports() {
  local port pid killed=0
  for port in $DEV_PORTS; do
    if [ "$IS_WINDOWS" = 1 ]; then
      for pid in $(netstat -ano 2>/dev/null | grep -E ":${port}[[:space:]]+.*LISTENING" | awk '{print $NF}' | sort -u); do
        [ -n "$pid" ] && [ "$pid" != 0 ] || continue
        taskkill //F //T //PID "$pid" >/dev/null 2>&1 && { echo "  freed :$port (was PID $pid)"; killed=1; }
      done
    else
      for pid in $(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true); do
        kill -TERM "$pid" 2>/dev/null && { echo "  freed :$port (was PID $pid)"; killed=1; }
      done
    fi
  done
  [ "$killed" = 1 ] && sleep 1 || true
}

if [ "$DOWN" = 1 ]; then
  log "Stopping the db container and any orphaned dev servers"
  free_dev_ports
  docker compose stop db
  exit 0
fi

log "Clearing orphaned dev servers on ports: $DEV_PORTS"
free_dev_ports

# 1. Postgres ---------------------------------------------------------------
if [ "$FRESH" = 1 ]; then
  log "Wiping the Postgres volume (--fresh)"
  docker compose down -v
fi

log "Starting Postgres (compose service: db)"
docker compose up -d db

log "Waiting for Postgres to accept connections"
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U "$PG_USER" >/dev/null 2>&1; then
    echo "  ready after ${i}s"
    break
  fi
  [ "$i" = 60 ] && { echo "  Postgres did not come up in 60s"; exit 1; }
  sleep 1
done

# 2. Dependencies + Prisma client ----------------------------------------------
if [ ! -d node_modules ] || [ ! -d server/node_modules ] || [ ! -d client/node_modules ]; then
  log "Installing workspace dependencies (npm install)"
  npm install
fi

log "Generating Prisma client"
npm run generate --workspace server

# 3. Restore from dump (optional) -------------------------------------------
if [ "$RESTORE" = 1 ]; then
  if [ -z "$RESTORE_FILE" ]; then
    RESTORE_FILE="$(ls -1t backup-*.dump 2>/dev/null | head -1 || true)"
  fi
  if [ -z "$RESTORE_FILE" ] || [ ! -f "$RESTORE_FILE" ]; then
    echo "  No dump found. Put a 'backup-*.dump' (pg_dump -Fc) in the repo root, or pass --restore=path."
    exit 1
  fi
  log "Restoring database from dump: $RESTORE_FILE"
  SAFETY="pre-restore-safety-$(date +%Y%m%d-%H%M%S).dump"
  if docker compose exec -T -e PGUSER="$PG_USER" db \
       sh -c 'pg_dump -Fc -f /tmp/safety.dump requirement_dashboard' 2>/dev/null; then
    docker compose cp db:/tmp/safety.dump "$SAFETY" && echo "  safety snapshot: $SAFETY"
  else
    echo "  (no safety snapshot — current DB is missing or empty)"
  fi
  docker compose cp "$RESTORE_FILE" db:/tmp/restore.dump
  docker compose exec -T -e PGUSER="$PG_USER" db sh -c \
    'dropdb --if-exists --force requirement_dashboard && createdb requirement_dashboard && pg_restore -d requirement_dashboard --no-owner --no-privileges /tmp/restore.dump'
fi

# 4. Migrations -----------------------------------------------------------------
log "Applying migrations (prisma migrate deploy)"
npm run migrate:deploy --workspace server

# 5. CSV seed (optional) ------------------------------------------------------
if [ "$SEED" = 1 ]; then
  log "Seeding: team roster → LeadMinds accounts → Jira requirements → vendors"
  npm run seed --workspace server
  npm run seed:accounts --workspace server
  npm run seed:jira --workspace server
  npm run seed:vendors --workspace server
fi

if [ "$DB_ONLY" = 1 ]; then
  log "Database ready. --db-only: not starting dev servers."
  echo "  Postgres : localhost:5434"
  echo "  Start app later with:  npm run dev:server   and   npm run dev:client"
  exit 0
fi

# 6. Dev servers (both, Ctrl+C stops both) ---------------------------------
log "Starting API (:4000) and client (:5173) — Ctrl+C to stop both"
echo "  Client : http://localhost:5173"
echo "  API    : http://localhost:4000/api/v1/health"
echo "  DB     : localhost:5434  (Prisma Studio: npm run studio --workspace server)"
echo

SERVER_PID=""
CLIENT_PID=""
cleanup() {
  trap - INT TERM
  echo; echo "Stopping dev servers…"
  kill_tree "$SERVER_PID"
  kill_tree "$CLIENT_PID"
  exit 0
}
trap cleanup INT TERM

npm run dev:server &
SERVER_PID=$!
npm run dev:client &
CLIENT_PID=$!

# Exit (cleaning up the other) as soon as either dev server stops.
wait -n 2>/dev/null || wait
cleanup
