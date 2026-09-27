#!/usr/bin/env bash
#
# Scheduled database backup — independent of deploys.
#
# Run from cron / a systemd timer on the VPS. Each run writes a verified
# `pg_dump -Fc` into ./backups/ and keeps only the newest BACKUP_KEEP dumps
# (default 7). Oldest auto-*.dump files are deleted so disk use stays bounded.
#
# Cron example (every 15 min), as the deploy user:
#   */15 * * * * cd /opt/delphic && ./scripts/db-backup.sh >> /var/log/delphic-backup.log 2>&1
#
# systemd timer: see docs/guides/DEPLOY-RUNBOOK.md.
#
# Env:
#   BACKUP_KEEP          how many auto-*.dump files to retain (default 7)
#   BACKUP_MIN_FREE_GB   abort if backups volume has less free space than this (default 2)
#   BACKUP_OFFSITE_CMD   optional shell command run with the dump path as $1
#                        (e.g. 'aws s3 cp "$1" s3://delphic-backups/')
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="${ROOT}/backups"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
BACKUP_MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-2}"
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
PG_USER="${POSTGRES_USER:-postgres}"
PG_DB="${POSTGRES_DB:-requirement_dashboard}"

log() { printf '%s %s\n' "$(date +'%F %T')" "$*"; }

assert_disk_space() {
  local min_kb avail_kb
  min_kb=$((BACKUP_MIN_FREE_GB * 1024 * 1024))
  avail_kb="$(df -Pk "${BACKUP_DIR}" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -z "${avail_kb}" ]]; then
    log "WARN: could not read free space for ${BACKUP_DIR} — continuing without a disk guard."
    return 0
  fi
  if [[ "${avail_kb}" -lt "${min_kb}" ]]; then
    log "ERROR: less than ${BACKUP_MIN_FREE_GB} GiB free on ${BACKUP_DIR} (${avail_kb} KiB available). No backup taken."
    exit 1
  fi
}

if ! $DC exec -T db pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
  log "ERROR: Postgres not ready — no backup taken."
  exit 1
fi

mkdir -p "$BACKUP_DIR"
assert_disk_space

OUT="${BACKUP_DIR}/auto-$(date +%Y-%m-%d-%H%M%S).dump"

if ! $DC exec -T db pg_dump -U "$PG_USER" -Fc "$PG_DB" > "$OUT"; then
  log "ERROR: pg_dump failed — removing partial file."
  rm -f "$OUT"
  exit 1
fi

# Verify it is restorable (inside the container, which always has a matching pg_restore).
if ! $DC exec -T db sh -c 'cat > /tmp/verify.dump && pg_restore --list /tmp/verify.dump >/dev/null && rm -f /tmp/verify.dump' < "$OUT"; then
  log "ERROR: backup $OUT failed pg_restore --list verification."
  exit 1
fi

SIZE="$(wc -c < "$OUT" | tr -d ' ')"
log "OK: $OUT ($SIZE bytes)"

if [ -n "${BACKUP_OFFSITE_CMD:-}" ]; then
  if bash -c "$BACKUP_OFFSITE_CMD" _ "$OUT"; then
    log "OK: copied offsite via BACKUP_OFFSITE_CMD"
  else
    log "WARN: offsite copy command failed for $OUT"
  fi
fi

# Keep exactly the newest $BACKUP_KEEP auto-*.dump files; delete older ones.
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/auto-*.dump 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
  rm -f "$old" && log "rotated out $(basename "$old")"
done
