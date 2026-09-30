// Finance → Project P&L in INR: exchange rates convert foreign-currency
// billing, and hourly billing is worked out live from approved timesheets.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const token = (await loginAs(admin)).access_token;
  const dev = await createUser({ role: 'employee' });
  const devMembership = await createOrgMembership(dev.id, org.id, { role: 'employee' });
  await prisma.salaryStructure.create({
    data: { org_id: org.id, org_membership_id: devMembership.id, effective_from: new Date('2026-01-01'), ctc: 50000, components: {}, created_by: admin.id },
  });
  return { org, admin, token, devMembership };
}

async function project(ctx, name, rate) {
  const account = await prisma.account.create({
    data: { org_id: ctx.org.id, name, type: 'client', stage: 'active', service_category: 'managed_services', owner_id: ctx.admin.id },
  });
  await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: account.id, org_membership_id: ctx.devMembership.id, created_by: ctx.admin.id } });
  if (rate) {
    await prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: account.id, effective_from: new Date('2026-09-01'), created_by: ctx.admin.id, ...rate } });
  }
  return account;
}

const pnlUrl = (id) => `/api/v1/billing/projects/${id}/pnl?period_month=9&period_year=2026`;

describe('Finance — exchange rates', () => {
  test('admin sets, reads and clears INR rates; every foreign currency is listed; non-admins are refused', async () => {
    const ctx = await seed();
    const initial = await authed(request(app).get('/api/v1/billing/exchange-rates'), ctx.token);
    expect(initial.body.data.map((r) => r.currency)).toEqual(['USD', 'AED', 'SAR', 'EUR', 'GBP']);
    expect(initial.body.data.every((r) => r.rate_to_inr === null)).toBe(true);

    const set = await authed(request(app).put('/api/v1/billing/exchange-rates'), ctx.token).send({ rates: [{ currency: 'USD', rate_to_inr: 83.5 }, { currency: 'AED', rate_to_inr: 22.7 }] });
    expect(set.status).toBe(200);
    expect(set.body.data.find((r) => r.currency === 'USD').rate_to_inr).toBe(83.5);

    const cleared = await authed(request(app).put('/api/v1/billing/exchange-rates'), ctx.token).send({ rates: [{ currency: 'AED', rate_to_inr: null }] });
    expect(cleared.body.data.find((r) => r.currency === 'AED').rate_to_inr).toBeNull();
    expect((await authed(request(app).put('/api/v1/billing/exchange-rates'), ctx.token).send({ rates: [{ currency: 'INR', rate_to_inr: 1 }] })).status).toBe(422);
    expect((await authed(request(app).put('/api/v1/billing/exchange-rates'), ctx.token).send({ rates: [{ currency: 'USD', rate_to_inr: -1 }] })).status).toBe(422);

    const emp = await createUser({ role: 'employee' });
    await createOrgMembership(emp.id, ctx.org.id, { role: 'employee' });
    expect((await authed(request(app).get('/api/v1/billing/exchange-rates'), (await loginAs(emp)).access_token)).status).toBe(403);
  });
});

describe('Finance — Project P&L in INR', () => {
  test('USD billing converts to INR once a rate is set; until then profit and margin stay blank', async () => {
    const ctx = await seed();
    const mii = await project(ctx, 'Mii Health 1', { rate_type: 'monthly', rate: 2000, currency: 'USD' });

    const before = (await authed(request(app).get(pnlUrl(mii.id)), ctx.token)).body.data;
    expect(before).toMatchObject({ currency: 'INR', missing_rates: ['USD'], profit: null, margin_percent: null });
    expect(before.internal.cost).toBe(50000);

    await authed(request(app).put('/api/v1/billing/exchange-rates'), ctx.token).send({ rates: [{ currency: 'USD', rate_to_inr: 83 }] });
    const after = (await authed(request(app).get(pnlUrl(mii.id)), ctx.token)).body.data;
    expect(after.revenue).toMatchObject({ amount: 166000, original_amount: 2000, original_currency: 'USD', currency: 'INR' });
    expect(after).toMatchObject({ missing_rates: [], total_cost: 50000, profit: 116000, margin_percent: 69.88 });

    const summary = (await authed(request(app).get('/api/v1/billing/projects-pnl?period_month=9&period_year=2026'), ctx.token)).body.data;
    expect(summary.find((r) => r.project.id === mii.id)).toMatchObject({
      currency: 'INR', revenue: 166000, original_revenue: 2000, original_currency: 'USD', service_category: 'managed_services', profit: 116000,
    });
  });

  test('hourly billing is approved billable hours x the rate on each day, even when the rate was set after approval', async () => {
    const ctx = await seed();
    const tank = await project(ctx, 'Tankpros');
    // Hours approved before any rate existed — no DailyProjectRevenue row gets written.
    for (const [date, hours, billable] of [['2026-09-02', 8, true], ['2026-09-03', 6, true], ['2026-09-04', 5, false], ['2026-10-01', 8, true]]) {
      await prisma.timesheetEntry.create({
        data: { org_id: ctx.org.id, org_membership_id: ctx.devMembership.id, account_id: tank.id, date: new Date(date), hours, billable, status: 'approved' },
      });
    }
    await prisma.timesheetEntry.create({
      data: { org_id: ctx.org.id, org_membership_id: ctx.devMembership.id, account_id: tank.id, date: new Date('2026-09-05'), hours: 4, billable: true, status: 'submitted' },
    });
    await prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: tank.id, rate_type: 'hourly', rate: 1500, currency: 'INR', effective_from: new Date('2026-09-01'), created_by: ctx.admin.id } });
    // A later raise only prices the days from when it applies.
    await prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: tank.id, rate_type: 'hourly', rate: 2000, currency: 'INR', effective_from: new Date('2026-09-03'), created_by: ctx.admin.id } });

    const pnl = (await authed(request(app).get(pnlUrl(tank.id)), ctx.token)).body.data;
    expect(pnl.revenue).toMatchObject({ billing_type: 'hourly', billable_hours: 14, amount: 8 * 1500 + 6 * 2000 });
    expect(pnl.profit).toBe(24000 - 50000);
  });

  test('hourly P&L matches the billing engine: nothing after the agreement end, overtime billed only where the project bills it', async () => {
    const ctx = await seed();
    const acme = await project(ctx, 'Acme Hourly', { rate_type: 'hourly', rate: 1000, currency: 'INR' });
    await prisma.account.update({ where: { id: acme.id }, data: { agreement_end_date: new Date('2026-09-10') } });
    for (const [date, hours, overtime_hours] of [['2026-09-02', 9, 2], ['2026-09-15', 8, 0]]) {
      await prisma.timesheetEntry.create({
        data: { org_id: ctx.org.id, org_membership_id: ctx.devMembership.id, account_id: acme.id, date: new Date(date), hours, overtime_hours, billable: true, status: 'approved' },
      });
    }

    const noOt = (await authed(request(app).get(pnlUrl(acme.id)), ctx.token)).body.data.revenue;
    expect(noOt).toMatchObject({ billing_type: 'hourly', billable_hours: 9, overtime_hours: 0, amount: 9000 });
    expect(noOt.excluded).toMatchObject({ outside_agreement: 8, overtime: 2 });

    await prisma.account.update({ where: { id: acme.id }, data: { overtime_billable: true, overtime_multiplier: 1.5 } });
    const withOt = (await authed(request(app).get(pnlUrl(acme.id)), ctx.token)).body.data.revenue;
    expect(withOt).toMatchObject({ billable_hours: 9, overtime_hours: 2, overtime_amount: 3000, amount: 12000 });

    // Billing & Sales shows the very same figure.
    const sales = (await authed(request(app).get(`/api/v1/analytics/billing/projects/${acme.id}?period_month=9&period_year=2026`), ctx.token)).body.data;
    expect(sales.totals.amount).toBe(12000);
  });
});

describe('Finance → Projects — same exchange rates as Project P&L', () => {
  test('project rows carry the INR rate and INR monthly figure from the shared converter, matching P&L', async () => {
    const ctx = await seed();
    const mii = await project(ctx, 'Mii Health 2', { rate_type: 'monthly', rate: 2000, currency: 'USD' });
    const hourly = await project(ctx, 'Hourly AED', { rate_type: 'hourly', rate: 50, currency: 'AED' });
    await prisma.account.updateMany({ where: { id: { in: [mii.id, hourly.id] } }, data: { is_project: true } });
    await prisma.account.update({ where: { id: hourly.id }, data: { estimated_monthly_hours: 100 } });
    const rowsOf = async () => (await authed(request(app).get('/api/v1/billing/projects'), ctx.token)).body.data;

    // No rates yet: INR figures are blank, not guessed.
    expect((await rowsOf()).find((r) => r.id === mii.id)).toMatchObject({ currency: 'USD', rate: 2000, exchange_rate: null, rate_inr: null, monthly_amount_inr: null });

    await authed(request(app).put('/api/v1/billing/exchange-rates'), ctx.token).send({ rates: [{ currency: 'USD', rate_to_inr: 83.25 }, { currency: 'AED', rate_to_inr: 22.7 }] });
    const rows = await rowsOf();
    const row = rows.find((r) => r.id === mii.id);
    expect(row).toMatchObject({ exchange_rate: 83.25, rate_inr: 166500, monthly_amount_inr: 166500 });
    expect(rows.find((r) => r.id === hourly.id)).toMatchObject({ exchange_rate: 22.7, rate_inr: 1135, monthly_amount_inr: 113500 });

    // Same figure the P&L bills for the month.
    const pnl = (await authed(request(app).get(pnlUrl(mii.id)), ctx.token)).body.data;
    expect(pnl.revenue.amount).toBe(row.monthly_amount_inr);

    // The single-project read (the drawer) agrees too.
    const one = (await authed(request(app).get(`/api/v1/billing/projects/${mii.id}`), ctx.token)).body.data;
    expect(one).toMatchObject({ exchange_rate: 83.25, rate_inr: 166500 });
  });
});
