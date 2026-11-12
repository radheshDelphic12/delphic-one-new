// Append-only JSON-lines audit log: who viewed, compared, downloaded or revealed what. Rotated at 5 MB, 3 files kept.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP = 3;

function createAudit(dir, now = () => new Date()) {
  const file = path.join(dir, 'audit.log');

  function rotate() {
    try {
      if (fs.statSync(file).size < MAX_BYTES) return;
    } catch {
      return;
    }
    for (let i = KEEP - 1; i >= 1; i -= 1) {
      const from = `${file}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${file}.${i + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
    try { fs.rmSync(`${file}.${KEEP}`, { force: true }); } catch { /* best effort */ }
  }

  // entry: { action, snapshot?, table?, ... }; user: { name, email }
  function log(user, entry) {
    const line = JSON.stringify({ ts: now().toISOString(), name: user && user.name, email: user && user.email, ...entry });
    try {
      fs.mkdirSync(dir, { recursive: true });
      rotate();
      fs.appendFileSync(file, `${line}\n`);
    } catch {
      // an unwritable audit log must not take the viewer down, but say so
      process.stderr.write(`audit log write failed: ${line}\n`);
    }
  }

  return { log, file };
}

module.exports = { createAudit };
