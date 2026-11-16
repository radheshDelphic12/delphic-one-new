/**
 * Finance > Expenses > Approvals: the queue honours the Month, Office and Employee filters (it used to ignore every filter).
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('approval queue filters', () => {
  test('month, office and employee narrow the queue; all together combine; a bad id is refused', async () => {
    const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const admin = await createUser({ role: 'admin' });
    await createOrgMembership(admin.id, org.id, { role: 'admin' });
    const adminToken = (await loginAs(admin)).access_token;
    const mk = async () => {
      const user = await createUser({ role: 'recruiter' });
      const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter' });
      return { membership, token: (await loginAs(user)).access_token };
    };
    const asha = await mk();
    const ravi = await mk();
    const ahmedabad = await prisma.location.create({ data: { org_id: org.id, name: 'Ahmedabad' } });
    const indore = await prisma.location.create({ data: { org_id: org.id, name: 'Indore' } });
    const file = async (who, location, date, amount) => (await authed(request(app).post('/api/v1/expenses/claims'), who.token).send({ location_id: location.id, category: 'Travel', amount, expense_date: date })).body.data.id;
    const octAhmedabad = await file(asha, ahmedabad, '2026-10-12', 500);
    const novIndore = await file(ravi, indore, '2026-11-03', 900);

    const queue = async (query = {}) => (await authed(request(app).get('/api/v1/expenses/claims/approvals'), adminToken).query(query)).body.data.map((c) => c.id).sort();
    expect(await queue()).toEqual([octAhmedabad, novIndore].sort());
    expect(await queue({ location_id: indore.id })).toEqual([novIndore]);
    expect(await queue({ period_month: 10, period_year: 2026 })).toEqual([octAhmedabad]);
    expect(await queue({ org_membership_id: ravi.membership.id })).toEqual([novIndore]);
    expect(await queue({ period_month: 11, period_year: 2026, location_id: ahmedabad.id })).toEqual([]); // together they combine
    expect((await authed(request(app).get('/api/v1/expenses/claims/approvals'), adminToken).query({ location_id: 'nope' })).status).toBe(422);
  });
});
