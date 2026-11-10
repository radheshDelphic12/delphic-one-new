/** FnF final payment placed in any month's payroll: shows as a line in that month (even long after exit), moves, and is taken out. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const payroll = require('../src/modules/payroll/payroll.service');

beforeEach(async () => { await cleanDatabase(); });
afterAll(async () => { await prisma.$disconnect(); });

const api = (p) => `/api/v1${p}`;

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const adminUser = await createUser({ role: 'admin', name: 'Boss Admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin', joined_at: new Date('2025-01-01') });
  const token = (await loginAs(adminUser)).access_token;
  const user = await createUser({ role: 'employee', name: 'Leaver Person' });
  const membership = await createOrgMembership(user.id, org.id, { role: 'employee', joined_at: new Date('2026-01-12') });
  await prisma.orgMembership.update({ where: { id: membership.id }, data: { employment_status: 'terminated', left_at: new Date('2026-09-30') } });
  await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: membership.id, effective_from: new Date('2026-01-12'), ctc: 60000, components: { basic: 60000 }, created_by: adminUser.id } });
  return { org, token, membership };
}

const lineFor = async (org, run, id) => (await payroll.runLines(org.id, run)).rows.find((r) => r.org_membership_id === id);

describe('FnF payment in a payroll month', () => {
  test('appears in a month after exit, moves to another month, and can be taken out', async () => {
    const { org, token, membership } = await seed();
    const dec = await prisma.payrollRun.create({ data: { org_id: org.id, period_month: 12, period_year: 2026, status: 'draft' } });
    const jan = await prisma.payrollRun.create({ data: { org_id: org.id, period_month: 1, period_year: 2027, status: 'draft' } });
    expect(await lineFor(org, dec, membership.id)).toBeUndefined();

    const url = api(`/payroll/fnf/${membership.id}/payroll-entry`);
    const put = await authed(request(app).put(url), token).send({ period_month: 12, period_year: 2026, amount: 45000, note: 'Final settlement' });
    expect(put.status).toBe(200);
    expect(put.body.data.period_month).toBe(12);
    const inDec = await lineFor(org, dec, membership.id);
    expect(Number(inDec.net)).toBe(45000);
    expect(Number(inDec.gross)).toBe(0);

    await authed(request(app).put(url), token).send({ period_month: 1, period_year: 2027, amount: 40000 });
    expect(await lineFor(org, dec, membership.id)).toBeUndefined();
    expect(Number((await lineFor(org, jan, membership.id)).net)).toBe(40000);
    expect(await prisma.salaryAdjustment.count({ where: { org_membership_id: membership.id, kind: 'fnf' } })).toBe(1);

    const statement = await authed(request(app).get(api(`/payroll/fnf/${membership.id}/statement`)), token);
    expect(statement.body.data.payroll_entry).toMatchObject({ period_month: 1, period_year: 2027, amount: 40000, run_status: 'draft' });

    expect((await authed(request(app).delete(url), token)).status).toBe(200);
    expect(await lineFor(org, jan, membership.id)).toBeUndefined();
    expect((await authed(request(app).delete(url), token)).status).toBe(404);
  });

  test('refused for someone who has not exited', async () => {
    const { token, membership } = await seed();
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { employment_status: 'active', left_at: null } });
    const res = await authed(request(app).put(api(`/payroll/fnf/${membership.id}/payroll-entry`)), token).send({ period_month: 12, period_year: 2026, amount: 1000 });
    expect(res.status).toBe(422);
  });
});
