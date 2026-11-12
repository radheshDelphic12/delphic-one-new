# AI interview recordings on SharePoint

Why: recordings and database backups share one small server disk. Recordings now move to a SharePoint site (via Microsoft Graph)
once the interview is over; the server copy is deleted and the app keeps only the link.

## How it works
1. The candidate's browser sends the recording in chunks to the server, as before (local file under `uploads/ai-interviews`).
2. Every 5 minutes `jobs/aiInterviewRecordings.js` moves finished recordings (completed / pending review, 10 minutes after the end)
   to SharePoint with a resumable upload session. The local file is deleted **only after** SharePoint confirmed the upload; a failed
   upload leaves the file in place and is retried.
3. The part entry in `ai_interviews.recording_files` gets `remote: { drive_id, item_id, web_url, bytes }` (no migration, JSON field).
4. Play / download (`GET /ai-interviews/:id/recording`) answers a 302 to a short-lived Microsoft link; same permission rules as before.
5. Hourly: expired recordings are deleted on the server **and** on SharePoint (a failed remote delete keeps the row, so it is retried),
   anything in the SharePoint folder older than 8 days is swept (safety net), and free disk space is checked
   (`low_disk_space` error log below `RECORDINGS_MIN_FREE_MB`, default 3072).
6. The retention setting is 1-7 days (default 2); older settings above 7 are cut to 7.

With the env below unset, nothing changes: recordings stay on the server and are deleted after the retention days.

## Setup (one time, Azure admin)
- Entra admin center > App registrations > the Graph app (the one that sends mail) > API permissions > add **Microsoft Graph >
  Application > Sites.Selected** > Grant admin consent.
- Give the app **write** on ONE site only: Graph `POST /sites/{site-id}/permissions` with
  `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"<client id>","displayName":"<app name>"}}]}` -> 201.
- Create the folder `Interview-Recordings` in the site's Documents library.

## Values from the Microsoft 365 admin (2026-11-09)
- App: **SMTP App**, client ID `390b19fa-8476-47b6-9f16-c6fe506ae41c` (the same app as the mail sender; tenant hostname `cozzera.sharepoint.com`).
- Write grant was made on the **root Communication site** (`https://cozzera.sharepoint.com`, site id starts `ae48e8d2-112c-4aa7-b8f3-4a0a0e75125b`).
- Library created there: **InterviewRecordings** (`https://cozzera.sharepoint.com/InterviewRecordings`). It must be limited to the HR
  group/owners (stop inheriting permissions): the root site itself is open to everyone. **Confirm with the admin before going live.**
- So the server `.env` gets: `RECORDINGS_SP_SITE_URL=https://cozzera.sharepoint.com` and `RECORDINGS_SP_LIBRARY=InterviewRecordings`.
- Still to confirm: `Sites.Selected` shows "Granted for Delphic" on the app; a separate admin-only place for the database backups.

## Env (server `.env`, passed through by docker-compose)
| Variable | Meaning |
|---|---|
| `MS_GRAPH_TENANT_ID` / `MS_GRAPH_CLIENT_ID` / `MS_GRAPH_CLIENT_SECRET` | same app as the mail sender |
| `RECORDINGS_SP_SITE_URL` | e.g. `https://<tenant>.sharepoint.com/sites/HR` (or `RECORDINGS_SP_SITE_ID`) |
| `RECORDINGS_SP_LIBRARY` | optional: a document library of its own, by name or address end (e.g. `InterviewRecordings`); files go straight into it |
| `RECORDINGS_SP_DRIVE_ID` | optional; default is the site's default library |
| `RECORDINGS_SP_FOLDER` | default `Interview-Recordings` |
| `RECORDINGS_MIN_FREE_MB` | low-disk threshold, default 3072 |

First check after setting it: record a short test interview, wait ~15 minutes, confirm the file appears in the folder, the local file
is gone, and play works from the review drawer.

## Code
`server/src/lib/sharepoint.js` (client), `aiInterviews.service.js` (`moveRecordingsToSharePoint`, `sweepSharePointRecordings`,
`diskStatus`, remote-aware `recordingFor` / `removeRecordingFiles` / `purgeExpiredRecordings`), tests `sharepoint-storage.test.js` and
the "stored on SharePoint" block in `ai-interviews.test.js`.

## Database backups off the server
A dump holds every company's data, so it goes to its **own** SharePoint place that only admins can open, never the HR site/library.
Same Azure app and Graph settings, but its own `BACKUP_SP_SITE_URL` (+ `BACKUP_SP_LIBRARY` or `BACKUP_SP_FOLDER`, default folder
`DB-Backups`, `BACKUP_SP_DRIVE_ID`); the app needs a `write` grant on that site too (same Graph POST as above).

On the VPS, in the backup service environment (next to `BACKUP_MAX_TOTAL_MB`):
`BACKUP_OFFSITE_CMD='/opt/delphic/scripts/offsite-backup.sh "$1"'` - `db-backup.sh` already calls that hook after every verified dump.
`scripts/offsite-backup.sh` streams the dump into the server container; `server/scripts/offsite-backup.js` uploads it. Automatic dumps
(every 15 min) go up about once an hour, pre-deploy dumps always; SharePoint keeps the 24 newest copies, then one per day for 30 days
(`lib/offsiteBackup.js`). A failed copy only logs a warning, the local dump and its pruning are untouched. With the `BACKUP_SP_*`
values unset the script exits 2 ("not set up") and nothing changes. Once copies are confirmed on SharePoint, `BACKUP_MAX_TOTAL_MB`
can be lowered to free the server disk. Tests: `offsite-backup.test.js`. Not run against real SharePoint yet.
