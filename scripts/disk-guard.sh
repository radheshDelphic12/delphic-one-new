#!/usr/bin/env bash
#
# Keeps the server disk from filling up. On 2026-11-10 the root disk (28 GB) was 79% full while the database is about 7 MB:
# docker build cache (5.5 GB, one layer set per deploy), old images, swap files and local backups were most of it.
#
# What it does (safe by design):
#   * always: drop docker build cache older than 24 h and dangling images
#   * when free space is below DISK_MIN_FREE_GB (default 8): drop ALL unused build cache and unused images older than 72 h
#   * when still below DISK_CRITICAL_GB (default 4): say so loudly and exit 2 (a deploy should stop)
#   * trims the systemd journal to JOURNAL_MAX_MB (default 200) when sudo works without a password
# What it NEVER touches: docker volumes (database, uploads), ./backups, uploads, images of running containers.
#
# Run after every deploy (deploy.yml does) and daily from cron:
#   30 3 * * * cd /opt/delphic && ./scripts/disk-guard.sh >> /var/log/delphic-disk.log 2>&1
#
# Usage: scripts/disk-guard.sh [--dry-run]
# Env: DISK_PATH (default /), DISK_MIN_FREE_GB, DISK_CRITICAL_GB, JOURNAL_MAX_MB, DISK_FREE_KB (tests: pretend this much is free)
set -uo pipefail

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1
DISK_PATH="${DISK_PATH:-/}"
MIN_GB="${DISK_MIN_FREE_GB:-8}"
CRIT_GB="${DISK_CRITICAL_GB:-4}"
JOURNAL_MB="${JOURNAL_MAX_MB:-200}"

log() { printf '%s disk-guard: %s\n' "$(date +'%F %T')" "$*"; }
free_kb() {
  if [[ -n "${DISK_FREE_KB:-}" ]]; then echo "${DISK_FREE_KB}"; else df -Pk "${DISK_PATH}" | awk 'NR==2 {print $4}'; fi
}
gb() { awk -v k="$1" 'BEGIN { printf "%.1f", k / 1024 / 1024 }'; }
run() {
  if [[ "${DRY}" -eq 1 ]]; then log "dry run: $*"; return 0; fi
  "$@" >/dev/null 2>&1 && log "done: $*" || log "skipped (failed): $*"
}

before="$(free_kb)"
log "free ${DISK_PATH}: $(gb "${before}") GB (floor ${MIN_GB} GB, critical ${CRIT_GB} GB)"

if command -v docker >/dev/null 2>&1; then
  run docker builder prune -f --filter until=24h
  run docker image prune -f
  if [[ "$(free_kb)" -lt $((MIN_GB * 1024 * 1024)) ]]; then
    log "below the floor: dropping all unused build cache and unused images older than 72 h"
    run docker builder prune -af
    run docker image prune -af --filter until=72h
  fi
else
  log "docker not found - skipping docker cleanup"
fi

if command -v journalctl >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
  run sudo -n journalctl --vacuum-size="${JOURNAL_MB}M"
fi

after="$(free_kb)"
log "free now: $(gb "${after}") GB (was $(gb "${before}") GB)"
if [[ "${after}" -lt $((CRIT_GB * 1024 * 1024)) ]]; then
  log "CRITICAL: less than ${CRIT_GB} GB free. Look at swap files, ./backups, docker images and uploads (docs/guides/DISK-STORAGE.md)."
  exit 2
fi
exit 0
