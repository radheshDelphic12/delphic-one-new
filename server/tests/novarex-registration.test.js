/** The Novarex registration migration: adds the company and Super Admin access only - no data - and is safe to run twice. */
const fs = require('fs');
const path = require('path');
const { prisma, cleanDatabase, createUser, createOrg, createOrgMembership } = require('./helpers');

jest.setTimeout(120000);
beforeAll(async () => { await cleanDatabase(); }, 180000);
afterAll(async () => { await cleanDatabase(); await prisma.$disconnect(); }, 180000);

const SQL = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261017100000_novarex_company_registration/migration.sql'), 'utf8');
const statements = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
const run = async () => { for (const s of statements) await prisma.$executeRawUnsafe(s); };

describe('Novarex company registration (migration)', () => {
  test('does nothing on a database without the Delphic company', async () => {
    await cleanDatabase();
    await run();
    expect(await prisma.org.count({ where: { slug: 'novarex' } })).toBe(0);
  });

  test('adds the company to the Delphic holding group, gives the group Super Admin access, creates no data, and is idempotent', async () => {
    await cleanDatabase();
    const delphic = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
    const other = await createOrg({ name: 'Unrelated group co', slug: `other-${Date.now()}` }); // its own holding group
    const su = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: delphic.org_group_id } });
    const plainAdmin = await createUser({ role: 'admin', withOrg: false }); // an admin who is NOT a group Super Admin
    await prisma.orgGroupMembership.create({ data: { user_id: plainAdmin.id, org_group_id: delphic.org_group_id } });
    const otherSu = await createUser({ role: 'admin', withOrg: false }); // a Super Admin of a different group
    await prisma.user.update({ where: { id: otherSu.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: otherSu.id, org_group_id: other.org_group_id } });
    await createOrgMembership(su.id, delphic.id, { role: 'admin' });

    await run();
    const vt = await prisma.org.findUnique({ where: { slug: 'novarex' } });
    expect(vt).toMatchObject({ name: 'Novarex Pharmaceuticals', org_group_id: delphic.org_group_id, enabled_modules: ['novarex'], default_currency: 'INR', timezone: 'Asia/Kolkata', status: 'active', is_master_workspace: false });
    const members = await prisma.orgMembership.findMany({ where: { org_id: vt.id } });
    expect(members.map((m) => m.person_id)).toEqual([su.id]); // only the group Super Admin, as an admin of the company
    expect(members[0].role).toBe('admin');

    // the company is registered, nothing else: no sites, investments, entries, projections, categories or settings
    const counts = await Promise.all([prisma.vtSite.count(), prisma.vtInvestment.count(), prisma.vtEntry.count(), prisma.vtProjection.count(), prisma.vtCategory.count(), prisma.vtSetting.count(), prisma.vtPerson.count()]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0]);

    // running it again changes nothing
    await run();
    expect(await prisma.org.count({ where: { slug: 'novarex' } })).toBe(1);
    expect(await prisma.orgMembership.count({ where: { org_id: vt.id } })).toBe(1);
  });

  test('an existing Novarex company is left exactly as it is', async () => {
    await cleanDatabase();
    const delphic = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
    const existing = await createOrg({ name: 'Novarex (renamed by hand)', slug: 'novarex', org_group_id: delphic.org_group_id });
    await prisma.org.update({ where: { id: existing.id }, data: { enabled_modules: ['novarex'] } });
    await run();
    const after = await prisma.org.findUnique({ where: { slug: 'novarex' } });
    expect(after).toMatchObject({ id: existing.id, name: 'Novarex (renamed by hand)' });
  });
});
