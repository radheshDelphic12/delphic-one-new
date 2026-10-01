// Finance — contract-based billing, invoices (editable number, the right
// project / client / currency, calculation details), vendor invoices,
// per-record locks (billing, salary per employee, expense, vendor) and
// Financials built from locked records only. Spec:
// docs/features/FINANCE-LIVE-ANALYTICS-INVOICES-LOCKING.md
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// August 2026: 21 Mon–Fri working days, fully in the past.
const AUG = { period_month: 8, period_year: 2026 };
// Mon-Fri 3-14 Aug (10 working days) and every August weekday (21).
const WORK_10 = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];
const WORK_21 = [...WORK_10, '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-31'];

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const it = await prisma.department.create({ data: { name: 'IT', org_id: org.id } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Company Calendar', is_default: true } });
  const vendor = await prisma.account.create({ data: { type: 'vendor', name: unique('ABC Vendor '), stage: 'active', owner_id: adminUser.id, org_id: org.id } });
  const miicare = await prisma.account.create({ data: { type: 'client', name: 'Miicare', stage: 'active', owner_id: adminUser.id, org_id: org.id, industry: 'IT' } });
  const acme = await prisma.account.create({ data: { type: 'client', name: 'Acme Ltd', stage: 'active', owner_id: adminUser.id, org_id: org.id, industry: 'IT' } });
  await authed(request(app).put('/api/v1/billing/exchange-rates'), adminToken).send({ rates: [{ currency: 'USD', rate_to_inr: 83 }] });
  return { org, it, adminUser, adminToken, vendor, miicare, acme };
}

// A project for `client` with its billing; `accountName` reproduces a project
// row whose own name is some other client's (the invoice-mapping bug).
async function project(ctx, { name, client, rate, rate_type = 'monthly', currency = 'INR', start = '2026-01-01', end = null, accountName = null }) {
  const res = await authed(request(app).post('/api/v1/calendars/projects'), ctx.adminToken).send({ name, service_category: 'managed_services', client_account_id: client.id });
  expect(res.status).toBe(201);
  const patch = await authed(request(app).patch(`/api/v1/billing/projects/${res.body.data.id}`), ctx.adminToken).send({
    agreement_start_date: start,
    agreement_end_date: end,
    billing: { rate_type, rate, currency },
  });
  expect(patch.status).toBe(200);
  if (accountName) await prisma.account.update({ where: { id: res.body.data.id }, data: { name: accountName, project_name: name } });
  return patch.body.data;
}

async function employee(ctx, name, ctc = null) {
  const user = await createUser({ role: 'employee', name });
  await prisma.user.update({ where: { id: user.id }, data: { department_id: ctx.it.id } });
  const membership = await createOrgMembership(user.id, ctx.org.id, { role: 'employee', department_id: ctx.it.id, joined_at: new Date('2026-01-01') });
  if (ctc) await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: membership.id, effective_from: new Date('2026-01-01'), ctc, components: { basic: ctc }, created_by: ctx.adminUser.id } });
  return membership;
}

async function hours(ctx, membershipId, accountId, dates, h = 8) {
  await prisma.timesheetEntry.createMany({
    data: dates.map((d) => ({ org_id: ctx.org.id, org_membership_id: membershipId, account_id: accountId, date: new Date(d), hours: h, billable: true, status: 'approved', approved_by: ctx.adminUser.id, approved_at: new Date() })),
  });
}

const lock = (ctx, body) => authed(request(app).post('/api/v1/calculations/lock'), ctx.adminToken).send({ ...AUG, ...body });

describe('Client invoices — contract amount, right project / client / currency', () => {
  test('a monthly USD project ending mid-month invoices rate × contract working days / working days, under its own name and client, with an editable number', async () => {
    const ctx = await seed();
    // MetaFlow-style: the agreement ends on Fri 14 Aug = 10 of August's 21 working days.
    const p = await project(ctx, { name: 'Miicare Platform', client: ctx.miicare, rate: 4200, currency: 'USD', end: '2026-08-14', accountName: 'Ment Tech Labs' });
    // Hours logged don't scale a monthly contract.
    const dev = await employee(ctx, 'Diksha');
    await hours(ctx, dev.id, p.id, ['2026-08-03'], 2);

    const preview = await authed(request(app).get('/api/v1/billing/invoices/preview'), ctx.adminToken).query({ account_id: p.id, ...AUG });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      project: { id: p.id, name: 'Miicare Platform', client_name: 'Miicare' },
      currency: 'USD',
      amount: 2000,
      suggested_number: 'INV-2026-001',
      details: { billing_type: 'monthly', rate: 4200, working_days: 21, contract_working_days: 10, period_from: '2026-08-01', period_to: '2026-08-14', amount: 2000 },
    });

    const created = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: p.id, ...AUG, invoice_number: 'MII/2026/07', invoice_date: '2026-09-01' });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ invoice_number: 'MII/2026/07', invoice_date: '2026-09-01', currency: 'USD', amount: 2000, project: { name: 'Miicare Platform', client_name: 'Miicare' } });

    const list = await authed(request(app).get('/api/v1/billing/invoices'), ctx.adminToken).query(AUG);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ invoice_number: 'MII/2026/07', currency: 'USD', project: { name: 'Miicare Platform', client_name: 'Miicare' }, details: { contract_working_days: 10 } });
    expect(JSON.stringify(list.body.data[0].project)).not.toContain('Ment Tech Labs');
  });

  test('two projects in INR and USD each keep their own currency and number; a number can\'t be reused', async () => {
    const ctx = await seed();
    const inr = await project(ctx, { name: 'Acme Support', client: ctx.acme, rate: 210000 });
    const usd = await project(ctx, { name: 'Miicare Platform', client: ctx.miicare, rate: 5000, currency: 'USD' });
    const a = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: inr.id, ...AUG });
    const b = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: usd.id, ...AUG });
    expect(a.body.data).toMatchObject({ invoice_number: 'INV-2026-001', currency: 'INR', amount: 210000, project: { name: 'Acme Support', client_name: 'Acme Ltd' } });
    expect(b.body.data).toMatchObject({ invoice_number: 'INV-2026-002', currency: 'USD', amount: 5000, project: { name: 'Miicare Platform', client_name: 'Miicare' } });

    // Re-generating a draft keeps its number; another invoice can't take it.
    const again = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: usd.id, ...AUG });
    expect(again.body.data.invoice_number).toBe('INV-2026-002');
    const clash = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: inr.id, ...AUG, invoice_number: 'INV-2026-002' });
    expect(clash.status).toBe(409);
  });

  test('an invoice can be raised in another currency through the exchange rates; a currency with no rate is refused', async () => {
    const ctx = await seed();
    const inr = await project(ctx, { name: 'Acme Support', client: ctx.acme, rate: 210000 });
    const usd = await project(ctx, { name: 'Miicare Platform', client: ctx.miicare, rate: 5000, currency: 'USD' });

    // INR project invoiced in USD (83 INR / USD): 210000 / 83.
    const preview = await authed(request(app).get('/api/v1/billing/invoices/preview'), ctx.adminToken).query({ account_id: inr.id, ...AUG, currency: 'USD' });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ currency: 'USD', amount: 2530.12, details: { currency: 'USD', conversion: { from_currency: 'INR', from_amount: 210000 } } });
    const a = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: inr.id, ...AUG, currency: 'USD' });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ currency: 'USD', amount: 2530.12 });

    // USD project invoiced in INR: 5000 x 83.
    const b = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: usd.id, ...AUG, currency: 'INR' });
    expect(b.body.data).toMatchObject({ currency: 'INR', amount: 415000 });

    // No EUR rate set -> clear error, nothing written.
    const eur = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: usd.id, ...AUG, currency: 'EUR' });
    expect(eur.status).toBe(422);
    expect(eur.body.message || eur.body.error?.message || JSON.stringify(eur.body)).toMatch(/exchange rate/i);
  });

  test('a draft invoice can be edited (number, date, notes, currency); a sent one cannot', async () => {
    const ctx = await seed();
    const usd = await project(ctx, { name: 'Miicare Platform', client: ctx.miicare, rate: 5000, currency: 'USD' });
    const other = await project(ctx, { name: 'Acme Support', client: ctx.acme, rate: 100000 });
    const inv = (await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: usd.id, ...AUG })).body.data;
    const second = (await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: other.id, ...AUG })).body.data;

    const edit = await authed(request(app).patch(`/api/v1/billing/invoices/${inv.id}`), ctx.adminToken).send({ invoice_number: 'MII/2026/99', invoice_date: '2026-09-05', notes: 'PO 123' });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ id: inv.id, invoice_number: 'MII/2026/99', invoice_date: '2026-09-05', notes: 'PO 123', currency: 'USD', amount: 5000 });

    // Number already used by another invoice.
    const clash = await authed(request(app).patch(`/api/v1/billing/invoices/${inv.id}`), ctx.adminToken).send({ invoice_number: second.invoice_number });
    expect(clash.status).toBe(409);

    // Changing currency re-expresses the amount.
    const inInr = await authed(request(app).patch(`/api/v1/billing/invoices/${inv.id}`), ctx.adminToken).send({ currency: 'INR' });
    expect(inInr.status).toBe(200);
    expect(inInr.body.data).toMatchObject({ id: inv.id, invoice_number: 'MII/2026/99', currency: 'INR', amount: 415000 });

    // Admin can override the calculated amount; it is recorded.
    const over = await authed(request(app).patch(`/api/v1/billing/invoices/${inv.id}`), ctx.adminToken).send({ amount: 400000, reason: 'Agreed discount' });
    expect(over.status).toBe(200);
    expect(over.body.data).toMatchObject({ amount: 400000, details: { amount: 400000 }, line_items: { manual_override: { original_amount: 415000, amount: 400000 } } });

    // A sent invoice can still be corrected by an admin, but only with a reason (and every edit is audited).
    expect((await authed(request(app).post(`/api/v1/billing/invoices/${inv.id}/status`), ctx.adminToken).send({ status: 'sent' })).status).toBe(200);
    const noReason = await authed(request(app).patch(`/api/v1/billing/invoices/${inv.id}`), ctx.adminToken).send({ notes: 'late fix' });
    expect(noReason.status).toBe(422);
    const withReason = await authed(request(app).patch(`/api/v1/billing/invoices/${inv.id}`), ctx.adminToken).send({ notes: 'late fix', reason: 'Client PO changed' });
    expect(withReason.status).toBe(200);
    expect(withReason.body.data).toMatchObject({ status: 'sent', notes: 'late fix' });
    // ...but its currency can't be re-derived once sent.
    expect((await authed(request(app).patch(`/api/v1/billing/invoices/${inv.id}`), ctx.adminToken).send({ currency: 'USD', reason: 'try' })).status).toBe(409);
    const audits = await prisma.auditLog.findMany({ where: { entity_id: inv.id, action: 'client_invoice_edit' } });
    expect(audits.length).toBeGreaterThanOrEqual(3);

    // Only admins edit.
    const emp = await createUser({ role: 'employee' });
    await createOrgMembership(emp.id, ctx.org.id, { role: 'employee' });
    const empToken = (await loginAs(emp)).access_token;
    expect((await authed(request(app).patch(`/api/v1/billing/invoices/${inv.id}`), empToken).send({ notes: 'x', reason: 'x' })).status).toBeGreaterThanOrEqual(401);
  });

  test('an hourly project invoices approved billable hours × rate and says so', async () => {
    const ctx = await seed();
    const p = await project(ctx, { name: 'Acme Hourly', client: ctx.acme, rate: 1500, rate_type: 'hourly' });
    const dev = await employee(ctx, 'Yash');
    await hours(ctx, dev.id, p.id, ['2026-08-03', '2026-08-04', '2026-08-05']);
    const res = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: p.id, ...AUG });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ amount: 36000, currency: 'INR', details: { billing_type: 'hourly', rate: 1500, billable_hours: 24, amount: 36000 } });
  });
});

describe('Per-record locks and the Locked section', () => {
  test('billing locks per project; the locked record keeps its INR figure and shows its invoice', async () => {
    const ctx = await seed();
    const p = await project(ctx, { name: 'Miicare Platform', client: ctx.miicare, rate: 5000, currency: 'USD' });
    const other = await project(ctx, { name: 'Acme Support', client: ctx.acme, rate: 100000 });
    expect((await lock(ctx, { kind: 'billing', scope_key: p.id })).status).toBe(200);
    await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: p.id, ...AUG, invoice_number: 'INV-MII-1' });

    const locked = await authed(request(app).get('/api/v1/calculations/locked'), ctx.adminToken).query({ period_year: 2026 });
    expect(locked.status).toBe(200);
    expect(locked.body.data).toHaveLength(1);
    expect(locked.body.data[0]).toMatchObject({ kind: 'billing', scope_key: p.id, amount: 5000, currency: 'USD', amount_inr: 415000, invoice: { invoice_number: 'INV-MII-1', currency: 'USD' }, summary: { project: { name: 'Miicare Platform' }, inr_at_lock: true } });

    // The other project is still live: Financials (locked) leaves it out.
    const fin = await authed(request(app).get('/api/v1/calculations/financials/records'), ctx.adminToken).query({ period_year: 2026, from_month: 8, to_month: 8 });
    expect(fin.body.data.totals.revenue).toBe(415000);
    const unlocked = await authed(request(app).get('/api/v1/calculations/financials/records'), ctx.adminToken).query({ period_year: 2026, from_month: 8, to_month: 8, state: 'unlocked' });
    expect(unlocked.body.data.totals.revenue).toBe(100000);
    expect(unlocked.body.data.counts.unlocked.billing).toBe(1);
    const all = await authed(request(app).get('/api/v1/calculations/financials/records'), ctx.adminToken).query({ period_year: 2026, from_month: 8, to_month: 8, state: 'all' });
    expect(all.body.data.totals.revenue).toBe(515000);
    expect(other.id).toBeTruthy();
  });

  test('salary locks employee by employee; payroll pays the locked figure and Financials counts only the locked one', async () => {
    const ctx = await seed();
    const diksha = await employee(ctx, 'Diksha', 42000);
    const ravi = await employee(ctx, 'Ravi', 30000);

    const res = await lock(ctx, { kind: 'salary_employee', scope_key: diksha.id });
    expect(res.status).toBe(200);
    const lockedNet = res.body.data.locked_amount;

    const live = await authed(request(app).get('/api/v1/analytics/salary-attendance'), ctx.adminToken).query(AUG);
    const byName = Object.fromEntries(live.body.data.lines.map((l) => [l.name, l]));
    expect(byName.Diksha).toMatchObject({ source: 'locked', lock: { status: 'locked', version: 1 } });
    expect(byName.Ravi).toMatchObject({ source: 'live', lock: { status: 'draft' } });

    // A later salary change doesn't move Diksha's locked pay.
    await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: diksha.id, effective_from: new Date('2026-08-01'), ctc: 99000, components: { basic: 99000 }, created_by: ctx.adminUser.id } });
    const run = await prisma.payrollRun.create({ data: { org_id: ctx.org.id, ...AUG } });
    const payroll = require('../src/modules/payroll/payroll.service');
    await payroll.processRun(ctx.org.id, run.id, ctx.adminUser.id);
    const slip = await prisma.payslip.findFirst({ where: { payroll_run_id: run.id, org_membership_id: diksha.id } });
    expect(Number(slip.net)).toBe(lockedNet);
    expect(slip.breakdown.calculation_version).toBe(1);

    const fin = await authed(request(app).get('/api/v1/calculations/financials/records'), ctx.adminToken).query({ period_year: 2026, from_month: 8, to_month: 8 });
    expect(fin.body.data.totals.salaries).toBe(lockedNet);
    expect(fin.body.data.counts.locked.salary).toBe(1);
    expect(ravi.id).toBeTruthy();
  });

  test('an approved expense locks on its own; a pending one can\'t', async () => {
    const ctx = await seed();
    const emp = await employee(ctx, 'Asha');
    const location = await prisma.location.create({ data: { org_id: ctx.org.id, name: 'Indore Office' } });
    const claim = await prisma.expenseClaim.create({ data: { org_id: ctx.org.id, org_membership_id: emp.id, location_id: location.id, category: 'Travel', expense_date: new Date('2026-08-10'), amount: 100, currency: 'USD', status: 'approved' } });
    const pending = await prisma.expenseClaim.create({ data: { org_id: ctx.org.id, org_membership_id: emp.id, location_id: location.id, category: 'Food', expense_date: new Date('2026-08-11'), amount: 500, currency: 'INR', status: 'pending' } });

    const records = await authed(request(app).get('/api/v1/analytics/expense-records'), ctx.adminToken).query(AUG);
    expect(records.body.data.records).toHaveLength(1); // only approved / reimbursed claims are expenses
    expect(records.body.data.records[0]).toMatchObject({ scope_key: `claim:${claim.id}`, amount: 100, currency: 'USD', amount_inr: 8300, lock: { status: 'draft' } });

    expect((await lock(ctx, { kind: 'expense', scope_key: `claim:${claim.id}` })).status).toBe(200);
    const refused = await lock(ctx, { kind: 'expense', scope_key: `claim:${pending.id}` });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/approved or reimbursed/);

    const after = await authed(request(app).get('/api/v1/analytics/expense-records'), ctx.adminToken).query(AUG);
    expect(after.body.data.records[0].lock).toMatchObject({ status: 'locked', version: 1 });
    const locked = await authed(request(app).get('/api/v1/calculations/locked'), ctx.adminToken).query({ period_year: 2026, kind: 'expense' });
    expect(locked.body.data[0]).toMatchObject({ kind: 'expense', amount: 100, currency: 'USD', amount_inr: 8300, summary: { record: { category: 'Travel', person: 'Asha' } } });
    const fin = await authed(request(app).get('/api/v1/calculations/financials/records'), ctx.adminToken).query({ period_year: 2026, from_month: 8, to_month: 8 });
    expect(fin.body.data.totals.expenses).toBe(8300);
  });

  test('a vendor invoices and locks per vendor with its client, project, rate, currency and calculation', async () => {
    const ctx = await seed();
    const p = await project(ctx, { name: 'Miicare Platform', client: ctx.miicare, rate: 5000, currency: 'USD', end: '2026-08-14' });
    const user = await createUser({ role: 'employee', name: 'Vendor Dev' });
    const contractor = await prisma.orgMembership.create({ data: { person_id: user.id, org_id: ctx.org.id, role: 'employee', worker_type: 'contractor', vendor_account_id: ctx.vendor.id, vendor_rate: 2100, vendor_rate_currency: 'USD', joined_at: new Date('2026-01-01') } });
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: p.id, org_membership_id: contractor.id, created_by: ctx.adminUser.id } });
    await hours(ctx, contractor.id, p.id, WORK_10);

    const preview = await authed(request(app).get('/api/v1/billing/vendor-invoices/preview'), ctx.adminToken).query({ vendor_account_id: ctx.vendor.id, ...AUG });
    expect(preview.status).toBe(200);
    // 2100 USD/month × 10 of 21 working days (the agreement ends 14 Aug).
    expect(preview.body.data.projects).toEqual([expect.objectContaining({ project: expect.objectContaining({ name: 'Miicare Platform', client_name: 'Miicare' }), currency: 'USD', amount: 1000, amount_inr: 83000 })]);
    expect(preview.body.data.projects[0].contractors[0]).toMatchObject({ contractor: 'Vendor Dev', monthly_vendor_rate: 2100, working_days: 21, contract_working_days: 10, amount: 1000 });

    const gen = await authed(request(app).post('/api/v1/billing/vendor-invoices/generate'), ctx.adminToken).send({ vendor_account_id: ctx.vendor.id, ...AUG, invoice_number: 'ABC-0815' });
    expect(gen.status).toBe(201);
    expect(gen.body.data[0]).toMatchObject({ invoice_number: 'ABC-0815', currency: 'USD', amount: 1000, generated: true, project: { name: 'Miicare Platform' } });

    expect((await lock(ctx, { kind: 'vendor_bill', scope_key: ctx.vendor.id })).status).toBe(200);
    const locked = await authed(request(app).get('/api/v1/calculations/locked'), ctx.adminToken).query({ period_year: 2026, kind: 'vendor_bill' });
    expect(locked.body.data[0]).toMatchObject({ kind: 'vendor_bill', amount_inr: 83000, summary: { vendor: { id: ctx.vendor.id }, lines: [expect.objectContaining({ contractor: 'Vendor Dev', currency: 'USD', amount: 1000, amount_inr: 83000, project: expect.objectContaining({ client_name: 'Miicare' }) })] }, vendor_invoices: [expect.objectContaining({ invoice_number: 'ABC-0815' })] });
    // Locking it creates the pending vendor payment, in INR.
    const payment = await prisma.vendorPayment.findFirst({ where: { org_id: ctx.org.id, vendor_account_id: ctx.vendor.id, ...AUG } });
    expect(Number(payment.amount)).toBe(83000);
  });

  test('a generated vendor invoice can be edited: number, date, notes, amount, currency (audited)', async () => {
    const ctx = await seed();
    const p = await project(ctx, { name: 'Miicare Platform', client: ctx.miicare, rate: 5000, currency: 'USD', end: '2026-08-14' });
    const user = await createUser({ role: 'employee', name: 'Vendor Dev' });
    const contractor = await prisma.orgMembership.create({ data: { person_id: user.id, org_id: ctx.org.id, role: 'employee', worker_type: 'contractor', vendor_account_id: ctx.vendor.id, vendor_rate: 2100, vendor_rate_currency: 'USD', joined_at: new Date('2026-01-01') } });
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: p.id, org_membership_id: contractor.id, created_by: ctx.adminUser.id } });
    await hours(ctx, contractor.id, p.id, WORK_10);
    const gen = await authed(request(app).post('/api/v1/billing/vendor-invoices/generate'), ctx.adminToken).send({ vendor_account_id: ctx.vendor.id, ...AUG, invoice_number: 'ABC-0815' });
    const row = gen.body.data[0];

    const edit = await authed(request(app).patch(`/api/v1/billing/vendor-invoices/${row.id}`), ctx.adminToken).send({ invoice_number: 'ABC-0816', invoice_date: '2026-09-03', notes: 'Corrected', amount: 1100 });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ invoice_number: 'ABC-0816', amount: 1100, currency: 'USD', notes: 'Corrected' });
    expect(edit.body.data.invoice_date).toMatch(/^2026-09-03/);
    expect(edit.body.data.details).toMatchObject({ amount_inr: 91300, exchange_rate: 83, manual_override: { original_amount: 1000 } });

    // Currency can be corrected too; the INR figure follows (INR rate is 1).
    const inInr = await authed(request(app).patch(`/api/v1/billing/vendor-invoices/${row.id}`), ctx.adminToken).send({ currency: 'INR', amount: 90000 });
    expect(inInr.body.data).toMatchObject({ currency: 'INR', amount: 90000, details: { amount_inr: 90000, manual_override: { original_amount: 1000, original_currency: 'USD' } } });

    const audits = await prisma.auditLog.findMany({ where: { entity_id: row.id, action: 'vendor_invoice_edit' } });
    expect(audits).toHaveLength(2);
  });
});

describe('Vendor payout and client billing follow approved timesheet hours; admin can tweak', () => {
  async function contractorOn(ctx, p) {
    const user = await createUser({ role: 'employee', name: 'Vendor Dev' });
    const contractor = await prisma.orgMembership.create({ data: { person_id: user.id, org_id: ctx.org.id, role: 'employee', worker_type: 'contractor', vendor_account_id: ctx.vendor.id, vendor_rate: 2100, vendor_rate_currency: 'USD', joined_at: new Date('2026-01-01') } });
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: p.id, org_membership_id: contractor.id, created_by: ctx.adminUser.id } });
    return contractor;
  }
  const vendorPreview = (ctx) => authed(request(app).get('/api/v1/billing/vendor-invoices/preview'), ctx.adminToken).query({ vendor_account_id: ctx.vendor.id, ...AUG });

  test('vendor payout = rate x approved days / working days (20 of 21), not the fixed contract days; admin can switch a project back to the contract basis', async () => {
    const ctx = await seed();
    const p = await project(ctx, { name: 'Miicare Platform', client: ctx.miicare, rate: 5000, currency: 'USD' });
    const contractor = await contractorOn(ctx, p);
    await hours(ctx, contractor.id, p.id, WORK_21.slice(0, 20)); // 20 of 21 working days approved

    const preview = await vendorPreview(ctx);
    expect(preview.status).toBe(200);
    expect(preview.body.data.projects[0]).toMatchObject({ currency: 'USD', amount: 2000 });
    expect(preview.body.data.projects[0].contractors[0]).toMatchObject({ payout_basis: 'approved_hours', payable_days: 20, contract_working_days: 21, amount: 2000 });

    // A half day (4h of an 8h day) counts for half a day; a day without approved hours counts for nothing.
    await prisma.timesheetEntry.deleteMany({ where: { org_membership_id: contractor.id, date: new Date('2026-08-31') } });
    await prisma.timesheetEntry.deleteMany({ where: { org_membership_id: contractor.id, date: new Date('2026-08-28') } });
    await hours(ctx, contractor.id, p.id, ['2026-08-28'], 4);
    expect((await vendorPreview(ctx)).body.data.projects[0].contractors[0]).toMatchObject({ payable_days: 19.5, amount: 1950 });

    // The retainer basis ignores hours (the previous behaviour), configurable per project by an admin.
    const patch = await authed(request(app).patch(`/api/v1/billing/projects/${p.id}`), ctx.adminToken).send({ vendor_payout_basis: 'contract' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.vendor_payout_basis).toBe('contract');
    expect((await vendorPreview(ctx)).body.data.projects[0].contractors[0]).toMatchObject({ payout_basis: 'contract', amount: 2100 });
  });

  test('a monthly client rate can bill by approved days instead of the retainer; the default stays the contract', async () => {
    const ctx = await seed();
    const p = await project(ctx, { name: 'Acme Support', client: ctx.acme, rate: 210000 });
    const dev = await employee(ctx, 'Asha');
    await hours(ctx, dev.id, p.id, WORK_21.slice(0, 20));
    const preview = () => authed(request(app).get('/api/v1/billing/invoices/preview'), ctx.adminToken).query({ account_id: p.id, ...AUG });

    expect((await preview()).body.data).toMatchObject({ amount: 210000, details: { billing_basis: 'contract' } });
    const patch = await authed(request(app).patch(`/api/v1/billing/projects/${p.id}`), ctx.adminToken).send({ client_billing_basis: 'approved_hours', billable_day_hours: 8 });
    expect(patch.status).toBe(200);
    expect(patch.body.data).toMatchObject({ client_billing_basis: 'approved_hours', billable_day_hours: 8 });
    expect((await preview()).body.data).toMatchObject({ amount: 200000, details: { billing_basis: 'approved_hours', payable_days: 20 } });
  });

  test('an admin adds a + or - adjustment (reason required); it moves the final amount, is audited, and flags a locked month', async () => {
    const ctx = await seed();
    const p = await project(ctx, { name: 'Acme Support', client: ctx.acme, rate: 210000 });
    const post = (body) => authed(request(app).post('/api/v1/billing/adjustments'), ctx.adminToken).send({ account_id: p.id, ...AUG, ...body });

    expect((await post({ amount: 5000 })).status).toBe(422); // reason is mandatory
    expect((await post({ amount: 0, reason: 'nothing' })).status).toBe(422);
    const plus = await post({ amount: 5000, reason: 'Extra weekend support' });
    expect(plus.status).toBe(201);
    const minus = await post({ amount: -2000, reason: 'SLA credit' });
    expect(minus.status).toBe(201);

    const list = await authed(request(app).get('/api/v1/billing/adjustments'), ctx.adminToken).query({ account_id: p.id, ...AUG });
    expect(list.body.data).toMatchObject({ total: 3000, items: [expect.objectContaining({ amount: 5000, reason: 'Extra weekend support' }), expect.objectContaining({ amount: -2000 })] });

    // Approved hours stay the source; the invoice shows the base and the tweak separately.
    const preview = await authed(request(app).get('/api/v1/billing/invoices/preview'), ctx.adminToken).query({ account_id: p.id, ...AUG });
    expect(preview.body.data).toMatchObject({ amount: 213000, details: { base_amount: 210000, adjustment_amount: 3000, adjustments: [{ amount: 5000 }, { amount: -2000 }] } });
    const inv = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: p.id, ...AUG });
    expect(inv.body.data).toMatchObject({ amount: 213000 });

    // Locking keeps the figure; a later tweak flags the locked month for review.
    expect((await lock(ctx, { kind: 'billing', scope_key: p.id })).status).toBe(200);
    expect((await post({ amount: 1000, reason: 'Late correction' })).status).toBe(201);
    const calc = await prisma.financialCalculation.findFirst({ where: { org_id: ctx.org.id, kind: 'billing', scope_key: p.id, ...AUG } });
    expect(calc.status).toBe('change_detected');

    // Removing one is audited too; only admins can adjust.
    expect((await authed(request(app).delete(`/api/v1/billing/adjustments/${plus.body.data.id}`), ctx.adminToken)).status).toBe(200);
    const audits = await prisma.auditLog.findMany({ where: { org_id: ctx.org.id, entity_type: 'billing_adjustment' } });
    expect(audits.map((a) => a.action).sort()).toEqual(['billing_adjustment_add', 'billing_adjustment_add', 'billing_adjustment_add', 'billing_adjustment_remove']);
    const emp = await createUser({ role: 'employee' });
    await createOrgMembership(emp.id, ctx.org.id, { role: 'employee' });
    expect((await authed(request(app).post('/api/v1/billing/adjustments'), (await loginAs(emp)).access_token).send({ account_id: p.id, ...AUG, amount: 1, reason: 'sneaky' })).status).toBeGreaterThanOrEqual(401);
  });
});

describe('Contract charges (GST, TDS, other) on client invoices', () => {
  const addCharge = (ctx, projectId, body) => authed(request(app).post(`/api/v1/billing/projects/${projectId}/charges`), ctx.adminToken).send(body);
  const preview = (ctx, projectId, extra = {}) => authed(request(app).get('/api/v1/billing/invoices/preview'), ctx.adminToken).query({ account_id: projectId, ...AUG, ...extra });

  test('percent and fixed charges, added or deducted, are worked out on the final approved amount (after the admin adjustment)', async () => {
    const ctx = await seed();
    const p = await project(ctx, { name: 'Acme Support', client: ctx.acme, rate: 210000 });
    // Final approved amount = 210000 contract + 5000 admin adjustment = 215000.
    expect((await authed(request(app).post('/api/v1/billing/adjustments'), ctx.adminToken).send({ account_id: p.id, ...AUG, amount: 5000, reason: 'Extra weekend support' })).status).toBe(201);

    // Validation: a name, a positive value, and a percentage cannot exceed 100.
    expect((await addCharge(ctx, p.id, { label: '', mode: 'percent', value: 18, effect: 'add' })).status).toBe(422);
    expect((await addCharge(ctx, p.id, { label: 'GST', mode: 'percent', value: 150, effect: 'add' })).status).toBe(422);
    expect((await addCharge(ctx, p.id, { label: 'GST', mode: 'fixed', value: 0, effect: 'add' })).status).toBe(422);

    const gst = await addCharge(ctx, p.id, { label: 'GST', mode: 'percent', value: 18, effect: 'add' });
    const tds = await addCharge(ctx, p.id, { label: 'TDS', mode: 'percent', value: 10, effect: 'deduct' });
    const fee = await addCharge(ctx, p.id, { label: 'Handling fee', mode: 'fixed', value: 500, effect: 'add' });
    expect([gst.status, tds.status, fee.status]).toEqual([201, 201, 201]);

    const list = await authed(request(app).get(`/api/v1/billing/projects/${p.id}/charges`), ctx.adminToken);
    expect(list.body.data.map((c) => c.label)).toEqual(['GST', 'TDS', 'Handling fee']);

    // 215000 + 38700 (GST) - 21500 (TDS) + 500 (fee) = 232700.
    const pre = await preview(ctx, p.id);
    expect(pre.body.data).toMatchObject({ amount: 215000, total_amount: 232700, details: { subtotal: 215000, total_amount: 232700 } });
    expect(pre.body.data.details.charges.map((c) => [c.label, c.amount])).toEqual([['GST', 38700], ['TDS', -21500], ['Handling fee', 500]]);

    // The invoice keeps the approved amount as `amount` and the payable total beside it.
    const inv = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: p.id, ...AUG });
    expect(inv.status).toBe(201);
    expect(inv.body.data).toMatchObject({ amount: 215000, total_amount: 232700 });
    expect(inv.body.data.details.charges).toHaveLength(3);
  });

  test('a charge can be edited and deleted one by one; a generated draft keeps its lines until it is refreshed', async () => {
    const ctx = await seed();
    const p = await project(ctx, { name: 'Acme Support', client: ctx.acme, rate: 100000 });
    const gst = (await addCharge(ctx, p.id, { label: 'GST', mode: 'percent', value: 18, effect: 'add' })).body.data;
    const tds = (await addCharge(ctx, p.id, { label: 'TDS', mode: 'percent', value: 10, effect: 'deduct' })).body.data;
    const inv = (await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: p.id, ...AUG })).body.data;
    expect(inv.total_amount).toBe(108000); // 100000 + 18000 - 10000

    // Edit GST to 12%, delete TDS.
    const edit = await authed(request(app).patch(`/api/v1/billing/charges/${gst.id}`), ctx.adminToken).send({ value: 12 });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ label: 'GST', value: 12 });
    expect((await authed(request(app).patch(`/api/v1/billing/charges/${gst.id}`), ctx.adminToken).send({ value: 250 })).status).toBe(422);
    expect((await authed(request(app).delete(`/api/v1/billing/charges/${tds.id}`), ctx.adminToken)).status).toBe(200);

    // The draft already generated is unchanged until it is refreshed ...
    const same = await authed(request(app).get(`/api/v1/billing/invoices/${inv.id}`), ctx.adminToken);
    expect(same.body.data.total_amount).toBe(108000);
    // ... then the new set applies: 100000 + 12000.
    const refreshed = await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: p.id, ...AUG });
    expect(refreshed.body.data).toMatchObject({ id: inv.id, amount: 100000, total_amount: 112000 });
    expect(refreshed.body.data.details.charges.map((c) => c.label)).toEqual(['GST']);

    // Audited, and admin only.
    const audits = await prisma.auditLog.findMany({ where: { org_id: ctx.org.id, entity_type: 'contract_charge' } });
    expect(audits.map((a) => a.action).sort()).toEqual(['contract_charge_add', 'contract_charge_add', 'contract_charge_edit', 'contract_charge_remove']);
    const emp = await createUser({ role: 'employee' });
    await createOrgMembership(emp.id, ctx.org.id, { role: 'employee' });
    expect((await authed(request(app).post(`/api/v1/billing/projects/${p.id}/charges`), (await loginAs(emp)).access_token).send({ label: 'GST', mode: 'percent', value: 18, effect: 'add' })).status).toBeGreaterThanOrEqual(401);
  });

  test('another invoice currency converts fixed charges; an admin amount override recomputes the percentages', async () => {
    const ctx = await seed();
    const p = await project(ctx, { name: 'Acme Support', client: ctx.acme, rate: 83000 }); // INR project; USD rate is 83
    await addCharge(ctx, p.id, { label: 'GST', mode: 'percent', value: 18, effect: 'add' });
    await addCharge(ctx, p.id, { label: 'Handling fee', mode: 'fixed', value: 830, effect: 'add' }); // 830 INR

    // In USD: subtotal 83000 / 83 = 1000; GST 180; the 830 INR fee becomes 10 USD.
    const usd = await preview(ctx, p.id, { currency: 'USD' });
    expect(usd.body.data).toMatchObject({ currency: 'USD', amount: 1000, total_amount: 1190 });
    expect(usd.body.data.details.charges.map((c) => [c.label, c.amount])).toEqual([['GST', 180], ['Handling fee', 10]]);

    // Admin overrides the draft amount: the percentage re-works on the new amount, the fixed fee stays.
    const inv = (await authed(request(app).post('/api/v1/billing/invoices'), ctx.adminToken).send({ client_account_id: p.id, ...AUG })).body.data;
    expect(inv.total_amount).toBe(83000 + 14940 + 830);
    const over = await authed(request(app).patch(`/api/v1/billing/invoices/${inv.id}`), ctx.adminToken).send({ amount: 50000, reason: 'Agreed discount' });
    expect(over.status).toBe(200);
    expect(over.body.data).toMatchObject({ amount: 50000, total_amount: 50000 + 9000 + 830 });
  });
});
