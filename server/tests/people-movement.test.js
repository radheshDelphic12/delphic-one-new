/**
 * Reports > Joining & attrition: joiners, leavers, joining rate and attrition rate by month, department and reason, with the people behind each count.
 */
const { app, prisma, request, cleanDatabase, createUser, createOrgMembership, loginAs, authed } = require('./helpers');

let admin;
let adminToken;
let org;
let dept;
const d = (s) => new Date(`${s}T00:00:00.000Z`);

async function employee(name, joined, left, extra = {}) {
  const u = await createUser({ role: 'employee', name, withOrg: false });
  return createOrgMembership(u.id, org.id, { role: 'employee', joined_at: d(joined), ...extra }).then(async (m) => (left ? prisma.orgMembership.update({ where: { id: m.id }, data: { left_at: d(left), employment_status: 'terminated', ...(extra.left_extra || {}) } }) : m));
}

beforeEach(async () => {
  await cleanDatabase();
  admin = await createUser({ role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  org = await prisma.org.findUnique({ where: { id: (await prisma.orgMembership.findFirst({ where: { person_id: admin.id } })).org_id } });
  dept = await prisma.department.create({ data: { org_id: org.id, name: 'Engineering' } });
});
afterAll(async () => { await prisma.$disconnect(); });

const get = (path, query) => authed(request(app).get(`/api/v1/reports${path}`), adminToken).query(query);

describe('joining and attrition', () => {
  test('headcount, joiners, leavers and the two rates by month', async () => {
    // 10 people on 1 Oct (the admin counts too, joined long ago), 3 join in October, 1 joins in November, 2 leave in November
    await prisma.orgMembership.updateMany({ where: { person_id: admin.id }, data: { joined_at: d('2025-01-01') } });
    for (let i = 0; i < 7; i += 1) await employee(`Old ${i}`, '2025-06-01', i < 2 ? '2026-11-10' : null, { department_id: dept.id });
    for (let i = 0; i < 3; i += 1) await employee(`Oct joiner ${i}`, '2026-10-05');
    await employee('Nov joiner', '2026-11-03');

    const res = await get('/joining-attrition', { from: '2026-10', to: '2026-11' });
    expect(res.status).toBe(200);
    const oct = res.body.data.months[0];
    const nov = res.body.data.months[1];
    expect(oct).toMatchObject({ key: '2026-10', opening: 8, joiners: 3, leavers: 0, closing: 11 });
    expect(nov).toMatchObject({ key: '2026-11', opening: 11, joiners: 1, leavers: 2, closing: 10 });
    expect(nov.attrition_rate).toBe(Math.round((2 / 10.5) * 1000) / 10); // 2 leavers / average (11 + 10) / 2
    const s = res.body.data.summary;
    expect(s).toMatchObject({ opening: 8, joiners: 4, leavers: 2, closing: 10, months: 2 });
    expect(s.attrition_rate_annualised).toBe(Math.round(s.attrition_rate * 6 * 10) / 10); // 2 months -> x 6
    expect(res.body.data.departments[0]).toMatchObject({ department: 'Engineering', leavers: 2 });
    expect(res.body.data.reasons[0]).toMatchObject({ reason: 'Terminated', count: 2 });
  });

  test('every count has people behind it, early leavers are those who left within 6 months, contractors are left out by default', async () => {
    await employee('Early leaver', '2026-07-01', '2026-10-15');
    await employee('Long stayer leaver', '2024-01-01', '2026-10-20');
    const contractor = await employee('Contractor', '2026-01-01', '2026-10-25');
    await prisma.orgMembership.update({ where: { id: contractor.id }, data: { worker_type: 'contractor' } });

    const left = (await get('/joining-attrition/details', { from: '2026-10', to: '2026-10', kind: 'leavers' })).body.data.rows;
    expect(left.map((r) => r.name).sort()).toEqual(['Early leaver', 'Long stayer leaver']);
    const early = (await get('/joining-attrition/details', { from: '2026-10', to: '2026-10', kind: 'early_leavers' })).body.data.rows;
    expect(early.map((r) => r.name)).toEqual(['Early leaver']);
    const withContractors = (await get('/joining-attrition/details', { from: '2026-10', to: '2026-10', kind: 'leavers', include_contractors: 'true' })).body.data.rows;
    expect(withContractors).toHaveLength(3);
    expect((await get('/joining-attrition', { from: '2026-10', to: '2026-10' })).body.data.summary).toMatchObject({ leavers: 2, early_leavers: 1 });
  });

  test('a person without HR report access is refused', async () => {
    const other = await createUser({ role: 'sales' });
    const { access_token } = await loginAs(other);
    expect((await authed(request(app).get('/api/v1/reports/joining-attrition'), access_token)).status).toBe(403);
  });
});
