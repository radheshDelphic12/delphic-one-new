// "Compare with now": a fresh pg_dump -Fc of the live database, taken as the read-only dump_reader role into the viewer's own
// folder. The viewer never queries the live database - it only takes this dump. Guarded by free space, a 5 minute cooldown and
// one run at a time; the result is checked with pg_restore --list before it is kept. The newest 5 now-* dumps are kept.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const COOLDOWN_MS = 5 * 60 * 1000;
const KEEP = 5;

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const nice = process.env.VIEWER_NICE === '1';
    const child = nice ? spawn('nice', ['-n', '10', cmd, ...args], { env, stdio: ['ignore', 'ignore', 'pipe'] }) : spawn(cmd, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { if (err.length < 2000) err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} failed (${code}): ${err.trim()}`))));
  });
}

// dump / verify are injectable for tests; by default both spawn the real client tools.
function createNowDump({ viewerDir, db, minFreeGb = 3, now = () => new Date(), freeBytes, dump = run, verify = run }) {
  let running = false;
  let lastAt = 0;

  function free() {
    if (freeBytes) return freeBytes();
    const s = fs.statfsSync(viewerDir);
    return s.bavail * s.bsize;
  }

  function newest() {
    try {
      return fs.readdirSync(viewerDir).filter((n) => /^now-.*\.dump$/.test(n)).map((n) => ({ n, t: fs.statSync(path.join(viewerDir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    } catch { return []; }
  }

  async function take() {
    if (!db || !db.host || !db.password) throw Object.assign(new Error('Compare with now is not set up on this server (DUMP_READER_PASSWORD missing)'), { status: 503 });
    if (running) throw Object.assign(new Error('A dump is already running'), { status: 409 });
    const wait = lastAt + COOLDOWN_MS - Date.now();
    if (wait > 0) throw Object.assign(new Error(`Only one fresh dump every 5 minutes - try again in ${Math.ceil(wait / 1000)} s`), { status: 429, retryAfter: Math.ceil(wait / 1000) });
    const need = (minFreeGb + 1) * 1024 ** 3;
    if (free() < need) throw Object.assign(new Error(`Not enough free disk space for a fresh dump (needs ${minFreeGb + 1} GB free)`), { status: 507 });
    running = true;
    lastAt = Date.now();
    const id = `now-${stamp(now())}.dump`;
    const tmp = path.join(viewerDir, `.${id}.part`);
    const out = path.join(viewerDir, id);
    try {
      fs.mkdirSync(viewerDir, { recursive: true });
      const env = { ...process.env, PGPASSWORD: db.password, PGCONNECT_TIMEOUT: '10', PGOPTIONS: '-c default_transaction_read_only=on' };
      await dump(process.env.PG_DUMP || 'pg_dump', ['-Fc', '-h', db.host, '-p', String(db.port || 5432), '-U', db.user, '-d', db.name, '-f', tmp], env);
      await verify(process.env.PG_RESTORE || 'pg_restore', ['--list', tmp], process.env);
      fs.renameSync(tmp, out);
      newest().slice(KEEP).forEach((f) => fs.rmSync(path.join(viewerDir, f.n), { force: true }));
      return id;
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      lastAt = 0; // a failed attempt does not start the cooldown
      throw err;
    } finally {
      running = false;
    }
  }

  return { take };
}

module.exports = { createNowDump, stamp };
