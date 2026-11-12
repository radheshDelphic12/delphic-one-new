#!/usr/bin/env bash
#
# Copies the uploaded documents (CVs, receipts, wallet attachments, vendor invoice files, HR letters, recordings not yet moved) off the server:
# one tar.gz of the uploads folder, streamed from the server container to SharePoint (the BACKUP_SP_* place, through server/scripts/offsite-backup.js).
# Once a day (a second run on the same day is skipped by the server script). The newest 14 archives stay on SharePoint; other files are never touched.
#
# Daily cron (as the deploy user):
#   45 3 * * * cd /opt/delphic && ./scripts/uploads-backup.sh >> /var/log/delphic-uploads-backup.log 2>&1
#
# Nothing is mounted or written on the host: the archive is built in the container and piped. A failure never touches the uploads.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DC="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
NAME="uploads-$(date -u +%Y-%m-%d).tar.gz"

$DC exec -T server sh -c 'cd /app/server && tar -czf - uploads' | $DC exec -T server node scripts/offsite-backup.js - --name "$NAME"
