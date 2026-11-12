#!/usr/bin/env bash
#
# One-time setup for the snapshot viewer's "Compare with now": a read-only Postgres role.
#
#   dump_reader   LOGIN, CONNECTION LIMIT 1, member of pg_read_all_data (SELECT on everything),
#                 default_transaction_read_only = on, no superuser / createdb / createrole / replication.
#
# Run it on the box, as the deploy user, from the repo folder:   bash scripts/create-dump-reader-role.sh
# It is safe to run again (it resets the password and re-applies the settings). It writes the password to .env as
# DUMP_READER_PASSWORD (generated if not already there); then restart the viewer:
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d dbviewer
#
# This is not a Prisma migration on purpose: it needs a password, and migrations run in CI and on every developer machine.
# It changes no table and drops nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
ENV_FILE="${ROOT}/.env"
[[ -f "$ENV_FILE" ]] || { echo "ERROR: ${ENV_FILE} not found - run this from the deployed repo folder." >&2; exit 1; }

# read single values without sourcing the file (it can hold characters bash would interpret)
env_val() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//" || true; }

PG_USER="$(env_val POSTGRES_USER)"; PG_USER="${PG_USER:-postgres}"
PG_DB="$(env_val POSTGRES_DB)"; PG_DB="${PG_DB:-requirement_dashboard}"
PASSWORD="$(env_val DUMP_READER_PASSWORD)"
if [[ -z "$PASSWORD" ]]; then
  PASSWORD="$(openssl rand -hex 24)"
  NEW_PASSWORD=1
fi
[[ "$PASSWORD" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "ERROR: DUMP_READER_PASSWORD may only contain letters, digits, . _ -" >&2; exit 1; }

DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$DC exec -T db pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null || { echo "ERROR: the db container is not ready." >&2; exit 1; }

# the password travels on stdin, never on a command line
$DC exec -T db psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -q <<SQL
\set pw '${PASSWORD}'
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dump_reader')
            THEN 'ALTER ROLE dump_reader WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD ' || quote_literal(:'pw')
            ELSE 'CREATE ROLE dump_reader WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1 PASSWORD ' || quote_literal(:'pw')
       END AS stmt \gset
:stmt;
GRANT pg_read_all_data TO dump_reader;
ALTER ROLE dump_reader SET default_transaction_read_only = on;
SELECT format('GRANT CONNECT ON DATABASE %I TO dump_reader', current_database()) AS grant_stmt \gset
:grant_stmt;
SQL

if [[ -n "${NEW_PASSWORD:-}" ]]; then
  printf '\n# Read-only Postgres role for the snapshot viewer "Compare with now" (scripts/create-dump-reader-role.sh)\nDUMP_READER_PASSWORD=%s\n' "$PASSWORD" >> "$ENV_FILE"
  echo "Wrote DUMP_READER_PASSWORD to ${ENV_FILE}."
fi

# prove it: it can read, and it cannot write
$DC exec -T -e PGPASSWORD="$PASSWORD" db psql -h 127.0.0.1 -U dump_reader -d "$PG_DB" -Atc 'select count(*) from _prisma_migrations' >/dev/null \
  && echo "OK: dump_reader can read." || { echo "ERROR: dump_reader could not read." >&2; exit 1; }
if $DC exec -T -e PGPASSWORD="$PASSWORD" db psql -h 127.0.0.1 -U dump_reader -d "$PG_DB" -Atc 'create table dump_reader_must_fail (x int)' >/dev/null 2>&1; then
  echo "ERROR: dump_reader was able to write - remove it with: DROP TABLE dump_reader_must_fail; and investigate." >&2
  exit 1
fi
echo "OK: dump_reader cannot write."
echo "Next: restart the viewer so it picks up the password:"
echo "  $DC up -d dbviewer"
