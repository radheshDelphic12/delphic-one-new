#!/usr/bin/env bash
#
# Tiered retention for the database dumps in ./backups (and ./backups/viewer).
# Called by scripts/db-backup.sh and start-delphic.sh after each new dump; safe
# to run by hand (use --dry-run first).
#
#   auto-*.dump       every dump for the last 6 h, then one per hour up to 48 h,
#                     then one per day up to 30 days, then one per month up to
#                     12 months. Older is deleted.
#   predeploy-*.dump  30 days.
#   viewer/now-*.dump the newest 5 (taken by the snapshot viewer's "compare with now").
#
# The newest 7 auto and the newest 7 predeploy dumps are never deleted by any
# rule or cap. Anything else in the folder (pre-restore-safety-*, *.sql, ...) is
# left alone.
#
# Hard caps: when the dumps together exceed BACKUP_MAX_TOTAL_MB, or the volume
# has less than BACKUP_MIN_FREE_GB free, the oldest dumps go first in this order:
# hourly, daily, predeploy, monthly (never the protected ones above).
#
# Usage: scripts/backup-prune.sh [--dry-run] [backup-dir]
# Env:
#   BACKUP_DIR            folder to prune (default <repo>/backups)
#   BACKUP_MAX_TOTAL_MB   total size cap (default 1500)
#   BACKUP_MIN_FREE_GB    free-space floor (default 3)
#   BACKUP_PROTECT_NEWEST how many newest auto / predeploy are untouchable (default 7)
#   PRUNE_NOW             epoch seconds to treat as "now" (tests)
#   PRUNE_FREE_KB         free space in KiB to assume instead of df (tests)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) BACKUP_DIR="$1" ;;
  esac
  shift
done
BACKUP_DIR="${BACKUP_DIR:-${ROOT}/backups}"
MAX_TOTAL_MB="${BACKUP_MAX_TOTAL_MB:-1500}"
MIN_FREE_GB="${BACKUP_MIN_FREE_GB:-3}"
PROTECT_N="${BACKUP_PROTECT_NEWEST:-7}"
NOW="${PRUNE_NOW:-$(date +%s)}"

HOUR=3600
RECENT_S=$((6 * HOUR))
HOURLY_S=$((48 * HOUR))
DAILY_S=$((30 * 24 * HOUR))
MONTHLY_S=$((365 * 24 * HOUR))
PREDEPLOY_S=$((30 * 24 * HOUR))
NOW_KEEP=5

log() { printf '%s %s\n' "$(date +'%F %T')" "$*"; }

[[ -d "$BACKUP_DIR" ]] || { log "prune: ${BACKUP_DIR} does not exist - nothing to do"; exit 0; }

declare -A EPOCH SIZE TIER PROTECT GONE STAMP
AUTO=(); PRE=(); NOWS=()

NAME_RE='^(auto|predeploy|now)-([0-9]{4})-([0-9]{2})-([0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})\.dump$'

# Reads every dump of one class; epochs come from the file name (auto-YYYY-MM-DD-HHMMSS.dump) in a single
# `date -f` call, because forking date per file is very slow on a big folder.
load() { # dir prefix array-name
  local dir="$1" prefix="$2" f base
  local -n arr="$3"
  local files=() stamps=() epochs=() n i
  [[ -d "$dir" ]] || return 0
  for f in "$dir"/${prefix}-*.dump; do
    [[ -f "$f" ]] || continue
    base="$(basename "$f")"
    [[ "$base" =~ $NAME_RE ]] || continue
    files+=("$f")
    stamps+=("${BASH_REMATCH[2]}-${BASH_REMATCH[3]}-${BASH_REMATCH[4]} ${BASH_REMATCH[5]}:${BASH_REMATCH[6]}:${BASH_REMATCH[7]}")
    STAMP["$f"]="${BASH_REMATCH[2]}-${BASH_REMATCH[3]}-${BASH_REMATCH[4]} ${BASH_REMATCH[5]}"
  done
  n=${#files[@]}
  [[ $n -gt 0 ]] || return 0
  mapfile -t epochs < <(printf '%s
' "${stamps[@]}" | date -f - +%s)
  for ((i = 0; i < n; i++)); do
    EPOCH["${files[$i]}"]="${epochs[$i]}"
    SIZE["${files[$i]}"]="$(stat -c %s "${files[$i]}")"
  done
  # newest first
  mapfile -t arr < <(for f in "${files[@]}"; do printf '%s %s
' "${EPOCH[$f]}" "$f"; done | sort -rn | cut -d' ' -f2-)
}

load "$BACKUP_DIR" auto AUTO
load "$BACKUP_DIR" predeploy PRE
load "$BACKUP_DIR/viewer" now NOWS

# ---- tiers -------------------------------------------------------------------
declare -A SEEN
bucket_keep() { # file tier key : keep the first (newest) file of each bucket
  local f="$1" tier="$2" key="$3"
  if [[ -z "${SEEN[$tier:$key]:-}" ]]; then SEEN["$tier:$key"]=1; TIER["$f"]="$tier"; else TIER["$f"]="drop"; fi
}

i=0
for f in "${AUTO[@]}"; do
  age=$((NOW - EPOCH[$f]))
  if [[ $age -le $RECENT_S ]]; then TIER["$f"]=recent
  elif [[ $age -le $HOURLY_S ]]; then bucket_keep "$f" hourly "${STAMP[$f]}"
  elif [[ $age -le $DAILY_S ]]; then bucket_keep "$f" daily "${STAMP[$f]:0:10}"
  elif [[ $age -le $MONTHLY_S ]]; then bucket_keep "$f" monthly "${STAMP[$f]:0:7}"
  else TIER["$f"]=drop; fi
  [[ $i -lt $PROTECT_N ]] && { PROTECT["$f"]=1; [[ "${TIER[$f]}" == drop ]] && TIER["$f"]=recent; }
  i=$((i + 1))
done

i=0
for f in "${PRE[@]}"; do
  age=$((NOW - EPOCH[$f]))
  if [[ $age -le $PREDEPLOY_S ]]; then TIER["$f"]=predeploy; else TIER["$f"]=drop; fi
  [[ $i -lt $PROTECT_N ]] && { PROTECT["$f"]=1; [[ "${TIER[$f]}" == drop ]] && TIER["$f"]=predeploy; }
  i=$((i + 1))
done

i=0
for f in "${NOWS[@]}"; do
  if [[ $i -lt $NOW_KEEP ]]; then TIER["$f"]=now; else TIER["$f"]=drop; fi
  i=$((i + 1))
done

ALL=("${AUTO[@]}" "${PRE[@]}" "${NOWS[@]}")

delete() { # file reason
  local f="$1" why="$2"
  [[ -n "${GONE[$f]:-}" ]] && return 0
  GONE["$f"]=1
  if [[ $DRY_RUN -eq 1 ]]; then
    log "rotated out (dry run) ${f#"$BACKUP_DIR"/} - ${why}"
  else
    rm -f "$f"
    log "rotated out ${f#"$BACKUP_DIR"/} - ${why}"
  fi
}

for f in "${ALL[@]}"; do
  [[ "${TIER[$f]}" == drop ]] && delete "$f" "outside the retention tiers"
done

# ---- hard caps ---------------------------------------------------------------
total_bytes=0
for f in "${ALL[@]}"; do [[ -z "${GONE[$f]:-}" ]] && total_bytes=$((total_bytes + SIZE[$f])); done
max_bytes=$((MAX_TOTAL_MB * 1024 * 1024))

if [[ -n "${PRUNE_FREE_KB:-}" ]]; then free_kb="$PRUNE_FREE_KB"
else free_kb="$(df -Pk "$BACKUP_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"; fi
free_kb="${free_kb:-0}"
min_free_kb=$((MIN_FREE_GB * 1024 * 1024))
[[ -z "${PRUNE_FREE_KB:-}" && "$free_kb" == 0 ]] && min_free_kb=0 # could not read df: no free-space rule

over_cap() { [[ $total_bytes -gt $max_bytes || $free_kb -lt $min_free_kb ]]; }

if over_cap; then
  log "prune: caps breached (total $((total_bytes / 1048576)) MB of ${MAX_TOTAL_MB}, free $((free_kb / 1048576)) GB of ${MIN_FREE_GB}) - removing oldest first: hourly, daily, predeploy, monthly"
  for tier in hourly daily predeploy monthly; do
    # oldest first within a tier
    mapfile -t cand < <(for f in "${ALL[@]}"; do
        [[ -z "${GONE[$f]:-}" && -z "${PROTECT[$f]:-}" && "${TIER[$f]}" == "$tier" ]] && printf '%s %s\n' "${EPOCH[$f]}" "$f"
      done | sort -n | cut -d' ' -f2-)
    for f in "${cand[@]}"; do
      over_cap || break 2
      delete "$f" "over the ${tier} cap"
      total_bytes=$((total_bytes - SIZE[$f]))
      free_kb=$((free_kb + SIZE[$f] / 1024))
    done
  done
  over_cap && log "prune: WARNING still over a cap after removing everything that is not protected (newest ${PROTECT_N} auto and predeploy are never removed)"
fi

kept=0; for f in "${ALL[@]}"; do [[ -z "${GONE[$f]:-}" ]] && kept=$((kept + 1)); done
log "prune: kept ${kept} dump(s), $((total_bytes / 1048576)) MB"
