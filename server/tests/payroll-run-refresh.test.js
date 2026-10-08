// A processed payroll run can be updated after salary changed: payslips whose figures moved are updated in
// place (kept as revisions), new eligible employees get a payslip, and nothing else is touched.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ymd = (d) => d.toISOString().slice(0, 10);
const WEEKDAYS = (year, monthIdx0) => {
  const out = [];
  for (let d = 1; d <= 31; d += 1) {
    const date = new Date(Date.UTC(year, monthIdx0, d));
    if (date.getUTCMonth() !== monthIdx0) break;
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) out.push(ymd(date));
  }
  return out;
};
const MONTH = { period_month: 8, period_year: 2026 };
const call = (method, path, token) => authed(request(app)[method](`/api/v1/payroll${path}`), token);

async function seed() {
  const org = await createOrg();
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const person = async (name) => {
    const user = await createUser({ role: 'recruiter', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: new Date('2026-01-01') });
    await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: membership.id, effective_from: new Date('2026-01-01'), ctc: 198000, components: { basic: 198000 }, created_by: adminUser.id } });
    await prisma.attendanceRecord.createMany({ data: WEEKDAYS(2026, 7).map((d) => ({ org_id: org.id, org_membership_id: membership.id, date: new Date(d), status: 'present' })) });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  return { org, adminUser, adminToken, person };
}

async function processedRun(ctx) {
  const run = (await call('post', '/runs', ctx.adminToken).send(MONTH)).body.data;
  const done = await call('post', `/runs/${run.id}/process`, ctx.adminToken).send({});
  expect(done.status).toBe(200);
  return run;
}
const payslipOf = async (ctx, runId, membershipId) => (await call('get', `/runs/${runId}/payslips`, ctx.adminToken)).body.data.find((p) => p.org_membership_id === membershipId);

describe('update a processed payroll run', () => {
  test('salary changes reach the payslip; each change is a revision with the reason; paid mismatch is flagged', async () => {
    const ctx = await seed();
    const asha = await ctx.person('Asha Revised');
    const run = await processedRun(ctx);
    const before = await payslipOf(ctx, run.id, asha.membership.id);
    const net0 = Number(before.net);
    expect(net0).toBeGreaterThan(0);

    // nothing changed yet: the refresh touches nothing
    const same = await call('post', `/runs/${run.id}/refresh`, ctx.adminToken).send({ reason: 'Routine check' });
    expect(same.status).toBe(200);
    expect(same.body.data).toMatchObject({ unchanged: 1, updated: [], added: [] });

    // the month's salary was already paid for the old amount
    await call('put', '/salary-payments', ctx.adminToken).send({ org_membership_id: asha.membership.id, period_month: 8, period_year: 2026, status: 'paid', paid_on: '2026-09-01', amount_paid: net0 });
    // a salary change after processing: +5000 variable pay
    expect((await call('post', '/adjustments', ctx.adminToken).send({ org_membership_id: asha.membership.id, ...MONTH, kind: 'variable_pay', amount: 5000, note: 'Q2 bonus' })).status).toBe(201);
    expect(Number((await payslipOf(ctx, run.id, asha.membership.id)).net)).toBe(net0); // frozen until the run is updated

    const refreshed = await call('post', `/runs/${run.id}/refresh`, ctx.adminToken).send({ reason: 'Q2 bonus added after processing' });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.updated).toEqual([expect.objectContaining({ employee: 'Asha Revised', previous_net: net0, net: net0 + 5000 })]);
    expect(refreshed.body.data.paid_mismatch).toEqual([expect.objectContaining({ amount_paid: net0, net: net0 + 5000 })]);

    const after = await payslipOf(ctx, run.id, asha.membership.id);
    expect(after.id).toBe(before.id); // updated in place, not replaced
    expect(Number(after.net)).toBe(net0 + 5000);
    expect(after.breakdown.revisions).toHaveLength(1);
    expect(after.breakdown.revisions[0]).toMatchObject({ reason: 'Q2 bonus added after processing', previous: { net: net0 } });
    // the employee reads the updated slip
    const mine = (await call('get', `/payslips/${after.id}`, asha.token)).body.data;
    expect(Number(mine.net)).toBe(net0 + 5000);
    expect(await prisma.auditLog.count({ where: { org_id: ctx.org.id, action: 'payroll_run_refresh' } })).toBe(2);

    // a second change adds a second revision
    await call('post', '/adjustments', ctx.adminToken).send({ org_membership_id: asha.membership.id, ...MONTH, kind: 'tds', amount: 1000 });
    await call('post', `/runs/${run.id}/refresh`, ctx.adminToken).send({ reason: 'TDS added' });
    const again = await payslipOf(ctx, run.id, asha.membership.id);
    expect(Number(again.net)).toBe(net0 + 4000);
    expect(again.breakdown.revisions.map((r) => r.reason)).toEqual(['Q2 bonus added after processing', 'TDS added']);
  });

  test('a newly eligible employee gets a payslip; a refresh limited to some employees leaves the rest alone', async () => {
    const ctx = await seed();
    const asha = await ctx.person('Asha First');
    const run = await processedRun(ctx);
    const ravi = await ctx.person('Ravi Late'); // joined the payroll after the run was processed
    await call('post', '/adjustments', ctx.adminToken).send({ org_membership_id: asha.membership.id, ...MONTH, kind: 'variable_pay', amount: 700 });

    const onlyRavi = await call('post', `/runs/${run.id}/refresh`, ctx.adminToken).send({ reason: 'Add Ravi', org_membership_ids: [ravi.membership.id] });
    expect(onlyRavi.body.data.added).toEqual([expect.objectContaining({ employee: 'Ravi Late' })]);
    expect(onlyRavi.body.data.updated).toEqual([]); // Asha's change is not picked up by a limited refresh
    expect(await prisma.payslip.count({ where: { payroll_run_id: run.id } })).toBe(2);

    const all = await call('post', `/runs/${run.id}/refresh`, ctx.adminToken).send({ reason: 'Everyone' });
    expect(all.body.data.updated).toEqual([expect.objectContaining({ employee: 'Asha First' })]);
    expect(all.body.data.added).toEqual([]);
    expect(all.body.data.unchanged).toBe(1);
  });

  test('only a processed run, only an admin, and a reason is required', async () => {
    const ctx = await seed();
    const asha = await ctx.person('Asha Guard');
    const draft = (await call('post', '/runs', ctx.adminToken).send(MONTH)).body.data;
    expect((await call('post', `/runs/${draft.id}/refresh`, ctx.adminToken).send({ reason: 'Too early' })).status).toBe(409);
    await call('post', `/runs/${draft.id}/process`, ctx.adminToken).send({});
    expect((await call('post', `/runs/${draft.id}/refresh`, ctx.adminToken).send({})).status).toBe(422);
    expect((await call('post', `/runs/${draft.id}/refresh`, ctx.adminToken).send({ reason: 'ab' })).status).toBe(422);
    expect((await call('post', '/runs/3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11/refresh', ctx.adminToken).send({ reason: 'Unknown run' })).status).toBe(404);
    expect((await call('post', `/runs/${draft.id}/refresh`, asha.token).send({ reason: 'Not an admin' })).status).toBeGreaterThanOrEqual(401);
  });
});
