// Reads table data straight from pg_dump -Fc files with pg_restore - there is no second database.
//   pg_restore --data-only [--table=X] -f -   streams COPY blocks (text format, one table at a time in memory)
//   pg_restore --schema-only -f -             gives CREATE TABLE and PRIMARY KEY definitions
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PG_RESTORE = process.env.PG_RESTORE || 'pg_restore';
const COPY_RE = /^COPY (\S+) \((.*)\) FROM stdin;$/;

function unquote(id) {
  return id.replace(/^"|"$/g, '').replace(/""/g, '"');
}

// public.accounts / public."Some Table" -> accounts
function tableName(qualified) {
  const m = /^(?:"?[^".]+"?\.)?(.+)$/.exec(qualified);
  return unquote(m ? m[1] : qualified);
}

function spawnRestore(args) {
  // VIEWER_NICE=1 (set in the image) runs heavy work at low priority so the app keeps its CPU.
  if (process.env.VIEWER_NICE === '1') return spawn('nice', ['-n', '10', PG_RESTORE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  return spawn(PG_RESTORE, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

// COPY text format -> value. \N is NULL; the rest are backslash escapes.
function decodeField(field) {
  if (field === '\\N') return null;
  if (field.indexOf('\\') === -1) return field;
  return field.replace(/\\(x[0-9A-Fa-f]{1,2}|[0-7]{1,3}|[\s\S])/g, (_, c) => {
    switch (c[0]) {
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'v': return '\v';
      case 'x': return c.length > 1 ? String.fromCharCode(parseInt(c.slice(1), 16)) : 'x';
      default:
        if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
        return c; // \\ -> \, anything else is the character itself
    }
  });
}

function decodeRow(line) {
  return line.split('\t').map(decodeField);
}

// Async generator over the COPY blocks of a dump. Yields
//   { type: 'start', table, columns }  /  { type: 'row', line }  /  { type: 'end', table }
async function* copyBlocks(dump, table) {
  const args = ['--data-only', '-f', '-'];
  if (table) args.push(`--table=${table}`);
  args.push(dump);
  const child = spawnRestore(args);
  let stderr = '';
  child.stderr.on('data', (d) => { if (stderr.length < 4000) stderr += d; });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code));
  });
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let current = null;
  let finished = false;
  try {
    for await (const line of rl) {
      if (current) {
        if (line === '\\.') {
          yield { type: 'end', table: current };
          current = null;
        } else {
          yield { type: 'row', line };
        }
      } else {
        const m = COPY_RE.exec(line);
        if (m) {
          current = tableName(m[1]);
          yield { type: 'start', table: current, columns: m[2].split(', ').map(unquote) };
        }
      }
    }
    finished = true;
  } finally {
    if (!finished) child.kill();
  }
  const code = await exited;
  if (finished && code !== 0) throw new Error(`pg_restore failed (${code}): ${stderr.trim()}`);
}

// ---- schema -------------------------------------------------------------------------------------------------------
function runCapture(args) {
  return new Promise((resolve, reject) => {
    const child = spawnRestore(args);
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(`pg_restore failed (${code}): ${err.trim()}`))));
  });
}

function parseSchema(sql) {
  const tables = {};
  const lines = sql.split(/\r?\n/); // pg_restore on Windows ends lines with CRLF
  for (let i = 0; i < lines.length; i += 1) {
    const create = /^CREATE TABLE (\S+) \($/.exec(lines[i]);
    if (create) {
      const name = tableName(create[1]);
      const columns = [];
      for (i += 1; i < lines.length && !/^\);?$/.test(lines[i]); i += 1) {
        const m = /^\s+("(?:[^"]|"")+"|\S+) (.+?),?$/.exec(lines[i]);
        if (m && !/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/.test(m[1])) {
          columns.push({ name: unquote(m[1]), type: m[2].replace(/ DEFAULT .*$/, '').replace(/ NOT NULL$/, '').trim() });
        }
      }
      tables[name] = { columns, pk: [] };
    } else {
      const alter = /^ALTER TABLE ONLY (\S+)$/.exec(lines[i]);
      if (alter && lines[i + 1]) {
        const pk = /ADD CONSTRAINT \S+ PRIMARY KEY \((.*)\);$/.exec(lines[i + 1]);
        const name = tableName(alter[1]);
        if (pk && tables[name]) tables[name].pk = pk[1].split(', ').map(unquote);
      }
    }
  }
  return tables;
}

// ---- per-dump index (cached): columns, primary key, row count and a content hash per table --------------------------
const indexCache = new Map();

function cacheFile(viewerDir, dump, stat) {
  const key = crypto.createHash('sha1').update(`${path.basename(dump)}:${stat.size}:${Math.floor(stat.mtimeMs)}`).digest('hex').slice(0, 20);
  return path.join(viewerDir, 'cache', `index-${key}.json`);
}

async function buildIndex(dump) {
  const schema = parseSchema(await runCapture(['--schema-only', '-f', '-', dump]));
  const tables = {};
  for (const [name, def] of Object.entries(schema)) {
    tables[name] = { columns: def.columns.map((c) => c.name), types: def.columns.map((c) => c.type), pk: def.pk, rows: 0, hash: '' };
  }
  let hash = null;
  let cur = null;
  for await (const ev of copyBlocks(dump)) {
    if (ev.type === 'start') {
      cur = tables[ev.table] || (tables[ev.table] = { columns: ev.columns, types: [], pk: [], rows: 0, hash: '' });
      cur.columns = ev.columns; // the real stored order
      hash = crypto.createHash('sha1');
    } else if (ev.type === 'row') {
      cur.rows += 1;
      hash.update(ev.line).update('\n');
    } else {
      cur.hash = hash.digest('hex');
    }
  }
  const mig = tables._prisma_migrations;
  return { tables, migration_count: mig ? mig.rows : null };
}

async function getIndex(dump, viewerDir) {
  const stat = fs.statSync(dump);
  const file = viewerDir ? cacheFile(viewerDir, dump, stat) : null;
  const memKey = file || `${dump}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  if (indexCache.has(memKey)) return indexCache.get(memKey);
  let index = null;
  if (file && fs.existsSync(file)) {
    try { index = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { index = null; }
  }
  if (!index) {
    index = await buildIndex(dump);
    if (file) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(index));
      } catch { /* a read-only cache dir only costs speed */ }
    }
  }
  indexCache.set(memKey, index);
  return index;
}

// ---- one table, fully parsed, behind a size-capped LRU ------------------------------------------------------------
class TableCache {
  constructor(maxBytes) {
    this.max = maxBytes;
    this.bytes = 0;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return null;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value, size) {
    if (size > this.max) return;
    this.map.set(key, { value, size });
    this.bytes += size;
    while (this.bytes > this.max) {
      const [oldKey, old] = this.map.entries().next().value;
      this.map.delete(oldKey);
      this.bytes -= old.size;
    }
  }
}

const tableCache = new TableCache((Number(process.env.TABLE_CACHE_MB) || 64) * 1024 * 1024);

async function readTable(dump, table) {
  const stat = fs.statSync(dump);
  const key = `${dump}:${stat.size}:${Math.floor(stat.mtimeMs)}:${table}`;
  const hit = tableCache.get(key);
  if (hit) return hit;
  let columns = null;
  const rows = [];
  let bytes = 0;
  for await (const ev of copyBlocks(dump, table)) {
    if (ev.type === 'start' && ev.table === table) columns = ev.columns;
    else if (ev.type === 'row') {
      rows.push(decodeRow(ev.line));
      bytes += ev.line.length * 2 + 64;
    }
  }
  if (!columns) throw Object.assign(new Error(`No table "${table}" in this snapshot`), { status: 404 });
  const value = { columns, rows };
  tableCache.set(key, value, bytes);
  return value;
}

module.exports = { copyBlocks, decodeField, decodeRow, parseSchema, getIndex, readTable, tableName };
