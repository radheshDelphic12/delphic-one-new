const { PrismaClient } = require('@prisma/client');
const prisma = require('../src/config/db');
const { cleanDatabase, createOrg, createUser, unique } = require('./helpers');
const { orderTables, main } = require('../scripts/restore-org');

const live = process.env.DATABASE_URL;
const withDb = (url, db) => url.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);
const liveDb = live.match(/\/([^/?]+)(\?|$)/)[1];
const scratchDb = `${liveDb}_scratch`;
const scratchUrl = withDb(live, scratchDb);

describe('restore-org: pure ordering', () => {
  it('puts parents before children and reports cycles', () => {
    expect(orderTables(['c', 'b', 'a'], [['c', 'b'], ['b', 'a']]).ordered).toEqual(['a', 'b', 'c']);
    const cyc = orderTables(['a', 'b', 'x'], [['a', 'b'], ['b', 'a']]);
    expect(cyc.ordered[0]).toBe('x');
    expect(cyc.cyclic.sort()).toEqual(['a', 'b']);
  });
});

describe('restore-org: one company comes back, the others stay as they are', () => {
  let orgA; let orgB; let owner; let admin;
  beforeAll(async () => {
    await cleanDatabase();
    owner = await createUser({ role: 'admin' });
    orgA = await createOrg({ name: 'Restore A', slug: unique('rst-a-') });
    orgB = await createOrg({ name: 'Restore B', slug: unique('rst-b-') });
    const mk = (org, name) => prisma.account.create({ data: { org_id: org.id, type: 'client', name, stage: 'active', owner_id: owner.id, origin_owner_id: owner.id } });
    await mk(orgA, 'A one'); await mk(orgA, 'A two'); await mk(orgB, 'B one');
    // clone the live test database as the "restored backup"; a template must have no open sessions
    await prisma.$disconnect();
    admin = new PrismaClient({ datasourceUrl: withDb(live, 'postgres') });
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${scratchDb}`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${scratchDb} TEMPLATE ${liveDb}`);
  }, 60000);
  afterAll(async () => {
    if (admin) { await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${scratchDb}`); await admin.$disconnect(); }
    await cleanDatabase();
  });

  it('dry run writes nothing; apply restores only the named company', async () => {
    // damage after the backup: company A loses an account and gains a wrong one; company B gets a legitimate new account
    await prisma.account.deleteMany({ where: { org_id: orgA.id, name: 'A one' } });
    await prisma.account.create({ data: { org_id: orgA.id, type: 'client', name: 'A wrong', stage: 'active', owner_id: owner.id, origin_owner_id: owner.id } });
    await prisma.account.create({ data: { org_id: orgB.id, type: 'client', name: 'B two', stage: 'active', owner_id: owner.id, origin_owner_id: owner.id } });
    const names = async (org) => (await prisma.account.findMany({ where: { org_id: org.id }, orderBy: { name: 'asc' } })).map((a) => a.name);

    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await main(['--source', scratchUrl, '--org', orgA.slug]);
    expect(await names(orgA)).toEqual(['A two', 'A wrong']);

    await main(['--source', scratchUrl, '--org', orgA.slug, '--apply', '--allow-uncovered']);
    log.mockRestore();
    expect(await names(orgA)).toEqual(['A one', 'A two']);
    expect(await names(orgB)).toEqual(['B one', 'B two']);
  }, 60000);
});
