const fs = require('fs');
const path = require('path');
const prisma = require('../../config/db');
const env = require('../../config/env');

// Group Dashboard > Settings > Storage: how full the disk is, what the uploaded files take, how big the database is. Read-only, so a full
// disk is seen coming and not found out by a failed deploy. The disk figures are those of the filesystem the uploads folder lives on.

const GB = 1024 ** 3;
const WARN_FREE_PERCENT = 20;
const CRITICAL_FREE_PERCENT = 10;
const CRITICAL_FREE_BYTES = 4 * GB;
const CACHE_MS = 60 * 1000;
let cache = null;

/** What a stored file belongs to, from its name: wallet-* (wallet attachments), deployment-* (bills), everything else by extension. */
function categoryOf(relPath) {
  const top = relPath.split(path.sep)[0];
  if (relPath.includes(path.sep)) return top === 'ai-interviews' ? 'AI interview recordings' : `Folder: ${top}`;
  if (top.startsWith('wallet-')) return 'Wallet attachments';
  if (top.startsWith('deployment-')) return 'Deployment bills';
  const ext = path.extname(top).toLowerCase();
  if (['.pdf', '.doc', '.docx', '.xlsx', '.csv'].includes(ext)) return 'Documents (CVs, agreements, invoices)';
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return 'Images and receipts';
  if (['.webm', '.mp4', '.mkv', '.wav', '.mp3'].includes(ext)) return 'Recordings';
  return 'Other files';
}

function walk(dir, base, out, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 4) walk(abs, base, out, depth + 1); } else if (e.isFile()) {
      let st; try { st = fs.statSync(abs); } catch { continue; }
      out.push({ rel: path.relative(base, abs), size: st.size, mtime: st.mtimeMs });
    }
  }
}

function uploadsReport() {
  const root = path.resolve(env.uploadDir);
  const files = [];
  walk(root, root, files);
  const by = new Map();
  for (const f of files) {
    const c = categoryOf(f.rel);
    const row = by.get(c) || { category: c, files: 0, bytes: 0, oldest: null };
    row.files += 1; row.bytes += f.size; row.oldest = row.oldest === null ? f.mtime : Math.min(row.oldest, f.mtime);
    by.set(c, row);
  }
  const rows = [...by.values()].map((r) => ({ category: r.category, files: r.files, bytes: r.bytes, oldest: r.oldest ? new Date(r.oldest).toISOString().slice(0, 10) : null })).sort((a, b) => b.bytes - a.bytes);
  const largest = files.sort((a, b) => b.size - a.size).slice(0, 10).map((f) => ({ name: f.rel, bytes: f.size, modified: new Date(f.mtime).toISOString().slice(0, 10) }));
  return { total_bytes: rows.reduce((s, r) => s + r.bytes, 0), total_files: rows.reduce((s, r) => s + r.files, 0), by_category: rows, largest };
}

function diskReport() {
  try {
    const s = fs.statfsSync(path.resolve(env.uploadDir));
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    const freePercent = total > 0 ? Math.round((free / total) * 1000) / 10 : null;
    let level = 'ok';
    if (freePercent !== null && (freePercent < CRITICAL_FREE_PERCENT || free < CRITICAL_FREE_BYTES)) level = 'critical';
    else if (freePercent !== null && freePercent < WARN_FREE_PERCENT) level = 'warning';
    return { available: true, total_bytes: total, free_bytes: free, used_bytes: total - free, free_percent: freePercent, level };
  } catch {
    return { available: false };
  }
}

async function databaseReport() {
  const [size] = await prisma.$queryRaw`SELECT pg_database_size(current_database())::bigint AS bytes`;
  const tables = await prisma.$queryRaw`
    SELECT relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname = 'public'
    ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 10`;
  return { total_bytes: Number(size.bytes), largest_tables: tables.map((t) => ({ name: t.name, bytes: Number(t.bytes) })) };
}

async function report({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const data = { checked_at: new Date().toISOString(), disk: diskReport(), uploads: uploadsReport(), database: await databaseReport() };
  cache = { at: Date.now(), data };
  return data;
}

module.exports = { report, categoryOf, diskReport };
