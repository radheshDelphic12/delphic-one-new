#!/usr/bin/env bash
# Prints `export` lines describing the checked-out commit, for the page's build meta tags:
#     eval "$(bash scripts/build-info.sh)"
# The Docker build has no .git (it is in .dockerignore), so the deploy passes these in as build args (docker-compose.yml, client/Dockerfile).
# Never fails: with no git information the values are empty and the page says "unknown".
cd "$(dirname "$0")/.." 2>/dev/null || true
sha="$(git rev-parse HEAD 2>/dev/null || true)"
date="$(git log -1 --format=%cI 2>/dev/null || true)"
subject="$(git log -1 --format=%s 2>/dev/null | cut -c1-300 || true)"
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
printf 'export BUILD_COMMIT_SHA=%q\n' "${sha}"
printf 'export BUILD_COMMIT_DATE=%q\n' "${date}"
printf 'export BUILD_COMMIT_MESSAGE=%q\n' "${subject}"
printf 'export BUILD_BRANCH=%q\n' "${branch}"
exit 0
