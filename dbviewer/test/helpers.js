const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');
const A = 'predeploy-2026-11-04-130200.dump'; // the older snapshot
const B = 'auto-2026-11-05-081000.dump'; // the newer one

// A temp "backups" folder with both fixtures and an empty viewer folder, like the container's two mounts.
function tempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dbviewer-'));
  const dumpDir = path.join(root, 'backups');
  const viewerDir = path.join(root, 'viewer');
  fs.mkdirSync(dumpDir);
  fs.mkdirSync(viewerDir);
  fs.copyFileSync(path.join(FIXTURES, A), path.join(dumpDir, A));
  fs.copyFileSync(path.join(FIXTURES, B), path.join(dumpDir, B));
  return { root, dumpDir, viewerDir, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

module.exports = { FIXTURES, A, B, tempDirs };
