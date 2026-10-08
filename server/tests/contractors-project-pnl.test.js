// People → contractors (vendor + vendor rate, restricted portal), Time &
// Attendance → the employee's own holiday calendars, and Finance → monthly
// project P&L with vendor invoices.
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

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedOrg() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const adminUser = await createUser({ role: 'admin' });
  const adminMembership = await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const vendor = await prisma.account.create({
    data: { type: 'vendor', name: unique('Vendor '), stage: 'active', owner_id: adminUser.id, org_id: org.id },
  });
  return { org, adminUser, adminMembership, adminToken, vendor };
}

async function createContractor(ctx, overrides = {}) {
  const email = `${unique('personal')}@gmail.com`;
  const res = await authed(request(app).post('/api/v1/users'), ctx.adminToken).send({
    name: 'Casey Contractor',
    email,
    password: 'Password123!',
    role: 'recruiter',
    worker_type: 'contractor',
    vendor_account_id: ctx.vendor.id,
    vendor_rate: 40000,
    ...overrides,
  });
  return { res, email };
}

describe('People — contractor user type', () => {
  test('admin creates a contractor linked to a vendor; role is forced to employee and the vendor shows on the membership', async () => {
    const ctx = await seedOrg();
    const { res } = await createContractor(ctx);
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('employee');

    const membership = await prisma.orgMembership.findFirst({ where: { person_id: res.body.data.id, org_id: ctx.org.id } });
    expect(membership).toMatchObject({ worker_type: 'contractor', vendor_account_id: ctx.vendor.id, role: 'employee' });
    expect(Number(membership.vendor_rate)).toBe(40000);

    const detail = await authed(request(app).get(`/api/v1/orgs/memberships/${membership.id}`), ctx.adminToken);
    expect(detail.body.data.vendor_account).toEqual({ id: ctx.vendor.id, name: ctx.vendor.name });
  });

  test('a contractor needs a vendor and a rate, and the vendor must be a vendor account of this org', async () => {
    const ctx = await seedOrg();
    expect((await createContractor(ctx, { vendor_account_id: null })).res.status).toBe(422);
    expect((await createContractor(ctx, { vendor_rate: null })).res.status).toBe(422);

    const otherOrg = await createOrg({ is_master_workspace: false });
    const foreignVendor = await prisma.account.create({
      data: { type: 'vendor', name: unique('Foreign '), stage: 'active', owner_id: ctx.adminUser.id, org_id: otherOrg.id },
    });
    expect((await createContractor(ctx, { vendor_account_id: foreignVendor.id })).res.status).toBe(404);
  });

  test('switching a member back to full-time clears the vendor fields', async () => {
    const ctx = await seedOrg();
    const { res } = await createContractor(ctx);
    const membership = await prisma.orgMembership.findFirst({ where: { person_id: res.body.data.id } });
    const patched = await authed(request(app).patch(`/api/v1/orgs/memberships/${membership.id}`), ctx.adminToken).send({ worker_type: 'full_time_employee' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ worker_type: 'full_time_employee', vendor_account: null, vendor_rate: null });
  });

  test('a contractor logs in with a personal email and only reaches the contractor portal', async () => {
    const ctx = await seedOrg();
    const { email } = await createContractor(ctx);
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123!' });
    expect(login.status).toBe(200);
    expect(login.body.data.memberships[0].worker_type).toBe('contractor');
    const token = login.body.data.access_token;

    for (const route of ['/api/v1/users/me', '/api/v1/calendars/me', '/api/v1/timesheets/my-projects', '/api/v1/timesheets/entries/me']) {
      const res = await authed(request(app).get(route), token);
      expect({ route, status: res.status }).toEqual({ route, status: 200 });
    }
    for (const route of ['/api/v1/users', '/api/v1/attendance/records/me', '/api/v1/expenses/claims/me', '/api/v1/payroll/payslips/me', '/api/v1/departments', '/api/v1/calendars', '/api/v1/org-chart']) {
      const res = await authed(request(app).get(route), token);
      expect({ route, status: res.status }).toEqual({ route, status: 403 });
    }
  });
});

describe('Time & Attendance — the employee sees their own calendars', () => {
  test('standard calendar comes from the department; an assigned project shows its client calendar', async () => {
    const ctx = await seedOrg();
    const department = await prisma.department.create({ data: { name: 'Operations', org_id: ctx.org.id } });
    const orgDefault = await prisma.calendar.create({ data: { org_id: ctx.org.id, name: 'Ahmedabad', is_default: true } });
    const deptCalendar = await prisma.calendar.create({ data: { org_id: ctx.org.id, name: 'Ops Standard', department_id: department.id } });
    const clientCalendar = await prisma.calendar.create({ data: { org_id: ctx.org.id, name: 'US Client', kind: 'client' } });
    await prisma.calendarHoliday.createMany({
      data: [
        { calendar_id: orgDefault.id, date: new Date('2026-10-20'), label: 'Diwali (default)' },
        { calendar_id: deptCalendar.id, date: new Date('2026-10-02'), label: 'Gandhi Jayanti' },
        { calendar_id: clientCalendar.id, date: new Date('2026-11-26'), label: 'Thanksgiving' },
      ],
    });

    const employee = await createUser({ role: 'employee' });
    const membership = await createOrgMembership(employee.id, ctx.org.id, { role: 'employee', department_id: department.id });
    const project = await prisma.account.create({
      data: { type: 'client', name: 'Circle', stage: 'active', owner_id: ctx.adminUser.id, org_id: ctx.org.id, client_name: 'XYZ' },
    });
    await prisma.projectCalendar.create({ data: { org_id: ctx.org.id, account_id: project.id, calendar_id: clientCalendar.id } });
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: project.id, org_membership_id: membership.id, created_by: ctx.adminUser.id } });

    const token = (await loginAs(employee)).access_token;
    const res = await authed(request(app).get('/api/v1/calendars/me?year=2026'), token);
    expect(res.status).toBe(200);
    expect(res.body.data.standard_calendar).toMatchObject({ id: deptCalendar.id, name: 'Ops Standard' });
    expect(res.body.data.standard_calendar.holidays.map((h) => h.label)).toEqual(['Gandhi Jayanti']);
    expect(res.body.data.projects).toHaveLength(1);
    expect(res.body.data.projects[0]).toMatchObject({ id: project.id, name: 'Circle', client_name: 'XYZ' });
    expect(res.body.data.projects[0].calendar).toMatchObject({ id: clientCalendar.id, kind: 'client' });
    expect(res.body.data.projects[0].calendar.holidays.map((h) => h.label)).toEqual(['Thanksgiving']);
  });
});

describe('Finance — monthly project P&L with vendor contractors', () => {
  async function seedCircle() {
    const ctx = await seedOrg();
    const project = await prisma.account.create({
      data: {
        type: 'client', name: 'Circle', stage: 'active', owner_id: ctx.adminUser.id, org_id: ctx.org.id,
        client_name: 'XYZ', service_category: 'managed_services', agreement_start_date: new Date('2026-09-01'),
      },
    });
    await prisma.billingRate.create({
      data: { org_id: ctx.org.id, account_id: project.id, rate_type: 'monthly', rate: 190000, effective_from: new Date('2026-09-01'), created_by: ctx.adminUser.id },
    });

    const dev = await createUser({ role: 'employee' });
    const devMembership = await createOrgMembership(dev.id, ctx.org.id, { role: 'employee' });
    await prisma.salaryStructure.create({
      data: { org_id: ctx.org.id, org_membership_id: devMembership.id, effective_from: new Date('2026-01-01'), ctc: 100000, components: {}, created_by: ctx.adminUser.id },
    });

    const { res } = await createContractor(ctx);
    const contractorMembership = await prisma.orgMembership.findFirst({ where: { person_id: res.body.data.id } });

    const assign = (org_membership_id, extra = {}) => authed(request(app).post('/api/v1/billing/cost-assignments'), ctx.adminToken)
      .send({ account_id: project.id, org_membership_id, ...extra });
    expect((await assign(devMembership.id, { allocation_percent: 50 })).status).toBe(201);
    const contractorAssign = await assign(contractorMembership.id);
    expect(contractorAssign.body.data.resource_type).toBe('contractor');
    return { ...ctx, project };
  }

  test('profit = monthly billing - (salary allocation + contractor vendor rate)', async () => {
    const { adminToken, project } = await seedCircle();
    const res = await authed(request(app).get(`/api/v1/billing/projects/${project.id}/pnl?period_month=9&period_year=2026`), adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.revenue).toMatchObject({ amount: 190000, billing_type: 'monthly' });
    expect(res.body.data.internal.cost).toBe(50000);
    expect(res.body.data.vendor.cost).toBe(40000);
    expect(res.body.data.vendor.vendors[0].basis).toBe('vendor_rate');
    expect(res.body.data.profit).toBe(100000);
    expect(res.body.data.margin_percent).toBe(52.63);
  });

  test('a vendor invoice for the month replaces that vendor\'s rate estimate', async () => {
    const { adminToken, project, vendor } = await seedCircle();
    const created = await authed(request(app).post(`/api/v1/billing/projects/${project.id}/vendor-invoices`), adminToken)
      .send({ vendor_account_id: vendor.id, period_month: 9, period_year: 2026, invoice_number: 'INV-9', amount: 45000 });
    expect(created.status).toBe(201);

    const res = await authed(request(app).get(`/api/v1/billing/projects/${project.id}/pnl?period_month=9&period_year=2026`), adminToken);
    expect(res.body.data.vendor.cost).toBe(45000);
    expect(res.body.data.vendor.vendors[0]).toMatchObject({ basis: 'invoice', invoiced_amount: 45000, estimated_cost: 40000 });
    expect(res.body.data.profit).toBe(95000);

    const summary = await authed(request(app).get('/api/v1/billing/projects-pnl?period_month=9&period_year=2026'), adminToken);
    expect(summary.status).toBe(200);
    expect(summary.body.data.find((r) => r.project.id === project.id)).toMatchObject({ revenue: 190000, internal_cost: 50000, vendor_cost: 45000, profit: 95000 });

    const removed = await authed(request(app).delete(`/api/v1/billing/vendor-invoices/${created.body.data.id}`), adminToken);
    expect(removed.status).toBe(200);
  });

  test('nothing is billed before the agreement starts', async () => {
    const { adminToken, project } = await seedCircle();
    const res = await authed(request(app).get(`/api/v1/billing/projects/${project.id}/pnl?period_month=8&period_year=2026`), adminToken);
    expect(res.body.data.revenue).toMatchObject({ amount: 0, note: 'before_agreement_start' });
  });

  test('payroll never pays a contractor', async () => {
    const ctx = await seedOrg();
    const { res } = await createContractor(ctx);
    const contractorMembership = await prisma.orgMembership.findFirst({ where: { person_id: res.body.data.id } });
    // Employed in the run's month (Sep 2026), so payroll sees and skips them.
    await prisma.orgMembership.update({ where: { id: contractorMembership.id }, data: { joined_at: new Date('2026-01-01') } });
    await prisma.salaryStructure.create({
      data: { org_id: ctx.org.id, org_membership_id: contractorMembership.id, effective_from: new Date('2026-01-01'), ctc: 50000, components: {}, created_by: ctx.adminUser.id },
    });
    const run = await prisma.payrollRun.create({ data: { org_id: ctx.org.id, period_month: 9, period_year: 2026 } });
    const payroll = require('../src/modules/payroll/payroll.service');
    const result = await payroll.processRun(ctx.org.id, run.id, ctx.adminUser.id);
    expect(result.skipped).toEqual(expect.arrayContaining([{ org_membership_id: contractorMembership.id, reason: 'contractor_paid_by_vendor' }]));
    expect(await prisma.payslip.count({ where: { org_membership_id: contractorMembership.id } })).toBe(0);
  });
});
