// The dump files the viewer can open: the host's ./backups (read-only mount) plus the viewer's own "now-*" dumps.
const fs = require('fs');
const path = require('path');

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\.dump$/;
const KINDS = ['auto', 'predeploy', 'now'];

// Time of a dump from its file name (the server clock is UTC, so the stamp in the name is UTC); otherwise the file's mtime.
function timeOf(name, stat) {
  const m = /(\d{4})-?(\d{2})-?(\d{2})[-_T]?(\d{2})(\d{2})(\d{2})/.exec(name);
  if (m) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return new Date(stat.mtimeMs);
}

function istString(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function describe(file, dir) {
  const name = path.basename(file);
  const stat = fs.statSync(file);
  const prefix = KINDS.find((k) => name.startsWith(`${k}-`));
  const time = timeOf(name, stat);
  return {
    id: name,
    kind: prefix || 'manual',
    file,
    dir,
    size: stat.size,
    mtime: stat.mtimeMs,
    time_utc: time.toISOString(),
    time_ist: istString(time),
  };
}

function createSnapshots({ dumpDir, viewerDir }) {
  function scan(dir, only) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return []; }
    return names.filter((n) => SAFE_ID.test(n) && (!only || n.startsWith(only))).map((n) => describe(path.join(dir, n), dir)).filter((s) => fs.statSync(s.file).isFile());
  }

  function list() {
    const all = [...scan(dumpDir), ...scan(viewerDir, 'now-')];
    return all.sort((a, b) => b.time_utc.localeCompare(a.time_utc));
  }

  // id -> snapshot; the id is a bare file name, never a path
  function resolve(id) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) return null;
    for (const dir of id.startsWith('now-') ? [viewerDir, dumpDir] : [dumpDir, viewerDir]) {
      // SAFE_ID has no separators or dots-only names, so this cannot leave the folder
      try {
        const file = path.join(dir, id);
        if (fs.statSync(file).isFile()) return describe(file, dir);
      } catch { /* try the next folder */ }
    }
    return null;
  }

  return { list, resolve };
}

function publicView(s) {
  const { file, dir, mtime, ...rest } = s; // never expose server paths
  return rest;
}

module.exports = { createSnapshots, publicView, SAFE_ID };
