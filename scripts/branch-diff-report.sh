#!/usr/bin/env bash
#
# What is on one stage branch but not yet on the next: dev -> staging (beta) -> main (prod).
#   scripts/branch-diff-report.sh [--fetch]
# Reports commits ahead, and commits that exist only on a LATER stage (a hotfix not merged back down, which must be merged back the same day).
# Read-only. --fetch updates remote branches first.
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ "${1:-}" = "--fetch" ] && git fetch -q origin

ref() { git rev-parse -q --verify "origin/$1" >/dev/null 2>&1 && echo "origin/$1" || { git rev-parse -q --verify "$1" >/dev/null 2>&1 && echo "$1"; } || true; }
DEV="$(ref dev)"; STG="$(ref staging)"; MAIN="$(ref main)"

pair() {  # pair <from-label> <from-ref> <to-label> <to-ref>
  [ -n "$2" ] && [ -n "$4" ] || { echo "== $1 -> $3: a branch is missing here, skipped"; return; }
  local ahead behind
  ahead="$(git rev-list --count "$4..$2")"; behind="$(git rev-list --count "$2..$4")"
  echo "== $1 -> $3: ${ahead} commit(s) not yet on $3"
  git log --oneline --no-merges "$4..$2" | head -25
  if [ "$behind" -gt 0 ]; then
    echo "   !! $3 has ${behind} commit(s) that $1 does not (merge them back down):"
    git log --oneline --no-merges "$2..$4" | head -10 | sed 's/^/      /'
  fi
}
pair dev "$DEV" staging "$STG"
pair staging "$STG" main "$MAIN"
