#!/usr/bin/env node
/*
 * One-customer restore: copy ONE company's rows from a restored backup back into the live database,
 * without touching any other company.
 *
 *   1. Restore the dump into a scratch database (never the live one):
 *        createdb scratch_restore && pg_restore -d scratch_restore --no-owner backups/<file>.dump
 *   2. Look at what would change (default is a dry run, nothing is written):
 *        node server/scripts/restore-org.js --source "postgres://.../scratch_restore" --org acme
 *   3. Apply it:
 *        node server/scripts/restore-org.js --source "postgres://.../scratch_restore" --org acme --apply
 *
 * --target defaults to DATABASE_URL. --org is a company slug or id.
 *
 * What it does: every table with an org_id column is copied for that company only: the company's rows in the target are deleted
 * and replaced by the rows of the backup, in one transaction, parents before children (foreign-key order). The company's own
 * `orgs` row is replaced too. Rows of other companies are never read or written.
 *
 * --allow-uncovered is needed to apply when child tables (below) exist; without it the tool refuses.
 *
 * Known limit (reported at the end of every run): a table that has no org_id of its own but hangs on an org table through a foreign key
 * (a "child" table) is NOT copied by this tool; the report lists them so they can be handled before --apply on a real incident.
 */
const { PrismaClient } = require('@prisma/client');

// Parents first. `edges` = [child, parent] pairs. Tables in a cycle are appended at the end and reported.
function orderTables(tables, edges) {
  const set = new Set(tables);
  const parents = new Map(tables.map((t) => [t, new Set()]));
  for (const [child, parent] of edges) {
    if (child !== parent && set.has(child) && set.has(parent)) parents.get(child).add(parent);
  }
  const ordered = [];
  const done = new Set();
  let progressed = true;
  while (ordered.length < tables.length && progressed) {
    progressed = false;
    for (const t of tables) {
      if (done.has(t)) continue;
      if ([...parents.get(t)].every((p) => done.has(p))) {
        ordered.push(t);
        done.add(t);
        progressed = true;
      }
    }
  }
  const cyclic = tables.filter((t) => !done.has(t));
  return { ordered: [...ordered, ...cyclic], cyclic };
}

const q = (name) => `"${String(name).replace(/"/g, '""')}"`;

async function discover(db) {
  const cols = await db.$queryRawUnsafe("select table_name from information_schema.columns where table_schema='public' and column_name='org_id' order by table_name");
  const tables = cols.map((c) => c.table_name).filter((t) => t !== 'orgs');
  const fks = await db.$queryRawUnsafe(`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent
    from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace`);
  const edges = fks.map((f) => [f.child.replace(/"/g, ''), f.parent.replace(/"/g, '')]);
  return { tables, edges };
}

// Tables with no org_id that reference an org-scoped table or orgs: not copied, reported.
function uncovered(tables, edges, allTables) {
  const scoped = new Set([...tables, 'orgs']);
  const withOrg = new Set(tables);
  return allTables.filter((t) => !withOrg.has(t) && t !== 'orgs' && edges.some(([c, p]) => c === t && scoped.has(p)));
}

async function main(argv) {
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const source = arg('source');
  const target = arg('target') || process.env.DATABASE_URL;
  const orgRef = arg('org');
  const apply = argv.includes('--apply');
  if (!source || !target || !orgRef) {
    console.error('usage: restore-org.js --source <backup db url> --org <slug|id> [--target <db url>] [--apply]');
    process.exit(2);
  }
  if (source === target) { console.error('source and target are the same database; refusing.'); process.exit(2); }

  const src = new PrismaClient({ datasourceUrl: source });
  const dst = new PrismaClient({ datasourceUrl: target });
  try {
    const isId = /^[0-9a-f-]{36}$/i.test(orgRef);
    const found = await src.$queryRawUnsafe(`select id::text as id, slug, name from orgs where ${isId ? 'id::text' : 'slug'} = $1`, orgRef);
    if (!found.length) { console.error(`company ${orgRef} is not in the backup`); process.exit(1); }
    const org = found[0];
    console.log(`Company: ${org.name} (${org.slug}) ${org.id}`);
    console.log(apply ? 'Mode: APPLY (writes to the target)' : 'Mode: dry run (nothing is written)');

    const { tables, edges } = await discover(dst);
    const { ordered, cyclic } = orderTables(tables, edges);
    const allTables = (await dst.$queryRawUnsafe("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")).map((t) => t.table_name);

    const plan = [];
    for (const t of ordered) {
      const exists = await src.$queryRawUnsafe("select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name='org_id'", t);
      if (!exists.length) { plan.push({ t, inBackup: 0, inLive: 0, skipped: true }); continue; }
      const [{ n: inBackup }] = await src.$queryRawUnsafe(`select count(*)::int as n from ${q(t)} where org_id::text = $1`, org.id);
      const [{ n: inLive }] = await dst.$queryRawUnsafe(`select count(*)::int as n from ${q(t)} where org_id::text = $1`, org.id);
      plan.push({ t, inBackup, inLive });
    }
    const changing = plan.filter((p) => p.inBackup || p.inLive);
    console.log(`\nTables with rows for this company: ${changing.length} of ${plan.length}`);
    for (const p of changing) console.log(`  ${p.t.padEnd(44)} live ${String(p.inLive).padStart(6)}  ->  backup ${String(p.inBackup).padStart(6)}${p.skipped ? '  (table not in backup)' : ''}`);
    if (cyclic.length) console.log(`\nWARNING: tables in a foreign-key cycle, applied last and may need a manual check: ${cyclic.join(', ')}`);
    const loose = uncovered(tables, edges, allTables);
    if (loose.length) console.log(`\nNOT copied (no org_id, hang on an org table through a foreign key): ${loose.join(', ')}`);

    if (!apply) { console.log('\nDry run finished. Add --apply to write.'); return { plan, cyclic, loose }; }

    if (loose.length && !argv.includes('--allow-uncovered')) {
      // Replacing the company's own row can cascade into those child tables, so do not write unless the operator accepts that.
      console.error('\nRefusing to apply: the child tables listed above are not copied. Review them, then add --allow-uncovered to go on.');
      process.exit(3);
    }
    // Read everything from the backup first, so a failure here changes nothing.
    const data = new Map();
    for (const p of plan.filter((x) => !x.skipped && x.inBackup)) {
      const rows = await src.$queryRawUnsafe(`select to_jsonb(t) as r from ${q(p.t)} t where org_id::text = $1`, org.id);
      data.set(p.t, rows.map((r) => r.r));
    }
    const orgRow = await src.$queryRawUnsafe('select to_jsonb(o) as r from orgs o where id::text = $1', org.id);

    await dst.$transaction(async (tx) => {
      for (const p of [...plan].reverse()) {
        if (p.skipped || !p.inLive) continue;
        await tx.$executeRawUnsafe(`delete from ${q(p.t)} where org_id::text = $1`, org.id);
      }
      await tx.$executeRawUnsafe('delete from orgs where id::text = $1', org.id);
      await tx.$executeRawUnsafe('insert into orgs select * from jsonb_populate_recordset(null::orgs, $1::jsonb)', JSON.stringify([orgRow[0].r]));
      for (const p of plan) {
        const rows = data.get(p.t);
        if (!rows || !rows.length) continue;
        await tx.$executeRawUnsafe(`insert into ${q(p.t)} select * from jsonb_populate_recordset(null::${q(p.t)}, $1::jsonb)`, JSON.stringify(rows));
      }
    }, { timeout: 10 * 60 * 1000 });
    console.log('\nApplied. Check the company in the product and compare row counts above.');
    return { plan, cyclic, loose };
  } finally {
    await src.$disconnect();
    await dst.$disconnect();
  }
}

module.exports = { orderTables, uncovered, main };
if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error('failed:', e.message); process.exit(1); });
