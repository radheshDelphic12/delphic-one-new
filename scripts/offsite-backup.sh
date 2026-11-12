#!/usr/bin/env bash
#
# Copies one database dump to SharePoint (the BACKUP_SP_* place) through the server container, which already has the Microsoft Graph
# settings. Meant for BACKUP_OFFSITE_CMD in scripts/db-backup.sh:
#
#   BACKUP_OFFSITE_CMD='/opt/delphic/scripts/offsite-backup.sh "$1"'
#
# The dump is streamed into the container (nothing is mounted) and the temp copy in the container is removed. Automatic dumps run every
# 15 minutes but go up about once an hour; pre-deploy dumps always go. Older SharePoint copies are trimmed (24 newest, then one per day
# for 30 days). A failure here never fails the local backup (db-backup.sh only warns).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DUMP="${1:?usage: offsite-backup.sh <dump-file>}"
[ -f "$DUMP" ] || { echo "offsite: $DUMP not found"; exit 1; }

DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
$DC exec -T server node scripts/offsite-backup.js - --name "$(basename "$DUMP")" < "$DUMP"
