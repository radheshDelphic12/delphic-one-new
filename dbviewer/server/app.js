const express = require('express');
const fs = require('fs');
const path = require('path');
const { createSnapshots, publicView } = require('./snapshots');
const { getIndex, readTable } = require('./dumpReader');
const { classify, show, MASK } = require('./mask');
const { createCompare } = require('./compare');
const { writeTableCsv, writeSnapshotXlsx, writeCompareXlsx } = require('./exporters');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp({ config, auth, audit, nowDump }) {
  const snapshots = createSnapshots({ dumpDir: config.dumpDir, viewerDir: config.viewerDir });
  const compare = createCompare({ snapshots, viewerDir: config.viewerDir, nowDump });
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    // Same origin as the app, so the page may only load its own files and talk to itself.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    next();
  });

  // Exports and comparisons are the memory-heavy work in a small container: only one of them runs at a time.
  let exporting = false;
  async function exclusive(res, fn) {
    if (exporting || compare.isBusy()) throw Object.assign(new Error('Another export or comparison is running - try again in a moment'), { status: 429 });
    exporting = true;
    try { await fn(); } finally { exporting = false; }
  }

  const api = express.Router();
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(express.json({ limit: '10kb' }));
  api.use(auth.middleware);

  const snap = (req) => {
    const s = snapshots.resolve(req.params.id);
    if (!s) throw Object.assign(new Error('Unknown snapshot'), { status: 404 });
    return s;
  };
  const reveal = (req) => req.query.reveal === '1';
  const note = (req, entry) => audit.log(req.user, { ...entry, ...(reveal(req) ? { reveal: true } : {}) });
  // A reveal opens only the "sensitive" class, and is logged on its own line whenever it is asked for.
  const noteReveal = (req, entry) => { if (reveal(req)) audit.log(req.user, { action: 'reveal', ...entry }); };

  api.get('/me', (req, res) => res.json({ user: req.user, snapshots_read_only: true, compare_now: Boolean(nowDump) }));

  api.get('/snapshots', (req, res) => {
    compare.sweep();
    res.json({ snapshots: snapshots.list().map(publicView) });
  });

  // Migration count, read lazily from the dump's _prisma_migrations rows (one small table).
  api.get('/snapshots/:id/info', wrap(async (req, res) => {
    const s = snap(req);
    let migration_count = null;
    try { migration_count = (await readTable(s.file, '_prisma_migrations')).rows.length; } catch { /* a dump without the table */ }
    res.json({ id: s.id, migration_count });
  }));

  api.get('/snapshots/:id/tables', wrap(async (req, res) => {
    const s = snap(req);
    const index = await getIndex(s.file, config.viewerDir);
    audit.log(req.user, { action: 'view_snapshot', snapshot: s.id });
    const tables = Object.entries(index.tables).map(([name, t]) => ({ name, rows: t.rows, columns: t.columns.length, pk: t.pk }));
    res.json({ snapshot: publicView(s), tables: tables.sort((a, b) => a.name.localeCompare(b.name)), migration_count: index.migration_count });
  }));

  function pageOf(table, query, doReveal) {
    const size = Math.min(Math.max(parseInt(query.size, 10) || 100, 1), 500);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const cols = table.columns;
    let rows = table.rows;
    const q = String(query.q || '').trim().toLowerCase();
    if (q) {
      // masked columns are not searchable (a search on them would reveal their values one match at a time)
      const searchable = cols.map((c, i) => [c, i]).filter(([c]) => { const k = classify(c); return !k || (k === 'sensitive' && doReveal); }).map(([, i]) => i);
      rows = rows.filter((r) => searchable.some((i) => r[i] !== null && r[i].toLowerCase().includes(q)));
    }
    const sortIdx = cols.indexOf(query.sort);
    if (sortIdx !== -1 && !(classify(query.sort) === 'always' || (classify(query.sort) === 'sensitive' && !doReveal))) {
      const dir = query.dir === 'desc' ? -1 : 1;
      const num = (v) => (v !== null && v !== '' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null);
      rows = [...rows].sort((x, y) => {
        const [a, b] = [x[sortIdx], y[sortIdx]];
        if (a === b) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        const [na, nb] = [num(a), num(b)];
        return dir * (na !== null && nb !== null ? na - nb : a.localeCompare(b));
      });
    }
    const slice = rows.slice((page - 1) * size, page * size);
    return {
      page, size, total: rows.length,
      rows: slice.map((r) => r.map((v, i) => show(cols[i], v, doReveal))),
    };
  }

  api.get('/snapshots/:id/tables/:table', wrap(async (req, res) => {
    const s = snap(req);
    const index = await getIndex(s.file, config.viewerDir);
    const meta = index.tables[req.params.table];
    if (!meta) throw Object.assign(new Error('Unknown table'), { status: 404 });
    const t = await readTable(s.file, req.params.table);
    const out = pageOf(t, req.query, reveal(req));
    note(req, { action: 'view_table', snapshot: s.id, table: req.params.table });
    noteReveal(req, { snapshot: s.id, table: req.params.table });
    res.json({
      table: req.params.table, pk: meta.pk, mask: MASK,
      columns: t.columns.map((c, i) => ({ name: c, type: meta.types[i] || '', mask: classify(c) })),
      ...out,
    });
  }));

  api.get('/snapshots/:id/tables/:table/csv', wrap(async (req, res) => {
    const s = snap(req);
    const index = await getIndex(s.file, config.viewerDir);
    if (!index.tables[req.params.table]) throw Object.assign(new Error('Unknown table'), { status: 404 });
    note(req, { action: 'download_csv', snapshot: s.id, table: req.params.table });
    noteReveal(req, { snapshot: s.id, table: req.params.table });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${s.id.replace(/\.dump$/, '')}__${req.params.table.replace(/[^A-Za-z0-9_-]/g, '_')}.csv"`);
    await writeTableCsv(res, s.file, req.params.table, reveal(req));
  }));

  api.get('/snapshots/:id/xlsx', wrap(async (req, res) => {
    const s = snap(req);
    const index = await getIndex(s.file, config.viewerDir);
    note(req, { action: 'download_snapshot_xlsx', snapshot: s.id });
    noteReveal(req, { snapshot: s.id });
    await exclusive(res, () => writeSnapshotXlsx(res, s.file, index, `${s.id.replace(/\.dump$/, '')}.xlsx`, reveal(req)));
  }));

  // ---- comparisons --------------------------------------------------------------------------------------------------
  api.post('/compare', (req, res) => {
    const { a, b } = req.body || {};
    if (exporting) throw Object.assign(new Error('An export is running - try again in a moment'), { status: 429 });
    const job = compare.start(a, b);
    audit.log(req.user, { action: 'compare', a, b });
    res.status(202).json({ job: job.id });
  });

  api.get('/compare/jobs/:job', (req, res) => {
    const job = compare.get(req.params.job);
    if (!job) return res.status(404).json({ error: 'Unknown job' });
    return res.json({ status: job.status, step: job.step, key: job.key, error: job.error });
  });

  const summaryOr404 = (req) => {
    const s = compare.readSummary(req.params.key);
    if (!s) throw Object.assign(new Error('Unknown comparison (it is removed when either dump is deleted)'), { status: 404 });
    return s;
  };

  api.get('/compare/:key', (req, res) => res.json(summaryOr404(req)));

  api.get('/compare/:key/tables/:table', (req, res) => {
    summaryOr404(req);
    const d = compare.readTableResult(req.params.key, req.params.table);
    if (!d) throw Object.assign(new Error('That table did not change'), { status: 404 });
    const kind = ['added', 'removed', 'changed'].includes(req.query.kind) ? req.query.kind : 'changed';
    const size = Math.min(Math.max(parseInt(req.query.size, 10) || 100, 1), 500);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const doReveal = reveal(req);
    const items = d[kind].slice((page - 1) * size, page * size).map((it) => (kind === 'changed'
      ? { key: it.key, changes: it.changes.map((c) => (c.masked ? c : { col: c.col, old: show(c.col, c.old, doReveal), new: show(c.col, c.new, doReveal) })) }
      : { key: it.key, row: Object.fromEntries(Object.entries(it.row).map(([c, v]) => [c, show(c, v, doReveal)])) }));
    audit.log(req.user, { action: 'view_compare_table', compare: req.params.key, table: req.params.table, ...(doReveal ? { reveal: true } : {}) });
    noteReveal(req, { compare: req.params.key, table: req.params.table });
    res.json({ table: req.params.table, kind, columns: d.columns, pk: d.pk, keyed: d.keyed, counts: d.counts, truncated: d.truncated, page, size, total: d[kind].length, items });
  });

  api.get('/compare/:key/xlsx', wrap(async (req, res) => {
    const s = summaryOr404(req);
    audit.log(req.user, { action: 'download_compare_xlsx', compare: req.params.key, a: s.a.id, b: s.b.id, ...(reveal(req) ? { reveal: true } : {}) });
    noteReveal(req, { compare: req.params.key });
    await exclusive(res, () => writeCompareXlsx(res, s, (t) => compare.readTableResult(req.params.key, t), `compare__${s.a.id.replace(/\.dump$/, '')}__${s.b.id.replace(/\.dump$/, '')}.xlsx`, reveal(req)));
  }));

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // the built UI (web/dist); the page itself is public, but every API call above needs a super admin
  const dist = path.join(__dirname, '..', 'web', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: 'index.html', maxAge: 0 }));
    app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) process.stderr.write(`${err.stack || err}\n`);
    if (res.headersSent) return res.end();
    return res.status(status).json({ error: status >= 500 ? 'Something went wrong reading this snapshot' : err.message });
  });

  return app;
}

module.exports = { createApp };
