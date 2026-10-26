const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const calc = require('../src/modules/superDashboard/groupDebt.calc');

const base = '/api/v1/super-dashboard';

describe('loan arithmetic (pure)', () => {
  test('EMI and a reducing-balance schedule that ends at zero', () => {
    // 10 lakh, 12% a year, 12 months: the standard EMI is 88,848.79
    expect(calc.emiFor(1000000, 12, 12)).toBe(88848.79);
    const rows = calc.buildSchedule({ principal: 1000000, annualRatePct: 12, periods: 12, startDate: '2026-01-15' });
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ seq: 1, due_date: '2026-02-15', interest_part: 10000 });
    expect(rows[11].balance_after).toBe(0);
    expect(Math.round(rows.reduce((a, r) => a + r.principal_part, 0))).toBe(1000000);
    expect(calc.emiFor(120000, 0, 12)).toBe(10000);
  });

  test('month-end dates clamp, quarterly and a given EMI are honoured', () => {
    expect(calc.addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(calc.addMonths('2026-11-30', 3)).toBe('2027-02-28');
    const q = calc.buildSchedule({ principal: 400000, annualRatePct: 8, periods: 4, frequency: 'quarterly', startDate: '2026-01-10' });
    expect(q.map((r) => r.due_date)).toEqual(['2026-04-10', '2026-07-10', '2026-10-10', '2027-01-10']);
    const fixed = calc.buildSchedule({ principal: 100000, annualRatePct: 10, periods: 5, startDate: '2026-01-01', emi: 25000 });
    expect(fixed[0].amount).toBe(25000);
    expect(fixed[4].balance_after).toBe(0);
  });

  test('summary: paid, pending, overdue, outstanding and the next due date', () => {
    const rows = calc.buildSchedule({ principal: 120000, annualRatePct: 0, periods: 12, startDate: '2026-01-01' }).map((r) => ({ ...r, status: r.seq <= 3 ? 'paid' : 'pending' }));
    const s = calc.summarise({ principal: 120000 }, rows, '2026-06-10');
    expect(s).toMatchObject({ emis_total: 12, emis_paid: 3, emis_pending: 9, emis_overdue: 2, outstanding: 90000, principal_paid: 30000 });
    expect(s.next_due).toMatchObject({ seq: 6, due_date: '2026-07-01' });
  });

  test('the loan ratio against the limit', () => {
    expect(calc.ratio(20, 100, 30)).toMatchObject({ ratio_pct: 20, status: 'ok', headroom: 10 });
    expect(calc.ratio(26, 100, 30).status).toBe('warning');
    expect(calc.ratio(40, 100, 30).status).toBe('over');
    expect(calc.ratio(10, 0, 30).status).toBe('unknown');
  });
});

describe('group debt management', () => {
  let group;
  let a;
  let b;
  let superToken;
  let adminToken;

  beforeEach(async () => {
    await cleanDatabase();
    a = await createOrg({ name: 'Alpha Global' });
    group = { id: a.org_group_id };
    b = await createOrg({ name: 'Beta Trading', org_group_id: group.id });
    const su = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: group.id } });
    await createOrgMembership(su.id, a.id, { role: 'admin' });
    ({ access_token: superToken } = await loginAs(su));
    const admin = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(admin.id, a.id, { role: 'admin' });
    ({ access_token: adminToken } = await loginAs(admin));
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const get = (path, t = superToken) => authed(request(app).get(`${base}${path}`), t);
  const post = (path, body, t = superToken) => authed(request(app).post(`${base}${path}`), t).send(body);
  const put = (path, body, t = superToken) => authed(request(app).put(`${base}${path}`), t).send(body);
  const patch = (path, body, t = superToken) => authed(request(app).patch(`${base}${path}`), t).send(body);
  const del = (path, t = superToken) => authed(request(app).delete(`${base}${path}`), t);

  test('only a group superadmin may use it', async () => {
    expect((await get('/group/debt', adminToken)).status).toBe(403);
    expect((await post('/group/debt/loans', { name: 'x' }, adminToken)).status).toBe(403);
    expect((await get('/group/debt')).status).toBe(200);
  });

  test('an existing loan: EMIs already paid are marked, outstanding and interest follow the schedule', async () => {
    const start = new Date(Date.UTC(new Date().getUTCFullYear() - 1, new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
    const res = await post('/group/debt/loans', { name: 'Office building loan', lender: 'HDFC Bank', loan_type: 'property_loan', org_id: b.id, principal: 1200000, interest_rate: 0, start_date: start, tenure_months: 24, emis_paid: 8 });
    expect(res.status).toBe(201);
    const loan = res.body.data;
    expect(loan.installments).toHaveLength(24);
    expect(loan.summary).toMatchObject({ emis_total: 24, emis_paid: 8, emis_pending: 16, outstanding: 800000, principal_paid: 400000 });
    expect(loan.company.name).toBe('Beta Trading');

    // paying EMI 12 pays 9-12 too; undoing 10 undoes 10-12
    const paid = await put(`/group/debt/loans/${loan.id}/installments/12`, { paid: true });
    expect(paid.body.data.summary.emis_paid).toBe(12);
    const undone = await put(`/group/debt/loans/${loan.id}/installments/10`, { paid: false });
    expect(undone.body.data.summary.emis_paid).toBe(9);
    expect(undone.body.data.summary.outstanding).toBe(750000);

    // more EMIs than the tenure is refused
    expect((await post('/group/debt/loans', { name: 'Bad', lender: 'X', principal: 1000, start_date: start, tenure_months: 6, emis_paid: 7 })).status).toBe(422);
    // a company outside the group is refused
    const other = await createOrg({ name: 'Elsewhere' });
    expect((await post('/group/debt/loans', { name: 'Bad', lender: 'X', principal: 1000, start_date: start, org_id: other.id })).status).toBe(422);
  });

  test('overview: totals, breakdowns, repayments of the next 12 months, the ratio limit and a rate change on a floating loan', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const loan = (await post('/group/debt/loans', { name: 'Car loan', lender: 'ICICI Bank', loan_type: 'vehicle_loan', principal: 600000, interest_rate: 10, rate_type: 'floating', start_date: today, tenure_months: 12, emis_paid: 0 })).body.data;
    await post('/group/debt/loans', { name: 'Working capital limit', lender: 'SBI', loan_type: 'credit_limit', principal: 300000, sanctioned_limit: 1000000, interest_rate: 11, start_date: today });
    await put('/group/debt/settings', { max_debt_ratio_pct: 25, ratio_basis: 'assets' });

    const ov = (await get('/group/debt')).body.data;
    expect(ov.totals).toMatchObject({ loans: 2, outstanding: 900000, sanctioned: 1600000 });
    expect(ov.by_type.map((x) => x.key).sort()).toEqual(['credit_limit', 'vehicle_loan']);
    expect(ov.by_lender).toHaveLength(2);
    expect(ov.repayments).toHaveLength(12);
    // 11 of the 12 EMIs fall inside the next 12 months (the first is a month away, the last one is exactly a year away)
    const due = ov.repayments.reduce((s, r) => s + r.principal, 0);
    expect(due).toBeGreaterThan(520000);
    expect(due).toBeLessThan(600000);
    expect(ov.settings).toEqual({ max_debt_ratio_pct: 25, ratio_basis: 'assets' });
    expect(ov.ratio).toMatchObject({ basis: 'assets', limit_pct: 25, debt: 900000 });
    expect(ov.totals.weighted_rate).toBeCloseTo(10.33, 1);

    // the rate of a floating loan changes: what is still to pay is worked out again, the paid EMIs stay
    const first = (await get(`/group/debt/loans/${loan.id}`)).body.data;
    const before = first.installments[11].interest_part;
    const changed = (await patch(`/group/debt/loans/${loan.id}`, { interest_rate: 14 })).body.data;
    expect(changed.installments).toHaveLength(12);
    expect(changed.interest_rate).toBe(14);
    expect(changed.installments[0].interest_part).toBeGreaterThan(first.installments[0].interest_part);
    expect(changed.installments[11].balance_after).toBe(0);
    expect(before).toBeLessThan(changed.installments[0].interest_part);

    expect((await del(`/group/debt/loans/${loan.id}`)).status).toBe(200);
    expect((await get('/group/debt')).body.data.totals.loans).toBe(1);
  });

  test("Zephyr's property loans count toward the group's debt (read only)", async () => {
    const zeph = await createOrg({ name: 'Zephyr Infra', org_group_id: group.id });
    const property = await prisma.zxProperty.create({ data: { org_id: zeph.id, code: 'P-1', name: 'Plot 12' } });
    await prisma.zxPropertyLoan.create({ data: { org_id: zeph.id, property_id: property.id, lender: 'Axis Bank', loan_amount: 2000000, outstanding_amount: 1500000, emi_amount: 40000, interest_rate: 9 } });
    const ov = (await get('/group/debt')).body.data;
    const row = ov.loans.find((l) => l.source === 'zephyr_property');
    expect(row).toMatchObject({ name: 'Plot 12 loan', lender: 'Axis Bank', monthly_emi: 40000 });
    expect(row.summary.outstanding).toBe(1500000);
    expect(ov.totals.outstanding).toBe(1500000);
  });
});
