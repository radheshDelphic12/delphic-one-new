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
const calendarsService = require('../src/modules/calendars/calendars.service');
const billingService = require('../src/modules/billing/billing.service');

beforeEach(async () => {
  await cleanDatabase();
});

afterEach(() => {
  process.env.FINANCE_DISABLED_MODULES = '';
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

async function seedEmployee(org, role = 'employee') {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role });
  const { access_token } = await loginAs(user);
  return { user, membership, token: access_token };
}

async function calendar(org, name, holidays = [], extra = {}) {
  const cal = await prisma.calendar.create({ data: { org_id: org.id, name, kind: 'internal', ...extra } });
  for (const [date, label] of holidays) {
    await prisma.calendarHoliday.create({ data: { calendar_id: cal.id, date: new Date(date), label } });
  }
  return cal;
}

const addProject = (token, body) => authed(request(app).post('/api/v1/calendars/projects'), token).send(body);

// An Account in the Lead stage — what a project's Client Name must point at.
async function lead(org, owner, name, extra = {}) {
  return prisma.account.create({
    data: { org_id: org.id, name, type: 'client', stage: 'lead', owner_id: owner.id, origin_owner_id: owner.id, ...extra },
  });
}

async function approvedEntry(org, membership, accountId, date, hours) {
  return prisma.timesheetEntry.create({
    data: { org_id: org.id, org_membership_id: membership.id, account_id: accountId, date: new Date(date), hours, billable: true, status: 'approved' },
  });
}

async function compute(token, from, to = from) {
  return authed(request(app).post('/api/v1/billing/daily-revenue/compute'), token).send({ date_from: from, date_to: to });
}

async function revenueFor(token, accountId) {
  const res = await authed(request(app).get(`/api/v1/billing/daily-revenue?account_id=${accountId}`), token);
  return res.body.data;
}

describe('Add Project (Calendar section) — Project <-> Calendar mapping is mandatory', () => {
  test('a project created with no calendar falls back to the Ahmedabad calendar; the list shows client name and category', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    const ahmedabad = await calendar(org, 'Ahmedabad Calendar');
    await calendar(org, 'US Client Calendar');
    const acme = await lead(org, admin, 'Acme Corp');

    const res = await addProject(token, { name: 'Tax Portal', client_account_id: acme.id, service_category: 'managed_services' });
    expect(res.status).toBe(201);
    expect(res.body.data.calendar.id).toBe(ahmedabad.id);
    expect(res.body.data.client_name).toBe('Acme Corp');
    expect(res.body.data.client_account_id).toBe(acme.id);
    expect(res.body.data.service_category).toBe('managed_services');

    // The mapping is a real row, not just a display fallback.
    expect(await prisma.projectCalendar.count({ where: { account_id: res.body.data.id } })).toBe(1);

    const list = await authed(request(app).get('/api/v1/calendars/projects'), token);
    expect(list.body.data.map((p) => p.name)).toContain('Tax Portal');
    expect(list.body.data.find((p) => p.name === 'Tax Portal').calendar_is_default).toBe(false);
  });

  test('the Ahmedabad fallback also finds an office calendar by its location', async () => {
    const { org, token } = await seedOrgAdmin();
    const location = await prisma.location.create({ data: { org_id: org.id, name: 'Ahmedabad' } });
    const office = await calendar(org, 'Ahmedabad Office', [], { location_id: location.id });
    await calendar(org, 'Indore Office');
    const res = await addProject(token, { name: 'Gaming', service_category: 'project' });
    expect(res.status).toBe(201);
    expect(res.body.data.calendar.id).toBe(office.id);
  });

  test('an explicit calendar wins; Recruitment is refused; a duplicate name is refused; a non-admin cannot add', async () => {
    const { org, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const us = await calendar(org, 'US Client Calendar');

    const explicit = await addProject(token, { name: 'TankPros', service_category: 'project', calendar_id: us.id });
    expect(explicit.status).toBe(201);
    expect(explicit.body.data.calendar.id).toBe(us.id);

    const recruitment = await addProject(token, { name: 'Hiring', service_category: 'recruitment' });
    expect(recruitment.status).toBe(422);

    const dup = await addProject(token, { name: 'tankpros', service_category: 'project' });
    expect(dup.status).toBe(409);

    const emp = await seedEmployee(org);
    expect((await addProject(emp.token, { name: 'Sneaky', service_category: 'project' })).status).toBe(403);
  });

  test('with no calendar anywhere in the org there is nothing to map to — a clear error, not a project without a calendar', async () => {
    const { token } = await seedOrgAdmin();
    const res = await addProject(token, { name: 'Orphan', service_category: 'project' });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('calendar');
    expect(await prisma.account.count({ where: { name: 'Orphan' } })).toBe(0);
  });

  test('editing the mapping switches the calendar the project follows — timesheet holidays follow it', async () => {
    const { org, token } = await seedOrgAdmin();
    const india = await calendar(org, 'Ahmedabad Calendar');
    const us = await calendar(org, 'US Client Calendar', [['2026-09-07', 'Labor Day']]);
    const emp = await seedEmployee(org);
    const project = (await addProject(token, { name: 'Tax Portal', service_category: 'managed_services' })).body.data;

    expect((await calendarsService.resolveCalendar(org.id, emp.membership.id, project.id)).id).toBe(india.id);
    expect(await calendarsService.holidayFor(org.id, emp.membership.id, project.id, new Date('2026-09-07'))).toBeNull();

    const edit = await authed(request(app).put(`/api/v1/calendars/projects/${project.id}`), token).send({ calendar_id: us.id });
    expect(edit.status).toBe(200);
    expect(edit.body.data.calendar.id).toBe(us.id);
    expect(await prisma.projectCalendar.count({ where: { account_id: project.id } })).toBe(1); // updated, not duplicated

    expect((await calendarsService.resolveCalendar(org.id, emp.membership.id, project.id)).id).toBe(us.id);
    const holiday = await calendarsService.holidayFor(org.id, emp.membership.id, project.id, new Date('2026-09-07'));
    expect(holiday.label).toBe('Labor Day');

    const emp2 = await seedEmployee(org);
    expect((await authed(request(app).put(`/api/v1/calendars/projects/${project.id}`), emp2.token).send({ calendar_id: india.id })).status).toBe(403);
  });

  test('a calendar that a project follows cannot be deleted', async () => {
    const { org, token } = await seedOrgAdmin();
    const cal = await calendar(org, 'Ahmedabad Calendar');
    await addProject(token, { name: 'Tax Portal', service_category: 'project' });
    const res = await authed(request(app).delete(`/api/v1/calendars/${cal.id}`), token);
    expect(res.status).toBe(409);
  });

  test('Project <-> Calendar and Employee <-> Project are independent: neither write touches the other table', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    const cal = await calendar(org, 'Ahmedabad Calendar');
    const other = await calendar(org, 'India Client Calendar');
    const emp = await seedEmployee(org);
    const project = (await addProject(token, { name: 'Tax Portal', service_category: 'project' })).body.data;

    // Assigning an employee (mapping 2) leaves the project's calendar alone …
    await authed(request(app).post('/api/v1/billing/cost-assignments'), token).send({ account_id: project.id, org_membership_id: emp.membership.id });
    expect(await prisma.projectMemberAssignment.count({ where: { account_id: project.id } })).toBe(1);
    expect((await prisma.projectCalendar.findUnique({ where: { account_id: project.id } })).calendar_id).toBe(cal.id);

    // … and re-mapping the calendar (mapping 1) leaves the allocations alone.
    await authed(request(app).put(`/api/v1/calendars/projects/${project.id}`), token).send({ calendar_id: other.id });
    expect(await prisma.projectMemberAssignment.count({ where: { account_id: project.id } })).toBe(1);
    expect(await prisma.employeeCalendar.count({ where: { account_id: project.id } })).toBe(0);
    expect(admin.id).toBeTruthy();
  });
});

describe('Finance → Projects profile', () => {
  test('lists Project Name, Client Name, a blank Requirement and the Billing Type; admin only', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const acme = await lead(org, admin, 'Acme Corp');
    const project = (await addProject(token, { name: 'Tax Portal', client_account_id: acme.id, service_category: 'managed_services' })).body.data;

    let list = await authed(request(app).get('/api/v1/billing/projects'), token);
    let row = list.body.data.find((p) => p.id === project.id);
    expect(row).toMatchObject({ project_name: 'Tax Portal', client_name: 'Acme Corp', requirement: '', billing_type: null });

    const patch = await authed(request(app).patch(`/api/v1/billing/projects/${project.id}`), token).send({
      billing: { rate_type: 'monthly', rate: 160000, currency: 'INR' },
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data.billing_type).toBe('monthly');
    expect(patch.body.data.rate).toBe(160000);

    list = await authed(request(app).get('/api/v1/billing/projects'), token);
    row = list.body.data.find((p) => p.id === project.id);
    expect(row.billing_type).toBe('monthly');
    expect(row.requirement).toBe('');
    expect(row.benchmark_hours).toBe(160);

    const emp = await seedEmployee(org);
    expect((await authed(request(app).get('/api/v1/billing/projects'), emp.token)).status).toBe(403);
    expect((await authed(request(app).patch(`/api/v1/billing/projects/${project.id}`), emp.token).send({ client_account_id: acme.id })).status).toBe(403);
  });

  test('changing the billing terms adds a new rate version; the profile edit rejects Recruitment', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const newClient = await lead(org, admin, 'New Client');
    const project = (await addProject(token, { name: 'Tax Portal', service_category: 'project' })).body.data;
    const url = `/api/v1/billing/projects/${project.id}`;

    await authed(request(app).patch(url), token).send({ billing: { rate_type: 'hourly', rate: 1000, effective_from: '2026-01-01' } });
    await authed(request(app).patch(url), token).send({ billing: { rate_type: 'monthly', rate: 90000, effective_from: '2026-06-01' } });
    expect(await prisma.billingRate.count({ where: { account_id: project.id } })).toBe(2);
    const profile = (await authed(request(app).get(url), token)).body.data;
    expect(profile.billing_type).toBe('monthly');

    const bad = await authed(request(app).patch(url), token).send({ service_category: 'recruitment' });
    expect(bad.status).toBe(422);
    const rename = await authed(request(app).patch(url), token).send({ project_name: 'Tax Portal 2', client_account_id: newClient.id });
    expect(rename.body.data).toMatchObject({ project_name: 'Tax Portal 2', client_name: 'New Client', client_account_id: newClient.id });
  });
});

describe('Project Client Name — a Lead account, never free text', () => {
  test('client-options lists only this org\'s Lead accounts (client or unclassified); admin only', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    await lead(org, admin, 'Lead Co');
    await lead(org, admin, 'Unclassified Lead', { type: null });
    await lead(org, admin, 'Vendor Lead', { type: 'vendor' });
    await lead(org, admin, 'Active Client', { stage: 'active' });
    const other = await seedOrgAdmin({ name: 'Other', slug: 'other' });
    await lead(other.org, other.admin, 'Other Org Lead');

    const res = await authed(request(app).get('/api/v1/calendars/projects/client-options'), token);
    expect(res.status).toBe(200);
    expect(res.body.data.map((a) => a.name)).toEqual(['Lead Co', 'Unclassified Lead']);

    const emp = await seedEmployee(org);
    expect((await authed(request(app).get('/api/v1/calendars/projects/client-options'), emp.token)).status).toBe(403);
  });

  test('create and edit refuse any account that is not a Lead of this org', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const active = await lead(org, admin, 'Active Client', { stage: 'active' });
    const vendor = await lead(org, admin, 'Vendor Lead', { type: 'vendor' });
    const other = await seedOrgAdmin({ name: 'Other', slug: 'other' });
    const foreign = await lead(other.org, other.admin, 'Other Org Lead');

    for (const bad of [active, vendor, foreign]) {
      const res = await addProject(token, { name: `P ${bad.name}`, client_account_id: bad.id, service_category: 'project' });
      expect(res.status).toBe(422);
      expect(res.body.message).toContain('Lead');
    }
    expect(await prisma.account.count({ where: { name: { startsWith: 'P ' } } })).toBe(0);

    const project = (await addProject(token, { name: 'Tax Portal', service_category: 'project' })).body.data;
    const patch = await authed(request(app).patch(`/api/v1/billing/projects/${project.id}`), token).send({ client_account_id: active.id });
    expect(patch.status).toBe(422);

    // Free text is no longer stored.
    await authed(request(app).patch(`/api/v1/billing/projects/${project.id}`), token).send({ project_name: 'Tax Portal', client_name: 'Typed Name' });
    expect((await prisma.account.findUnique({ where: { id: project.id } })).client_name).toBeNull();
  });

  test('edit pre-loads the linked lead, keeps it once it leaves the Lead stage, and can clear it', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const acme = await lead(org, admin, 'Acme Corp');
    const project = (await addProject(token, { name: 'Tax Portal', client_account_id: acme.id, service_category: 'project' })).body.data;
    const url = `/api/v1/billing/projects/${project.id}`;

    const loaded = (await authed(request(app).get(url), token)).body.data;
    expect(loaded.client_account).toMatchObject({ id: acme.id, name: 'Acme Corp', stage: 'lead' });

    // The lead converts; re-saving the unchanged client must still work.
    await prisma.account.update({ where: { id: acme.id }, data: { stage: 'active', name: 'Acme Corporation' } });
    const resave = await authed(request(app).patch(url), token).send({ project_name: 'Tax Portal', client_account_id: acme.id });
    expect(resave.status).toBe(200);
    expect(resave.body.data.client_name).toBe('Acme Corporation'); // live name of the linked account

    const cleared = await authed(request(app).patch(url), token).send({ client_account_id: null });
    expect(cleared.body.data).toMatchObject({ client_account_id: null, client_name: null });
  });

  test('legacy projects keep their free-text client name until a lead is linked', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const project = (await addProject(token, { name: 'Legacy', service_category: 'project' })).body.data;
    await prisma.account.update({ where: { id: project.id }, data: { client_name: 'Old Typed Client' } });

    const url = `/api/v1/billing/projects/${project.id}`;
    const untouched = await authed(request(app).patch(url), token).send({ benchmark_hours: 150 });
    expect(untouched.body.data).toMatchObject({ client_name: 'Old Typed Client', client_account_id: null });

    const linked = await lead(org, admin, 'Proper Lead');
    const res = await authed(request(app).patch(url), token).send({ client_account_id: linked.id });
    expect(res.body.data).toMatchObject({ client_name: 'Proper Lead', client_account_id: linked.id });
  });
});

describe('Monthly billing — 160h benchmark over the month\'s actual working days', () => {
  test('the pure formula: a full day earns rate/working-days, a shortfall earns pro-rata, the month can never exceed the rate', () => {
    const { monthlyDayRevenue } = billingService;
    const base = { rate: 32000, benchmarkHours: 160, workingDays: 20, isWorkingDay: true };
    expect(monthlyDayRevenue({ ...base, hours: 8 })).toBe(1600); // 8h = the 160/20 daily share
    expect(monthlyDayRevenue({ ...base, hours: 4 })).toBe(800); // half day, half pay
    expect(monthlyDayRevenue({ ...base, hours: 12 })).toBe(1600); // capped at the day's share
    expect(monthlyDayRevenue({ ...base, workingDays: 22, hours: 8 })).toBe(1454.55); // 22-day month: 32000/22
    expect(monthlyDayRevenue({ ...base, isWorkingDay: false, hours: 8 })).toBe(0);
  });

  test('working days are Mon–Fri less the project calendar\'s holidays', () => {
    expect(calendarsService.countWorkingDays(2026, 9)).toBe(22);
    expect(calendarsService.countWorkingDays(2026, 9, new Set(['2026-09-07']))).toBe(21);
    expect(calendarsService.countWorkingDays(2026, 9, new Set(['2026-09-12']))).toBe(22); // a Saturday holiday costs nothing
    expect(calendarsService.countWorkingDays(2026, 2)).toBe(20);
  });

  test('daily revenue uses the project calendar: a holiday changes the month\'s divisor and earns nothing itself', async () => {
    const { org, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar', [['2026-09-07', 'Labor Day']]);
    const emp = await seedEmployee(org);
    const project = (await addProject(token, { name: 'Tax Portal', service_category: 'managed_services' })).body.data;
    await authed(request(app).patch(`/api/v1/billing/projects/${project.id}`), token).send({
      billing: { rate_type: 'monthly', rate: 21000, effective_from: '2026-09-01' },
    });

    await approvedEntry(org, emp.membership, project.id, '2026-09-15', 4); // Tue
    await approvedEntry(org, emp.membership, project.id, '2026-09-16', 8); // Wed
    await approvedEntry(org, emp.membership, project.id, '2026-09-12', 8); // Sat
    await approvedEntry(org, emp.membership, project.id, '2026-09-07', 8); // the holiday
    await compute(token, '2026-09-07', '2026-09-16');

    const byDate = Object.fromEntries((await revenueFor(token, project.id)).map((r) => [r.date.slice(0, 10), Number(r.revenue)]));
    // 21 working days in Sep 2026 once Labor Day is off.
    expect(byDate['2026-09-15']).toBe(525); // 21000 × 4/160
    expect(byDate['2026-09-16']).toBe(1000); // 21000 / 21
    expect(byDate['2026-09-12']).toBe(0);
    expect(byDate['2026-09-07']).toBe(0);
  });

  test('hourly billing is exactly logged hours × hourly rate', async () => {
    const { org, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const emp = await seedEmployee(org);
    const project = (await addProject(token, { name: 'Gaming', service_category: 'project' })).body.data;
    await authed(request(app).patch(`/api/v1/billing/projects/${project.id}`), token).send({
      billing: { rate_type: 'hourly', rate: 750, effective_from: '2026-09-01' },
    });
    await approvedEntry(org, emp.membership, project.id, '2026-09-15', 5.5);
    await compute(token, '2026-09-15');
    expect(Number((await revenueFor(token, project.id))[0].revenue)).toBe(4125);
  });
});

describe('Agreement Start Date — billing applies only from that date', () => {
  test('hours before the start are not billed, an earlier period cannot be invoiced, and the first invoice starts at the agreement date', async () => {
    const { org, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const emp = await seedEmployee(org);
    const project = (await addProject(token, { name: 'Tax Portal', service_category: 'project' })).body.data;
    const url = `/api/v1/billing/projects/${project.id}`;
    await authed(request(app).patch(url), token).send({ billing: { rate_type: 'hourly', rate: 1000, effective_from: '2026-08-01' } });

    await approvedEntry(org, emp.membership, project.id, '2026-09-05', 8);
    await approvedEntry(org, emp.membership, project.id, '2026-09-15', 6);
    await compute(token, '2026-09-05'); // billed while no agreement date is set …
    expect(await revenueFor(token, project.id)).toHaveLength(1);

    // … then the agreement date is set: recomputing drops the pre-agreement day.
    const set = await authed(request(app).patch(url), token).send({ agreement_start_date: '2026-09-10' });
    expect(set.body.data.agreement_start_date).toBe('2026-09-10');
    const before = await compute(token, '2026-09-05');
    expect(before.body.data.skipped[0].reason).toBe('before_agreement_start');
    await compute(token, '2026-09-15');
    const rows = await revenueFor(token, project.id);
    expect(rows.map((r) => r.date.slice(0, 10))).toEqual(['2026-09-15']);

    const august = await authed(request(app).post('/api/v1/billing/invoices'), token).send({ client_account_id: project.id, period_month: 8, period_year: 2026 });
    expect(august.status).toBe(422);
    expect(august.body.message).toContain('Agreement Start Date');

    const september = await authed(request(app).post('/api/v1/billing/invoices'), token).send({ client_account_id: project.id, period_month: 9, period_year: 2026 });
    expect(september.status).toBe(201);
    expect(Number(september.body.data.amount)).toBe(6000);
  });

  test('the agreement date can be cleared again', async () => {
    const { org, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const project = (await addProject(token, { name: 'Tax Portal', service_category: 'project' })).body.data;
    const url = `/api/v1/billing/projects/${project.id}`;
    await authed(request(app).patch(url), token).send({ agreement_start_date: '2026-09-10' });
    const cleared = await authed(request(app).patch(url), token).send({ agreement_start_date: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.agreement_start_date).toBeNull();
    expect(org.id).toBeTruthy();
  });

  test('a project takes several agreement attachments', async () => {
    const { org, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const project = (await addProject(token, { name: 'Tax Portal', service_category: 'project' })).body.data;
    for (const name of ['msa.pdf', 'sow.pdf', 'nda.docx']) {
      const res = await authed(request(app).post('/api/v1/documents'), token)
        .field('entity_type', 'account')
        .field('entity_id', project.id)
        .field('label', 'Client Agreement')
        .attach('file', Buffer.from('agreement'), name);
      expect(res.status).toBe(201);
    }
    const list = await authed(request(app).get(`/api/v1/documents?entity_type=account&entity_id=${project.id}`), token);
    expect(list.body.data).toHaveLength(3);
    expect(org.id).toBeTruthy();
  });
});

describe('Finance scope reduction', () => {
  test('Vendor Payments, External Access, Vendor Ledger and Accounting are refused by the API; expenses and billing are not', async () => {
    const { org, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    process.env.FINANCE_DISABLED_MODULES = 'vendor_payments,external_access,vendor_ledger,accounting';

    for (const path of ['/api/v1/accounting/ledger-accounts', '/api/v1/expenses/vendor-payments', '/api/v1/vendor-commissions', '/api/v1/external-access']) {
      const res = await authed(request(app).get(path), token);
      expect(res.status).toBe(404);
      expect(res.body.message).toContain('temporarily disabled');
    }
    expect((await authed(request(app).get('/api/v1/expenses/claims'), token)).status).toBe(200);
    expect((await authed(request(app).get('/api/v1/billing/projects'), token)).status).toBe(200);
  });

  test('clearing the switch turns a section back on — nothing was removed', async () => {
    const { token } = await seedOrgAdmin();
    process.env.FINANCE_DISABLED_MODULES = '';
    expect((await authed(request(app).get('/api/v1/accounting/ledger-accounts'), token)).status).toBe(200);
    process.env.FINANCE_DISABLED_MODULES = 'accounting';
    expect((await authed(request(app).get('/api/v1/accounting/ledger-accounts'), token)).status).toBe(404);
    expect((await authed(request(app).get('/api/v1/vendor-commissions'), token)).status).not.toBe(404);
  });

  test('with the variable unset, all four are off by default', () => {
    const saved = process.env.FINANCE_DISABLED_MODULES;
    delete process.env.FINANCE_DISABLED_MODULES;
    try {
      const { disabledFinanceModules } = require('../src/middleware/financeScope');
      expect(Array.from(disabledFinanceModules()).sort()).toEqual(['accounting', 'external_access', 'vendor_ledger', 'vendor_payments']);
    } finally {
      process.env.FINANCE_DISABLED_MODULES = saved;
    }
  });
});

describe('Project resources — company employees only for now, schema ready for the rest', () => {
  test('the API only accepts company_employee; the column already holds contractor / vendor_resource', async () => {
    const { org, admin, token } = await seedOrgAdmin();
    await calendar(org, 'Ahmedabad Calendar');
    const emp = await seedEmployee(org);
    const project = (await addProject(token, { name: 'Tax Portal', service_category: 'project' })).body.data;

    const contractor = await authed(request(app).post('/api/v1/billing/cost-assignments'), token).send({
      account_id: project.id, org_membership_id: emp.membership.id, resource_type: 'contractor',
    });
    expect(contractor.status).toBe(422);

    const ok = await authed(request(app).post('/api/v1/billing/cost-assignments'), token).send({ account_id: project.id, org_membership_id: emp.membership.id });
    expect(ok.status).toBe(201);
    expect(ok.body.data.resource_type).toBe('company_employee');

    // The schema is ready: a later release only has to open the API/UI up.
    const second = await seedEmployee(org);
    const stored = await prisma.projectMemberAssignment.create({
      data: { org_id: org.id, account_id: project.id, org_membership_id: second.membership.id, resource_type: 'vendor_resource', created_by: admin.id },
    });
    expect(stored.resource_type).toBe('vendor_resource');
  });
});

describe('Holiday calendar export', () => {
  test('a calendar\'s holidays download as an Excel file, sorted by date; another org cannot pull it', async () => {
    const ExcelJS = require('exceljs');
    const { org, token } = await seedOrgAdmin();
    const cal = await calendar(org, 'Ahmedabad Calendar', [['2026-10-02', 'Gandhi Jayanti'], ['2026-01-26', 'Republic Day']]);

    const res = await authed(request(app).get(`/api/v1/calendars/${cal.id}/holidays/export`), token)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    const rows = workbook.getWorksheet('Holidays').getSheetValues().slice(2);
    expect(rows.map((r) => [r[1], r[3]])).toEqual([['2026-01-26', 'Republic Day'], ['2026-10-02', 'Gandhi Jayanti']]);

    const other = await seedOrgAdmin({});
    expect((await authed(request(app).get(`/api/v1/calendars/${cal.id}/holidays/export`), other.token)).status).toBe(404);
  });
});
