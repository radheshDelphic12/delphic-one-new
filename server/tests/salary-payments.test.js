// Salary payment status: an admin marks each employee's monthly salary paid / not paid with the
// transaction details, and a dashboard lists every month filtered by status.
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
const get = (token, q) => authed(request(app).get('/api/v1/payroll/salary-payments'), token).query(q);
const put = (token, body) => authed(request(app).put('/api/v1/payroll/salary-payments'), token).send(body);

async function seed() {
  const org = await createOrg();
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const person = async (name) => {
    const user = await createUser({ role: 'recruiter', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: new Date('2026-01-01') });
    await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: membership.id, effective_from: new Date('2026-01-01'), ctc: 198000, components: { basic: 198000 }, created_by: adminUser.id } });
    // August and September 2026: every working day present.
    for (const days of [WEEKDAYS(2026, 7), WEEKDAYS(2026, 8)]) {
      await prisma.attendanceRecord.createMany({ data: days.map((d) => ({ org_id: org.id, org_membership_id: membership.id, date: new Date(d), status: 'present' })) });
    }
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  return { org, adminUser, adminToken, person };
}

describe('salary payment status', () => {
  test('a salary starts as not paid; marking it paid keeps the transaction details; the dashboard filters by status', async () => {
    const ctx = await seed();
    const asha = await ctx.person('Asha Paid');
    const ravi = await ctx.person('Ravi Pending');
    const range = { from: '2026-08', to: '2026-09' };

    const all = (await get(ctx.adminToken, range)).body.data;
    expect(all.rows).toHaveLength(4); // 2 employees x 2 months
    expect(all.rows.every((r) => r.status === 'not_paid' && r.payment === null)).toBe(true);
    expect(all.totals).toMatchObject({ salaries: 4, paid_count: 0, not_paid_count: 4 });
    expect(all.totals.payable).toBeGreaterThan(0);

    const paid = await put(ctx.adminToken, { org_membership_id: asha.membership.id, period_month: 9, period_year: 2026, status: 'paid', paid_on: '2026-09-30', payment_mode: 'bank_transfer', transaction_id: 'UTR123456', bank_name: 'HDFC', notes: 'September salary' });
    expect(paid.status).toBe(200);
    // no amount sent: the payment is the month's final payable salary
    const septAsha = all.rows.find((r) => r.employee === 'Asha Paid' && r.month === '2026-09');
    expect(paid.body.data).toMatchObject({ paid_on: '2026-09-30', payment_mode: 'bank_transfer', transaction_id: 'UTR123456', bank_name: 'HDFC', amount_paid: septAsha.payable });

    const after = (await get(ctx.adminToken, range)).body.data;
    expect(after.totals).toMatchObject({ paid_count: 1, not_paid_count: 3 });
    const only = (await get(ctx.adminToken, { ...range, status: 'paid' })).body.data;
    expect(only.rows).toHaveLength(1);
    expect(only.rows[0]).toMatchObject({ employee: 'Asha Paid', month: '2026-09', status: 'paid' });
    expect(only.rows[0].payment.transaction_id).toBe('UTR123456');
    const pending = (await get(ctx.adminToken, { ...range, status: 'not_paid' })).body.data;
    expect(pending.rows).toHaveLength(3);
    expect(pending.rows.some((r) => r.employee === 'Asha Paid' && r.month === '2026-09')).toBe(false);
    expect(pending.by_month.map((m) => m.month)).toEqual(['2026-09', '2026-08']);
    expect((await get(ctx.adminToken, { ...range, org_membership_id: ravi.membership.id })).body.data.rows).toHaveLength(2);

    // edit the details (idempotent per employee and month), then clear them
    const edited = await put(ctx.adminToken, { org_membership_id: asha.membership.id, period_month: 9, period_year: 2026, status: 'paid', paid_on: '2026-10-01', amount_paid: 150000, payment_mode: 'upi', transaction_id: 'UPI-99' });
    expect(edited.body.data).toMatchObject({ amount_paid: 150000, payment_mode: 'upi', transaction_id: 'UPI-99', paid_on: '2026-10-01' });
    expect(await prisma.salaryPayment.count({ where: { org_id: ctx.org.id } })).toBe(1);
    expect((await put(ctx.adminToken, { org_membership_id: asha.membership.id, period_month: 9, period_year: 2026, status: 'not_paid' })).status).toBe(200);
    expect(await prisma.salaryPayment.count({ where: { org_id: ctx.org.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { org_id: ctx.org.id, entity_type: 'salary_payment' } })).toBe(3); // create, update, clear
  });

  test('validation, scoping and admin-only access', async () => {
    const ctx = await seed();
    const asha = await ctx.person('Asha Paid');
    const base = { org_membership_id: asha.membership.id, period_month: 9, period_year: 2026 };
    expect((await put(ctx.adminToken, { ...base, status: 'paid' })).status).toBe(422); // date required
    expect((await put(ctx.adminToken, { ...base, status: 'paid', paid_on: '2099-01-01' })).status).toBe(422); // not in the future
    expect((await put(ctx.adminToken, { ...base, status: 'paid', paid_on: '2026-09-30', payment_mode: 'barter' })).status).toBe(422);
    expect((await put(ctx.adminToken, { ...base, org_membership_id: '3f1d8c74-3c1b-4c0e-9a55-0b8f9a4d9f11', status: 'paid', paid_on: '2026-09-30' })).status).toBe(404);
    expect((await get(ctx.adminToken, { from: '2026-09', to: '2026-01' })).status).toBe(422);
    expect((await get(ctx.adminToken, { from: '2020-01', to: '2026-09' })).status).toBe(422); // more than 24 months
    // another company's membership cannot be touched
    const otherOrg = await createOrg({ name: 'Other Co', slug: 'other-co' });
    const stranger = await createUser({ role: 'recruiter' });
    const strangerMembership = await createOrgMembership(stranger.id, otherOrg.id, { role: 'recruiter' });
    expect((await put(ctx.adminToken, { ...base, org_membership_id: strangerMembership.id, status: 'paid', paid_on: '2026-09-30' })).status).toBe(404);
    // employees cannot read or change payment status
    expect((await get(asha.token, {})).status).toBeGreaterThanOrEqual(401);
    expect((await put(asha.token, { ...base, status: 'paid', paid_on: '2026-09-30' })).status).toBeGreaterThanOrEqual(401);
  });
});
