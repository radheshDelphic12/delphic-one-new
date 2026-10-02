// FRD hardening: admin approval before a timesheet lock, the full approval chain for day overtime and
// regularisation, approval steps on the audit trail, the lock order (timesheets -> calculations -> financials),
// the financial freeze of invoices / payments, Leave Managers + unpaid overflow at approval, half-day leave in the
// daily attendance run, attendance audit, the vendor export and "apply the project rate to every resource".
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');
const autoAttendance = require('../src/modules/attendance/autoAttendance.service');
const { todayIst } = require('../src/lib/istDate');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const api = (p) => `/api/v1${p}`;
const AUG = { period_month: 8, period_year: 2026 };

async function seed(orgOverrides = {}) {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-'), timesheet_admin_approval: true, ...orgOverrides });
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Calendar', is_default: true } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const managerUser = await createUser({ role: 'recruiter', name: 'Manager Mia' });
  const managerMembership = await createOrgMembership(managerUser.id, org.id, { role: 'recruiter', joined_at: new Date('2020-01-01') });
  const managerToken = (await loginAs(managerUser)).access_token;
  const employee = async (name, extra = {}) => {
    const user = await createUser({ role: 'recruiter', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: new Date('2020-01-01') });
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { manager_id: managerMembership.id, ...extra } });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  return { org, adminUser, adminToken, managerUser, managerMembership, managerToken, employee };
}

const logEntry = (p, date, hours = 8) => authed(request(app).post(api('/timesheets/entries')), p.token).send({ date, hours, notes: 'work' });
const decideEntry = (token, id, status = 'approved') => authed(request(app).post(api(`/timesheets/entries/${id}/decision`)), token).send({ status });
const audit = (ctx, query) => authed(request(app).get(api('/calculations/lock-audit')), ctx.adminToken).query(query).then((r) => r.body.data);

describe('Admin approval before a timesheet is locked', () => {
  test('a month with entries still waiting for approval is not locked, unless the admin forces it with a reason', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const entry = (await logEntry(emp, '2026-09-10')).body.data;
    const lock = (body) => authed(request(app).post(api('/timesheets/locks/month')), ctx.adminToken).send({ year: 2026, month: 9, org_membership_ids: [emp.membership.id], ...body });

    const refused = await lock({});
    expect(refused.body.data.locked).toBe(0);
    expect(refused.body.data.results[0]).toMatchObject({ result: 'pending_entries', pending: 1 });
    expect(await prisma.timesheetMonthLock.count()).toBe(0);

    expect((await lock({ force: true })).status).toBe(422); // a reason is required
    // The manager's approval alone is not enough either: the entry is still pending until the admin approves.
    await decideEntry(ctx.managerToken, entry.id);
    expect((await lock({})).body.data.results[0].result).toBe('pending_entries');

    await decideEntry(ctx.adminToken, entry.id);
    expect((await lock({})).body.data.locked).toBe(1);
  });

  test('forcing the lock is allowed for an admin and is written on the audit row', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    await logEntry(emp, '2026-09-10');
    const res = await authed(request(app).post(api('/timesheets/locks/month')), ctx.adminToken).send({ year: 2026, month: 9, org_membership_ids: [emp.membership.id], force: true, reason: 'Payroll cut-off' });
    expect(res.body.data.locked).toBe(1);
    const rows = await audit(ctx, { stage: 'timesheet', action: undefined });
    expect(rows.find((r) => r.action === 'lock').change).toContain('admin override');
  });
});

describe('Day overtime and regularisation follow the same chain; every step is on the audit trail', () => {
  test('day overtime: the manager approval is the first step, the admin is final', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const ot = await prisma.timesheetDayOvertime.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, date: new Date('2026-09-12'), hours: 2, status: 'pending' } });
    const decide = (token, status = 'approved') => authed(request(app).post(api(`/timesheets/overtime/${ot.id}/decision`)), token).send({ status });

    const step = await decide(ctx.managerToken);
    expect(step.status).toBe(200);
    expect(step.body.awaiting_admin).toBe(true);
    expect((await prisma.timesheetDayOvertime.findUnique({ where: { id: ot.id } })).status).toBe('pending');
    expect((await decide(ctx.managerToken)).status).toBe(409);
    expect((await authed(request(app).get(api('/timesheets/approvals/pending')), ctx.managerToken)).body.data.overtime).toHaveLength(0);
    expect((await authed(request(app).get(api('/timesheets/approvals/pending')), ctx.adminToken)).body.data.overtime).toHaveLength(1);
    expect((await decide(ctx.adminToken)).status).toBe(200);
    expect((await prisma.timesheetDayOvertime.findUnique({ where: { id: ot.id } })).status).toBe('approved');
  });

  test('regularisation: manager step then admin', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const ticket = await prisma.timesheetRegularizationTicket.create({
      data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, date: new Date('2026-09-08'), target_hours: 6, requested_by: emp.user.id, requested_change: {}, reason: 'Missed the weekly deadline' },
    });
    const decide = (token) => authed(request(app).post(api(`/timesheets/regularization-tickets/${ticket.id}/decision`)), token).send({ status: 'approved', decision_reason: 'ok' });
    const step = await decide(ctx.managerToken);
    expect(step.body.awaiting_admin).toBe(true);
    expect(await prisma.timesheetEntry.count({ where: { org_membership_id: emp.membership.id } })).toBe(0);
    expect((await decide(ctx.adminToken)).status).toBe(200);
    expect(await prisma.timesheetEntry.count({ where: { org_membership_id: emp.membership.id, status: 'approved' } })).toBe(1);
  });

  test('approval steps appear on the audit trail with who, what and the status change', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const entry = (await logEntry(emp, '2026-09-10')).body.data;
    await decideEntry(ctx.managerToken, entry.id);
    await decideEntry(ctx.adminToken, entry.id);
    const rows = (await audit(ctx, { stage: 'timesheet', year: 2026, month: 9 })).filter((r) => ['manager_approve', 'approve'].includes(r.action));
    expect(rows.map((r) => [r.action, r.previous_status, r.new_status]).sort()).toEqual([['approve', 'submitted', 'approved'], ['manager_approve', 'submitted', 'manager_approved']]);
    expect(rows.map((r) => r.actor.name)).toContain('Manager Mia');
    expect(rows).toHaveLength(2);
    expect(rows[0].employee.name).toBe('Eve');
  });

  test('attendance regularisation and deletion are audited', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const rec = await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, date: new Date('2026-09-10'), status: 'absent', source: 'manual' } });
    expect((await authed(request(app).post(api(`/attendance/${rec.id}/regularize`)), ctx.adminToken).send({ status: 'present', reason: 'Was on site' })).status).toBe(200);
    expect((await authed(request(app).delete(api(`/attendance/${rec.id}`)), ctx.adminToken).send({ reason: 'Duplicate' })).status).toBe(200);
    const logs = await prisma.auditLog.findMany({ where: { entity_type: 'attendance' }, orderBy: { created_at: 'asc' } });
    expect(logs.map((l) => l.action)).toEqual(['attendance_regularize', 'attendance_delete']);
    expect(logs[0].snapshot).toMatchObject({ from: 'absent', status: 'present', records: 1 });
  });
});

describe('The lock stages run in order', () => {
  async function salaried(ctx, name) {
    const emp = await ctx.employee(name);
    await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, effective_from: new Date('2026-01-01'), ctc: 42000, components: { basic: 42000 }, created_by: ctx.adminUser.id } });
    return emp;
  }
  const calc = (ctx, action, body) => authed(request(app).post(api(`/calculations/${action}`)), ctx.adminToken).send({ ...AUG, ...body });

  test('a calculation cannot be locked while its timesheets are open (stage 1 first)', async () => {
    const ctx = await seed({ enforce_lock_order: true });
    const emp = await salaried(ctx, 'Eve');
    await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, date: new Date('2026-08-12'), hours: 8, status: 'approved', approved_by: ctx.adminUser.id, approved_at: new Date() } });

    const blocked = await calc(ctx, 'lock', { kind: 'salary_employee', scope_key: emp.membership.id });
    expect(blocked.status).toBe(422);
    expect(blocked.body.message).toContain('Stage 1 first');

    // Lock the employee's August timesheet, then the calculation locks.
    expect((await authed(request(app).post(api('/timesheets/locks/month')), ctx.adminToken).send({ year: 2026, month: 8, org_membership_ids: [emp.membership.id] })).body.data.locked).toBe(1);
    expect((await calc(ctx, 'lock', { kind: 'salary_employee', scope_key: emp.membership.id })).status).toBe(200);
  });

  test('the month financials cannot be locked while calculations are started but not locked (stage 2 first)', async () => {
    const ctx = await seed({ enforce_lock_order: true });
    const emp = await salaried(ctx, 'Eve');
    expect((await calc(ctx, 'review', { kind: 'salary_employee', scope_key: emp.membership.id })).status).toBe(200);
    const state = (await authed(request(app).get(api('/calculations/state')), ctx.adminToken).query({ ...AUG, kind: 'financials' })).body.data;
    expect(state.live.readiness.blockers.map((b) => b.code)).toContain('calculations_not_locked');
    const res = await calc(ctx, 'lock', { kind: 'financials' });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('Stage 2 first');
  });
});

describe('The financial lock freezes the month\'s invoices and payments', () => {
  test('invoices, vendor invoices and vendor payments of a financially locked month cannot change until it is reopened', async () => {
    const ctx = await seed();
    const client = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: ctx.adminUser.id, org_id: ctx.org.id } });
    const vendor = await prisma.account.create({ data: { type: 'vendor', name: unique('Vendor '), stage: 'active', owner_id: ctx.adminUser.id, org_id: ctx.org.id } });
    const invoice = await prisma.clientInvoice.create({ data: { org_id: ctx.org.id, client_account_id: client.id, period_month: 8, period_year: 2026, amount: 1000, currency: 'INR', status: 'draft', line_items: {}, invoice_number: 'INV-1', created_by: ctx.adminUser.id } });
    const vinv = await prisma.projectVendorInvoice.create({ data: { org_id: ctx.org.id, account_id: client.id, vendor_account_id: vendor.id, period_month: 8, period_year: 2026, amount: 500, currency: 'INR', created_by: ctx.adminUser.id } });
    const payment = await prisma.vendorPayment.create({ data: { org_id: ctx.org.id, vendor_name: 'V', vendor_type: 'contractor', vendor_account_id: vendor.id, amount: 500, currency: 'INR', period_month: 8, period_year: 2026, status: 'pending', created_by: ctx.adminUser.id } });
    const fin = await prisma.financialCalculation.create({ data: { org_id: ctx.org.id, kind: 'financials', scope_key: 'org', ...AUG, status: 'locked', current_version: 1, locked_by: ctx.adminUser.id, locked_at: new Date() } });

    expect((await authed(request(app).post(api(`/billing/invoices/${invoice.id}/send`)), ctx.adminToken)).status).toBeGreaterThanOrEqual(400);
    const edit = await authed(request(app).patch(api(`/billing/invoices/${invoice.id}`)), ctx.adminToken).send({ notes: 'x', reason: 'edit' });
    expect(edit.status).toBe(423);
    expect((await authed(request(app).delete(api(`/billing/invoices/${invoice.id}`)), ctx.adminToken).send({ reason: 'x' })).status).toBe(423);
    expect((await authed(request(app).patch(api(`/billing/vendor-invoices/${vinv.id}/tracking`)), ctx.adminToken).send({ sent: true })).status).toBe(423);
    expect((await authed(request(app).post(api(`/expenses/vendor-payments/${payment.id}/decision`)), ctx.adminToken).send({ status: 'approved' })).status).toBe(423);

    // Reopen the financial lock (audited) and the changes go through.
    expect((await authed(request(app).post(api('/calculations/reopen')), ctx.adminToken).send({ kind: 'financials', ...AUG, reason: 'Late TDS' })).status).toBe(200);
    expect((await authed(request(app).patch(api(`/billing/vendor-invoices/${vinv.id}/tracking`)), ctx.adminToken).send({ sent: true })).status).toBe(200);
    expect(fin.id).toBeTruthy();
    const rows = await audit(ctx, { stage: 'financial' });
    expect(rows[0]).toMatchObject({ stage: 'financial', action: 'reopen', previous_status: 'locked', new_status: 'reopened', reason: 'Late TDS' });
  });
});

describe('Leave Manager and unpaid overflow at approval', () => {
  const typeNamed = async (ctx, name) => (await authed(request(app).get(api('/leave/types')), ctx.adminToken)).body.data.find((t) => t.name === name);

  test('a Leave Manager processes leave requests; other people cannot; the admin keeps control', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const lm = await ctx.employee('Lena');
    const casual = await typeNamed(ctx, 'Casual Leave');
    const req = (await authed(request(app).post(api('/leave/requests')), emp.token).send({ leave_type_id: casual.id, from_date: '2026-09-14', to_date: '2026-09-14' })).body.data;

    expect((await authed(request(app).get(api('/leave/requests')), lm.token)).status).toBe(403);
    expect((await authed(request(app).put(api(`/leave/managers/${lm.membership.id}`)), lm.token).send({ is_leave_manager: true })).status).toBe(403);
    expect((await authed(request(app).put(api(`/leave/managers/${lm.membership.id}`)), ctx.adminToken).send({ is_leave_manager: true })).status).toBe(200);
    expect((await authed(request(app).get(api('/leave/managers')), ctx.adminToken)).body.data.map((m) => m.name)).toEqual(['Lena']);

    expect((await authed(request(app).get(api('/leave/requests')), lm.token)).status).toBe(200);
    const decided = await authed(request(app).post(api(`/leave/requests/${req.id}/decision`)), lm.token).send({ status: 'approved' });
    expect(decided.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: 'leave_manager_set' } })).toBe(1);
    // A plain employee still cannot decide.
    expect((await authed(request(app).post(api(`/leave/requests/${req.id}/decision`)), emp.token).send({ status: 'rejected' })).status).toBe(403);
  });

  test('a pending paid request longer than the balance is split when it is approved', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const special = (await authed(request(app).post(api('/leave/types')), ctx.adminToken).send({ name: 'Special', paid: true, annual_quota: 2, overflow_to_unpaid: true })).body.data;
    // Created pending directly (as if applied before the balance dropped): Mon-Fri, only 2 days left.
    const pending = await prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, leave_type_id: special.id, from_date: new Date('2026-09-14'), to_date: new Date('2026-09-18'), status: 'pending' } });
    const res = await authed(request(app).post(api(`/leave/requests/${pending.id}/decision`)), ctx.adminToken).send({ status: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.overflow.to_unpaid_days).toBe(3);
    const rows = await prisma.leaveRequest.findMany({ where: { org_membership_id: emp.membership.id }, include: { leave_type: true }, orderBy: { from_date: 'asc' } });
    expect(rows.map((r) => [r.leave_type.name, r.status, r.from_date.toISOString().slice(0, 10), r.to_date.toISOString().slice(0, 10)])).toEqual([
      ['Special', 'approved', '2026-09-14', '2026-09-15'],
      ['Unpaid Leave', 'approved', '2026-09-16', '2026-09-18'],
    ]);
  });
});

describe('Daily attendance and the half-day leave day', () => {
  test('a day with one approved half-day leave is marked as a half day; a full leave day is left alone', async () => {
    const ctx = await seed();
    const it = await prisma.department.create({ data: { name: 'IT', org_id: ctx.org.id } });
    const person = async (name) => {
      const user = await createUser({ role: 'recruiter', name });
      await prisma.user.update({ where: { id: user.id }, data: { department_id: it.id } });
      const membership = await createOrgMembership(user.id, ctx.org.id, { role: 'recruiter', joined_at: new Date('2020-01-01') });
      const shift = await prisma.shift.create({ data: { org_id: ctx.org.id, name: `S${name}`, start_minutes: 0, end_minutes: 1439, grace_minutes: 0 } });
      await prisma.orgMembership.update({ where: { id: membership.id }, data: { shift_id: shift.id } });
      return membership;
    };
    const half = await person('Half');
    const full = await person('Full');
    const type = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'Casual', paid: true, annual_quota: 12 } });
    const today = todayIst();
    await prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: half.id, leave_type_id: type.id, from_date: today, to_date: today, is_half_day: true, half_day_session: 'FIRST_HALF', status: 'approved' } });
    await prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: full.id, leave_type_id: type.id, from_date: today, to_date: today, status: 'approved' } });
    await autoAttendance.runDaily(ctx.org.id, new Date());
    const weekday = today.getUTCDay() !== 0 && today.getUTCDay() !== 6;
    const halfRec = await prisma.attendanceRecord.findFirst({ where: { org_membership_id: half.id } });
    expect(halfRec?.status ?? null).toBe(weekday ? 'half_day' : null);
    expect(await prisma.attendanceRecord.count({ where: { org_membership_id: full.id } })).toBe(0);
  });
});

describe('Vendor export and applying the project rate to every resource', () => {
  test('the vendor export lists invoice, TDS, adjustment, net payable, sent and payment status', async () => {
    const ctx = await seed();
    const client = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: ctx.adminUser.id, org_id: ctx.org.id, project_name: 'Apollo' } });
    const vendor = await prisma.account.create({ data: { type: 'vendor', name: 'Acme Staffing', stage: 'active', owner_id: ctx.adminUser.id, org_id: ctx.org.id } });
    const vinv = await prisma.projectVendorInvoice.create({ data: { org_id: ctx.org.id, account_id: client.id, vendor_account_id: vendor.id, period_month: 8, period_year: 2026, invoice_number: 'VINV-7', amount: 20000, currency: 'INR', created_by: ctx.adminUser.id } });
    await authed(request(app).patch(api(`/billing/vendor-invoices/${vinv.id}/tracking`)), ctx.adminToken).send({ sent: true, tds_amount: 2000, adjustment_amount: -500, adjustment_note: 'Credit' });
    await prisma.vendorPayment.create({ data: { org_id: ctx.org.id, vendor_name: 'Acme', vendor_type: 'contractor', vendor_account_id: vendor.id, amount: 17500, currency: 'INR', period_month: 8, period_year: 2026, status: 'paid', paid_at: new Date(), created_by: ctx.adminUser.id } });
    const res = await authed(request(app).get(api('/calculations/export/vendor')), ctx.adminToken).query({ ...AUG, format: 'json' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ month: 'August 2026', vendor: 'Acme Staffing', invoice_number: 'VINV-7', amount: 20000, tds: 2000, adjustment: -500, net_payable: 17500, sent_status: 'sent', payment_status: 'paid' });
    const xlsx = await authed(request(app).get(api('/calculations/export/vendor')), ctx.adminToken).query(AUG).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xlsx.headers['content-disposition']).toContain('vendor-2026-08.xlsx');
    expect(xlsx.body.slice(0, 2).toString()).toBe('PK');
  });

  test('applying the project rate gives every allocated resource its own rate (so billing statuses apply), once', async () => {
    const ctx = await seed();
    const client = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: ctx.adminUser.id, org_id: ctx.org.id, industry: 'IT' } });
    const proj = await authed(request(app).post(api('/calendars/projects')), ctx.adminToken).send({ name: 'Rates Co', service_category: 'managed_services', client_account_id: client.id });
    const project = (await authed(request(app).patch(api(`/billing/projects/${proj.body.data.id}`)), ctx.adminToken).send({ agreement_start_date: '2026-01-01', billing: { rate_type: 'monthly', rate: 100000, currency: 'INR' } })).body.data;
    const a = await ctx.employee('Dev A');
    const b = await ctx.employee('Dev B');
    for (const p of [a, b]) await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: project.id, org_membership_id: p.membership.id, created_by: ctx.adminUser.id } });
    const apply = () => authed(request(app).post(api(`/billing/projects/${project.id}/resource-rates/apply-project-rate`)), ctx.adminToken).send({ effective_from: '2026-01-01' });
    expect((await apply()).body.data).toMatchObject({ created: 2, skipped: 0 });
    expect((await apply()).body.data).toMatchObject({ created: 0, skipped: 2 });
    const rates = (await authed(request(app).get(api('/billing/resource-rates')), ctx.adminToken).query({ account_id: project.id })).body.data;
    expect(rates.map((r) => [r.rate_type, r.rate]).sort()).toEqual([['monthly', 100000], ['monthly', 100000]]);
  });
});
