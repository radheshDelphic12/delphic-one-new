const { app, prisma, request, cleanDatabase, createUser, createOrgMembership, loginAs, createActiveClientAccount, createRequirement, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setup() {
  const sales = await createUser({ role: 'sales' });
  const { access_token: salesToken } = await loginAs(sales);
  const account = await createActiveClientAccount(sales.id);
  const requirement = await createRequirement(salesToken, account.id, { primary_tech_stack: ['Java'], budget_min: 50000, budget_max: 80000 });
  const seat = await prisma.requirementSeat.findFirst({ where: { requirement_id: requirement.id } });
  const orgId = requirement.org_id;
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, orgId, { role: 'admin' });
  const { access_token: adminToken } = await loginAs(admin);
  const profile = await prisma.profile.create({ data: { org_id: orgId, name: 'Fake Candidate', source: 'direct', added_by: admin.id, total_experience_years: 2, primary_skills: ['x'] } });
  const sub = await prisma.submission.create({ data: { requirement_seat_id: seat.id, profile_id: profile.id, submitted_by: admin.id, stage: 'sourced', proposed_rate: 100000, vendor_rate: 70000, proposed_rate_currency: 'INR', vendor_rate_currency: 'INR' } });
  return { requirement, sub, adminToken };
}

describe('rate change history', () => {
  test('submission: changing a set rate needs a reason, is recorded, and shows in the history', async () => {
    const { sub, adminToken } = await setup();
    const patch = (body) => authed(request(app).patch(`/api/v1/submissions/${sub.id}`), adminToken).send(body);

    const noReason = await patch({ vendor_rate: 75000 });
    expect(noReason.status).toBe(422);
    expect(Number((await prisma.submission.findUnique({ where: { id: sub.id } })).vendor_rate)).toBe(70000);

    const ok = await patch({ vendor_rate: 75000, rate_change_reason: 'Vendor renegotiated' });
    expect(ok.status).toBe(200);
    expect(Number(ok.body.data.vendor_rate)).toBe(75000);
    expect(Number(ok.body.data.margin)).toBe(25000);

    // same value again, or an unrelated field: no reason needed, nothing recorded
    expect((await patch({ vendor_rate: 75000 })).status).toBe(200);
    expect((await patch({ submission_notes: 'ok' })).status).toBe(200);

    const history = (await authed(request(app).get(`/api/v1/submissions/${sub.id}/rate-changes`), adminToken)).body.data;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ field: 'vendor_rate', old_value: 70000, new_value: 75000, reason: 'Vendor renegotiated', currency: 'INR' });
    expect(history[0].changed_by).toBeTruthy();
  });

  test('a rate set for the first time needs no reason; a locked submission stays closed to rate changes', async () => {
    const { sub, adminToken } = await setup();
    const patch = (body) => authed(request(app).patch(`/api/v1/submissions/${sub.id}`), adminToken).send(body);
    const first = await patch({ final_agreed_rate: 90000 });
    expect(first.status).toBe(200);
    expect((await authed(request(app).get(`/api/v1/submissions/${sub.id}/rate-changes`), adminToken)).body.data[0]).toMatchObject({ field: 'final_agreed_rate', old_value: null, new_value: 90000 });
    await prisma.submission.update({ where: { id: sub.id }, data: { is_locked: true } });
    expect((await patch({ vendor_rate: 1, rate_change_reason: 'try' })).status).toBe(403);
  });

  test('requirement budget: reason needed, both ends recorded', async () => {
    const { requirement, adminToken } = await setup();
    const patch = (body) => authed(request(app).patch(`/api/v1/requirements/${requirement.id}`), adminToken).send(body);
    expect((await patch({ budget_max: 90000 })).status).toBe(422);
    expect((await patch({ budget_min: 55000, budget_max: 90000, rate_change_reason: 'Client raised budget' })).status).toBe(200);
    const history = (await authed(request(app).get(`/api/v1/requirements/${requirement.id}/rate-changes`), adminToken)).body.data;
    expect(history.map((h) => [h.field, h.old_value, h.new_value]).sort()).toEqual([['budget_max', 80000, 90000], ['budget_min', 50000, 55000]]);
    expect(history.every((h) => h.reason === 'Client raised budget')).toBe(true);
  });
});
