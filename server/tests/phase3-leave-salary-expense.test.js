const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createOrg,
  createOrgMembership,
  authed,
} = require('./helpers');
const leaveService = require('../src/modules/leave/leave.service');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedOrgAdmin(orgOverrides = { name: 'Delphic', slug: 'delphic' }) {
  const org = await createOrg(orgOverrides);
  const admin = await createUser({ role: 'admin' });
  const membership = await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, membership, token: access_token };
}

async function seedEmployee(org, extra = {}) {
  const user = await createUser({ role: 'employee' });
  const membership = await createOrgMembership(user.id, org.id, { role: 'employee', ...extra });
  const { access_token } = await loginAs(user);
  return { user, membership, token: access_token };
}

const d = (s) => new Date(`${s}T00:00:00.000Z`);

async function typeByName(org, name) {
  await leaveService.listTypes(org.id); // seeds the four standard types
  return prisma.leaveType.findFirst({ where: { org_id: org.id, name } });
}

async function leave(org, membership, type, from, to, status = 'approved', extra = {}) {
  return prisma.leaveRequest.create({
    data: { org_id: org.id, org_membership_id: membership.id, leave_type_id: type.id, from_date: d(from), to_date: d(to), status, ...extra },
  });
}

describe('Leave balances are computed live, Jan 1 -> today', () => {
  const today = d('2026-09-24');
  const r = (from, to, status = 'approved', extra = {}) => ({ from_date: d(from), to_date: d(to), status, is_half_day: false, ...extra });

  test('a leave spanning today counts only the days up to today as used; the rest is upcoming', () => {
    const usage = leaveService.summariseUsage([r('2026-09-22', '2026-09-26')], { year: 2026, today });
    expect(usage).toEqual({ used: 3, upcoming: 2, pending: 0 });
  });

  test('half days, pending, cancelled and rejected requests', () => {
    const usage = leaveService.summariseUsage(
      [
        r('2026-09-24', '2026-09-24', 'approved', { is_half_day: true }), // today -> used
        r('2026-09-25', '2026-09-25', 'approved', { is_half_day: true }), // tomorrow -> upcoming
        r('2026-10-05', '2026-10-06', 'pending'),
        r('2026-03-02', '2026-03-03', 'cancelled'),
        r('2026-03-09', '2026-03-10', 'rejected'),
      ],
      { year: 2026, today }
    );
    expect(usage).toEqual({ used: 0.5, upcoming: 0.5, pending: 2 });
  });

  test('a leave over New Year is split between the two years', () => {
    const req = [r('2025-12-30', '2026-01-02')];
    expect(leaveService.summariseUsage(req, { year: 2025, today })).toEqual({ used: 2, upcoming: 0, pending: 0 });
    expect(leaveService.summariseUsage(req, { year: 2026, today })).toEqual({ used: 2, upcoming: 0, pending: 0 });
  });

  test('a future year has nothing used yet; a past year is complete', () => {
    const req = [r('2027-02-01', '2027-02-03'), r('2025-06-02', '2025-06-04')];
    expect(leaveService.summariseUsage(req, { year: 2027, today })).toEqual({ used: 0, upcoming: 3, pending: 0 });
    expect(leaveService.summariseUsage(req, { year: 2025, today })).toEqual({ used: 3, upcoming: 0, pending: 0 });
  });

  test('type codes: CL / EL / SL / UL, initials for a custom type', () => {
    expect(['Casual Leave', 'Earned Leave', 'Sick Leave', 'Unpaid Leave'].map(leaveService.leaveCode)).toEqual(['CL', 'EL', 'SL', 'UL']);
    expect(leaveService.leaveCode('Maternity Leave')).toBe('ML');
  });

  test('today is taken in IST, not UTC', () => {
    // 20:00 UTC on the 24th is already 01:30 on the 25th in India.
    expect(leaveService.todayIst(new Date('2026-09-24T20:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-25');
    expect(leaveService.todayIst(new Date('2026-09-24T10:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-24');
  });
});

describe('Leave costs working days only, on the employee\'s calendar', () => {
  test('Fri -> Mon costs 2 days; 1-5 Oct with a 2 Oct holiday costs 2; a weekend-only range is refused', async () => {
    const { org } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const cl = await typeByName(org, 'Casual Leave');
    const calendar = await prisma.calendar.create({ data: { org_id: org.id, name: 'Standard', kind: 'internal', is_default: true } });
    await prisma.calendarHoliday.create({ data: { calendar_id: calendar.id, date: d('2026-10-02'), label: 'Gandhi Jayanti' } });
    const apply = (from_date, to_date) => authed(request(app).post('/api/v1/leave/requests'), emp.token).send({ leave_type_id: cl.id, from_date, to_date });

    const friToMon = await apply('2026-11-06', '2026-11-09');
    expect(friToMon.status).toBe(201);
    expect(friToMon.body.data.days).toBe(2);

    const octWeek = await apply('2026-10-01', '2026-10-05');
    expect(octWeek.status).toBe(201);
    expect(octWeek.body.data.days).toBe(2);

    expect((await apply('2026-11-14', '2026-11-15')).status).toBe(422); // Sat + Sun

    const mine = await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), emp.token);
    expect(mine.body.data.find((b) => b.code === 'CL')).toMatchObject({ pending: 4, remaining: 12 });
  });

  test('a full-day leave is refused on a date the employee was present; a half day is still allowed', async () => {
    const { org } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const cl = await typeByName(org, 'Casual Leave');
    await prisma.attendanceRecord.create({ data: { org_id: org.id, org_membership_id: emp.membership.id, date: d('2026-09-15'), status: 'present', check_in_at: new Date('2026-09-15T04:00:00Z') } });

    const full = await authed(request(app).post('/api/v1/leave/requests'), emp.token).send({ leave_type_id: cl.id, from_date: '2026-09-14', to_date: '2026-09-16' });
    expect(full.status).toBe(409);
    expect(full.body.message).toContain('2026-09-15');

    const half = await authed(request(app).post('/api/v1/leave/requests'), emp.token).send({ leave_type_id: cl.id, from_date: '2026-09-15', to_date: '2026-09-15', is_half_day: true, half_day_session: 'SECOND_HALF' });
    expect(half.status).toBe(201);
  });
});

describe('Admin leave balances: overview, entitlement control, withdrawing leave', () => {
  test('the overview lists every active employee with CL/EL/SL/UL counters; only an admin can read it', async () => {
    const { org, token } = await seedOrgAdmin();
    const asha = await seedEmployee(org);
    const ravi = await seedEmployee(org);
    const cl = await typeByName(org, 'Casual Leave');
    const sl = await typeByName(org, 'Sick Leave');
    const ul = await typeByName(org, 'Unpaid Leave');
    await leave(org, asha.membership, cl, '2026-02-02', '2026-02-04'); // 3 days taken
    await leave(org, asha.membership, sl, '2026-03-02', '2026-03-02', 'pending');
    await leave(org, ravi.membership, ul, '2026-04-06', '2026-04-10'); // unpaid, 5 days
    const left = await seedEmployee(org);
    await prisma.orgMembership.update({ where: { id: left.membership.id }, data: { left_at: new Date('2026-05-01') } });

    const res = await authed(request(app).get('/api/v1/leave/balances/overview').query({ year: 2026 }), token);
    expect(res.status).toBe(200);
    expect(res.body.data.types.map((t) => t.code).sort()).toEqual(['CL', 'EL', 'SL', 'UL']);
    expect(res.body.data.employees.map((e) => e.org_membership_id)).not.toContain(left.membership.id); // ex-employees are not listed

    const byMember = Object.fromEntries(res.body.data.employees.map((e) => [e.org_membership_id, Object.fromEntries(e.balances.map((b) => [b.code, b]))]));
    expect(byMember[asha.membership.id].CL).toMatchObject({ allocated: 12, used: 3, remaining: 9, pending: 0 });
    expect(byMember[asha.membership.id].SL).toMatchObject({ allocated: 12, used: 0, pending: 1, remaining: 12 });
    expect(byMember[ravi.membership.id].UL).toMatchObject({ used: 5, unlimited: true, remaining: null });
    expect(byMember[ravi.membership.id].CL).toMatchObject({ used: 0, remaining: 12 });

    expect((await authed(request(app).get('/api/v1/leave/balances/overview'), asha.token)).status).toBe(403);
  });

  test('the overview can be narrowed by name search', async () => {
    const { org, token } = await seedOrgAdmin();
    const asha = await seedEmployee(org);
    await seedEmployee(org);
    await prisma.user.update({ where: { id: asha.user.id }, data: { name: 'Asha Patel' } });
    const res = await authed(request(app).get('/api/v1/leave/balances/overview').query({ year: 2026, search: 'patel' }), token);
    expect(res.body.data.employees.map((e) => e.name)).toEqual(['Asha Patel']);
  });

  test('an admin sets an employee\'s entitlement; the employee sees it, and it caps new requests; null resets it', async () => {
    const { org, token } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const cl = await typeByName(org, 'Casual Leave');
    const url = `/api/v1/leave/balances/${emp.membership.id}`;

    const set = await authed(request(app).put(url), token).send({ leave_type_id: cl.id, year: 2026, allocated: 2 });
    expect(set.status).toBe(200);
    expect(set.body.data).toMatchObject({ code: 'CL', allocated: 2, remaining: 2, customised: true });

    const mine = await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), emp.token);
    expect(mine.body.data.find((b) => b.code === 'CL')).toMatchObject({ allocated: 2, customised: true });

    // 3 days against an entitlement of 2 is refused with the new figure.
    const tooMany = await authed(request(app).post('/api/v1/leave/requests'), emp.token).send({ leave_type_id: cl.id, from_date: '2026-11-02', to_date: '2026-11-04' });
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.message).toContain('2 remaining');
    const fits = await authed(request(app).post('/api/v1/leave/requests'), emp.token).send({ leave_type_id: cl.id, from_date: '2026-11-02', to_date: '2026-11-03' });
    expect(fits.status).toBe(201);

    const reset = await authed(request(app).put(url), token).send({ leave_type_id: cl.id, year: 2026, allocated: null });
    expect(reset.body.data).toMatchObject({ allocated: 12, customised: false });

    // Guards: unknown employee/type, negative number, non-admin.
    expect((await authed(request(app).put(`/api/v1/leave/balances/00000000-0000-4000-8000-0000000000aa`), token).send({ leave_type_id: cl.id, allocated: 3 })).status).toBe(404);
    expect((await authed(request(app).put(url), token).send({ leave_type_id: '00000000-0000-4000-8000-0000000000bb', allocated: 3 })).status).toBe(404);
    expect((await authed(request(app).put(url), token).send({ leave_type_id: cl.id, allocated: -1 })).status).toBe(422);
    expect((await authed(request(app).put(url), emp.token).send({ leave_type_id: cl.id, allocated: 30 })).status).toBe(403);
  });

  test('an entitlement in another organization cannot be touched', async () => {
    const a = await seedOrgAdmin();
    const b = await seedOrgAdmin({});
    const empB = await seedEmployee(b.org);
    const cl = await typeByName(a.org, 'Casual Leave');
    const res = await authed(request(app).put(`/api/v1/leave/balances/${empB.membership.id}`), a.token).send({ leave_type_id: cl.id, allocated: 5 });
    expect(res.status).toBe(404);
  });

  test('approving moves the counters straight away (nothing stored); withdrawing an approved leave gives the days back and lifts the leave-day block', async () => {
    const { org, token } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const cl = await typeByName(org, 'Casual Leave');

    const created = await authed(request(app).post('/api/v1/leave/requests'), emp.token).send({ leave_type_id: cl.id, from_date: '2026-01-19', to_date: '2026-01-21' });
    const pendingView = await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), emp.token);
    expect(pendingView.body.data.find((b) => b.code === 'CL')).toMatchObject({ used: 0, pending: 3, remaining: 12 });

    await authed(request(app).post(`/api/v1/leave/requests/${created.body.data.id}/decision`), token).send({ status: 'approved' });
    const approvedView = await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), emp.token);
    expect(approvedView.body.data.find((b) => b.code === 'CL')).toMatchObject({ used: 3, pending: 0, remaining: 9 });
    expect(await leaveService.leaveDayFor(org.id, emp.membership.id, d('2026-01-20'))).not.toBeNull();

    // The legacy stored counter is no longer touched.
    expect(await prisma.leaveBalance.count({ where: { org_membership_id: emp.membership.id } })).toBe(0);

    expect((await authed(request(app).post(`/api/v1/leave/requests/${created.body.data.id}/revoke`), emp.token).send({ reason: 'x' })).status).toBe(403);
    const revoke = await authed(request(app).post(`/api/v1/leave/requests/${created.body.data.id}/revoke`), token).send({ reason: 'Client escalation — needed on site' });
    expect(revoke.status).toBe(200);
    expect(revoke.body.data).toMatchObject({ status: 'cancelled', decision_reason: 'Client escalation — needed on site' });

    const after = await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), emp.token);
    expect(after.body.data.find((b) => b.code === 'CL')).toMatchObject({ used: 0, remaining: 12 });
    expect(await leaveService.leaveDayFor(org.id, emp.membership.id, d('2026-01-20'))).toBeNull();

    const again = await authed(request(app).post(`/api/v1/leave/requests/${created.body.data.id}/revoke`), token).send({});
    expect(again.status).toBe(409);
  });

  test('a paid type with no quota is uncapped until an admin sets an entitlement', async () => {
    const { org, token } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const custom = (await authed(request(app).post('/api/v1/leave/types'), token).send({ name: 'Study Leave', paid: true })).body.data;
    const big = await authed(request(app).post('/api/v1/leave/requests'), emp.token).send({ leave_type_id: custom.id, from_date: '2026-11-02', to_date: '2026-11-20' });
    expect(big.status).toBe(201);
    await authed(request(app).post(`/api/v1/leave/requests/${big.body.data.id}/revoke`), token).send({});
    await authed(request(app).put(`/api/v1/leave/balances/${emp.membership.id}`), token).send({ leave_type_id: custom.id, year: 2026, allocated: 5 });
    const capped = await authed(request(app).post('/api/v1/leave/requests'), emp.token).send({ leave_type_id: custom.id, from_date: '2026-11-02', to_date: '2026-11-20' });
    expect(capped.status).toBe(422);
  });
});

describe('Payroll → Salary Structure edit', () => {
  async function structure(token, membershipId, body = {}) {
    const res = await authed(request(app).post('/api/v1/payroll/salary-structures'), token).send({
      org_membership_id: membershipId,
      effective_from: '2026-01-01',
      ctc: 60000,
      components: { Basic: 30000, HRA: 15000, Allowances: 20000, 'Professional tax': -5000 },
      ...body,
    });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  test('an admin revises base salary, allowances and deductions; the edit persists and records who changed it', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const created = await structure(token, emp.membership.id);

    const edit = await authed(request(app).patch(`/api/v1/payroll/salary-structures/${created.id}`), token).send({
      ctc: 66000,
      components: { Basic: 36000, HRA: 15000, Allowances: 20000, 'Professional tax': -5000 },
    });
    expect(edit.status).toBe(200);
    expect(Number(edit.body.data.ctc)).toBe(66000);
    expect(edit.body.data.components.Basic).toBe(36000);
    expect(edit.body.data.updated_by).toBe(admin.id);
    expect(edit.body.data.updated_at).toBeTruthy();

    const list = await authed(request(app).get('/api/v1/payroll/salary-structures'), token);
    expect(Number(list.body.data.find((s) => s.id === created.id).ctc)).toBe(66000);
    expect(await prisma.salaryStructure.count({ where: { org_membership_id: emp.membership.id } })).toBe(1); // edited in place, not duplicated
  });

  test('the components must still add up to CTC after an edit — including when only one of them is sent', async () => {
    const { org, token } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const created = await structure(token, emp.membership.id);
    const url = `/api/v1/payroll/salary-structures/${created.id}`;

    const mismatch = await authed(request(app).patch(url), token).send({ ctc: 70000, components: { Basic: 30000 } });
    expect(mismatch.status).toBe(422);
    const ctcOnly = await authed(request(app).patch(url), token).send({ ctc: 99999 });
    expect(ctcOnly.status).toBe(422);
    const componentsOnly = await authed(request(app).patch(url), token).send({ components: { Basic: 1 } });
    expect(componentsOnly.status).toBe(422);
    expect((await authed(request(app).patch(url), token).send({})).status).toBe(422);
    expect(Number((await prisma.salaryStructure.findUnique({ where: { id: created.id } })).ctc)).toBe(60000); // nothing half-applied
  });

  test('the effective date can be moved on its own; a non-admin and another org are refused', async () => {
    const a = await seedOrgAdmin();
    const b = await seedOrgAdmin({});
    const emp = await seedEmployee(a.org);
    const created = await structure(a.token, emp.membership.id);
    const url = `/api/v1/payroll/salary-structures/${created.id}`;

    const moved = await authed(request(app).patch(url), a.token).send({ effective_from: '2026-04-01' });
    expect(moved.status).toBe(200);
    expect(moved.body.data.effective_from.slice(0, 10)).toBe('2026-04-01');

    expect((await authed(request(app).patch(url), emp.token).send({ effective_from: '2026-05-01' })).status).toBe(403);
    expect((await authed(request(app).patch(url), b.token).send({ effective_from: '2026-05-01' })).status).toBe(404);
  });

  test('payroll uses the edited structure: a draft run picks it up, an already processed payslip keeps its figures', async () => {
    const { org, token } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    await prisma.orgMembership.update({ where: { id: emp.membership.id }, data: { joined_at: d('2026-01-01') } });
    const created = await structure(token, emp.membership.id);
    const url = `/api/v1/payroll/salary-structures/${created.id}`;

    const runA = (await authed(request(app).post('/api/v1/payroll/runs'), token).send({ period_month: 2, period_year: 2026 })).body.data;
    await authed(request(app).patch(url), token).send({ ctc: 72000, components: { Basic: 42000, HRA: 15000, Allowances: 20000, 'Professional tax': -5000 } });
    await authed(request(app).post(`/api/v1/payroll/runs/${runA.id}/process`), token);
    const slipA = (await authed(request(app).get(`/api/v1/payroll/runs/${runA.id}/payslips`), token)).body.data.find((p) => p.org_membership_id === emp.membership.id);
    expect(Number(slipA.gross)).toBe(72000); // the edit was in force when the draft was processed

    // Editing afterwards does not rewrite that payslip.
    await authed(request(app).patch(url), token).send({ ctc: 80000, components: { Basic: 50000, HRA: 15000, Allowances: 20000, 'Professional tax': -5000 } });
    const slipAfter = (await authed(request(app).get(`/api/v1/payroll/runs/${runA.id}/payslips`), token)).body.data.find((p) => p.org_membership_id === emp.membership.id);
    expect(Number(slipAfter.gross)).toBe(72000);

    // A later run uses the newest figures.
    const runB = (await authed(request(app).post('/api/v1/payroll/runs'), token).send({ period_month: 3, period_year: 2026 })).body.data;
    await authed(request(app).post(`/api/v1/payroll/runs/${runB.id}/process`), token);
    const slipB = (await authed(request(app).get(`/api/v1/payroll/runs/${runB.id}/payslips`), token)).body.data.find((p) => p.org_membership_id === emp.membership.id);
    expect(Number(slipB.gross)).toBe(80000);
  });
});

describe('Expenses → edit a submitted claim', () => {
  async function claim(org, emp, extra = {}) {
    const location = (await prisma.location.findFirst({ where: { org_id: org.id } })) || (await prisma.location.create({ data: { org_id: org.id, name: 'Ahmedabad' } }));
    const res = await authed(request(app).post('/api/v1/expenses/claims'), emp.token).send({ location_id: location.id, category: 'Travel', amount: 1200, currency: 'INR', ...extra });
    expect(res.status).toBe(201);
    return { claim: res.body.data, location };
  }

  test('the owner edits amount, category and location while it is pending; omitted fields stay as they were', async () => {
    const { org } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const { claim: c } = await claim(org, emp, { currency: 'USD' });
    const other = await prisma.location.create({ data: { org_id: org.id, name: 'Indore' } });

    const edit = await authed(request(app).patch(`/api/v1/expenses/claims/${c.id}`), emp.token).send({ amount: 1500.5, category: 'Client travel', location_id: other.id });
    expect(edit.status).toBe(200);
    expect(Number(edit.body.data.amount)).toBe(1500.5);
    expect(edit.body.data).toMatchObject({ category: 'Client travel', currency: 'USD', status: 'pending' });
    expect(edit.body.data.location.name).toBe('Indore');
  });

  test('an admin can edit anyone\'s pending claim; a colleague cannot even see it', async () => {
    const { org, token } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const colleague = await seedEmployee(org);
    const { claim: c } = await claim(org, emp);
    expect((await authed(request(app).patch(`/api/v1/expenses/claims/${c.id}`), colleague.token).send({ amount: 1 })).status).toBe(404);
    expect((await authed(request(app).patch(`/api/v1/expenses/claims/${c.id}`), token).send({ amount: 999 })).status).toBe(200);
  });

  test('a decided claim is locked: approved, rejected and reimbursed all refuse an edit', async () => {
    const { org, token } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const approved = (await claim(org, emp)).claim;
    const rejected = (await claim(org, emp)).claim;
    await authed(request(app).post(`/api/v1/expenses/claims/${approved.id}/decision`), token).send({ status: 'approved' });
    await authed(request(app).post(`/api/v1/expenses/claims/${rejected.id}/decision`), token).send({ status: 'rejected', reason: 'No receipt' });

    for (const c of [approved, rejected]) {
      const res = await authed(request(app).patch(`/api/v1/expenses/claims/${c.id}`), emp.token).send({ amount: 1 });
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('pending');
    }
    await authed(request(app).post(`/api/v1/expenses/claims/${approved.id}/reimburse`), token);
    expect((await authed(request(app).patch(`/api/v1/expenses/claims/${approved.id}`), token).send({ amount: 1 })).status).toBe(409);
    expect(Number((await prisma.expenseClaim.findUnique({ where: { id: approved.id } })).amount)).toBe(1200);
  });

  test('validation: nothing to update, a non-positive amount, an unknown location', async () => {
    const { org } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const { claim: c } = await claim(org, emp);
    const url = `/api/v1/expenses/claims/${c.id}`;
    expect((await authed(request(app).patch(url), emp.token).send({})).status).toBe(422);
    expect((await authed(request(app).patch(url), emp.token).send({ amount: 0 })).status).toBe(422);
    expect((await authed(request(app).patch(url), emp.token).send({ location_id: '00000000-0000-4000-8000-0000000000cc' })).status).toBe(404);
  });

  test('receipts attach to a pending claim (several), only its owner and admins see them, and a decided claim\'s receipts are frozen', async () => {
    const { org, token } = await seedOrgAdmin();
    const emp = await seedEmployee(org);
    const colleague = await seedEmployee(org);
    const { claim: c } = await claim(org, emp);

    const upload = (t, name) =>
      authed(request(app).post('/api/v1/documents'), t).field('entity_type', 'expense_claim').field('entity_id', c.id).field('label', 'Receipt').attach('file', Buffer.from('receipt'), name);

    const first = await upload(emp.token, 'taxi.pdf');
    expect(first.status).toBe(201);
    expect((await upload(emp.token, 'hotel.png')).status).toBe(201);
    expect((await upload(colleague.token, 'sneaky.pdf')).status).toBe(404);

    const list = await authed(request(app).get(`/api/v1/documents?entity_type=expense_claim&entity_id=${c.id}`), emp.token);
    expect(list.body.data).toHaveLength(2);
    expect((await authed(request(app).get(`/api/v1/documents?entity_type=expense_claim&entity_id=${c.id}`), token)).body.data).toHaveLength(2);
    expect((await authed(request(app).get(`/api/v1/documents?entity_type=expense_claim&entity_id=${c.id}`), colleague.token)).status).toBe(404);

    // While pending an owner can remove a receipt…
    expect((await authed(request(app).delete(`/api/v1/documents/${first.body.data.id}`), emp.token)).status).toBe(200);

    // …after the decision they are part of the record.
    await authed(request(app).post(`/api/v1/expenses/claims/${c.id}/decision`), token).send({ status: 'approved' });
    const late = await upload(emp.token, 'late.pdf');
    expect(late.status).toBe(409);
    const remaining = (await authed(request(app).get(`/api/v1/documents?entity_type=expense_claim&entity_id=${c.id}`), emp.token)).body.data;
    expect((await authed(request(app).delete(`/api/v1/documents/${remaining[0].id}`), emp.token)).status).toBe(409);
  });
});
