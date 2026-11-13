#!/usr/bin/env bash
#
# Restore point - run BEFORE any large piece of work and BEFORE every release to prod.
# (docs/features/SAAS-LAUNCH-BUILD-PLAN.md, section 24 of the SaaS launch plan.)
#
# A restore point is four things kept together in backups/restore-points/<name>/ :
#   1. database.dump       full verified pg_dump -Fc
#   2. row-counts.tsv      exact row count per table (prove after the work that nothing was lost: scripts/restore-point.sh --compare <name>)
#   3. uploads.txt         list of uploaded files (name, size) - the files themselves are not copied here, the list tells what must exist
#   4. git.txt + settings  the commit that is live, a git tag, and the settings with every secret value blanked
#
# Usage:
#   scripts/restore-point.sh [--name <label>] [--stage dev|beta|prod] [--no-tag]
#   scripts/restore-point.sh --compare <name>      # compare today's row counts with a restore point
#
# Database access (first that applies):
#   RESTORE_POINT_MODE=docker  -> docker compose db container (the production layout, same as scripts/db-backup.sh)
#   otherwise                  -> pg_dump / psql on this machine using DATABASE_URL
# BACKUP_OFFSITE_CMD (optional) is run with the dump path as $1, like db-backup.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT_ROOT="${ROOT}/backups/restore-points"
UPLOAD_DIR="${UPLOAD_DIR:-${ROOT}/server/uploads}"
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
PG_USER="${POSTGRES_USER:-postgres}"
PG_DB="${POSTGRES_DB:-requirement_dashboard}"

log() { printf '%s %s\n' "$(date +'%F %T')" "$*"; }

psql_q() {  # psql_q <sql> : tuples-only, tab separated
  if [ "${RESTORE_POINT_MODE:-}" = "docker" ]; then
    $DC exec -T db psql -U "$PG_USER" -d "$PG_DB" -At -F $'\t' -c "$1"
  else
    psql "${DATABASE_URL:?DATABASE_URL is not set}" -At -F $'\t' -c "$1"
  fi
}
dump_db() {  # dump_db > file
  if [ "${RESTORE_POINT_MODE:-}" = "docker" ]; then
    $DC exec -T db pg_dump -U "$PG_USER" -Fc "$PG_DB"
  else
    pg_dump "${DATABASE_URL:?DATABASE_URL is not set}" -Fc
  fi
}

COUNT_SQL="select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"

if [ "${1:-}" = "--compare" ]; then
  NAME="${2:?usage: restore-point.sh --compare <name>}"
  DIR="${OUT_ROOT}/${NAME}"
  [ -f "${DIR}/row-counts.tsv" ] || { log "ERROR: ${DIR}/row-counts.tsv not found"; exit 1; }
  psql_q "$COUNT_SQL" > "${DIR}/row-counts.now.tsv"
  log "Tables whose row count differs from restore point ${NAME} (restore point -> now):"
  join -t $'\t' -a1 -a2 -e MISSING -o 0,1.2,2.2 "${DIR}/row-counts.tsv" "${DIR}/row-counts.now.tsv" | awk -F'\t' '$2 != $3 { printf "  %-46s %s -> %s\n", $1, $2, $3; n++ } END { if (!n) print "  (none - identical)" }'
  exit 0
fi

LABEL="restore"; STAGE="${STAGE:-prod}"; TAG=1
while [ $# -gt 0 ]; do
  case "$1" in
    --name) LABEL="$2"; shift 2 ;;
    --stage) STAGE="$2"; shift 2 ;;
    --no-tag) TAG=0; shift ;;
    *) log "unknown option $1"; exit 2 ;;
  esac
done
NAME="$(date +%Y%m%d-%H%M%S)-${LABEL}"
DIR="${OUT_ROOT}/${NAME}"
mkdir -p "$DIR"
log "Restore point ${NAME}"

# 1. database
dump_db > "${DIR}/database.dump" || { log "ERROR: pg_dump failed"; rm -rf "$DIR"; exit 1; }
if [ "${RESTORE_POINT_MODE:-}" = "docker" ]; then
  $DC exec -T db sh -c 'cat > /tmp/rp.dump && pg_restore --list /tmp/rp.dump >/dev/null && rm -f /tmp/rp.dump' < "${DIR}/database.dump" || { log "ERROR: the dump does not verify"; exit 1; }
else
  pg_restore --list "${DIR}/database.dump" >/dev/null || { log "ERROR: the dump does not verify"; exit 1; }
fi
log "database.dump $(wc -c < "${DIR}/database.dump" | tr -d ' ') bytes, verified"

# 2. row counts
psql_q "$COUNT_SQL" > "${DIR}/row-counts.tsv"
log "row-counts.tsv $(wc -l < "${DIR}/row-counts.tsv" | tr -d ' ') tables"

# 3. uploads list
if [ -d "$UPLOAD_DIR" ]; then
  (cd "$UPLOAD_DIR" && find . -type f -printf '%s\t%p\n' | sort -k2) > "${DIR}/uploads.txt"
  log "uploads.txt $(wc -l < "${DIR}/uploads.txt" | tr -d ' ') files"
else
  echo "(no upload folder at ${UPLOAD_DIR})" > "${DIR}/uploads.txt"
fi

# 4. code and settings
{
  echo "commit: $(git rev-parse HEAD)"
  echo "branch: $(git rev-parse --abbrev-ref HEAD)"
  echo "dirty: $(git status --porcelain | wc -l | tr -d ' ') changed files"
  echo "taken: $(date -u +%FT%TZ)  stage: ${STAGE}"
} > "${DIR}/git.txt"
if [ "$TAG" = 1 ]; then
  TAGNAME="rp-${NAME}"
  git tag -f "$TAGNAME" >/dev/null && echo "tag: ${TAGNAME}" >> "${DIR}/git.txt"
fi
# settings: keep the names, blank every value that looks like a secret; module switches are kept as they are
for f in server/.env .env; do
  [ -f "$f" ] || continue
  sed -E 's/^([A-Za-z0-9_]*(SECRET|PASSWORD|PASS|TOKEN|KEY|URL|DSN|CREDENTIAL)[A-Za-z0-9_]*)=.*/\1=<hidden>/I' "$f" > "${DIR}/settings-$(echo "$f" | tr '/' '_').txt"
done
(psql_q "select o.slug, o.enabled_modules from orgs o order by o.slug" > "${DIR}/company-modules.tsv") || true

if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
  bash -c "$BACKUP_OFFSITE_CMD" _ "${DIR}/database.dump" && log "copied offsite" || log "WARN: offsite copy failed"
fi
log "Done: ${DIR}"
log "After the work:  scripts/restore-point.sh --compare ${NAME}"
