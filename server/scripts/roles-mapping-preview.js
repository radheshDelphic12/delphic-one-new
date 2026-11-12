/**
 * READ ONLY. Prints the proposed custom-role mapping for one company so it can be reviewed and approved before anything is
 * applied. Matches the people you named by EMPLOYEE CODE (never by first name), shows code + email, proposes the rest by department
 * and current role, and lists everyone who does not map cleanly (they keep their current access). Writes nothing.
 *
 * Usage:  node server/scripts/roles-mapping-preview.js [org-slug]      (default: the master workspace, Delphic Global)
 */
const { PrismaClient } = require('@prisma/client');
const rolesService = require('../src/modules/roles/roles.service');

const prisma = new PrismaClient();
const pad = (v, n) => String(v ?? '').padEnd(n).slice(0, n);
const line = (p, role, note = '') => `  ${pad(p.employee_code || '-', 8)} ${pad(p.name, 26)} ${pad(p.email, 34)} ${pad(p.current_role, 10)} ${pad(role, 18)} ${note}`;

async function main() {
  const slug = process.argv[2];
  const org = await prisma.org.findFirst({ where: slug ? { slug } : { is_master_workspace: true }, select: { id: true, name: true } });
  if (!org) throw new Error('Company not found');
  const p = await rolesService.mappingPreview(org.id);
  console.log(`\nProposed custom roles for ${org.name}. NOTHING IS APPLIED.\n`);
  console.log('1. People you named (matched by employee code)');
  for (const n of p.named) {
    if (!n.person) console.log(`  ${pad(n.expected_code, 8)} ${pad(n.expected_name, 26)} NOT FOUND: nobody has this code -> ${n.role}`);
    else console.log(line(n.person, n.role, n.status === 'name_differs' ? `NAME DIFFERS from "${n.expected_name}"` : n.person.base_role_changes ? 'plain role changes' : ''));
  }
  console.log('\n2. Super Admin: Paras Gulati');
  for (const a of p.super_admin.accounts) console.log(line(a, a.is_group_superadmin ? '(group account)' : 'Super Admin', a.is_group_superadmin ? 'keeps Group Super Admin' : ''));
  if (p.super_admin.status !== 'match') console.log(`  status: ${p.super_admin.status}, not proposed`);
  console.log(`\n3. Suggested for everyone else (${p.suggested.length})`);
  for (const s of p.suggested) console.log(line(s, s.proposed_role, s.reason));
  console.log(`\n4. Do not map cleanly (${p.unmapped.length}). They keep their current access until you decide`);
  for (const u of p.unmapped) console.log(line(u, '-', u.reason));
  console.log('');
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => prisma.$disconnect());
