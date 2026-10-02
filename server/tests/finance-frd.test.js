// FRD billing + finance slice: per-resource billing (monthly for one, hourly for another, same month) with
// client billing statuses, Live Analytics invoice filters, the Finance month-wise project view, the Sales and
// Salary exports, salary adjustments (TDS / OT adjustment / variable pay / reimbursement) and vendor tracking.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const AUG = { period_month: 8, period_year: 2026 }; // 21 Mon-Fri days, fully in the past
const api = (path) => `/api/v1${path}`;

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const it = await prisma.department.create({ data: { name: 'IT', org_id: org.id } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Calendar', is_default: true } });
  const vendor = await prisma.account.create({ data: { type: 'vendor', name: unique('Vendor '), stage: 'active', owner_id: adminUser.id, org_id: org.id } });
  const client = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: adminUser.id, org_id: org.id, industry: 'IT' } });
  return { org, it, adminUser, adminToken, vendor, client };
}

async function employee(ctx, name) {
  const user = await createUser({ role: 'employee', name });
  const membership = await createOrgMembership(user.id, ctx.org.id, { role: 'employee', joined_at: new Date('2026-01-01') });
  return { user, membership };
}

async function addProject(ctx, name, { rate = 1000, rate_type = 'hourly' } = {}) {
  const res = await authed(request(app).post(api('/calendars/projects')), ctx.adminToken).send({ name, service_category: 'managed_services', client_account_id: ctx.client.id });
  expect(res.status).toBe(201);
  const patch = await authed(request(app).patch(api(`/billing/projects/${res.body.data.id}`)), ctx.adminToken).send({
    agreement_start_date: '2026-01-01',
    overtime_billable: false,
    billing: { rate_type, rate, currency: 'INR' },
  });
  expect(patch.status).toBe(200);
  return patch.body.data;
}

function weekdays({ period_month, period_year }) {
  const out = [];
  const days = new Date(Date.UTC(period_year, period_month, 0)).getUTCDate();
  for (let d = 1; d <= days; d += 1) {
    const day = new Date(Date.UTC(period_year, period_month - 1, d));
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

const approved = (ctx, membershipId, accountId, dates, hours = 8) =>
  prisma.timesheetEntry.createMany({
    data: dates.map((date) => ({ org_id: ctx.org.id, org_membership_id: membershipId, account_id: accountId, date: new Date(date), hours, status: 'approved', approved_by: ctx.adminUser.id, approved_at: new Date() })),
  });

const rate = (ctx, body) => authed(request(app).post(api('/billing/resource-rates')), ctx.adminToken).send({ effective_from: '2026-01-01', ...body });
const billing = (ctx, query = {}) => authed(request(app).get(api('/analytics/billing')), ctx.adminToken).query({ ...AUG, ...query });

describe('Billing per resource - monthly for one, hourly for another, in the same month', () => {
  test('each resource is billed by its own rate type; the project shows as mixed', async () => {
    const ctx = await seed();
    const project = await addProject(ctx, 'Mixed Co', { rate: 1000, rate_type: 'hourly' });
    const a = await employee(ctx, 'Dev A'); // monthly 105000 (21 working days = 5000 a day)
    const b = await employee(ctx, 'Dev B'); // hourly 500
    const c = await employee(ctx, 'Dev C'); // the project's own hourly 1000
    const days = weekdays(AUG);
    await approved(ctx, a.membership.id, project.id, days); // 21 days x 8h
    await approved(ctx, b.membership.id, project.id, days.slice(0, 10)); // 80h
    await approved(ctx, c.membership.id, project.id, days.slice(0, 5)); // 40h
    expect((await rate(ctx, { account_id: project.id, org_membership_id: a.membership.id, rate_type: 'monthly', rate: 105000 })).status).toBe(201);
    expect((await rate(ctx, { account_id: project.id, org_membership_id: b.membership.id, rate_type: 'hourly', rate: 500 })).status).toBe(201);

    const res = await billing(ctx);
    expect(res.status).toBe(200);
    const row = res.body.data.projects.find((p) => p.project.id === project.id);
    const byName = Object.fromEntries(row.resources.map((r) => [r.name, r]));
    expect(byName['Dev A']).toMatchObject({ rate_type: 'monthly', amount: 105000 });
    expect(byName['Dev B']).toMatchObject({ rate_type: 'hourly', amount: 40000 });
    expect(byName['Dev C'].amount).toBe(40000); // the project's own rate
    expect(row.amount).toBe(185000);
    expect(row.resource_rates.map((r) => r.rate_type).sort()).toEqual(['hourly', 'monthly']);

    // Billing type filter: mixed shows it, hourly / monthly do not.
    expect((await billing(ctx, { billing_type: 'mixed' })).body.data.projects).toHaveLength(1);
    expect((await billing(ctx, { billing_type: 'monthly' })).body.data.projects).toHaveLength(0);

    // The resource rate is admin-editable and audited.
    const rates = (await authed(request(app).get(api('/billing/resource-rates')), ctx.adminToken).query({ account_id: project.id })).body.data;
    expect(rates).toHaveLength(2);
    expect(await prisma.auditLog.count({ where: { action: 'resource_billing_rate_create' } })).toBe(2);
    expect((await authed(request(app).delete(api(`/billing/resource-rates/${rates[0].id}`)), ctx.adminToken).send({ reason: 'Wrong rate' })).status).toBe(200);
  });

  test('monthly billing follows the client billing status: present, PL, NPL, comp off, first half, half day; the rules are editable', async () => {
    const ctx = await seed();
    const project = await addProject(ctx, 'Statuses Co');
    const a = await employee(ctx, 'Dev A');
    await rate(ctx, { account_id: project.id, org_membership_id: a.membership.id, rate_type: 'monthly', rate: 105000 }); // 5000 a working day
    const days = weekdays(AUG);
    const m = a.membership.id;
    const attend = (date, status) => prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: m, date: new Date(date), status, source: 'manual' } });
    for (const d of days.slice(0, 10)) await attend(d, 'present'); // 10 present
    const type = async (name, paid) => prisma.leaveType.create({ data: { org_id: ctx.org.id, name, paid, annual_quota: 20 } });
    const pl = await type('Casual Leave', true);
    const npl = await type('Unpaid Leave', false);
    const co = await type('Comp Off', true);
    const leave = (typeId, date, extra = {}) => prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: m, leave_type_id: typeId, from_date: new Date(date), to_date: new Date(date), status: 'approved', ...extra } });
    await leave(pl.id, days[10]);
    await leave(pl.id, days[11]); // 2 PL
    await leave(npl.id, days[12]);
    await leave(npl.id, days[13]); // 2 NPL
    await leave(co.id, days[14]); // comp off
    await leave(pl.id, days[15], { is_half_day: true, half_day_session: 'FIRST_HALF' }); // first half
    await attend(days[16], 'half_day'); // half day
    // days[17..20]: no attendance, no leave -> absent

    // Present 10 + PL 2 + comp off 1 + FH 0.5 + half day 0.5 = 14 days x 5000.
    let row = (await billing(ctx)).body.data.projects.find((p) => p.project.id === project.id);
    let resource = row.resources.find((r) => r.name === 'Dev A');
    expect(resource.amount).toBe(70000);
    expect(resource.status_days).toMatchObject({ present: 10, pl: 2, npl: 2, comp_off: 1, first_half: 1, half_day: 1, absent: 4 });

    // The client's rules are their own configuration: paid leave billed at half.
    const rules = await authed(request(app).put(api(`/billing/projects/${project.id}/billing-rules`)), ctx.adminToken).send({ rules: { pl: 0.5 }, reason: 'Contract says PL is half billable' });
    expect(rules.status).toBe(200);
    expect(rules.body.data.rules).toMatchObject({ pl: 0.5, npl: 0 });
    row = (await billing(ctx)).body.data.projects.find((p) => p.project.id === project.id);
    expect(row.resources.find((r) => r.name === 'Dev A').amount).toBe(65000); // 13 days
    expect(await prisma.auditLog.count({ where: { action: 'billing_leave_rules_set' } })).toBe(1);
  });
});

describe('Live Analytics invoice filters and the Finance month-wise project view', () => {
  async function twoProjects() {
    const ctx = await seed();
    const a = await addProject(ctx, 'Invoiced Co');
    const b = await addProject(ctx, 'Not Invoiced Co');
    const dev = await employee(ctx, 'Dev');
    const days = weekdays(AUG);
    await approved(ctx, dev.membership.id, a.id, days.slice(0, 3));
    await approved(ctx, dev.membership.id, b.id, days.slice(3, 6));
    const invoice = (status, extra = {}) => prisma.clientInvoice.upsert({
      where: { client_account_id_period_month_period_year: { client_account_id: a.id, ...AUG.period_month ? { period_month: 8, period_year: 2026 } : {} } },
      create: { org_id: ctx.org.id, client_account_id: a.id, period_month: 8, period_year: 2026, amount: 24000, currency: 'INR', status, line_items: {}, invoice_number: 'INV-2026-001', invoice_date: new Date('2026-09-01'), created_by: ctx.adminUser.id, ...extra },
      update: { status, ...extra },
    });
    return { ctx, a, b, invoice };
  }
  const names = (res) => res.body.data.projects.map((p) => p.project.name).sort();

  test('invoice generated / not generated / sent / unsent / paid / unpaid filters', async () => {
    const { ctx, invoice } = await twoProjects();
    expect(names(await billing(ctx, { invoice_status: 'not_generated' }))).toEqual(['Invoiced Co', 'Not Invoiced Co']);
    await invoice('draft');
    expect(names(await billing(ctx, { invoice_status: 'generated' }))).toEqual(['Invoiced Co']);
    expect(names(await billing(ctx, { invoice_status: 'not_generated' }))).toEqual(['Not Invoiced Co']);
    expect(names(await billing(ctx, { invoice_status: 'unsent' }))).toEqual(['Invoiced Co']);
    expect(names(await billing(ctx, { invoice_status: 'sent' }))).toEqual([]);

    await invoice('sent', { sent_at: new Date() });
    expect(names(await billing(ctx, { invoice_status: 'sent' }))).toEqual(['Invoiced Co']);
    expect(names(await billing(ctx, { invoice_status: 'unsent' }))).toEqual([]);
    expect(names(await billing(ctx, { invoice_status: 'unpaid' }))).toEqual(['Invoiced Co']);
    expect(names(await billing(ctx, { invoice_status: 'paid' }))).toEqual([]);

    await invoice('paid', { paid_at: new Date() });
    expect(names(await billing(ctx, { invoice_status: 'paid' }))).toEqual(['Invoiced Co']);
    expect(names(await billing(ctx, { invoice_status: 'unpaid' }))).toEqual([]);

    // The summary tells Finance what still needs doing.
    const all = (await billing(ctx)).body.data;
    expect(all.totals.invoice_summary).toMatchObject({ projects: 2, not_generated: 1, generated: 1, paid: 1, unpaid: 0 });
    expect(all.projects.find((p) => p.project.name === 'Invoiced Co').invoice).toMatchObject({ generated: true, status: 'paid', number: 'INV-2026-001' });
  });

  test('the month view lists running projects with resources, hours, billing, invoice, payment and financial status', async () => {
    const { ctx, a, invoice } = await twoProjects();
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: a.id, org_membership_id: (await prisma.orgMembership.findFirst({ where: { org_id: ctx.org.id, role: 'employee' } })).id, created_by: ctx.adminUser.id } });
    await invoice('sent', { sent_at: new Date() });
    const res = await authed(request(app).get(api('/calculations/finance/month-projects')), ctx.adminToken).query(AUG);
    expect(res.status).toBe(200);
    const view = res.body.data;
    expect(view.label).toBe('August 2026');
    const inv = view.projects.find((p) => p.project === 'Invoiced Co');
    expect(inv).toMatchObject({ client: expect.any(String), billing_type: 'hourly', assigned_resources: ['Dev'], approved_hours: 24, billing_amount: 24000, payment_status: 'unpaid' });
    expect(inv.invoice).toMatchObject({ generated: true, sent: true, paid: false });
    expect(inv.financial_status).toMatchObject({ calculation: 'draft', financial: 'open' });
    expect(inv.attention).toEqual(['payment_pending']);
    const other = view.projects.find((p) => p.project === 'Not Invoiced Co');
    expect(other.payment_status).toBe('no_invoice');
    expect(other.attention).toContain('invoice_not_generated');
    expect(view.totals).toMatchObject({ projects: 2, not_generated: 1 });
  });
});

describe('Sales and Salary Excel exports, salary adjustments', () => {
  test('the sales export lists month, project, client, resource, billing type, amount, invoice and payment; month filtered', async () => {
    const ctx = await seed();
    const project = await addProject(ctx, 'Export Co');
    const dev = await employee(ctx, 'Dev');
    await approved(ctx, dev.membership.id, project.id, weekdays(AUG).slice(0, 4));
    await prisma.clientInvoice.create({ data: { org_id: ctx.org.id, client_account_id: project.id, period_month: 8, period_year: 2026, amount: 32000, currency: 'INR', status: 'sent', sent_at: new Date(), line_items: {}, invoice_number: 'INV-9', invoice_date: new Date('2026-09-02'), created_by: ctx.adminUser.id } });

    const json = await authed(request(app).get(api('/calculations/export/sales')), ctx.adminToken).query({ ...AUG, format: 'json' });
    expect(json.status).toBe(200);
    expect(json.body.data).toHaveLength(1);
    expect(json.body.data[0]).toMatchObject({ month: 'August 2026', project: 'Export Co', resource: 'Dev', billing_type: 'hourly', billing_amount: 32000, invoice_number: 'INV-9', invoice_status: 'sent', sent_status: 'sent', payment_status: 'unpaid' });
    // Another month has nothing.
    expect((await authed(request(app).get(api('/calculations/export/sales')), ctx.adminToken).query({ period_month: 7, period_year: 2026, format: 'json' })).body.data).toHaveLength(0);

    const xlsx = await authed(request(app).get(api('/calculations/export/sales')), ctx.adminToken).query(AUG).buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toContain('sales-2026-08.xlsx');
    expect(xlsx.body.length).toBeGreaterThan(1000);
    expect(xlsx.body.slice(0, 2).toString()).toBe('PK'); // a real xlsx (zip)
  });

  test('salary adjustments change the payable salary, show per component in the export, and flag a locked month', async () => {
    const ctx = await seed();
    const emp = await employee(ctx, 'Salaried');
    await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, effective_from: new Date('2026-01-01'), ctc: 42000, components: { basic: 42000 }, created_by: ctx.adminUser.id } });
    const exportRow = async () => (await authed(request(app).get(api('/calculations/export/salary')), ctx.adminToken).query({ ...AUG, format: 'json' })).body.data.find((r) => r.employee === 'Salaried');

    const before = await exportRow();
    expect(before).toMatchObject({ tds: 0, variable_pay: 0, reimbursements: 0 });
    expect(before.final_payable).toBe(before.salary);

    const add = (kind, amount, note) => authed(request(app).post(api('/payroll/adjustments')), ctx.adminToken).send({ org_membership_id: emp.membership.id, ...AUG, kind, amount, note });
    expect((await add('tds', 2000, 'TDS Q2')).status).toBe(201);
    expect((await add('variable_pay', 5000)).status).toBe(201);
    expect((await add('reimbursement', 1500)).status).toBe(201);
    expect((await add('ot_adjustment', 1000)).status).toBe(201);

    const after = await exportRow();
    expect(after).toMatchObject({ tds: 2000, variable_pay: 5000, reimbursements: 1500, salary: before.salary });
    expect(after.ot).toBe(before.ot + 1000);
    expect(after.final_payable).toBe(before.salary + 5000 + 1500 + 1000 - 2000);

    // Lock the employee's month, then change an adjustment: the locked figure stays and the change is flagged.
    expect((await authed(request(app).post(api('/calculations/lock')), ctx.adminToken).send({ kind: 'salary_employee', scope_key: emp.membership.id, ...AUG })).status).toBe(200);
    const list = (await authed(request(app).get(api('/payroll/adjustments')), ctx.adminToken).query({ ...AUG, org_membership_id: emp.membership.id })).body.data;
    expect(list).toHaveLength(4);
    const edit = await authed(request(app).patch(api(`/payroll/adjustments/${list[0].id}`)), ctx.adminToken).send({ amount: 2500 });
    expect(edit.status).toBe(200);
    const state = await authed(request(app).get(api('/calculations/state')), ctx.adminToken).query({ kind: 'salary_employee', scope_key: emp.membership.id, ...AUG });
    expect(state.body.data.status).toBe('change_detected');
    expect(await prisma.auditLog.count({ where: { action: 'salary_adjustment_edit' } })).toBe(1);
    expect((await authed(request(app).post(api('/payroll/adjustments')), emp.user && (await loginAs(emp.user)).access_token).send({ org_membership_id: emp.membership.id, ...AUG, kind: 'tds', amount: 1 })).status).toBe(403);
  });
});

describe('Vendor billing tracking and traceability', () => {
  test('sent / unsent, TDS and adjustment, and the trace from invoice back to timesheets and payment', async () => {
    const ctx = await seed();
    const project = await addProject(ctx, 'Vendor Project');
    const user = await createUser({ role: 'employee', name: 'Vendor Dev' });
    const contractor = await prisma.orgMembership.create({
      data: { person_id: user.id, org_id: ctx.org.id, role: 'employee', worker_type: 'contractor', vendor_account_id: ctx.vendor.id, vendor_rate: 40000, vendor_rate_currency: 'INR', joined_at: new Date('2026-01-01') },
    });
    await approved(ctx, contractor.id, project.id, weekdays(AUG).slice(0, 5));
    const invoice = await prisma.projectVendorInvoice.create({
      data: { org_id: ctx.org.id, account_id: project.id, vendor_account_id: ctx.vendor.id, period_month: 8, period_year: 2026, invoice_number: 'VINV-1', amount: 20000, currency: 'INR', created_by: ctx.adminUser.id },
    });

    const track = await authed(request(app).patch(api(`/billing/vendor-invoices/${invoice.id}/tracking`)), ctx.adminToken).send({ sent: true, tds_amount: 2000, adjustment_amount: -500, adjustment_note: 'Late delivery credit' });
    expect(track.status).toBe(200);
    expect(track.body.data).toMatchObject({ sent: true, tds_amount: 2000, adjustment_amount: -500, net_payable: 17500, payment_status: 'unpaid' });
    expect(await prisma.auditLog.count({ where: { action: 'vendor_invoice_tracking' } })).toBe(1);

    await prisma.vendorPayment.create({ data: { org_id: ctx.org.id, vendor_name: 'Vendor', vendor_type: 'contractor', vendor_account_id: ctx.vendor.id, amount: 17500, currency: 'INR', period_month: 8, period_year: 2026, status: 'paid', paid_at: new Date(), created_by: ctx.adminUser.id } });
    const trace = await authed(request(app).get(api(`/billing/vendor-invoices/${invoice.id}/trace`)), ctx.adminToken);
    expect(trace.status).toBe(200);
    const t = trace.body.data;
    expect(t.vendor.id).toBe(ctx.vendor.id);
    expect(t.project.name).toBe('Vendor Project');
    expect(t.invoice).toMatchObject({ invoice_number: 'VINV-1', sent: true, paid: true, payment_status: 'paid', net_payable: 17500 });
    expect(t.timesheet_records).toHaveLength(5);
    expect(t.timesheet_hours.approved).toBe(40);
    expect(t.payment).toMatchObject({ paid: true, paid_amount: 17500 });
    expect(t.billing_record.locked).toBe(false);

    const other = await createUser({ role: 'employee' });
    await createOrgMembership(other.id, ctx.org.id, { role: 'employee' });
    expect((await authed(request(app).get(api(`/billing/vendor-invoices/${invoice.id}/trace`)), (await loginAs(other)).access_token)).status).toBe(403);
  });
});
