#!/usr/bin/env bash
# Checks scripts/backup-prune.sh against a temporary folder of dummy dumps with
# fake timestamps. Run: bash scripts/test-backup-prune.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRUNE="$HERE/backup-prune.sh"
NOW="$(date -d '2026-11-05 12:00:00' +%s)"
export PRUNE_NOW="$NOW" PRUNE_FREE_KB=999999999
FAILS=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mk() { # dir kind secondsAgo [bytes]
  local dir="$1" kind="$2" ago="$3" bytes="${4:-10}"
  mkdir -p "$dir"
  head -c "$bytes" /dev/zero > "$dir/${kind}-$(date -d "@$((NOW - ago))" +%Y-%m-%d-%H%M%S).dump"
}
count() { ls "$1"/$2-*.dump 2>/dev/null | wc -l | tr -d ' '; }
# many files at once: ages in seconds on stdin, one date call
mkmany() { # dir kind  < seconds-ago per line
  local dir="$1" kind="$2" ago
  mkdir -p "$dir"
  while read -r ago; do echo "@$((NOW - ago))"; done | date -f - +"${kind}-%Y-%m-%d-%H%M%S.dump" | (cd "$dir" && xargs touch)
}
check() { # name expected actual
  if [[ "$2" == "$3" ]]; then echo "ok   $1"; else echo "FAIL $1: expected $2, got $3"; FAILS=$((FAILS + 1)); fi
}
run() { bash "$PRUNE" "$@" >/dev/null; }

# 1. every-15-minute autos for 60 days (5760 files is slow; every 15 min for 3 days + hourly-ish older)
D="$TMP/t1"; mkdir -p "$D"
{
  for ((m = 0; m < 3 * 24 * 60; m += 15)); do echo $((m * 60)); done                        # 288 files over 3 days
  for ((d = 4; d <= 40; d++)); do echo $((d * 86400)); echo $((d * 86400 + 7200)); done     # 2 per day, days 4-40
  for ((mo = 2; mo <= 16; mo++)); do echo $((mo * 30 * 86400)); done                        # monthly-ish up to 16 months
} | mkmany "$D" auto
run "$D"
# ages of the surviving autos in seconds, one date call
ages() { ls "$1"/auto-*.dump | sed -E 's#.*/auto-([0-9]{4}-[0-9]{2}-[0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})\.dump#\1 \2:\3:\4#' | date -f - +%s | awk -v n="$NOW" '{print n-$1}'; }
AG="$(ages "$D")"
check "all autos from the last 6 h are kept (15-min cadence = 25)" 25 "$(awk '$1<=21600' <<<"$AG" | wc -l | tr -d ' ')"
check "one per hour between 6 h and 48 h (42)" 42 "$(awk '$1>21600 && $1<=172800' <<<"$AG" | wc -l | tr -d ' ')"
dn="$(awk '$1>172800 && $1<=2592000' <<<"$AG" | wc -l | tr -d ' ')"
check "one per calendar day between 48 h and 30 days (28 or 29 depending on the boundary day)" 1 "$([[ $dn -ge 28 && $dn -le 29 ]] && echo 1 || echo 0)"
check "nothing older than 12 months survives" 0 "$(awk '$1>31536000' <<<"$AG" | wc -l | tr -d ' ')"
check "monthly tier keeps something between 30 days and 12 months" 1 "$([[ $(awk '$1>2592000 && $1<=31536000' <<<"$AG" | wc -l) -ge 5 ]] && echo 1 || echo 0)"

# 2. predeploy: 30 days kept, newest 7 always kept even when old
D="$TMP/t2"
for d in 1 5 10 20 29 31 40 60; do mk "$D" predeploy $((d * 86400)); done
run "$D"
check "predeploy keeps the 7 newest (the 31/40/60 day ones included: only 6 are within 30 days)" 7 "$(count "$D" predeploy)"

D="$TMP/t3"
for d in 100 101 102 103 104 105 106 107 108 109; do mk "$D" predeploy $((d * 86400)); mk "$D" auto $((d * 86400)); done
run "$D"
check "newest 7 predeploy are never pruned even when all are old" 7 "$(count "$D" predeploy)"
check "newest 7 auto are never pruned even when all are old" 7 "$(count "$D" auto)"

# 3. viewer now-* keeps the newest 5
D="$TMP/t4"
for h in 1 2 3 4 5 6 7 8; do mk "$D/viewer" now $((h * 3600)); done
run "$D"
check "viewer now dumps: newest 5" 5 "$(count "$D/viewer" now)"

# 4. total-size cap removes hourly, then daily, then predeploy, then monthly; protected survive
D="$TMP/t5"
for h in 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do mk "$D" auto $((h * 3600 + 1800)) 1048576; done    # 14 hourly-tier, 1 MB each
for d in 3 4 5 6 7 8 9 10; do mk "$D" auto $((d * 86400)) 1048576; done                              # 8 daily-tier
for d in 1 2 3 4 5 6 7 8 9 10; do mk "$D" predeploy $((d * 86400)) 1048576; done                       # 10 predeploy
BACKUP_MAX_TOTAL_MB=20 run "$D"
total=$(( $(cat "$D"/*.dump | wc -c) / 1048576 ))
check "total size cap brought the folder to 20 MB or less" 1 "$([[ $total -le 20 ]] && echo 1 || echo 0)"
check "cap kept the newest 7 autos" 1 "$([[ $(count "$D" auto) -ge 7 ]] && echo 1 || echo 0)"
check "cap kept the newest 7 predeploy" 1 "$([[ $(count "$D" predeploy) -ge 7 ]] && echo 1 || echo 0)"

# 5. cap that cannot be met never touches the protected dumps
D="$TMP/t6"
for h in 1 2 3 4 5 6 7 8; do mk "$D" auto $((h * 3600)) 1048576; mk "$D" predeploy $((h * 3600)) 1048576; done
BACKUP_MAX_TOTAL_MB=1 run "$D"
check "protected autos survive an impossible cap" 7 "$(count "$D" auto)"
check "protected predeploy survive an impossible cap" 7 "$(count "$D" predeploy)"

# 6. low free space triggers removal, dry run changes nothing, unrelated files untouched
D="$TMP/t7"
for h in 7 8 9 10 11 12 13 14 15 16; do mk "$D" auto $((h * 3600 + 600)) 1048576; done
for h in 1 2 3 4 5 6 7 8; do mk "$D" auto $((h * 3600)) 1024; done
echo keep > "$D/pre-restore-safety-1.dump"; echo keep > "$D/old.sql"
before="$(ls "$D" | wc -l)"
PRUNE_FREE_KB=1048576 bash "$PRUNE" --dry-run "$D" >/dev/null
check "dry run deletes nothing" "$before" "$(ls "$D" | wc -l)"
PRUNE_FREE_KB=1048576 run "$D"
check "low free space pruned something" 1 "$([[ $(ls "$D" | wc -l) -lt $before ]] && echo 1 || echo 0)"
check "pre-restore-safety dump and .sql are never touched" 2 "$(ls "$D/pre-restore-safety-1.dump" "$D/old.sql" | wc -l | tr -d ' ')"

# 7. missing folder is not an error
check "missing folder exits 0" 0 "$(bash "$PRUNE" "$TMP/nope" >/dev/null; echo $?)"

[[ $FAILS -eq 0 ]] && echo "all prune checks passed" || { echo "$FAILS check(s) failed"; exit 1; }
