#!/usr/bin/env bash
#
# Tag the commit that is live on a stage, so "go back to the previous version" is one command.
#   scripts/release-tag.sh <dev|beta|prod> [commit] [-m "release notes"]
# Creates vYYYY.MM.DD-<stage>-N (N counts up per day and stage) on the commit (default HEAD) and prints the previous tag
# of the same stage, i.e. the version to redeploy for a rollback. Local only: pushing tags is a separate, deliberate step
# (git push origin <tag>).
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

STAGE="${1:?usage: release-tag.sh <dev|beta|prod> [commit] [-m notes]}"
case "$STAGE" in dev|beta|prod) ;; *) echo "stage must be dev, beta or prod" >&2; exit 2 ;; esac
shift
COMMIT="HEAD"; NOTES=""
if [ $# -gt 0 ] && [ "${1:0:1}" != "-" ]; then COMMIT="$1"; shift; fi
if [ "${1:-}" = "-m" ]; then NOTES="${2:-}"; fi

SHA="$(git rev-parse --verify "${COMMIT}^{commit}")"
DAY="$(date +%Y.%m.%d)"
N=1
while git rev-parse -q --verify "refs/tags/v${DAY}-${STAGE}-${N}" >/dev/null; do N=$((N + 1)); done
TAG="v${DAY}-${STAGE}-${N}"
PREV="$(git tag --list "v*-${STAGE}-*" --sort=-creatordate | head -1 || true)"

git tag -a "$TAG" "$SHA" -m "${STAGE} release ${TAG}${NOTES:+: ${NOTES}}"
echo "Tagged ${SHA:0:8} as ${TAG}"
if [ -n "$PREV" ]; then
  echo "Previous ${STAGE} version (roll back to this): ${PREV} ($(git rev-parse --short "${PREV}^{commit}"))"
  echo "Changes since then:"; git log --oneline "${PREV}..${SHA}" | head -30
else
  echo "No earlier ${STAGE} tag."
fi
