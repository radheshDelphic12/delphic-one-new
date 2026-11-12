// Off-server copies of the database dumps on SharePoint. The server keeps its own short, size-capped history (scripts/backup-prune.sh);
// this keeps a longer one off the disk. Pure planning functions only; the upload itself is server/scripts/offsite-backup.js.

const DAY = 24 * 3600000;
const NAME_RE = /^(auto|predeploy)-\d{4}-\d{2}-\d{2}-\d{6}\.dump$/;
// The uploaded documents (CVs, receipts, invoice files, letters): one archive a day, uploads-2026-11-12.tar.gz.
const UPLOADS_RE = /^uploads-\d{4}-\d{2}-\d{2}\.tar\.gz$/;
const UPLOADS_KEEP = 14; // the newest 14 daily archives stay on SharePoint

/** Dumps run every 15 minutes; copies of automatic dumps go up about once an hour. */
const MIN_GAP_MS = 55 * 60000;

/** Should this dump be uploaded now? Pre-deploy dumps always go; automatic ones at most about once an hour; other names never. */
function shouldUpload(name, existing, now = new Date()) {
  if (UPLOADS_RE.test(name)) return !existing.some((f) => f.name === name); // once a day: today's archive is not there yet
  if (!NAME_RE.test(name)) return false;
  if (name.startsWith('predeploy-')) return true;
  const newest = existing.filter((f) => f.name.startsWith('auto-')).reduce((m, f) => Math.max(m, f.modified_at.getTime()), 0);
  return now.getTime() - newest >= MIN_GAP_MS;
}

/**
 * Which remote files to delete. Automatic dumps: the newest 24 copies (about a day, as copies go up hourly), then one per day for
 * 30 days, then nothing. Pre-deploy dumps: 30 days. Files with other names are never touched.
 */
function planRemoteRetention(files, now = new Date()) {
  const t = now.getTime();
  const mine = files.filter((f) => NAME_RE.test(f.name));
  const del = [];
  const auto = mine.filter((f) => f.name.startsWith('auto-')).sort((a, b) => b.modified_at - a.modified_at);
  const days = new Set();
  auto.forEach((f, i) => {
    if (i < 24) return;
    const day = f.modified_at.toISOString().slice(0, 10);
    if (t - f.modified_at.getTime() > 30 * DAY || days.has(day)) del.push(f);
    else days.add(day);
  });
  for (const f of mine) if (f.name.startsWith('predeploy-') && t - f.modified_at.getTime() > 30 * DAY) del.push(f);
  const uploads = files.filter((f) => UPLOADS_RE.test(f.name)).sort((a, b) => b.modified_at - a.modified_at);
  del.push(...uploads.slice(UPLOADS_KEEP));
  return del;
}

module.exports = { shouldUpload, planRemoteRetention, NAME_RE, UPLOADS_RE, MIN_GAP_MS };
