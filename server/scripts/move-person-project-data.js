/* Moves one person's timesheet entries, regularisation / overtime tickets and project assignment from one account to
 * another (e.g. hours logged on a dropped client account that only carries a project_name, to the real project account).
 *
 *   node scripts/move-person-project-data.js --person "Arunim" --from <accountId> --to <accountId>          # report only
 *   node scripts/move-person-project-data.js --person "Arunim" --from <accountId> --to <accountId> --apply  # write
 *
 * Only that person's rows move; other people on the --from account are left alone. All writes run in one transaction.
 */
const prisma = require('../src/config/db');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const person = arg('person');
const from = arg('from');
const to = arg('to');
const apply = process.argv.includes('--apply');

async function main() {
  if (!person || !from || !to) throw new Error('Usage: --person <name> --from <accountId> --to <accountId> [--apply]');
  const [src, dst] = await Promise.all([from, to].map((id) => prisma.account.findUnique({ where: { id }, select: { id: true, org_id: true, name: true, project_name: true, stage: true, is_project: true } })));
  if (!src || !dst) throw new Error('Account not found');
  if (src.org_id !== dst.org_id) throw new Error('Accounts belong to different companies');
  const members = await prisma.orgMembership.findMany({ where: { org_id: src.org_id, person: { name: { startsWith: person, mode: 'insensitive' } } }, select: { id: true, person: { select: { name: true } } } });
  if (members.length !== 1) throw new Error(`--person must match exactly one member, matched ${members.length}: ${members.map((m) => m.person.name).join(', ')}`);
  const m = members[0];
  const who = { org_membership_id: m.id };

  console.log(`Person: ${m.person.name}\nFrom: ${src.name} (project_name ${src.project_name}, stage ${src.stage}, is_project ${src.is_project})\nTo:   ${dst.name} (stage ${dst.stage}, is_project ${dst.is_project})`);
  const [entries, tickets, otTickets, assignments, dstAssignments] = await Promise.all([
    prisma.timesheetEntry.count({ where: { ...who, account_id: from } }),
    prisma.timesheetRegularizationTicket.count({ where: { ...who, account_id: from } }),
    prisma.overtimeTicket.count({ where: { ...who, account_id: from } }),
    prisma.projectMemberAssignment.findMany({ where: { ...who, account_id: from }, select: { id: true } }),
    prisma.projectMemberAssignment.count({ where: { ...who, account_id: to } }),
  ]);
  console.log(`Timesheet entries: ${entries}, regularisation tickets: ${tickets}, overtime tickets: ${otTickets}, assignments on FROM: ${assignments.length}, assignments already on TO: ${dstAssignments}`);
  if (!apply) { console.log('Report only. Re-run with --apply to move them.'); return; }

  await prisma.$transaction(async (tx) => {
    await tx.timesheetEntry.updateMany({ where: { ...who, account_id: from }, data: { account_id: to } });
    await tx.timesheetRegularizationTicket.updateMany({ where: { ...who, account_id: from }, data: { account_id: to } });
    await tx.overtimeTicket.updateMany({ where: { ...who, account_id: from }, data: { account_id: to } });
    // Keep the allocation on the real project: move it unless the person already has one there, then drop the old one.
    if (assignments.length && dstAssignments === 0) await tx.projectMemberAssignment.updateMany({ where: { ...who, account_id: from }, data: { account_id: to } });
    else if (assignments.length) await tx.projectMemberAssignment.deleteMany({ where: { ...who, account_id: from } });
  });
  console.log('Moved.');
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
