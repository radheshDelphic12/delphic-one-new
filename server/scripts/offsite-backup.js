#!/usr/bin/env node
// Copies one database dump to SharePoint (the BACKUP_SP_* place) and trims the older copies there.
//
//   node scripts/offsite-backup.js <dump-file>
//   node scripts/offsite-backup.js - --name auto-2026-11-09-120000.dump < dump-file    (dump piped in; used from the host, scripts/offsite-backup.sh)
//
// Needs MS_GRAPH_* plus BACKUP_SP_SITE_URL (and BACKUP_SP_LIBRARY / BACKUP_SP_FOLDER). Exit codes: 0 done or skipped on purpose,
// 1 failed, 2 not set up. A failure never touches the local dump.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getSharePoint } = require('../src/lib/sharepoint');
const { shouldUpload, planRemoteRetention } = require('../src/lib/offsiteBackup');

const log = (m) => console.log(`${new Date().toISOString().replace('T', ' ').slice(0, 19)} offsite: ${m}`);

async function main(argv) {
  const input = argv[0];
  if (!input) throw new Error('usage: offsite-backup.js <dump-file | -> [--name NAME]');
  const sp = getSharePoint('backups');
  if (!sp) { log('not set up (MS_GRAPH_* and BACKUP_SP_SITE_URL): nothing copied'); return 2; }

  const nameAt = argv.indexOf('--name');
  const name = input === '-' ? argv[nameAt + 1] : path.basename(input);
  if (!name || name.startsWith('--')) throw new Error('--name is required when the dump comes from stdin');

  const existing = await sp.listFolder();
  if (!shouldUpload(name, existing)) { log(`${name}: skipped (a recent copy exists, or not a backup file name)`); return 0; }

  let file = input;
  let tmp = null;
  if (input === '-') {
    tmp = path.join(os.tmpdir(), `offsite-${process.pid}-${name}`);
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      process.stdin.on('error', reject);
      out.on('error', reject).on('finish', resolve);
      process.stdin.pipe(out);
    });
    file = tmp;
    if ((await fs.promises.stat(tmp)).size === 0) { await fs.promises.unlink(tmp).catch(() => {}); throw new Error(`${name}: nothing was received on stdin (empty file not uploaded)`); }
  }
  try {
    const up = await sp.uploadFile(file, name);
    log(`${name}: uploaded (${up.bytes} bytes)`);
  } finally {
    if (tmp) await fs.promises.unlink(tmp).catch(() => {});
  }

  // trimming is best effort: a failure here must not look like a failed backup
  try {
    for (const f of planRemoteRetention(existing)) {
      await sp.deleteItem(f.id, f.drive_id);
      log(`${f.name}: removed from SharePoint (retention)`);
    }
  } catch (err) {
    log(`retention clean-up failed: ${err.message}`);
  }
  return 0;
}

main(process.argv.slice(2)).then((code) => process.exit(code)).catch((err) => { console.error(`offsite: ${err.message}`); process.exit(1); });
