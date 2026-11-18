/**
 * Reimbursement claims: an optional duration (start to end) that can be saved, changed and cleared.
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => { await cleanDatabase(); });
afterAll(async () => { await prisma.$disconnect(); });

describe('claim duration', () => {
  test('optional on create, validated, editable and clearable', async () => {
    const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const user = await createUser({ role: 'recruiter' });
    await createOrgMembership(user.id, org.id, { role: 'recruiter' });
    const token = (await loginAs(user)).access_token;
    const location = await prisma.location.create({ data: { org_id: org.id, name: 'Indore' } });
    const post = (body) => authed(request(app).post('/api/v1/expenses/claims'), token).send({ location_id: location.id, category: 'Software', amount: 2399, ...body });

    const plain = await post({ expense_date: '2026-10-31' });
    expect(plain.status).toBe(201);
    expect(plain.body.data.duration_start).toBeNull();

    expect((await post({ duration_start: '2026-10-31', duration_end: '2026-10-01' })).status).toBe(422);

    const withDuration = await post({ duration_start: '2026-10-01', duration_end: '2026-10-31' });
    expect(withDuration.status).toBe(201);
    expect(String(withDuration.body.data.duration_start).slice(0, 10)).toBe('2026-10-01');
    expect(String(withDuration.body.data.duration_end).slice(0, 10)).toBe('2026-10-31');

    const patch = (id, body) => authed(request(app).patch(`/api/v1/expenses/claims/${id}`), token).send(body);
    const id = withDuration.body.data.id;
    expect((await patch(id, { duration_end: '2026-09-01' })).status).toBe(422); // before the stored start
    const cleared = await patch(id, { duration_start: null, duration_end: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.duration_start).toBeNull();
    expect(cleared.body.data.duration_end).toBeNull();
  });

  test('group expenses carry the same optional duration', async () => {
    const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const admin = await createUser({ role: 'admin' });
    await createOrgMembership(admin.id, org.id, { role: 'admin' });
    const token = (await loginAs(admin)).access_token;
    const post = (body) => authed(request(app).post('/api/v1/billing/group-charges/mine'), token).send({ kind: 'Rent', amount: 1000, payment_date: '2026-10-31', ...body });

    expect((await post({ duration_start: '2026-10-31', duration_end: '2026-10-01' })).status).toBe(422);
    const created = await post({ duration_start: '2026-10-01', duration_end: '2026-10-31' });
    expect(created.status).toBe(201);
    expect(String(created.body.data.duration_end).slice(0, 10)).toBe('2026-10-31');

    const patch = (body) => authed(request(app).patch(`/api/v1/billing/group-charges/${created.body.data.id}`), token).send(body);
    expect((await patch({ duration_end: '2026-09-01' })).status).toBe(422);
    const cleared = await patch({ duration_start: null, duration_end: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.duration_start).toBeNull();
  });
});
