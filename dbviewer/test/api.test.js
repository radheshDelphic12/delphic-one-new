const fs = require('fs');
const path = require('path');
const request = require('supertest');
const ExcelJS = require('exceljs');
const { createApp } = require('../server/app');
const { createAuth } = require('../server/auth');
const { createAudit } = require('../server/audit');
const { createNowDump } = require('../server/nowDump');
const { A, B, tempDirs } = require('./helpers');

const SUPER = 'Bearer super-token';
const ADMIN = 'Bearer admin-token';
const MASK = '••••••';

// A stand-in for the app's GET /api/v1/superadmin/whoami
function fakeApp(calls) {
  return async (url, opts) => {
    calls.push(opts.headers.Authorization);
    const t = opts.headers.Authorization;
    const reply = (status, data) => ({ status, json: async () => ({ data }) });
    if (t === SUPER) return reply(200, { id: 'u1', name: 'Root Person', email: 'root@example.com' });
    if (t === ADMIN) return reply(403);
    return reply(401);
  };
}

describe('auth', () => {
  test('no token is 401, a non-super-admin is 403, a super admin is 200', async () => {
    const calls = [];
    const auth = createAuth({ apiUrl: 'http://app', fetchImpl: fakeApp(calls) });
    expect((await auth.check(undefined)).status).toBe(401);
    expect(calls).toHaveLength(0); // no token: the app is not even asked
    expect((await auth.check('Bearer nope')).status).toBe(401);
    expect((await auth.check(ADMIN)).status).toBe(403);
    expect((await auth.check(SUPER))).toMatchObject({ status: 200, user: { name: 'Root Person' } });
  });

  test('an answer is cached for 60 s per token, then asked again', async () => {
    let t = 1000;
    const calls = [];
    const auth = createAuth({ apiUrl: 'http://app', fetchImpl: fakeApp(calls), now: () => t });
    await auth.check(SUPER);
    t += 59000;
    await auth.check(SUPER);
    expect(calls).toHaveLength(1);
    t += 2000;
    await auth.check(SUPER);
    expect(calls).toHaveLength(2);
  });

  test('an app that cannot be reached is a 502 and is not cached', async () => {
    let up = false;
    const fetchImpl = async () => { if (!up) throw new Error('down'); return { status: 200, json: async () => ({ data: { name: 'R' } }) }; };
    const auth = createAuth({ apiUrl: 'http://app', fetchImpl });
    expect((await auth.check(SUPER)).status).toBe(502);
    up = true;
    expect((await auth.check(SUPER)).status).toBe(200);
  });
});

describe('the API', () => {
  let dirs; let app; let audit; let calls;
  const get = (url, token = SUPER) => request(app).get(url).set('Authorization', token);

  beforeEach(() => {
    dirs = tempDirs();
    calls = [];
    audit = createAudit(dirs.viewerDir);
    const auth = createAuth({ apiUrl: 'http://app', fetchImpl: fakeApp(calls) });
    app = createApp({ config: { dumpDir: dirs.dumpDir, viewerDir: dirs.viewerDir }, auth, audit, nowDump: null });
  });
  afterEach(() => dirs.cleanup());

  const auditLines = () => fs.readFileSync(audit.file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

  test('every API call needs a super admin', async () => {
    expect((await request(app).get('/api/snapshots')).status).toBe(401);
    expect((await get('/api/snapshots', ADMIN)).status).toBe(403);
    expect((await get('/api/snapshots')).status).toBe(200);
  });

  test('snapshots are listed newest first with kind, UTC and IST time and size, and no server paths', async () => {
    const res = await get('/api/snapshots');
    expect(res.body.snapshots.map((s) => s.id)).toEqual([B, A]);
    expect(res.body.snapshots[1]).toMatchObject({ kind: 'predeploy', time_utc: '2026-11-04T13:02:00.000Z', time_ist: '2026-11-04 18:32' });
    expect(res.body.snapshots[0].kind).toBe('auto');
    expect(JSON.stringify(res.body)).not.toContain(dirs.root);
  });

  test('migration count is read lazily from the dump', async () => {
    expect((await get(`/api/snapshots/${A}/info`)).body.migration_count).toBe(2);
    expect((await get(`/api/snapshots/${B}/info`)).body.migration_count).toBe(3);
  });

  test('a snapshot id can never leave the backups folder', async () => {
    expect((await get('/api/snapshots/..%2F..%2Fetc%2Fpasswd/tables')).status).toBe(404);
    expect((await get('/api/snapshots/not-a-dump.txt/tables')).status).toBe(404);
  });

  test('tables list with row counts; a table page shows rows as stored with secrets and identifiers masked', async () => {
    const tables = await get(`/api/snapshots/${A}/tables`);
    expect(tables.body.tables.find((t) => t.name === 'people')).toMatchObject({ rows: 5, pk: ['id'] });
    const page = await get(`/api/snapshots/${A}/tables/people`);
    const cols = page.body.columns.map((c) => c.name);
    const row = Object.fromEntries(cols.map((c, i) => [c, page.body.rows[0][i]]));
    expect(page.body.total).toBe(5);
    expect(row.name).toBe('Asha');
    expect(row.password_hash).toBe(MASK);
    expect(row.aadhaar_number).toBe(MASK);
    expect(page.body.columns.find((c) => c.name === 'password_hash').mask).toBe('always');
  });

  test('filter, sort and paging', async () => {
    const q = await get(`/api/snapshots/${A}/tables/people?q=chit`);
    expect(q.body.total).toBe(1);
    const sorted = await get(`/api/snapshots/${A}/tables/people?sort=amount&dir=desc&size=2`);
    expect(sorted.body.rows.map((r) => r[0])).toEqual(['p4', 'p3']);
    const p2 = await get(`/api/snapshots/${A}/tables/people?sort=amount&dir=desc&size=2&page=2`);
    expect(p2.body.rows.map((r) => r[0])).toEqual(['p2', 'p1']);
  });

  test('masked columns cannot be searched, so a search cannot reveal their values', async () => {
    expect((await get(`/api/snapshots/${A}/tables/people?q=hash-A-1`)).body.total).toBe(0);
    expect((await get(`/api/snapshots/${A}/tables/people?q=1111`)).body.total).toBe(0);
  });

  test('reveal shows personal identifiers, never secrets, and writes an audit line', async () => {
    const page = await get(`/api/snapshots/${A}/tables/people?reveal=1`);
    const cols = page.body.columns.map((c) => c.name);
    const row = Object.fromEntries(cols.map((c, i) => [c, page.body.rows[0][i]]));
    expect(row.aadhaar_number).toBe('1111 2222 3333');
    expect(row.password_hash).toBe(MASK);
    const lines = auditLines();
    expect(lines.find((l) => l.action === 'reveal')).toMatchObject({ name: 'Root Person', email: 'root@example.com', snapshot: A, table: 'people' });
    expect(lines.find((l) => l.action === 'view_table')).toBeDefined();
  });

  test('CSV: header, rows, embedded commas / quotes / newlines escaped, masked columns masked', async () => {
    const res = await get(`/api/snapshots/${A}/tables/people/csv`);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/\.csv"/);
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe('id,name,note,password_hash,aadhaar_number,amount');
    expect(res.text).toContain('"tab\there and newline\nand back\\slash and ""quotes"""');
    expect(res.text).not.toContain('hash-A-1');
    expect(res.text).not.toContain('1111 2222');
    expect(auditLines().some((l) => l.action === 'download_csv')).toBe(true);
  });

  test('XLSX of a whole snapshot: one sheet per non-empty table, masked columns masked', async () => {
    const res = await get(`/api/snapshots/${A}/xlsx`).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets.map((w) => w.name).sort()).toEqual(['_prisma_migrations', 'dropped_later', 'events', 'people', 'same_in_both']);
    const people = wb.getWorksheet('people');
    expect(people.getRow(1).values.slice(1)).toEqual(['id', 'name', 'note', 'password_hash', 'aadhaar_number', 'amount']);
    expect(people.rowCount).toBe(6);
    expect(people.getRow(2).getCell(4).value).toBe(MASK);
  });

  describe('comparison', () => {
    async function run(a, b) {
      const start = await request(app).post('/api/compare').set('Authorization', SUPER).send({ a, b });
      expect(start.status).toBe(202);
      for (let i = 0; i < 200; i += 1) {
        const job = (await get(`/api/compare/jobs/${start.body.job}`)).body;
        if (job.status === 'done') return job.key;
        if (job.status === 'error') throw new Error(job.error);
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('compare did not finish');
    }

    test('summary: changed tables with added / removed / changed counts, schema changes and new migrations', async () => {
      const key = await run(A, B);
      const s = (await get(`/api/compare/${key}`)).body;
      const byName = Object.fromEntries(s.tables.map((t) => [t.name, t]));
      expect(Object.keys(byName).sort()).toEqual(['_prisma_migrations', 'brand_new', 'dropped_later', 'events', 'people']);
      expect(byName.people).toMatchObject({ added: 1, removed: 1, changed: 2, rows_a: 5, rows_b: 5, columns_added: ['nickname'] });
      expect(byName.events).toMatchObject({ added: 2, removed: 2, changed: 0, keyed: false });
      expect(s.schema.tables_added).toEqual(['brand_new']);
      expect(s.schema.tables_removed).toEqual(['dropped_later']);
      expect(s.schema.migrations_added).toEqual(['20260301000000_nicknames']);
      expect(s.totals).toMatchObject({ tables_changed: 5 });
      expect(s.tables.find((t) => t.name === 'same_in_both')).toBeUndefined();
    });

    test('table detail: changed rows show old to new; secrets only say changed; sensitive values need reveal', async () => {
      const key = await run(A, B);
      const d = (await get(`/api/compare/${key}/tables/people?kind=changed`)).body;
      const p3 = d.items.find((i) => i.key[0] === 'p3');
      expect(p3.changes.find((c) => c.col === 'amount')).toEqual({ col: 'amount', old: '30.00', new: '31.00' });
      expect(p3.changes.find((c) => c.col === 'aadhaar_number')).toEqual({ col: 'aadhaar_number', old: null, new: MASK });
      const p2 = d.items.find((i) => i.key[0] === 'p2');
      expect(p2.changes.find((c) => c.col === 'password_hash')).toEqual({ col: 'password_hash', masked: true });
      const revealed = (await get(`/api/compare/${key}/tables/people?kind=changed&reveal=1`)).body;
      expect(revealed.items.find((i) => i.key[0] === 'p3').changes.find((c) => c.col === 'aadhaar_number').new).toBe('7777 8888 9999');
      const added = (await get(`/api/compare/${key}/tables/people?kind=added`)).body;
      expect(added.items[0].row).toMatchObject({ id: 'p6', name: 'Farah', password_hash: MASK });
    });

    test('the same pair is answered from the saved result; deleting a dump deletes its comparison', async () => {
      const key = await run(A, B);
      expect(await run(A, B)).toBe(key);
      fs.rmSync(path.join(dirs.dumpDir, A));
      await get('/api/snapshots');
      expect((await get(`/api/compare/${key}`)).status).toBe(404);
    });

    test('XLSX of a comparison: Summary sheet, then one sheet per changed table with the old -> new cells', async () => {
      const key = await run(A, B);
      const res = await get(`/api/compare/${key}/xlsx`).buffer(true).parse((r, cb) => { const c = []; r.on('data', (x) => c.push(x)); r.on('end', () => cb(null, Buffer.concat(c))); });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body);
      expect(wb.worksheets[0].name).toBe('Summary');
      const summaryRows = [];
      wb.getWorksheet('Summary').eachRow((r) => summaryRows.push(r.values.slice(1)));
      expect(summaryRows.find((r) => r[0] === 'people')).toEqual(['people', 1, 1, 2, 5, 5, 'nickname']);
      const sheet = wb.getWorksheet('people');
      const rows = [];
      sheet.eachRow((r) => rows.push(r.values.slice(1)));
      const header = rows[0];
      expect(header.slice(0, 3)).toEqual(['Change', 'Key', 'id']);
      const p3 = rows.find((r) => r[0] === 'changed' && r[1] === 'p3');
      expect(p3[header.indexOf('amount')]).toBe('30.00 -> 31.00');
      const p2 = rows.find((r) => r[0] === 'changed' && r[1] === 'p2');
      expect(p2[header.indexOf('password_hash')]).toBe('(changed)');
      expect(JSON.stringify(rows)).not.toMatch(/hash-[A-F]-\d/);
    });

    test('pick two different snapshots, and both must exist', async () => {
      expect((await request(app).post('/api/compare').set('Authorization', SUPER).send({ a: A, b: A })).status).toBe(400);
      expect((await request(app).post('/api/compare').set('Authorization', SUPER).send({ a: A, b: 'missing.dump' })).status).toBe(404);
      expect((await request(app).post('/api/compare').set('Authorization', SUPER).send({ a: A, b: 'now' })).status).toBe(503); // no dump_reader configured
    });
  });
});

describe('compare with now: taking the fresh dump', () => {
  function build({ free = 50 * 1024 ** 3, dump } = {}) {
    const dirs = tempDirs();
    const created = [];
    const nd = createNowDump({
      viewerDir: dirs.viewerDir,
      db: { host: 'db', port: 5432, name: 'app', user: 'dump_reader', password: 'pw' },
      minFreeGb: 3,
      freeBytes: () => free,
      now: () => new Date(Date.UTC(2026, 10, 5, 9, 0, created.length)),
      dump: dump || (async (cmd, args) => { created.push(args); fs.writeFileSync(args[args.indexOf('-f') + 1], 'dump'); }),
      verify: async () => {},
    });
    return { dirs, nd, created };
  }

  test('writes now-<utc time>.dump as the read-only role, verified, and keeps only the newest 5', async () => {
    const { dirs, nd, created } = build();
    try {
      for (let i = 1; i <= 7; i += 1) {
        const f = path.join(dirs.viewerDir, `now-2026-11-0${i}-000000.dump`);
        fs.writeFileSync(f, 'x');
        fs.utimesSync(f, new Date(2026, 10, i), new Date(2026, 10, i));
      }
      const id = await nd.take();
      expect(id).toBe('now-2026-11-05-090000.dump');
      expect(created[0]).toEqual(expect.arrayContaining(['-U', 'dump_reader', '-Fc']));
      const left = fs.readdirSync(dirs.viewerDir).filter((n) => /^now-.*\.dump$/.test(n));
      expect(left).toHaveLength(5);
      expect(left).toContain(id);
      expect(left).not.toContain('now-2026-11-01-000000.dump');
    } finally { dirs.cleanup(); }
  });

  test('refused under BACKUP_MIN_FREE_GB + 1 free, and not set up without the role password', async () => {
    const low = build({ free: 3.5 * 1024 ** 3 });
    await expect(low.nd.take()).rejects.toMatchObject({ status: 507 });
    low.dirs.cleanup();
    const off = createNowDump({ viewerDir: '/nonexistent', db: { host: 'db' } });
    await expect(off.take()).rejects.toMatchObject({ status: 503 });
  });

  test('one every 5 minutes, one at a time; a failed dump leaves no file and does not start the cooldown', async () => {
    const { dirs, nd } = build();
    try {
      await nd.take();
      await expect(nd.take()).rejects.toMatchObject({ status: 429 });
    } finally { dirs.cleanup(); }

    let release;
    const slow = build({ dump: (cmd, args) => new Promise((r) => { release = () => { fs.writeFileSync(args[args.indexOf('-f') + 1], 'd'); r(); }; }) });
    try {
      const first = slow.nd.take();
      await expect(slow.nd.take()).rejects.toMatchObject({ status: 409 });
      await new Promise((r) => setTimeout(r, 10));
      release();
      await first;
    } finally { slow.dirs.cleanup(); }

    const bad = build({ dump: async () => { throw new Error('pg_dump failed'); } });
    try {
      await expect(bad.nd.take()).rejects.toThrow('pg_dump failed');
      expect(fs.readdirSync(bad.dirs.viewerDir).filter((n) => n.includes('now-'))).toEqual([]);
      await expect(bad.nd.take()).rejects.toThrow('pg_dump failed'); // not 429: the failure did not start the cooldown
    } finally { bad.dirs.cleanup(); }
  });
});

describe('audit log', () => {
  test('appends JSON lines and rotates at 5 MB keeping 3 files', () => {
    const dirs = tempDirs();
    try {
      const audit = createAudit(dirs.viewerDir);
      const user = { name: 'Root', email: 'r@example.com' };
      audit.log(user, { action: 'a' });
      expect(JSON.parse(fs.readFileSync(audit.file, 'utf8').trim())).toMatchObject({ name: 'Root', email: 'r@example.com', action: 'a' });
      fs.writeFileSync(audit.file, 'x'.repeat(5 * 1024 * 1024 + 1));
      audit.log(user, { action: 'b' });
      expect(fs.existsSync(`${audit.file}.1`)).toBe(true);
      fs.writeFileSync(audit.file, 'x'.repeat(5 * 1024 * 1024 + 1));
      audit.log(user, { action: 'c' });
      fs.writeFileSync(audit.file, 'x'.repeat(5 * 1024 * 1024 + 1));
      audit.log(user, { action: 'd' });
      expect(fs.existsSync(`${audit.file}.3`)).toBe(false);
      expect(fs.existsSync(`${audit.file}.2`)).toBe(true);
    } finally { dirs.cleanup(); }
  });
});
