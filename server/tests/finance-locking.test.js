// Finance: projects identified by id/code (not name), vendor-resource
// timesheets, Managed Services billing on the project calendar, overtime,
// approval states, the reusable lock / version / change-detection system,
// invoices from a locked month, resource revenue across contracts, vendor
// payments, attendance-based salary, Financials snapshots, and the new
// Group Charge / Expense / Payroll filters and category permissions.
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
  unique,
} = require('./helpers');
const billingEngine = require('../src/modules/calculations/engines/billing.engine');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const AUG = { period_month: 8, period_year: 2026 }; // 21 Mon–Fri days, fully in the past

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const it = await prisma.department.create({ data: { name: 'IT', org_id: org.id } });
  const adminUser = await createUser({ role: 'admin' });
  const adminMembership = await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const calendar = await prisma.calendar.create({ data: { org_id: org.id, name: 'Ahmedabad Calendar', is_default: true } });
  const vendor = await prisma.account.create({ data: { type: 'vendor', name: unique('Vendor '), stage: 'active', owner_id: adminUser.id, org_id: org.id } });
  const client = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: adminUser.id, org_id: org.id, industry: 'IT' } });
  return { org, it, adminUser, adminMembership, adminToken, calendar, vendor, client };
}

async function employee(ctx, { name = 'Emp', it = true, managerId = null } = {}) {
  const user = await createUser({ role: 'employee', name });
  if (it) await prisma.user.update({ where: { id: user.id }, data: { department_id: ctx.it.id } });
  const membership = await createOrgMembership(user.id, ctx.org.id, { role: 'employee', department_id: it ? ctx.it.id : undefined, joined_at: new Date('2026-01-01') });
  if (managerId) await prisma.orgMembership.update({ where: { id: membership.id }, data: { manager_id: managerId } });
  const token = (await loginAs(user)).access_token;
  return { user, membership, token };
}

async function contractor(ctx, { name = 'Vendor Dev', rate = 42000 } = {}) {
  const user = await createUser({ role: 'employee', name });
  const membership = await prisma.orgMembership.create({
    data: { person_id: user.id, org_id: ctx.org.id, role: 'employee', worker_type: 'contractor', vendor_account_id: ctx.vendor.id, vendor_rate: rate, vendor_rate_currency: 'INR', joined_at: new Date('2026-01-01') },
  });
  const token = (await loginAs(user)).access_token;
  return { user, membership, token };
}

async function addProject(ctx, name, { rate = 140000, rate_type = 'monthly', overtime = false, multiplier, category = 'managed_services', calendarId } = {}) {
  const res = await authed(request(app).post('/api/v1/calendars/projects'), ctx.adminToken).send({ name, service_category: category, client_account_id: ctx.client.id, ...(calendarId ? { calendar_id: calendarId } : {}) });
  expect(res.status).toBe(201);
  const patch = await authed(request(app).patch(`/api/v1/billing/projects/${res.body.data.id}`), ctx.adminToken).send({
    agreement_start_date: '2026-01-01',
    overtime_billable: overtime,
    ...(multiplier ? { overtime_multiplier: multiplier } : {}),
    billing: { rate_type, rate, currency: 'INR' },
  });
  expect(patch.status).toBe(200);
  return patch.body.data;
}

async function assign(ctx, accountId, membershipId, extra = {}) {
  const res = await authed(request(app).post('/api/v1/billing/cost-assignments'), ctx.adminToken).send({ account_id: accountId, org_membership_id: membershipId, ...extra });
  expect(res.status).toBe(201);
}

async function log(token, body) {
  return authed(request(app).post('/api/v1/timesheets/entries'), token).send(body);
}

async function decide(token, entryId, status, reason) {
  return authed(request(app).post(`/api/v1/timesheets/entries/${entryId}/decision`), token).send({ status, ...(reason ? { reason } : {}) });
}

// Every Mon–Fri of a month as YYYY-MM-DD (optionally excluding some).
function weekdays({ period_month, period_year }, except = []) {
  const out = [];
  const days = new Date(Date.UTC(period_year, period_month, 0)).getUTCDate();
  for (let d = 1; d <= days; d += 1) {
    const day = new Date(Date.UTC(period_year, period_month - 1, d));
    const key = day.toISOString().slice(0, 10);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && !except.includes(key)) out.push(key);
  }
  return out;
}

async function approvedEntries(ctx, membershipId, accountId, dates, hours = 8, extra = {}) {
  await prisma.timesheetEntry.createMany({
    data: dates.map((date) => ({ org_id: ctx.org.id, org_membership_id: membershipId, account_id: accountId, date: new Date(date), hours, status: 'approved', approved_by: ctx.adminUser.id, approved_at: new Date(), ...extra })),
  });
}

const calc = (token, path, body) => authed(request(app).post(`/api/v1/calculations/${path}`), token).send(body);

describe('Projects — the name is a label, the id/code is the identity', () => {
  test('two contracts with the same name are separate projects with their own codes, resources and billing', async () => {
    const ctx = await seed();
    const a = await addProject(ctx, 'ABC Development', { rate: 100000 });
    const b = await addProject(ctx, 'ABC Development', { rate: 140000 });
    expect(a.id).not.toBe(b.id);
    expect(a.project_code).toMatch(/^P\d{4}$/);
    expect(b.project_code).toMatch(/^P\d{4}$/);
    expect(a.project_code).not.toBe(b.project_code);

    const aditya = await employee(ctx, { name: 'Aditya' });
    const yash = await employee(ctx, { name: 'Yash' });
    await assign(ctx, a.id, aditya.membership.id);
    await assign(ctx, b.id, yash.membership.id);
    await approvedEntries(ctx, aditya.membership.id, a.id, ['2026-08-03']);
    await approvedEntries(ctx, yash.membership.id, b.id, ['2026-08-03', '2026-08-04']);

    const res = await authed(request(app).get('/api/v1/analytics/billing'), ctx.adminToken).query({ ...AUG });
    expect(res.status).toBe(200);
    const rowA = res.body.data.projects.find((p) => p.project.id === a.id);
    const rowB = res.body.data.projects.find((p) => p.project.id === b.id);
    expect(rowA.resources.map((r) => r.name)).toEqual(['Aditya']);
    expect(rowB.resources.map((r) => r.name)).toEqual(['Yash']);
    expect(rowA.amount).toBe(Math.round((100000 / 21) * 100) / 100);
    expect(rowB.amount).toBe(2 * (Math.round((140000 / 21) * 100) / 100)); // each day rounded

    // Renaming to a name another project already has is fine too.
    const rename = await authed(request(app).patch(`/api/v1/billing/projects/${a.id}`), ctx.adminToken).send({ project_name: 'ABC Development' });
    expect(rename.status).toBe(200);
  });

  test('Project P&L filters by project type and client', async () => {
    const ctx = await seed();
    const other = await prisma.account.create({ data: { type: 'client', name: unique('Other '), stage: 'active', owner_id: ctx.adminUser.id, org_id: ctx.org.id, industry: 'IT' } });
    const ms = await addProject(ctx, 'Managed', { category: 'managed_services' });
    const fixed = await addProject(ctx, 'Fixed', { category: 'project' });
    await authed(request(app).patch(`/api/v1/billing/projects/${fixed.id}`), ctx.adminToken).send({ client_account_id: other.id });

    const byType = await authed(request(app).get('/api/v1/billing/projects-pnl'), ctx.adminToken).query({ ...AUG, project_type: 'managed_services' });
    expect(byType.body.data.map((r) => r.project.id)).toEqual([ms.id]);
    const byClient = await authed(request(app).get('/api/v1/billing/projects-pnl'), ctx.adminToken).query({ ...AUG, client_account_id: other.id });
    expect(byClient.body.data.map((r) => r.project.id)).toEqual([fixed.id]);
  });

  test('cost rate/hr replaces the salary allocation for that person in P&L (hours x rate), never both', async () => {
    const ctx = await seed();
    const p = await addProject(ctx, 'Costed');
    const e = await employee(ctx, { name: 'Rated' });
    await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: e.membership.id, effective_from: new Date('2026-01-01'), ctc: 55000, components: { basic: 55000 }, created_by: ctx.adminUser.id } });
    await assign(ctx, p.id, e.membership.id, { cost_rate_per_hr: 500 });
    await approvedEntries(ctx, e.membership.id, p.id, ['2026-08-03']);
    const pnl = await authed(request(app).get(`/api/v1/billing/projects/${p.id}/pnl`), ctx.adminToken).query(AUG);
    expect(pnl.body.data.internal.employees[0]).toMatchObject({ cost_basis: 'cost_rate', approved_hours: 8, cost: 4000 });
    expect(pnl.body.data.internal.cost).toBe(4000);
  });
});

describe('Timesheets — employees and vendor resources share one model', () => {
  test('a vendor resource sees assigned projects, logs hours + overtime, and their manager approves it', async () => {
    const ctx = await seed();
    const manager = await employee(ctx, { name: 'Manager' });
    const p = await addProject(ctx, 'Vendor Work');
    const c = await contractor(ctx);
    await prisma.orgMembership.update({ where: { id: c.membership.id }, data: { manager_id: manager.membership.id } });
    await assign(ctx, p.id, c.membership.id);

    const projects = await authed(request(app).get('/api/v1/timesheets/my-projects'), c.token);
    expect(projects.body.data.map((x) => x.id)).toEqual([p.id]);
    // Project is required for a vendor resource, like IT staff.
    expect((await log(c.token, { date: '2026-08-03', hours: 8 })).status).toBe(422);
    const created = await log(c.token, { date: '2026-08-03', account_id: p.id, hours: 8, overtime_hours: 2 });
    expect(created.status).toBe(201);
    expect(Number(created.body.data.overtime_hours)).toBe(2);
    const mine = await authed(request(app).get('/api/v1/timesheets/my-log'), c.token).query({ month: 8, year: 2026 });
    expect(mine.status).toBe(200);
    expect(mine.body.data[0].total_hours).toBe(10);

    const approved = await decide(manager.token, created.body.data.id, 'approved');
    expect(approved.status).toBe(200);
    const detail = await authed(request(app).get(`/api/v1/analytics/billing/projects/${p.id}`), ctx.adminToken).query(AUG);
    const day = detail.body.data.days.find((d) => d.date === '2026-08-03');
    expect(day.status).toBe('approved');
    expect(day.approvers[0].name).toBe('Manager');
  });
});

describe('Billing & Sales — Managed Services on the project calendar', () => {
  test('the same 8h day bills rate x min(8/160, 1/working days) for 19, 20, 21 and 22-day calendars', async () => {
    const ctx = await seed();
    const cases = [
      { month: 9, holidays: [], wd: 22 },
      { month: 8, holidays: [], wd: 21 },
      { month: 8, holidays: ['2026-08-14'], wd: 20 },
      { month: 8, holidays: ['2026-08-14', '2026-08-28'], wd: 19 },
    ];
    const e = await employee(ctx);
    for (const c of cases) {
      const cal = await prisma.calendar.create({ data: { org_id: ctx.org.id, name: unique('Cal ') } });
      if (c.holidays.length) await prisma.calendarHoliday.createMany({ data: c.holidays.map((d) => ({ calendar_id: cal.id, date: new Date(d), label: 'Holiday' })) });
      const p = await addProject(ctx, `Calendar ${c.wd}`, { calendarId: cal.id });
      const workDay = c.month === 9 ? '2026-09-01' : '2026-08-03';
      await approvedEntries(ctx, e.membership.id, p.id, [workDay]);
      const raw = await billingEngine.computeProjectMonth(ctx.org.id, p.id, { period_month: c.month, period_year: 2026 });
      expect(raw.working_days).toBe(c.wd);
      const day = raw.days.find((d) => d.date === workDay);
      expect(day.base_amount).toBe(Math.round(140000 * Math.min(8 / 160, 1 / c.wd) * 100) / 100);
      // A holiday shows as a zero row, never disappears.
      for (const h of c.holidays) expect(raw.days.find((d) => d.date === h)).toMatchObject({ is_working_day: false, base_amount: 0 });
      expect(raw.days).toHaveLength(c.month === 9 ? 30 : 31);
    }
  });

  test('hourly projects show the client\'s estimated hours x rate beside actual billing, which it never changes', async () => {
    const ctx = await seed();
    const p = await addProject(ctx, 'Estimated', { rate: 1500, rate_type: 'hourly' });
    const set = await authed(request(app).patch(`/api/v1/billing/projects/${p.id}`), ctx.adminToken).send({ estimated_monthly_hours: 120 });
    expect(set.body.data.estimated_monthly_hours).toBe(120);
    const e = await employee(ctx);
    await approvedEntries(ctx, e.membership.id, p.id, ['2026-08-03', '2026-08-04']);

    const overview = await authed(request(app).get('/api/v1/analytics/billing'), ctx.adminToken).query(AUG);
    const row = overview.body.data.projects.find((r) => r.project.id === p.id);
    expect(row.amount).toBe(16 * 1500);
    expect(row.estimate).toMatchObject({ hours: 120, amount: 180000, amount_inr: 180000, actual_hours: 16, actual_amount: 24000, hours_variance: -104 });
    expect(overview.body.data.totals).toMatchObject({ amount_inr: 24000, estimated_inr: 180000, estimated_projects: 1 });
    const detail = await authed(request(app).get(`/api/v1/analytics/billing/projects/${p.id}`), ctx.adminToken).query(AUG);
    expect(detail.body.data.estimate).toMatchObject({ hours: 120, amount: 180000 });

    // Monthly projects never get an estimate; clearing it removes it.
    const monthly = await addProject(ctx, 'Monthly');
    await authed(request(app).patch(`/api/v1/billing/projects/${monthly.id}`), ctx.adminToken).send({ estimated_monthly_hours: 100 });
    await authed(request(app).patch(`/api/v1/billing/projects/${p.id}`), ctx.adminToken).send({ estimated_monthly_hours: null });
    const after = await authed(request(app).get('/api/v1/analytics/billing'), ctx.adminToken).query(AUG);
    expect(after.body.data.projects.every((r) => r.estimate === null)).toBe(true);
  });

  test('overtime is billed only where the project enables it; the toggle only changes what is shown', async () => {
    const ctx = await seed();
    const on = await addProject(ctx, 'OT on', { rate: 1000, rate_type: 'hourly', overtime: true, multiplier: 1.5 });
    const off = await addProject(ctx, 'OT off', { rate: 1000, rate_type: 'hourly', overtime: false });
    const e = await employee(ctx);
    await approvedEntries(ctx, e.membership.id, on.id, ['2026-08-03'], 8, { overtime_hours: 2 });
    await approvedEntries(ctx, e.membership.id, off.id, ['2026-08-04'], 8, { overtime_hours: 2 });

    const withOt = await authed(request(app).get('/api/v1/analytics/billing'), ctx.adminToken).query({ ...AUG, include_overtime: 'true' });
    const row = (id) => withOt.body.data.projects.find((p) => p.project.id === id);
    expect(row(on.id).amount).toBe(8000 + 2 * 1500);
    expect(row(off.id).amount).toBe(8000);
    const withoutOt = await authed(request(app).get('/api/v1/analytics/billing'), ctx.adminToken).query({ ...AUG, include_overtime: 'false' });
    expect(withoutOt.body.data.projects.find((p) => p.project.id === on.id).amount).toBe(8000);
  });

  test('pending and rejected entries block the lock; once approved the month locks, is immutable, and makes a draft invoice', async () => {
    const ctx = await seed();
    const p = await addProject(ctx, 'Lockable', { rate: 1000, rate_type: 'hourly' });
    const e = await employee(ctx);
    await assign(ctx, p.id, e.membership.id);
    const pending = await log(e.token, { date: '2026-08-03', account_id: p.id, hours: 8 });
    const rejectMe = await log(e.token, { date: '2026-08-04', account_id: p.id, hours: 8 });
    await decide(ctx.adminToken, rejectMe.body.data.id, 'rejected', 'Wrong project');

    const status = await authed(request(app).get('/api/v1/analytics/billing'), ctx.adminToken).query({ ...AUG, status: 'pending' });
    expect(status.body.data.days.find((d) => d.date === '2026-08-03').status).toBe('pending');
    expect(status.body.data.days.find((d) => d.date === '2026-08-04').status).toBe('rejected');
    // Every date stays, with zero where nothing is billable.
    expect(status.body.data.days).toHaveLength(31);

    const blocked = await calc(ctx.adminToken, 'lock', { kind: 'billing', scope_key: p.id, ...AUG });
    expect(blocked.status).toBe(422);
    expect(blocked.body.errors.blockers.map((b) => b.code).sort()).toEqual(['pending_entries', 'rejected_entries']);

    await decide(ctx.adminToken, pending.body.data.id, 'approved');
    const resubmitted = await log(e.token, { date: '2026-08-04', account_id: p.id, hours: 6 });
    await decide(ctx.adminToken, resubmitted.body.data.id, 'approved');

    const locked = await calc(ctx.adminToken, 'lock', { kind: 'billing', scope_key: p.id, ...AUG, reason: 'August review done' });
    expect(locked.status).toBe(200);
    expect(locked.body.data).toMatchObject({ status: 'locked', current_version: 1, locked_amount: 14000 });
    expect((await calc(ctx.adminToken, 'lock', { kind: 'billing', scope_key: p.id, ...AUG })).status).toBe(409);

    const invoice = await calc(ctx.adminToken, 'billing/invoice', { account_id: p.id, ...AUG });
    expect(invoice.status).toBe(200);
    expect(invoice.body.data).toMatchObject({ status: 'draft', calculation_version_id: expect.any(String) });
    expect(Number(invoice.body.data.amount)).toBe(14000);
    const drafts = await authed(request(app).get('/api/v1/billing/invoices'), ctx.adminToken).query({ status: 'draft' });
    expect(drafts.body.data.map((i) => i.id)).toContain(invoice.body.data.id);

    // A later timesheet regularisation does NOT change the locked billing — it's flagged.
    await prisma.timesheetLock.create({ data: { org_id: ctx.org.id, date: new Date('2026-08-05') } });
    const ticket = await authed(request(app).post('/api/v1/timesheets/regularization-requests'), e.token).send({ date: '2026-08-05', account_id: p.id, hours: 8, reason: 'Forgot to log' });
    expect(ticket.status).toBe(201);
    await authed(request(app).post(`/api/v1/timesheets/regularization-tickets/${ticket.body.data.id}/decision`), ctx.adminToken).send({ status: 'approved' });

    const state = await authed(request(app).get('/api/v1/calculations/state'), ctx.adminToken).query({ kind: 'billing', scope_key: p.id, ...AUG });
    expect(state.body.data.status).toBe('change_detected');
    expect(state.body.data.locked_amount).toBe(14000);
    expect(state.body.data.changes[0]).toMatchObject({ source_type: 'timesheet', previous_amount: 14000, potential_amount: 22000, status: 'open' });
    const overview = await authed(request(app).get('/api/v1/analytics/billing'), ctx.adminToken).query(AUG);
    expect(overview.body.data.projects.find((r) => r.project.id === p.id)).toMatchObject({ source: 'locked', amount: 14000, live_amount: 22000 });
    // An invoice can't be generated while a change is unresolved.
    expect((await calc(ctx.adminToken, 'billing/invoice', { account_id: p.id, ...AUG })).status).toBe(409);

    const recalculated = await calc(ctx.adminToken, 'recalculate', { kind: 'billing', scope_key: p.id, ...AUG, reason: 'Accept the regularised day' });
    expect(recalculated.body.data).toMatchObject({ status: 'locked', current_version: 2, locked_amount: 22000 });
    expect(recalculated.body.data.versions.map((v) => v.amount)).toEqual([22000, 14000]);
    expect(recalculated.body.data.changes[0]).toMatchObject({ status: 'accepted', resolved_version: 2 });
    const refreshed = await calc(ctx.adminToken, 'billing/invoice', { account_id: p.id, ...AUG });
    expect(Number(refreshed.body.data.amount)).toBe(22000);
    expect(refreshed.body.data.id).toBe(invoice.body.data.id);

    const audit = await prisma.auditLog.findMany({ where: { entity_type: 'financial_calculation' }, orderBy: { created_at: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['calculation_lock', 'calculation_invoice', 'calculation_recalculate']));
  });

  test('fixed-price projects are recognised but never run through hour/day billing', async () => {
    const ctx = await seed();
    const p = await addProject(ctx, 'Fixed', { category: 'project' });
    const e = await employee(ctx);
    await approvedEntries(ctx, e.membership.id, p.id, ['2026-08-03']);
    const res = await authed(request(app).get('/api/v1/analytics/billing'), ctx.adminToken).query(AUG);
    expect(res.body.data.projects.find((r) => r.project.id === p.id)).toMatchObject({ engine: 'fixed_price', supported: false, amount: 0 });
  });
});

describe('Resource Revenue and vendor payments', () => {
  test('a resource on two contracts has one line per contract and a total', async () => {
    const ctx = await seed();
    const p1 = await addProject(ctx, 'Circle XYZ', { rate: 1000, rate_type: 'hourly' });
    const p2 = await addProject(ctx, 'Another', { rate: 500, rate_type: 'hourly' });
    const m = await employee(ctx, { name: 'Mallicka' });
    await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: m.membership.id, effective_from: new Date('2026-01-01'), ctc: 42000, components: { basic: 42000 }, created_by: ctx.adminUser.id } });
    await assign(ctx, p1.id, m.membership.id, { allocation_percent: 60 });
    await assign(ctx, p2.id, m.membership.id, { allocation_percent: 40 });
    await approvedEntries(ctx, m.membership.id, p1.id, ['2026-08-03']);
    await approvedEntries(ctx, m.membership.id, p2.id, ['2026-08-04']);
    await prisma.attendanceRecord.createMany({ data: weekdays(AUG).map((d) => ({ org_id: ctx.org.id, org_membership_id: m.membership.id, date: new Date(d), status: 'present' })) });

    const res = await authed(request(app).get('/api/v1/analytics/resource-revenue'), ctx.adminToken).query(AUG);
    const r = res.body.data.resources.find((x) => x.name === 'Mallicka');
    expect(r.projects.map((p) => [p.project.id, p.revenue])).toEqual([[p1.id, 8000], [p2.id, 4000]]);
    expect(r.revenue).toBe(12000);
    // Full attendance: the month's salary 42000, split 60/40 by allocation.
    expect(r.projects.map((p) => p.cost)).toEqual([25200, 16800]);
    expect(r.projects.every((p) => p.approval_status === 'approved')).toBe(true);
  });

  test('vendor payment = contractor rate on the project calendar from approved hours; locking creates the pending payment', async () => {
    const ctx = await seed();
    const p = await addProject(ctx, 'Staffed');
    const c = await contractor(ctx, { rate: 42000 });
    await assign(ctx, p.id, c.membership.id);
    await approvedEntries(ctx, c.membership.id, p.id, weekdays(AUG));

    const live = await authed(request(app).get('/api/v1/analytics/vendor-payments'), ctx.adminToken).query(AUG);
    expect(live.body.data.lines[0]).toMatchObject({ working_days: 21, amount: 42000, approval_status: 'approved' });
    const locked = await calc(ctx.adminToken, 'lock', { kind: 'vendor_payment', ...AUG });
    expect(locked.status).toBe(200);
    const payments = await prisma.vendorPayment.findMany({ where: { org_id: ctx.org.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ vendor_account_id: ctx.vendor.id, status: 'pending', period_month: 8 });
    expect(Number(payments[0].amount)).toBe(42000);
  });
});

describe('Salary — attendance on the employee calendar; lock; regularisation after lock', () => {
  test('per day = ctc / calendar working days; a regularisation after lock is flagged, recalculated as v2, and feeds payroll and Financials', async () => {
    const ctx = await seed();
    await prisma.calendarHoliday.create({ data: { calendar_id: ctx.calendar.id, date: new Date('2026-08-14'), label: 'Independence Day (obs.)' } });
    const n = await employee(ctx, { name: 'Nikhil' });
    await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: n.membership.id, effective_from: new Date('2026-01-01'), ctc: 55000, components: { basic: 55000 }, created_by: ctx.adminUser.id } });
    const present = weekdays(AUG, ['2026-08-14', '2026-08-20', '2026-08-21']);
    await prisma.attendanceRecord.createMany({ data: present.map((d) => ({ org_id: ctx.org.id, org_membership_id: n.membership.id, date: new Date(d), status: 'present' })) });
    const absent = await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: n.membership.id, date: new Date('2026-08-20'), status: 'absent' } });

    const salary = await authed(request(app).get('/api/v1/analytics/salary-attendance'), ctx.adminToken).query(AUG);
    const line = salary.body.data.lines[0];
    expect(line.breakdown.working_days).toBe(20); // 21 weekdays − 1 calendar holiday
    expect(line.per_day).toBe(2750); // 55000 / 20
    expect(line.deductions).toBe(5500); // 2 days loss of pay
    expect(line.net).toBe(49500);

    const locked = await calc(ctx.adminToken, 'lock', { kind: 'salary', ...AUG });
    expect(locked.body.data).toMatchObject({ status: 'locked', locked_amount: 49500 });
    const finLock = await calc(ctx.adminToken, 'lock', { kind: 'financials', ...AUG });
    expect(finLock.status).toBe(200);

    // Regularise the absent day to present after the lock.
    const reg = await authed(request(app).post(`/api/v1/attendance/${absent.id}/regularize`), ctx.adminToken).send({ status: 'present', reason: 'Was on client site' });
    expect(reg.status).toBe(200);
    const state = await authed(request(app).get('/api/v1/calculations/state'), ctx.adminToken).query({ kind: 'salary', ...AUG });
    expect(state.body.data.status).toBe('change_detected');
    expect(state.body.data.locked_amount).toBe(49500);
    expect(state.body.data.changes[0]).toMatchObject({
      source_type: 'attendance',
      previous_amount: 49500,
      potential_amount: 52250,
      difference: 2750,
      old_value: expect.objectContaining({ status: 'absent' }),
      new_value: expect.objectContaining({ status: 'present' }),
      changed_by: expect.objectContaining({ id: ctx.adminUser.id }),
    });
    // Locked month keeps serving the locked figure.
    expect((await authed(request(app).get('/api/v1/analytics/salary-attendance'), ctx.adminToken).query(AUG)).body.data).toMatchObject({ source: 'locked', totals: expect.objectContaining({ net: 49500 }) });
    const fin = await authed(request(app).get('/api/v1/calculations/state'), ctx.adminToken).query({ kind: 'financials', ...AUG });
    expect(fin.body.data.status).toBe('change_detected');

    // A payroll run processed now uses the LOCKED version, not live data.
    const run = await authed(request(app).post('/api/v1/payroll/runs'), ctx.adminToken).send(AUG);
    const processed = await authed(request(app).post(`/api/v1/payroll/runs/${run.body.data.id}/process`), ctx.adminToken);
    expect(processed.status).toBe(200);
    const slips = await prisma.payslip.findMany({ where: { payroll_run_id: run.body.data.id } });
    expect(Number(slips[0].net)).toBe(49500);

    expect((await calc(ctx.adminToken, 'recalculate', { kind: 'salary', ...AUG })).status).toBe(422); // reason required
    const v2 = await calc(ctx.adminToken, 'recalculate', { kind: 'salary', ...AUG, reason: 'Accepted client-site regularisation' });
    expect(v2.body.data).toMatchObject({ status: 'locked', current_version: 2, locked_amount: 52250 });
    await calc(ctx.adminToken, 'recalculate', { kind: 'financials', ...AUG, reason: 'Salary re-finalized' });

    const summary = await authed(request(app).get('/api/v1/calculations/financials/summary'), ctx.adminToken).query({ period_year: 2026, from_month: 8, to_month: 8 });
    expect(summary.status).toBe(200);
    const salaries = summary.body.data.categories.find((c) => c.key === 'salaries');
    expect(salaries.children.find((c) => c.key === 'it_salaries').amount).toBe(52250);
    expect(summary.body.data.months[0]).toMatchObject({ finalized: true, version: 2 });
    const recalcUpdate = summary.body.data.latest_updates.find((u) => u.type === 'recalculated');
    expect(recalcUpdate).toMatchObject({ old_amount: -49500, new_amount: -52250, reason: 'Salary re-finalized' });
    expect(summary.body.data.latest_updates.some((u) => u.type === 'change' && u.kind === 'salary' && u.status === 'accepted')).toBe(true);
  });

  test('a month still running cannot be locked', async () => {
    const ctx = await seed();
    const now = new Date();
    const res = await calc(ctx.adminToken, 'lock', { kind: 'salary', period_month: now.getUTCMonth() + 1, period_year: now.getUTCFullYear() + 1 });
    expect(res.status).toBe(422);
    expect(res.body.errors.blockers[0].code).toBe('period_open');
  });

  test('only admins lock, recalculate or reopen', async () => {
    const ctx = await seed();
    const e = await employee(ctx);
    expect((await calc(e.token, 'lock', { kind: 'salary', ...AUG })).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/calculations/state'), e.token).query({ kind: 'salary', ...AUG })).status).toBe(403);
  });
});

describe('Payroll filters', () => {
  test('employee, department and team filters combine', async () => {
    const ctx = await seed();
    const team = await prisma.team.create({ data: { org_id: ctx.org.id, name: 'Backend' } });
    const nikhil = await employee(ctx, { name: 'Nikhil' });
    await prisma.orgMembership.update({ where: { id: nikhil.membership.id }, data: { team_id: team.id } });
    const other = await employee(ctx, { name: 'Other IT' });
    const nonIt = await employee(ctx, { name: 'Ops', it: false });
    for (const m of [nikhil, other, nonIt]) {
      await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: m.membership.id, effective_from: new Date('2026-01-01'), ctc: 30000, components: { basic: 30000 }, created_by: ctx.adminUser.id } });
    }
    const q = (query) => authed(request(app).get('/api/v1/payroll/salary-structures'), ctx.adminToken).query(query);
    expect((await q({ department_id: ctx.it.id })).body.data).toHaveLength(2);
    expect((await q({ department_id: ctx.it.id, team_id: team.id })).body.data.map((s) => s.org_membership_id)).toEqual([nikhil.membership.id]);
    expect((await q({ department_id: ctx.it.id, team_id: team.id, org_membership_id: other.membership.id })).body.data).toHaveLength(0);

    const att = await authed(request(app).get('/api/v1/payroll/attendance-salary'), ctx.adminToken).query({ ...AUG, team_id: team.id });
    expect(att.body.data.lines.map((l) => l.name)).toEqual(['Nikhil']);
  });
});

describe('Group Charges, Expenses and their categories', () => {
  test('only admins manage categories; employees can read them', async () => {
    const ctx = await seed();
    const e = await employee(ctx);
    const list = await authed(request(app).get('/api/v1/finance-categories'), e.token).query({ kind: 'group_charge' });
    expect(list.status).toBe(200);
    expect(list.body.data.map((c) => c.name)).toContain('Office Rent');
    expect((await authed(request(app).post('/api/v1/finance-categories'), e.token).send({ kind: 'expense', name: 'Nope' })).status).toBe(403);
    const created = await authed(request(app).post('/api/v1/finance-categories'), ctx.adminToken).send({ kind: 'expense', name: 'Visa Fees' });
    expect(created.status).toBe(201);
    expect((await authed(request(app).post('/api/v1/finance-categories'), ctx.adminToken).send({ kind: 'expense', name: 'visa fees' })).status).toBe(409);
    const renamed = await authed(request(app).patch(`/api/v1/finance-categories/${created.body.data.id}`), ctx.adminToken).send({ name: 'Visa & Permits' });
    expect(renamed.body.data.name).toBe('Visa & Permits');
    expect((await authed(request(app).delete(`/api/v1/finance-categories/${created.body.data.id}`), ctx.adminToken)).body.data).toEqual({ deleted: true });
  });

  test('group charges filter by month and by exact payment date, category and office', async () => {
    const ctx = await seed();
    const ahmedabad = await prisma.location.create({ data: { org_id: ctx.org.id, name: 'Ahmedabad' } });
    const cats = (await authed(request(app).get('/api/v1/finance-categories'), ctx.adminToken).query({ kind: 'group_charge' })).body.data;
    const rent = cats.find((c) => c.name === 'Office Rent');
    const power = cats.find((c) => c.name === 'Electricity');
    const add = (body) => authed(request(app).post('/api/v1/billing/group-charges/mine'), ctx.adminToken).send({ amount: 1000, ...body });
    expect((await add({ payment_date: '2026-09-25', category_id: rent.id, location_id: ahmedabad.id })).status).toBe(201);
    await add({ payment_date: '2026-09-10', category_id: power.id });
    await add({ payment_date: '2026-10-25', category_id: rent.id });

    const q = (query) => authed(request(app).get('/api/v1/billing/group-charges'), ctx.adminToken).query(query);
    expect((await q({ period_month: 9, period_year: 2026 })).body.data).toHaveLength(2);
    const day = (await q({ date: '2026-09-25' })).body.data;
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({ kind: 'Office Rent', category: { id: rent.id }, location: { name: 'Ahmedabad' } });
    expect((await q({ category_id: rent.id })).body.data).toHaveLength(2);
    expect((await q({ category_id: rent.id, location_id: ahmedabad.id })).body.data).toHaveLength(1);
  });

  test('admins edit their own group charges; a charge raised by the group stays the group superadmin\'s', async () => {
    const ctx = await seed();
    const ahmedabad = await prisma.location.create({ data: { org_id: ctx.org.id, name: 'Ahmedabad' } });
    const cats = (await authed(request(app).get('/api/v1/finance-categories'), ctx.adminToken).query({ kind: 'group_charge' })).body.data;
    const rent = cats.find((c) => c.name === 'Office Rent');
    const power = cats.find((c) => c.name === 'Electricity');
    const own = (await authed(request(app).post('/api/v1/billing/group-charges/mine'), ctx.adminToken).send({ amount: 1000, payment_date: '2026-09-25', category_id: rent.id })).body.data;

    const edit = (id, body, token = ctx.adminToken) => authed(request(app).patch(`/api/v1/billing/group-charges/${id}`), token).send(body);
    const updated = await edit(own.id, { amount: 1500, currency: 'USD', payment_date: '2026-10-02', category_id: power.id, location_id: ahmedabad.id, notes: 'Oct bill' });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ amount: '1500', currency: 'USD', period_month: 10, period_year: 2026, kind: 'Electricity', location: { name: 'Ahmedabad' }, notes: 'Oct bill' });
    expect((await edit(own.id, { location_id: null, notes: null })).body.data).toMatchObject({ location_id: null, notes: null });
    expect((await edit(own.id, {})).status).toBe(422);

    const e = await employee(ctx);
    expect((await edit(own.id, { amount: 1 }, e.token)).status).toBe(403);

    const groupAdmin = await employee(ctx, { name: 'Group' });
    await prisma.user.update({ where: { id: groupAdmin.user.id }, data: { is_group_superadmin: true } });
    const raised = await prisma.groupBillingCharge.create({
      data: { org_group_id: ctx.org.org_group_id, org_id: ctx.org.id, period_month: 9, period_year: 2026, kind: 'Brand fee', amount: 5000, raised_by: groupAdmin.user.id },
    });
    const listed = (await authed(request(app).get('/api/v1/billing/group-charges'), ctx.adminToken)).body.data.find((c) => c.id === raised.id);
    expect(listed.raiser).toEqual({ is_group_superadmin: true });
    expect((await edit(raised.id, { amount: 1 })).status).toBe(403);
  });

  test('expenses filter by employee, month, category and office together', async () => {
    const ctx = await seed();
    const ahmedabad = await prisma.location.create({ data: { org_id: ctx.org.id, name: 'Ahmedabad' } });
    const indore = await prisma.location.create({ data: { org_id: ctx.org.id, name: 'Indore' } });
    const travel = (await authed(request(app).get('/api/v1/finance-categories'), ctx.adminToken).query({ kind: 'expense' })).body.data.find((c) => c.name === 'Travel');
    const radhesh = await employee(ctx, { name: 'Radhesh' });
    const other = await employee(ctx, { name: 'Other' });
    const claim = (token, body) => authed(request(app).post('/api/v1/expenses/claims'), token).send({ amount: 500, ...body });
    expect((await claim(radhesh.token, { location_id: ahmedabad.id, category_id: travel.id, expense_date: '2026-09-12' })).status).toBe(201);
    await claim(radhesh.token, { location_id: indore.id, category_id: travel.id, expense_date: '2026-09-13' });
    await claim(radhesh.token, { location_id: ahmedabad.id, category_id: travel.id, expense_date: '2026-08-13' });
    await claim(other.token, { location_id: ahmedabad.id, category: 'Travel', expense_date: '2026-09-12' });

    const res = await authed(request(app).get('/api/v1/expenses/claims'), ctx.adminToken).query({
      org_membership_id: radhesh.membership.id, period_month: 9, period_year: 2026, category_id: travel.id, location_id: ahmedabad.id,
    });
    expect(res.body.data).toHaveLength(1);
    // Category filter also matches older free-text claims with the same name.
    expect((await authed(request(app).get('/api/v1/expenses/claims'), ctx.adminToken).query({ category_id: travel.id, period_month: 9, period_year: 2026 })).body.data).toHaveLength(3);
  });
});
