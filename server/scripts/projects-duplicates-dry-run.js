/* eslint-disable no-console */
// READ ONLY. Lists the project records that make the Monthly performance review count a project twice or count one Finance > Projects
// does not show, and the action proposed for each. It changes nothing: no insert, update or delete is issued anywhere in this file.
//
//   node scripts/projects-duplicates-dry-run.js [org-slug]          (inside the server container: docker exec -w /app/server delphic-server-1 node scripts/...)
//
// What it reports:
//   1. DELETED projects that still have people allocated (soft-deleted accounts keep their allocation rows). Proposed: leave the
//      account deleted; the report now ignores it; move the allocation to the live project of the same name if there is one.
//   2. LIVE projects that share a name (and client): possible duplicates from a project that was entered again. Proposed: a person
//      decides whether they are one contract (merge) or two (keep, they carry different project codes).
//   3. Allocations on accounts that Finance > Projects would NOT list (not active, not run as a project). Proposed: review.
const prisma = require('../src/config/db');
const { projectListWhere } = require('../src/lib/projectScope');

const label = (a) => `${a.project_code || '(no code)'}  ${a.project_name || a.name}${a.client_name ? `  [${a.client_name}]` : ''}`;
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'open');

async function main() {
  const slug = process.argv[2];
  const orgs = await prisma.org.findMany({ where: slug ? { slug } : {}, select: { id: true, name: true, slug: true } });
  for (const org of orgs) {
    const assignments = await prisma.projectMemberAssignment.findMany({
      where: { org_id: org.id },
      select: { id: true, start_date: true, end_date: true, org_membership: { select: { employee_code: true, person: { select: { name: true } } } }, account: { select: { id: true, name: true, project_name: true, project_code: true, client_name: true, stage: true, is_project: true, deleted_at: true, agreement_start_date: true, agreement_end_date: true } } },
    });
    if (!assignments.length) continue;
    const listed = new Set((await prisma.account.findMany({ where: { deleted_at: null, ...projectListWhere(org.id) }, select: { id: true } })).map((a) => a.id));
    console.log(`\n=== ${org.name} (${org.slug}): ${assignments.length} allocations ===`);

    const deleted = assignments.filter((x) => x.account.deleted_at);
    console.log(`\n1. Allocations on DELETED projects: ${deleted.length}`);
    for (const x of deleted) console.log(`   ${x.org_membership.person?.name} (${x.org_membership.employee_code || '-'})  ->  ${label(x.account)}  deleted ${day(x.account.deleted_at)}  allocation ${day(x.start_date)} - ${day(x.end_date)}`);
    if (deleted.length) console.log('   Proposed: keep the account deleted (reports ignore it); move each allocation to the live project of the same name when there is one.');

    const live = assignments.filter((x) => !x.account.deleted_at).map((x) => x.account);
    const byName = new Map();
    for (const a of new Map(live.map((l) => [l.id, l])).values()) {
      const k = `${(a.project_name || a.name).trim().toLowerCase()}|${(a.client_name || '').trim().toLowerCase()}`;
      byName.set(k, [...(byName.get(k) || []), a]);
    }
    const dupes = [...byName.values()].filter((g) => g.length > 1);
    console.log(`\n2. LIVE projects sharing a name and client: ${dupes.length} group(s)`);
    for (const g of dupes) { console.log(`   ${g[0].project_name || g[0].name}:`); for (const a of g) console.log(`      ${label(a)}  agreement ${day(a.agreement_start_date)} - ${day(a.agreement_end_date)}  stage ${a.stage}`); }
    if (dupes.length) console.log('   Proposed: a person decides, per group, whether it is one contract (merge) or two (keep: they carry different project codes).');

    const unlisted = [...new Map(assignments.filter((x) => !x.account.deleted_at && !listed.has(x.account.id)).map((x) => [x.account.id, x.account])).values()];
    console.log(`\n3. Allocated projects Finance > Projects does not list: ${unlisted.length}`);
    for (const a of unlisted) console.log(`   ${label(a)}  stage ${a.stage}  is_project ${a.is_project}`);
    if (unlisted.length) console.log('   Proposed: review each; the report now leaves them out so it matches Finance > Projects.');
  }
  console.log('\nDry run only: nothing was changed.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
