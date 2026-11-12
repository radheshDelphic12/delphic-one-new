// Comparison jobs: snapshot A against snapshot B (or a fresh "now" dump). One job runs at a time. Results are small JSON files in
// <viewerDir>/compare/<key>/ (summary.json + one file per changed table), deleted when either dump is gone.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getIndex, readTable } = require('./dumpReader');
const { diffTable } = require('./diff');

const safeName = (table) => `${encodeURIComponent(table)}.json`;

function createCompare({ snapshots, viewerDir, nowDump }) {
  const root = path.join(viewerDir, 'compare');
  const jobs = new Map();
  let busy = false;

  const keyOf = (a, b) => crypto.createHash('sha1').update(`${a.id}:${a.size}:${Math.floor(a.mtime)}|${b.id}:${b.size}:${Math.floor(b.mtime)}`).digest('hex').slice(0, 16);
  const dirOf = (key) => path.join(root, key);

  function readSummary(key) {
    if (!/^[0-9a-f]{16}$/.test(key)) return null;
    try { return JSON.parse(fs.readFileSync(path.join(dirOf(key), 'summary.json'), 'utf8')); } catch { return null; }
  }

  function readTableResult(key, table) {
    if (!readSummary(key)) return null;
    try { return JSON.parse(fs.readFileSync(path.join(dirOf(key), 'tables', safeName(table)), 'utf8')); } catch { return null; }
  }

  // Comparisons live exactly as long as both of their dumps.
  function sweep() {
    let keys = [];
    try { keys = fs.readdirSync(root); } catch { return; }
    for (const key of keys) {
      const s = readSummary(key);
      if (!s || !snapshots.resolve(s.a.id) || !snapshots.resolve(s.b.id)) fs.rmSync(dirOf(key), { recursive: true, force: true });
    }
  }

  async function migrations(snap) {
    try {
      const t = await readTable(snap.file, '_prisma_migrations');
      const i = t.columns.indexOf('migration_name');
      return t.rows.map((r) => r[i]);
    } catch { return []; }
  }

  async function execute(job, A, B) {
    const key = keyOf(A, B);
    const dir = dirOf(key);
    if (readSummary(key)) { job.key = key; return; }
    job.step = 'indexing both snapshots';
    const ia = await getIndex(A.file, viewerDir);
    const ib = await getIndex(B.file, viewerDir);
    const tmp = `${dir}.tmp-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmp, 'tables'), { recursive: true });
    const names = [...new Set([...Object.keys(ia.tables), ...Object.keys(ib.tables)])].sort();
    const tables = [];
    const schema = { tables_added: [], tables_removed: [], columns: [], migrations_added: [], migrations_removed: [] };
    let done = 0;
    for (const name of names) {
      job.step = `comparing ${name} (${done += 1}/${names.length})`;
      const ta = ia.tables[name];
      const tb = ib.tables[name];
      if (!ta) schema.tables_added.push(name);
      else if (!tb) schema.tables_removed.push(name);
      const sameCols = ta && tb && ta.columns.join(',') === tb.columns.join(',');
      if (sameCols && ta.hash && ta.hash === tb.hash) continue; // byte-identical rows: nothing to read
      const [da, db] = [ta ? await readTable(A.file, name) : null, tb ? await readTable(B.file, name) : null];
      const d = diffTable(da, db, (tb || ta).pk);
      // a table that is new or gone is listed under tables_added / tables_removed, not column by column
      if (ta && tb && (d.columns_added.length || d.columns_removed.length)) schema.columns.push({ table: name, added: d.columns_added, removed: d.columns_removed });
      const { added, removed, changed } = d.counts;
      if (!added && !removed && !changed && !d.columns_added.length && !d.columns_removed.length) continue;
      fs.writeFileSync(path.join(tmp, 'tables', safeName(name)), JSON.stringify(d));
      tables.push({
        name, rows_a: ta ? ta.rows : null, rows_b: tb ? tb.rows : null, added, removed, changed,
        keyed: d.keyed, truncated: d.truncated, columns_added: d.columns_added, columns_removed: d.columns_removed,
      });
    }
    const [ma, mb] = [await migrations(A), await migrations(B)];
    schema.migrations_added = mb.filter((m) => !ma.includes(m));
    schema.migrations_removed = ma.filter((m) => !mb.includes(m));
    const pick = (s) => ({ id: s.id, kind: s.kind, size: s.size, time_utc: s.time_utc, time_ist: s.time_ist });
    const summary = {
      key, created: new Date().toISOString(), a: pick(A), b: pick(B), schema, tables,
      totals: {
        tables_compared: names.length,
        tables_changed: tables.length,
        added: tables.reduce((n, t) => n + t.added, 0),
        removed: tables.reduce((n, t) => n + t.removed, 0),
        changed: tables.reduce((n, t) => n + t.changed, 0),
      },
    };
    fs.writeFileSync(path.join(tmp, 'summary.json'), JSON.stringify(summary));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
    job.key = key;
  }

  // a, b: snapshot ids; b may be 'now'. Returns the job (poll it with get()).
  function start(aId, bId) {
    if (busy) throw Object.assign(new Error('Another comparison is running - wait for it to finish'), { status: 409 });
    const A = snapshots.resolve(aId);
    if (!A) throw Object.assign(new Error('Unknown snapshot A'), { status: 404 });
    let B = null;
    if (bId !== 'now') {
      B = snapshots.resolve(bId);
      if (!B) throw Object.assign(new Error('Unknown snapshot B'), { status: 404 });
      if (A.id === B.id) throw Object.assign(new Error('Pick two different snapshots'), { status: 400 });
    } else if (!nowDump) {
      throw Object.assign(new Error('Compare with now is not available'), { status: 503 });
    }
    const job = { id: crypto.randomBytes(8).toString('hex'), status: 'running', step: bId === 'now' ? 'taking a fresh dump of the database' : 'starting', key: null, error: null };
    jobs.set(job.id, job);
    if (jobs.size > 50) jobs.delete(jobs.keys().next().value);
    busy = true;
    (async () => {
      try {
        let target = B;
        if (!target) {
          const id = await nowDump.take();
          target = snapshots.resolve(id);
        }
        await execute(job, A, target);
        job.status = 'done';
        job.step = 'done';
      } catch (err) {
        job.status = 'error';
        job.error = err.message;
        job.http = err.status;
      } finally {
        busy = false;
      }
    })();
    return job;
  }

  return { start, get: (id) => jobs.get(id) || null, readSummary, readTableResult, sweep, dirOf, isBusy: () => busy };
}

module.exports = { createCompare };
