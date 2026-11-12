# Server disk storage

What filled the production disk, what now keeps it in check, and what to run by hand.

## What was using the disk (read on 2026-11-11, root disk 28 GB, 22 GB used, 79%)

| What | Size | Notes |
|---|---|---|
| Docker images | 7.0 GB | 4 images; each deploy leaves the previous layers behind |
| Docker build cache | 5.5 GB (4.0 GB reclaimable) | one layer set per deploy; the weekly `until=168h` prune was too slow for several deploys a day |
| Swap files | 5.2 GB | `/swapfile` 2.1 GB + `/swapfile2` 3.1 GB (the second was added on 2026-11-10 so the client build would not run out of memory) |
| Backups (`/opt/delphic/backups`) | 727 MB | 112 dumps of about 7 MB, local only |
| Docker volumes | about 660 MB | database 134 MB, uploads 135 MB (654 files, 44 MB of AI interview recordings), three unnamed old volumes of 131 MB each |
| `/var/log` | 194 MB | |

The database itself is about 7 MB. The disk is full of deploy leftovers, not data.

## What keeps it in check now

* `scripts/disk-guard.sh` runs before and after every production deploy (`.github/workflows/deploy.yml`) and can run daily from cron.
  * Always: drops docker build cache older than 24 h and dangling images.
  * Below 8 GB free (`DISK_MIN_FREE_GB`): drops all unused build cache and unused images older than 72 h.
  * Below 4 GB free (`DISK_CRITICAL_GB`): says so and exits 2.
  * Trims the systemd journal to 200 MB when `sudo` works without a password.
  * Never touches docker volumes, `./backups`, uploads or the images of running containers.
  * `scripts/disk-guard.sh --dry-run` shows what it would do.
* **Group Dashboard > Settings > Storage** (group superadmin) shows disk used and free with a Healthy / Getting full / Almost full state, uploaded files by kind (documents, receipts, wallet attachments, AI interview recordings) with the oldest file, and the database size with its largest tables.
* `scripts/backup-prune.sh` keeps dumps in tiers under a 1500 MB cap (unchanged).

Daily cron (as the deploy user):

```
30 3 * * * cd /opt/delphic && ./scripts/disk-guard.sh >> /var/log/delphic-disk.log 2>&1
```

## One-time cleanup by hand (safe: no data is touched)

Run on the server (`ssh delphic-one`), look at each result before the next:

```
df -h /
docker system df
docker builder prune -af          # build cache; the next build is slower once
docker image prune -f             # dangling images
docker volume ls                  # the three 131 MB unnamed volumes: check they are not mounted before removing
docker volume prune -f            # removes ONLY volumes that no container uses - check `docker volume ls` first
```

Do not run `docker system prune --volumes`: it can remove the database and uploads volumes if a container is stopped.

Swap: keep `/swapfile2` while the server has 1.9 GB of memory. When the server is moved to a larger instance, remove both swap files and get back 5 GB.

## Bigger fixes (not done by this change)

* Build images in GitHub Actions and let the server only pull them. The build on the server is what needs the swap and the build cache.
* Keep backups off the server (`scripts/offsite-backup.sh` exists; a managed database such as RDS also keeps its own backups).
* Move uploaded files (CVs, receipts, recordings) to object storage. AI interview recordings already go to SharePoint when that is set up (docs/features/RECORDINGS-SHAREPOINT.md).
* A larger root disk is the simplest relief; resizing an EBS volume does not need a rebuild.

## How documents are managed (read on production 2026-11-12)

Documents here means everything people upload: CVs, receipts, wallet attachments, vendor invoice files, HR letters, AI interview recordings.

| Fact | Value |
|---|---|
| Where they live | the `delphic_uploads` docker volume, mounted at `/app/server/uploads` in the server container; the database keeps only the file name |
| Size today | 90 MB in 655 files; about 19 new files a week, so a few MB a month |
| Largest file | under 1 MB (recordings are no longer kept here once they are on SharePoint) |
| Root disk | 28 GB, 63% used, 11 GB free (after the disk-guard clean-up) |
| Off-server copy | database dumps only (`scripts/offsite-backup.sh`). Uploaded documents have **no** off-server copy |

What this means:

* Space is not a document problem. At this growth the uploads volume needs years to reach 1 GB. The earlier "storage problem" was docker images, build cache and swap, which `scripts/disk-guard.sh` now handles.
* The real risk is loss, not size: if the server disk is lost, the uploaded documents are lost with it, because only the database is copied off the server.
* Recordings are the only large documents. They go to SharePoint when Graph is set up and are removed after the retention days (`AI interview > Settings`).

Rules to follow:

1. Keep documents on the uploads volume while it is under about 5 GB. Check **Group Dashboard > Settings > Storage** (uploads by kind, oldest file) every month.
2. Run `scripts/disk-guard.sh` daily from cron (the line above is not installed yet; production has only the 15-minute database backup in cron).
3. Off-server copy of the uploads: `scripts/uploads-backup.sh` sends one `uploads-DATE.tar.gz` a day to the same SharePoint place as the database dumps and keeps the newest 14. Install on the server (as the deploy user), once:

   ```
   chmod +x scripts/uploads-backup.sh
   ( crontab -l; echo '45 3 * * * cd /opt/delphic && ./scripts/uploads-backup.sh >> /var/log/delphic-uploads-backup.log 2>&1'; echo '30 3 * * * cd /opt/delphic && ./scripts/disk-guard.sh >> /var/log/delphic-disk.log 2>&1' ) | crontab -
   ```

   Test it once by hand first (`./scripts/uploads-backup.sh`); the log line says `uploads-DATE.tar.gz: uploaded`. To restore, download the archive from SharePoint and unpack it into the uploads volume.
4. Move to object storage (SharePoint library or S3) when uploads pass about 5 GB or the disk goes under 8 GB free again.
