const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const calc = require('../src/modules/novarex/novarex.calc');

jest.setTimeout(120000);
beforeAll(async () => {
  await cleanDatabase();
}, 180000);
afterAll(async () => {
  await cleanDatabase();
  await prisma.$disconnect();
}, 180000);

let orgSeq = 0;
async function setup(label = 'co') {
  orgSeq += 1;
  const slug = `nx-${label}-${Date.now()}-${orgSeq}`;
  const org = await createOrg({ name: `Novarex ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['novarex'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}
async function addMember(org, accessRole) {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  const person = await prisma.nxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole } });
  const { access_token } = await loginAs(user);
  return { user, person, token: access_token };
}
const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/novarex${path}`), token).send(body),
  get: (path) => authed(request(app).get(`/api/v1/novarex${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/novarex${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/novarex${path}`), token),
});
const iso = (d) => d.toISOString().slice(0, 10);
const monthKey = (back) => { const d = new Date(); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1))).slice(0, 7); };
const dayIn = (back, day = 10) => `${monthKey(back)}-${String(day).padStart(2, '0')}`;
const monthRange = (back) => ({ from: `${monthKey(back)}-01`, to: iso(new Date(Date.UTC(Number(monthKey(back).slice(0, 4)), Number(monthKey(back).slice(5)), 0))) });
const qs = (o) => `?${new URLSearchParams(o).toString()}`;

async function investment(a, body = {}) {
  const r = await a.post('/investments', { name: 'Growth fund', investment_date: dayIn(2, 5), amount: 500000, expected_return_amount: 560000, expected_return_date: dayIn(0, 28), investor: 'Self', ...body });
  expect(r.status).toBe(201);
  return r.body.data;
}
async function entry(a, body, expected = 201) {
  const r = await a.post('/entries', body);
  expect(r.status).toBe(expected);
  return r.body.data;
}
const catId = async (a, scope, name) => (await a.get(`/categories?scope=${scope}`)).body.data.find((c) => c.name === name).id;

describe('pure accounting rules', () => {
  test('principal is not income; planned and cancelled investments are not counted; overdue is derived', () => {
    const inv = { id: 'i', status: 'active', amount: 500000, investment_date: '2026-01-05', expected_return_amount: 560000, expected_return_date: '2026-06-30', returns: [] };
    const rets = [{ return_date: '2026-03-01', principal: 100000, earnings: 4000, status: 'received' }, { return_date: '2026-03-02', principal: 50000, earnings: 0, status: 'reversed' }];
    const v = calc.investmentView(inv, rets, '2026-05-01');
    expect(v).toMatchObject({ principal_returned: 100000, earnings: 4000, outstanding_principal: 400000, status: 'partially_returned', overdue: false });
    expect(calc.investmentView(inv, rets, '2026-07-01')).toMatchObject({ status: 'overdue', overdue: true });
    expect(calc.investmentView({ ...inv, status: 'planned' }, [], '2026-05-01')).toMatchObject({ counted: false, status: 'planned' });
    const s = calc.summarize({ investments: [{ ...inv, returns: rets }], entries: [], from: '2026-01-01', to: '2026-12-31' });
    expect(s).toMatchObject({ investment_added: 500000, principal_returned: 100000, investment_earnings: 4000, income: 4000, net_result: 4000 });
    const planned = calc.summarize({ investments: [{ ...inv, status: 'planned', returns: [] }], entries: [], from: '2026-01-01', to: '2026-12-31' });
    expect(planned.investment_added).toBe(0);
  });

  test('salary counted once, transfers ignored, unpaid is a payable, variance sign', () => {
    const e = (kind, amount, extra = {}) => ({ kind, amount, entry_date: '2026-02-10', payment_status: 'paid', ...extra });
    const entries = [e('income', 1000), e('expense', 300), e('expense', 100, { expense_class: 'other' }), e('salary', 200), e('salary', 50, { payment_status: 'unpaid' }), e('transfer', 9999), e('expense', 70, { payment_status: 'cancelled' })];
    const s = calc.summarize({ entries, from: '2026-02-01', to: '2026-02-28' });
    expect(s).toMatchObject({ other_income: 1000, operating_expenses: 300, other_expenses: 100, salaries: 250, expenses: 650, net_result: 350, salaries_paid: 200 });
    expect(s.cash_out).toBe(600);
    const hidden = calc.summarize({ entries, from: '2026-02-01', to: '2026-02-28', payroll: false });
    expect(hidden.salaries).toBeNull();
    expect(hidden.expenses).toBe(400);
    const pos = calc.position({ entries, to: '2026-12-31' });
    expect(pos.payables).toBe(50);
    const cmp = calc.compare([{ line: 'operating_expense', amount: 200, status: 'approved' }, { line: 'other_income', amount: 5000, status: 'archived' }], s);
    const op = cmp.find((c) => c.line === 'operating_expense');
    expect(op).toMatchObject({ projected: 200, actual: 300, variance: 100, favourable: false, remaining: 0 });
    expect(cmp.find((c) => c.line === 'other_income').projected).toBe(0);
  });
});

describe('novarex access, categories and isolation', () => {
  test('roles, module gate and company isolation', async () => {
    const { org, token } = await setup('acc');
    const a = api(token);
    const me = (await a.get('/me')).body.data;
    expect(me.role).toBe('admin');
    expect(me.caps).toEqual(expect.arrayContaining(['investmentsEdit', 'payroll', 'closeMonth']));
    const cats = (await a.get('/categories')).body.data;
    expect(cats.map((c) => c.scope)).toEqual(expect.arrayContaining(['investment', 'income', 'expense']));
    const added = await a.post('/categories', { scope: 'expense', name: 'Barrel ageing' });
    expect(added.status).toBe(201);
    expect((await a.post('/categories', { scope: 'expense', name: 'Barrel ageing' })).status).toBe(409);
    expect((await a.patch(`/categories/${added.body.data.id}`, { name: 'Cask ageing', active: false })).status).toBe(200);

    const finance = await addMember(org, 'finance');
    const staff = await addMember(org, 'staff');
    expect((await api(staff.token).post('/entries', { kind: 'expense', amount: 5, entry_date: dayIn(0, 1) })).status).toBe(403);
    expect((await api(staff.token).get('/investments')).status).toBe(200);
    expect((await api(finance.token).post('/investments', { name: 'X', investment_date: dayIn(0, 1), amount: 10 })).status).toBe(201);
    expect((await api(finance.token).post('/people', { name: 'Z' })).status).toBe(403);

    // another company, and a company that is not a Novarex company
    const other = await setup('other');
    const inv = await investment(a);
    expect((await api(other.token).get(`/investments/${inv.id}`)).status).toBe(404);
    expect((await api(other.token).get('/investments')).body.data).toHaveLength(0);
    const plain = await createOrg({ name: 'Plain co', slug: `plain-${Date.now()}` });
    const outsider = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(outsider.id, plain.id, { role: 'admin' });
    const { access_token } = await loginAs(outsider);
    expect((await api(access_token).get('/dashboard')).status).toBe(403);
    expect((await request(app).get('/api/v1/novarex/dashboard')).status).toBe(401);
  });
});

describe('investments and returns', () => {
  test('principal and earnings are recorded separately and never mixed', async () => {
    const { token } = await setup('inv');
    const a = api(token);
    const inv = await investment(a);
    expect(inv.code).toMatch(/^NX-0001$/);
    expect(inv).toMatchObject({ status: 'active', outstanding_principal: 500000, principal_returned: 0, earnings: 0 });

    const r1 = await a.post(`/investments/${inv.id}/returns`, { return_date: dayIn(1, 10), principal: 100000, earnings: 0 });
    expect(r1.status).toBe(201);
    expect(r1.body.data).toMatchObject({ status: 'partially_returned', principal_returned: 100000, earnings: 0, outstanding_principal: 400000 });
    const r2 = await a.post(`/investments/${inv.id}/returns`, { return_date: dayIn(1, 20), principal: 0, earnings: 12000 });
    expect(r2.body.data).toMatchObject({ principal_returned: 100000, earnings: 12000 });
    // a combined payment keeps two amounts
    const r3 = await a.post(`/investments/${inv.id}/returns`, { return_date: dayIn(0, 3), principal: 50000, earnings: 3000 });
    expect(r3.body.data).toMatchObject({ principal_returned: 150000, earnings: 15000, outstanding_principal: 350000 });

    expect((await a.post(`/investments/${inv.id}/returns`, { return_date: dayIn(0, 4), principal: 400000 })).status).toBe(422); // more than outstanding
    expect((await a.post(`/investments/${inv.id}/returns`, { return_date: dayIn(0, 4), principal: 0, earnings: 0 })).status).toBe(422);
    expect((await a.post(`/investments/${inv.id}/returns`, { return_date: dayIn(4, 1), principal: 1 })).status).toBe(422); // before the investment

    // dashboard: principal is not income
    const range = { from: dayIn(1, 1), to: monthRange(0).to };
    const d = (await a.get(`/dashboard${qs(range)}`)).body.data;
    expect(d.period).toMatchObject({ principal_returned: 150000, investment_earnings: 15000, income: 15000, net_result: 15000, investment_added: 0 });
    expect(d.cumulative).toMatchObject({ investment_added: 500000, principal_returned: 150000 });
    expect(d.position.outstanding_principal).toBe(350000);

    // reverse one return: it no longer counts
    const rid = r3.body.data.returns.find((r) => r.principal === 50000).id;
    const rev = await a.patch(`/returns/${rid}`, { status: 'reversed', reason: 'bounced' });
    expect(rev.body.data).toMatchObject({ principal_returned: 100000, earnings: 12000 });

    // the investment cannot be cancelled or deleted while it has returns
    expect((await a.patch(`/investments/${inv.id}`, { status: 'cancelled' })).status).toBe(409);
    expect((await a.del(`/investments/${inv.id}`)).status).toBe(409);
    expect((await a.patch(`/investments/${inv.id}`, { amount: 50000 })).status).toBe(422);

    // full recovery completes it
    await a.post(`/investments/${inv.id}/returns`, { return_date: dayIn(0, 5), principal: 400000 });
    const done = (await a.get(`/investments/${inv.id}`)).body.data;
    expect(done.status).toBe('completed');
    expect(done.outstanding_principal).toBe(0);
    expect((await a.post(`/investments/${inv.id}/returns`, { return_date: dayIn(0, 6), principal: 1 })).status).toBe(422);
  });

  test('planned investments are not counted until active; overdue and filters', async () => {
    const { token } = await setup('plan');
    const a = api(token);
    const planned = await investment(a, { name: 'Future deal', status: 'planned', amount: 250000 });
    expect((await a.post(`/investments/${planned.id}/returns`, { return_date: dayIn(0, 1), principal: 1 })).status).toBe(409);
    const late = await investment(a, { name: 'Late deal', amount: 100000, expected_return_amount: 110000, expected_return_date: dayIn(1, 1) });
    expect(late.status).toBe('overdue');
    expect((await a.get('/investments?status=overdue')).body.data.map((i) => i.id)).toEqual([late.id]);
    const list = await a.get('/investments');
    expect(list.body.totals).toMatchObject({ count: 2, invested: 100000 }); // the planned one is not "invested"
    const cat = await catId(a, 'investment', 'Outlet set-up');
    await a.patch(`/investments/${late.id}`, { category_id: cat });
    expect((await a.get(`/investments?category_id=${cat}`)).body.data).toHaveLength(1);
    expect((await a.patch(`/investments/${late.id}`, { category_id: await catId(a, 'income', 'Other business income') })).status).toBe(422);
    const d = (await a.get('/dashboard')).body.data;
    expect(d.attention.overdue_investments.map((x) => x.id)).toEqual([late.id]);
  });
});

describe('income, expenses, salaries and the monthly report', () => {
  test('nothing is counted twice and every filter changes the figures', async () => {
    const { org, token } = await setup('ent');
    const a = api(token);
    const inv = await investment(a, { amount: 300000, investment_date: dayIn(2, 2) });
    await a.post(`/investments/${inv.id}/returns`, { return_date: dayIn(1, 12), principal: 100000, earnings: 8000 });
    const person = await prisma.nxPerson.create({ data: { org_id: org.id, name: 'Asha Rao', access_role: 'none' } });
    const rent = await catId(a, 'expense', 'Outlet rent and utilities');
    const ops = await catId(a, 'expense', 'Outlet operations');
    const sales = await catId(a, 'income', 'Product sales');

    await entry(a, { kind: 'income', amount: 40000, entry_date: dayIn(1, 15), category_id: sales, party_name: 'Retailer' });
    await entry(a, { kind: 'income', amount: 9000, entry_date: dayIn(1, 16), category_id: sales, payment_status: 'unpaid', due_date: dayIn(1, 20) });
    await entry(a, { kind: 'expense', amount: 12000, entry_date: dayIn(1, 8), category_id: rent });
    await entry(a, { kind: 'expense', amount: 5000, entry_date: dayIn(1, 9), category_id: ops, expense_class: 'other' });
    await entry(a, { kind: 'expense', amount: 3000, entry_date: dayIn(1, 11), category_id: ops, payment_status: 'unpaid', due_date: dayIn(1, 25) });
    await entry(a, { kind: 'salary', amount: 25000, entry_date: dayIn(1, 28), person_id: person.id });
    await entry(a, { kind: 'transfer', amount: 77777, entry_date: dayIn(1, 18) });
    expect((await a.post('/entries', { kind: 'expense', amount: 1, entry_date: dayIn(1, 1), category_id: sales })).status).toBe(422); // wrong category kind
    expect((await a.post('/entries', { kind: 'expense', amount: 1, entry_date: dayIn(1, 1), person_id: person.id })).status).toBe(422);
    expect((await a.post('/entries', { kind: 'income', amount: 0, entry_date: dayIn(1, 1) })).status).toBe(422);
    expect((await a.post('/entries', { kind: 'income', amount: 5, entry_date: dayIn(1, 5), due_date: dayIn(1, 1) })).status).toBe(422);

    const m1 = monthRange(1);
    const d = (await a.get(`/dashboard${qs(m1)}`)).body.data;
    expect(d.period).toMatchObject({
      principal_returned: 100000, investment_earnings: 8000, other_income: 49000, income: 57000,
      operating_expenses: 15000, other_expenses: 5000, salaries: 25000, expenses: 45000, net_result: 12000,
    });
    // cash: principal + earnings + paid income  /  paid expenses + salary paid
    expect(d.period.cash_in).toBe(100000 + 8000 + 40000);
    expect(d.period.cash_out).toBe(12000 + 5000 + 25000);
    expect(d.position).toMatchObject({ receivables: 9000, payables: 3000, outstanding_principal: 200000 });
    expect(d.expenses_by_category).toEqual(expect.arrayContaining([{ name: 'Outlet operations', amount: 8000 }, { name: 'Outlet rent and utilities', amount: 12000 }]));
    expect(d.salary_by_person).toEqual([expect.objectContaining({ name: 'Asha Rao', paid: 25000, total: 25000 })]);

    // filters: category, payment status, employee, custom range
    expect((await a.get(`/dashboard${qs({ ...m1, expense_category_id: rent })}`)).body.data.period.operating_expenses).toBe(12000);
    expect((await a.get(`/dashboard${qs({ ...m1, payment_status: 'unpaid' })}`)).body.data.period).toMatchObject({ other_income: 9000, operating_expenses: 3000, salaries: 0 });
    expect((await a.get(`/dashboard${qs({ ...m1, person_id: person.id })}`)).body.data.period.salaries).toBe(25000);
    expect((await a.get(`/dashboard${qs({ from: dayIn(1, 15), to: dayIn(1, 16) })}`)).body.data.period.other_income).toBe(49000);
    expect((await a.get(`/dashboard${qs({ from: dayIn(0, 1), to: dayIn(0, 2) })}`)).body.data.period.income).toBe(0);

    // monthly report, and the same figures through the transaction register and the CSV report
    const rep = (await a.get(`/monthly-report${qs({ from: m1.from, to: m1.to })}`)).body.data;
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0]).toMatchObject({ total_income: 57000, total_expenses: 45000, net_result: 12000, new_investments: 0, principal_returned: 100000, salary_expenses: 25000 });
    expect(rep.opening_set).toBe(false);
    expect(rep.rows[0].opening_balance).toBeNull(); // never invented
    const tx = await a.get(`/transactions${qs({ ...m1, limit: 50 })}`);
    expect(tx.body.summary).toMatchObject({ principal_return: 100000, earnings: 8000, income: 49000, expense: 20000, salary: 25000, transfer: 77777 });
    expect((await a.get(`/transactions${qs({ ...m1, type: 'earnings' })}`)).body.data).toHaveLength(1);
    expect((await a.get(`/transactions${qs({ ...m1, q: 'retailer' })}`)).body.data).toHaveLength(1);
    expect((await a.get(`/transactions${qs({ ...m1, min: 40000 })}`)).body.data.every((r) => r.amount >= 40000)).toBe(true);
    const csv = (await a.get(`/reports${qs({ report: 'expenses', ...m1 })}`)).body.data;
    expect(csv.rows).toEqual(expect.arrayContaining([['Outlet rent and utilities', 12000]]));

    // opening balance is only used when set
    await a.patch('/settings', { opening_balance: 100000, opening_date: dayIn(3, 1) });
    const rep2 = (await a.get(`/monthly-report${qs({ from: m1.from, to: m1.to })}`)).body.data;
    expect(rep2.rows[0].opening_balance).toBe(100000 - 300000);
    expect(rep2.rows[0].closing_balance).toBe(100000 - 300000 + 148000 - 42000);
  });

  test('payroll stays private to finance and admin', async () => {
    const { org, token } = await setup('pay');
    const a = api(token);
    await entry(a, { kind: 'salary', amount: 30000, entry_date: dayIn(0, 2) });
    await entry(a, { kind: 'expense', amount: 1000, entry_date: dayIn(0, 3) });
    const manager = await addMember(org, 'manager');
    const m = api(manager.token);
    expect((await m.post('/entries', { kind: 'salary', amount: 5, entry_date: dayIn(0, 1) })).status).toBe(403);
    const list = (await m.get('/entries?limit=50')).body;
    expect(list.data.map((e) => e.kind)).not.toContain('salary');
    expect(list.summary.salary).toBeNull();
    const d = (await m.get('/dashboard')).body.data;
    expect(d.period.salaries).toBeNull();
    expect(d.period.expenses).toBe(1000);
    expect(d.salary_by_person).toBeNull();
    expect((await m.get('/entries?kind=salary')).body.data).toHaveLength(0);
    expect((await m.get('/reports?report=salaries')).status).toBe(403);
    const tx = (await m.get('/transactions?limit=50')).body;
    expect(tx.data.map((r) => r.type)).not.toContain('salary');
    expect((await a.get('/entries?kind=salary')).body.data).toHaveLength(1);
  });
});

describe('projections', () => {
  test('a projection is a plan: it creates no transaction and compares with actuals', async () => {
    const { token } = await setup('prj');
    const a = api(token);
    const month = monthKey(1);
    await entry(a, { kind: 'expense', amount: 15000, entry_date: `${month}-10` });
    const before = (await a.get('/transactions?limit=50')).body.summary.count;
    const p1 = await a.post('/projections', { name: 'Ops budget', month, line: 'operating_expense', amount: 10000, status: 'approved' });
    expect(p1.status).toBe(201);
    await a.post('/projections', { name: 'Expected earnings', month, line: 'investment_earnings', amount: 20000 });
    await a.post('/projections', { name: 'Old', month, line: 'operating_expense', amount: 999999, status: 'archived' });
    expect((await a.get('/transactions?limit=50')).body.summary.count).toBe(before); // nothing was created
    expect((await prisma.nxEntry.count({ where: { deleted_at: null } })) >= 1).toBe(true);
    expect((await a.post('/projections', { name: 'x', month: '2026-13', line: 'salary', amount: 1 })).status).toBe(422);
    expect((await a.post('/projections', { name: 'x', month, line: 'salary', amount: 1, investment_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);

    const cmp = (await a.get(`/projections/compare${qs({ from: `${month}-01`, to: `${month}-28` })}`)).body.data;
    const op = cmp.total.find((l) => l.line === 'operating_expense');
    expect(op).toMatchObject({ projected: 10000, actual: 15000, variance: 5000, variance_pct: 50, favourable: false });
    const earn = cmp.total.find((l) => l.line === 'investment_earnings');
    expect(earn).toMatchObject({ projected: 20000, actual: 0, variance: -20000, favourable: false, remaining: 20000 });
    const d = (await a.get(`/dashboard${qs({ from: `${month}-01`, to: `${month}-28` })}`)).body.data;
    expect(d.projected_totals).toMatchObject({ operating_expense: 10000, investment_earnings: 20000, net: 10000 });
    expect(d.period.net_result).toBe(-15000); // actuals unchanged by the plan
    const upd = await a.patch(`/projections/${p1.body.data.id}`, { status: 'archived' });
    expect(upd.body.data.status).toBe('archived');
    expect((await a.get(`/projections?status=archived`)).body.data.length).toBe(2);
    expect((await a.del(`/projections/${p1.body.data.id}`)).status).toBe(200);
  });
});

describe('month close and audit', () => {
  test('a closed month is locked; an admin can edit with a reason; changes are audited', async () => {
    const { org, token } = await setup('lock');
    const a = api(token);
    const month = monthKey(1);
    const e1 = await entry(a, { kind: 'income', amount: 1000, entry_date: `${month}-05` });
    expect((await a.post(`/finance/periods/${month}/close`, {})).status).toBe(200);
    expect((await a.post(`/finance/periods/${month}/close`, {})).status).toBe(409);
    expect((await a.post('/finance/periods/2999-01/close', {})).status).toBe(422);
    const finance = await addMember(org, 'finance');
    const f = api(finance.token);
    expect((await f.post('/entries', { kind: 'expense', amount: 5, entry_date: `${month}-06` })).status).toBe(409);
    const needReason = await a.patch(`/entries/${e1.id}`, { amount: 1200 });
    expect(needReason.status).toBe(422);
    expect((await a.patch(`/entries/${e1.id}`, { amount: 1200, reason: 'fix typo' })).status).toBe(200);
    const periods = (await a.get('/finance/periods')).body.data;
    expect(periods.find((p) => p.month === month)).toMatchObject({ status: 'closed', stale: true });
    expect((await a.post(`/finance/periods/${month}/reopen`, { reason: 'late invoice' })).status).toBe(200);
    expect((await f.post('/entries', { kind: 'expense', amount: 5, entry_date: `${month}-06` })).status).toBe(201);
    const audit = (await a.get('/audit')).body.data;
    expect(audit.map((x) => `${x.entity}:${x.action}`)).toEqual(expect.arrayContaining(['entry:create', 'entry:update', 'period:close', 'period:reopen']));
    expect((await f.get('/audit')).status).toBe(403);
    const trend = (await a.get(`/finance/valuation${qs({ from: month, to: month, state: 'locked' })}`)).body.data;
    expect(trend.months[0]).toMatchObject({ valuation: 0 });
  });
});

describe('group dashboard', () => {
  test('Novarex Pharmaceuticals is a company of the group: P&L without capital, its own block, valued by the group formula', async () => {
    const delphic = await createOrg({ name: 'Group Alpha', slug: `ga-${Date.now()}` });
    const nx = await createOrg({ name: 'Novarex Pharmaceuticals', slug: `vts-${Date.now()}`, org_group_id: delphic.org_group_id });
    await prisma.org.update({ where: { id: nx.id }, data: { enabled_modules: ['novarex'] } });
    const superUser = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: superUser.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: superUser.id, org_group_id: delphic.org_group_id } });
    await createOrgMembership(superUser.id, delphic.id, { role: 'admin' });
    await createOrgMembership(superUser.id, nx.id, { role: 'admin' });
    const { access_token: superToken } = await loginAs(superUser);

    const a = api(superToken);
    const inv = await prisma.nxInvestment.create({ data: { org_id: nx.id, code: 'NX-0001', name: 'Fund', investment_date: new Date(`${dayIn(1, 3)}T00:00:00Z`), amount: 400000, status: 'active', expected_return_amount: 450000, expected_return_date: new Date(`${dayIn(0, 20)}T00:00:00Z`) } });
    await prisma.nxReturn.create({ data: { org_id: nx.id, investment_id: inv.id, return_date: new Date(`${dayIn(1, 10)}T00:00:00Z`), principal: 100000, earnings: 6000 } });
    await prisma.nxEntry.create({ data: { org_id: nx.id, kind: 'expense', amount: 2000, entry_date: new Date(`${dayIn(1, 11)}T00:00:00Z`), payment_status: 'paid' } });
    await prisma.nxEntry.create({ data: { org_id: nx.id, kind: 'transfer', amount: 999999, entry_date: new Date(`${dayIn(1, 12)}T00:00:00Z`), payment_status: 'paid' } });
    await prisma.nxProjection.create({ data: { org_id: nx.id, name: 'Plan', month: monthKey(0), line: 'investment_earnings', amount: 7000, status: 'approved' } });
    void a;

    const month = monthKey(1);
    const res = await authed(request(app).get(`/api/v1/super-dashboard/group/overview?from=${month}&to=${monthKey(0)}&state=all`), superToken);
    expect(res.status).toBe(200);
    const c = res.body.data.companies.find((x) => x.org.id === nx.id);
    expect(c.org.kind).toBe('novarex');
    expect(c.has_data).toBe(true);
    expect(c.totals).toMatchObject({ revenue: 6000, expenses: 2000, profit: 4000 }); // earnings only: capital, principal and the transfer are not
    // profit x 240 + principal still invested x 3, on the last month in view
    expect(c.valuation.asset_component).toBe(900000);
    expect(c.valuation.current).toBe(c.valuation.profit_component + c.valuation.asset_component);
    expect(c.valuation.profit_component).toBe(c.series[c.series.length - 1].profit * 240);
    expect(c.novarex.money).toMatchObject({ capital_invested_total: 400000, principal_returned_total: 100000, outstanding_principal: 300000 });
    expect(res.body.data.novarex.money.outstanding_principal).toBe(300000);
    expect(res.body.data.novarex.projected.total_income).toBe(7000);
    expect(res.body.data.novarex.companies).toHaveLength(1);

    const proj = await authed(request(app).get(`/api/v1/super-dashboard/group/projection`), superToken);
    expect(proj.status).toBe(200);
    expect(proj.body.data.novarex).toBeTruthy();
    expect(proj.body.data.companies.find((x) => x.org.id === nx.id).projected.every((p) => typeof p.valuation === 'number')).toBe(true);

    const dd = await authed(request(app).get(`/api/v1/super-dashboard/companies/${nx.id}/drilldown?from=${month}&to=${month}&state=all`), superToken);
    expect(dd.status).toBe(200);
    expect(dd.body.data.sections.map((s) => s.key)).toEqual(['months', 'outlets', 'investments']);
    const av = await authed(request(app).put(`/api/v1/super-dashboard/companies/${nx.id}/asset-values`), superToken).send({ month: monthKey(0), asset_value: 5 });
    expect(av.status).toBe(422);
  });
});
