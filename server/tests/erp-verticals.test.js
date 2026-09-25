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
const { linearForecast, computeValuation } = require('../src/modules/financials/financials.service');
const { buildInvite } = require('../src/lib/email/ics');
const outbox = require('../src/lib/email/outbox');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setup(modules = [], role = 'admin') {
  const org = await createOrg({ name: 'Vertical Co', slug: 'vertical-co' });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: modules } });
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role });
  const { access_token } = await loginAs(user);
  return { org, user, membership, token: access_token };
}

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);

describe('module gating', () => {
  test('a vertical API returns 403 when the module is not enabled for the org', async () => {
    const { token } = await setup([]);
    for (const path of ['/api/v1/trading/summary', '/api/v1/leads/summary', '/api/v1/contracts/summary', '/api/v1/projects/summary']) {
      const res = await authed(request(app).get(path), token);
      expect(res.status).toBe(403);
    }
  });

  test('enabled_modules is exposed on the login response org', async () => {
    const { user } = await setup(['trading']);
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Password123!' });
    expect(res.body.data.active_org.enabled_modules).toEqual(['trading']);
  });
});

describe('Gulati trading', () => {
  async function seedTrading() {
    const ctx = await setup(['trading']);
    const item = (await authed(request(app).post('/api/v1/trading/items'), ctx.token).send({ name: 'Steel', unit: 'tonne' })).body.data;
    const supplier = (await authed(request(app).post('/api/v1/trading/partners'), ctx.token).send({ kind: 'supplier', name: 'Acme Steel' })).body.data;
    return { ...ctx, item, supplier };
  }

  test('a partner cannot become active until every onboarding step is done', async () => {
    const { token, supplier } = await seedTrading();
    const blocked = await authed(request(app).patch(`/api/v1/trading/partners/${supplier.id}`), token).send({ status: 'active' });
    expect(blocked.status).toBe(422);

    const done = { kyc_done: true, agreement_signed: true, rate_card_agreed: true, bank_details_received: true };
    const ok = await authed(request(app).patch(`/api/v1/trading/partners/${supplier.id}`), token).send({ status: 'active', onboarding_checklist: done });
    expect(ok.status).toBe(200);
    expect(ok.body.data.onboarded_at).toBeTruthy();
  });

  test('rate card resolves the transaction rate, closes the previous rate, and flips the partner to trading', async () => {
    const { token, supplier, item } = await seedTrading();
    const done = { kyc_done: true, agreement_signed: true, rate_card_agreed: true, bank_details_received: true };
    await authed(request(app).patch(`/api/v1/trading/partners/${supplier.id}`), token).send({ status: 'active', onboarding_checklist: done });

    const noRate = await authed(request(app).post('/api/v1/trading/transactions'), token).send({
      partner_id: supplier.id, item_id: item.id, quantity: 2, txn_date: iso(daysAgo(1)),
    });
    expect(noRate.status).toBe(422);

    await authed(request(app).post('/api/v1/trading/rates'), token).send({ partner_id: supplier.id, item_id: item.id, rate: 50000, effective_from: iso(daysAgo(60)) });
    await authed(request(app).post('/api/v1/trading/rates'), token).send({ partner_id: supplier.id, item_id: item.id, rate: 55000, effective_from: iso(daysAgo(10)) });

    const old = await authed(request(app).post('/api/v1/trading/transactions'), token).send({
      partner_id: supplier.id, item_id: item.id, quantity: 2, txn_date: iso(daysAgo(30)), status: 'completed',
    });
    expect(old.body.data.rate).toBe(50000);
    expect(old.body.data.amount).toBe(100000);
    expect(old.body.data.txn_type).toBe('purchase');

    const recent = await authed(request(app).post('/api/v1/trading/transactions'), token).send({
      partner_id: supplier.id, item_id: item.id, quantity: 1, txn_date: iso(daysAgo(2)), status: 'completed',
    });
    expect(recent.body.data.rate).toBe(55000);

    const detail = await authed(request(app).get(`/api/v1/trading/partners/${supplier.id}`), token);
    expect(detail.body.data.partner.trading_status).toBe('trading');

    const summary = await authed(request(app).get('/api/v1/trading/summary'), token);
    expect(summary.body.data.trailing_30d.purchases).toBe(155000);
  });

  test('only an active partner can trade', async () => {
    const { token, supplier, item } = await seedTrading();
    const res = await authed(request(app).post('/api/v1/trading/transactions'), token).send({
      partner_id: supplier.id, item_id: item.id, quantity: 1, rate: 10, txn_date: iso(new Date()),
    });
    expect(res.status).toBe(422);
  });

  test("another org's partner is invisible", async () => {
    const a = await seedTrading();
    const other = await createOrg({ name: 'Other', slug: 'other' });
    await prisma.org.update({ where: { id: other.id }, data: { enabled_modules: ['trading'] } });
    const u = await createUser({ role: 'admin' });
    await createOrgMembership(u.id, other.id, { role: 'admin' });
    const { access_token } = await loginAs(u);
    const res = await authed(request(app).get(`/api/v1/trading/partners/${a.supplier.id}`), access_token);
    expect(res.status).toBe(404);
  });
});

describe('Zephyr / Acconcy leads', () => {
  test('a self-project lead must name its investor, customer deal or project type', async () => {
    const { token } = await setup(['leads']);
    const noBasis = await authed(request(app).post('/api/v1/leads'), token).send({ name: 'Tower', category: 'self_project' });
    expect(noBasis.status).toBe(422);

    const noName = await authed(request(app).post('/api/v1/leads'), token).send({ name: 'Tower', category: 'self_project', self_project_basis: 'investor' });
    expect(noName.status).toBe(422);

    const ok = await authed(request(app).post('/api/v1/leads'), token).send({
      name: 'Tower', category: 'self_project', self_project_basis: 'investor', investor_name: 'Aurum', estimated_value: 5000000,
    });
    expect(ok.status).toBe(201);
  });

  test('non self-project leads drop stale basis fields; won leads are locked', async () => {
    const { token } = await setup(['leads']);
    const lead = (await authed(request(app).post('/api/v1/leads'), token).send({ name: 'Plaza', category: 'other', investor_name: 'Stale' })).body.data;
    expect(lead.investor_name).toBeNull();

    await authed(request(app).post(`/api/v1/leads/${lead.id}/stage`), token).send({ stage: 'won' });
    const edit = await authed(request(app).patch(`/api/v1/leads/${lead.id}`), token).send({ name: 'Renamed' });
    expect(edit.status).toBe(409);
    const back = await authed(request(app).post(`/api/v1/leads/${lead.id}/stage`), token).send({ stage: 'qualified' });
    expect(back.status).toBe(422);
  });

  test('converting a self-project lead creates a linked project and marks it won', async () => {
    const { token } = await setup(['leads', 'projects']);
    const lead = (await authed(request(app).post('/api/v1/leads'), token).send({
      name: 'Riverside', category: 'self_project', self_project_basis: 'project_type', project_type: 'Residential', estimated_value: 9000000,
    })).body.data;
    const res = await authed(request(app).post(`/api/v1/leads/${lead.id}/convert`), token).send({ to: 'project' });
    expect(res.status).toBe(201);
    expect(res.body.data.project.budget).toBe(9000000);
    expect(res.body.data.lead.stage).toBe('won');
    expect(res.body.data.lead.converted_project_id).toBe(res.body.data.project.id);
  });

  test('a lead can be converted to a recurring contract using its expected monthly value', async () => {
    const { token } = await setup(['leads', 'contracts']);
    const lead = (await authed(request(app).post('/api/v1/leads'), token).send({ name: 'Orion', expected_monthly: 100000 })).body.data;
    const res = await authed(request(app).post(`/api/v1/leads/${lead.id}/convert`), token).send({
      to: 'contract', kind: 'recurring', start_date: iso(daysAgo(5)), billing_frequency: 'monthly',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.contract.recurring_amount).toBe(100000);
  });

  test('summary reports the funnel and win rate', async () => {
    const { token } = await setup(['leads']);
    const a = (await authed(request(app).post('/api/v1/leads'), token).send({ name: 'A', estimated_value: 100 })).body.data;
    const b = (await authed(request(app).post('/api/v1/leads'), token).send({ name: 'B', estimated_value: 200 })).body.data;
    await authed(request(app).post(`/api/v1/leads/${a.id}/stage`), token).send({ stage: 'won' });
    await authed(request(app).post(`/api/v1/leads/${b.id}/stage`), token).send({ stage: 'lost' });
    const res = await authed(request(app).get('/api/v1/leads/summary'), token);
    expect(res.body.data.win_rate).toBe(50);
    expect(res.body.data.funnel.won.count).toBe(1);
  });
});

describe('contracts and MRR', () => {
  test('recurring contracts need an amount and a real billing frequency', async () => {
    const { token } = await setup(['contracts']);
    const res = await authed(request(app).post('/api/v1/contracts'), token).send({
      kind: 'recurring', title: 'Retainer', counterparty_name: 'X', start_date: iso(daysAgo(1)), billing_frequency: 'one_time',
    });
    expect(res.status).toBe(422);
  });

  test('MRR normalises monthly, quarterly and annual billing and builds a 12-month schedule', async () => {
    const { token } = await setup(['contracts']);
    const make = async (title, amount, freq, extra = {}) => {
      const created = await authed(request(app).post('/api/v1/contracts'), token).send({
        kind: 'recurring', title, counterparty_name: title, recurring_amount: amount, billing_frequency: freq, start_date: iso(daysAgo(40)), ...extra,
      });
      expect(created.status).toBe(201);
      const activated = await authed(request(app).post(`/api/v1/contracts/${created.body.data.id}/status`), token).send({ status: 'active' });
      expect(activated.status).toBe(200);
    };
    await make('Monthly', 1000, 'monthly');
    await make('Quarterly', 3000, 'quarterly');
    await make('Annual', 12000, 'annual');
    // Ends next month: counts toward this month's MRR but drops out of later months.
    const end = new Date(); end.setUTCMonth(end.getUTCMonth() + 1, 1); end.setUTCDate(end.getUTCDate() - 1);
    await make('Short', 500, 'monthly', { end_date: iso(end) });

    const res = await authed(request(app).get('/api/v1/contracts/summary'), token);
    expect(res.body.data.mrr).toBe(3500);
    expect(res.body.data.arr).toBe(42000);
    expect(res.body.data.schedule).toHaveLength(12);
    expect(res.body.data.schedule[0].expected_revenue).toBe(3500);
    expect(res.body.data.schedule[11].expected_revenue).toBe(3000);
  });

  test('status machine: draft -> active -> completed only; closed contracts cannot be edited', async () => {
    const { token } = await setup(['contracts']);
    const c = (await authed(request(app).post('/api/v1/contracts'), token).send({
      kind: 'construction', title: 'Road', counterparty_name: 'NHAI', value: 1000, start_date: iso(daysAgo(1)),
    })).body.data;
    const skip = await authed(request(app).post(`/api/v1/contracts/${c.id}/status`), token).send({ status: 'completed' });
    expect(skip.status).toBe(422);
    await authed(request(app).post(`/api/v1/contracts/${c.id}/status`), token).send({ status: 'active' });
    await authed(request(app).post(`/api/v1/contracts/${c.id}/status`), token).send({ status: 'completed' });
    const edit = await authed(request(app).patch(`/api/v1/contracts/${c.id}`), token).send({ notes: 'late' });
    expect(edit.status).toBe(409);
  });

  test('billed amount cannot exceed the contract value', async () => {
    const { token } = await setup(['contracts']);
    const res = await authed(request(app).post('/api/v1/contracts'), token).send({
      kind: 'construction', title: 'Bridge', counterparty_name: 'PWD', value: 100, billed_to_date: 200, start_date: iso(daysAgo(1)),
    });
    expect(res.status).toBe(422);
  });
});

describe('self projects', () => {
  test('finance entries roll up to revenue, cost, net and budget use', async () => {
    const { token } = await setup(['projects']);
    const project = (await authed(request(app).post('/api/v1/projects'), token).send({ name: 'Riverside', budget: 1000 })).body.data;
    const add = (entry_type, amount) =>
      authed(request(app).post(`/api/v1/projects/${project.id}/finance`), token).send({ entry_type, amount, entry_date: iso(new Date()) });
    await add('revenue', 800);
    await add('expense', 300);
    await add('salary', 100);
    await add('other', 50);

    const detail = await authed(request(app).get(`/api/v1/projects/${project.id}`), token);
    expect(detail.body.data.project).toMatchObject({ revenue: 800, total_cost: 450, net: 350, budget_used_percent: 45 });
  });

  test('legal/site documents report expiry status and the register lists the worst first', async () => {
    const { token } = await setup(['projects']);
    const project = (await authed(request(app).post('/api/v1/projects'), token).send({ name: 'Mall' })).body.data;
    const doc = (title, expires_on) =>
      authed(request(app).post(`/api/v1/projects/${project.id}/documents`), token).field('category', 'legal').field('title', title).field('expires_on', expires_on || '');
    await doc('Fine', iso(new Date(Date.now() + 400 * 86400000)));
    await doc('Lapsed', iso(daysAgo(3)));
    await doc('Soon', iso(new Date(Date.now() + 10 * 86400000)));

    const res = await authed(request(app).get('/api/v1/projects/documents/register'), token);
    expect(res.body.data.documents.map((d) => d.status)).toEqual(['expired', 'expiring_soon', 'valid']);
    expect(res.body.data.counts).toMatchObject({ expired: 1, expiring_soon: 1, total: 3 });
  });
});

describe('financials, plans, projection and valuation', () => {
  test('linearForecast extends a trend and never goes negative', () => {
    expect(linearForecast([100, 200, 300], 2)).toEqual([400, 500]);
    expect(linearForecast([300, 200, 100], 3)).toEqual([0, 0, 0]);
    expect(linearForecast([], 2)).toEqual([0, 0]);
  });

  test('computeValuation applies the chosen method to the last 3 complete months', () => {
    const actuals = [
      { revenue: 999, expenses: 0, salary: 0, other: 0 },
      { revenue: 100, expenses: 20, salary: 30, other: 0 },
      { revenue: 100, expenses: 20, salary: 30, other: 0 },
      { revenue: 100, expenses: 20, salary: 30, other: 0 },
      { revenue: 5, expenses: 0, salary: 0, other: 0 }, // in-progress month is ignored
    ];
    const rev = computeValuation({ valuation_method: 'revenue_multiple', valuation_multiple: 2, valuation: 1 }, actuals);
    expect(rev.computed).toBe(2400);
    const ebitda = computeValuation({ valuation_method: 'ebitda_multiple', valuation_multiple: null, valuation: 1 }, actuals);
    expect(ebitda.computed).toBe(4800);
    const manual = computeValuation({ valuation_method: 'manual', valuation: 777 }, actuals);
    expect(manual.effective).toBe(777);
  });

  test('org financials combine trading, project, contract and billing sources; plan compares to actual', async () => {
    const { token, org } = await setup(['trading', 'projects', 'contracts']);
    const now = new Date();
    const project = (await authed(request(app).post('/api/v1/projects'), token).send({ name: 'P' })).body.data;
    await authed(request(app).post(`/api/v1/projects/${project.id}/finance`), token).send({ entry_type: 'revenue', amount: 1000, entry_date: iso(now) });
    await authed(request(app).post(`/api/v1/projects/${project.id}/finance`), token).send({ entry_type: 'expense', amount: 200, entry_date: iso(now) });

    const c = (await authed(request(app).post('/api/v1/contracts'), token).send({
      kind: 'recurring', title: 'R', counterparty_name: 'R', recurring_amount: 300, billing_frequency: 'monthly', start_date: iso(daysAgo(70)),
    })).body.data;
    await authed(request(app).post(`/api/v1/contracts/${c.id}/status`), token).send({ status: 'active' });

    const monthly = await authed(request(app).get('/api/v1/financials/monthly?months=2'), token);
    const current = monthly.body.data[1];
    expect(current.revenue).toBe(1300);
    expect(current.expenses).toBe(200);
    expect(current.profit).toBe(1100);

    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    await authed(request(app).put('/api/v1/financials/plan'), token).send({ period_month: month, period_year: year, line_kind: 'revenue', planned_amount: 2000 });
    await authed(request(app).put('/api/v1/financials/plan'), token).send({ period_month: month, period_year: year, line_kind: 'revenue', planned_amount: 1500 });
    const plan = await authed(request(app).get(`/api/v1/financials/plan?period_month=${month}&period_year=${year}`), token);
    const revenueLine = plan.body.data.lines.find((l) => l.line_kind === 'revenue');
    expect(revenueLine).toMatchObject({ planned: 1500, actual: 1300, variance: -200, on_track: false });
    expect(await prisma.financialPlan.count({ where: { org_id: org.id } })).toBe(1);
  });

  test('group projections require a group superadmin and return per-org valuation', async () => {
    const { user, org, token } = await setup([]);
    const denied = await authed(request(app).get('/api/v1/super-dashboard/projections'), token);
    expect(denied.status).toBe(403);

    const group = await prisma.orgGroup.findUnique({ where: { id: org.org_group_id } });
    await prisma.orgGroupMembership.create({ data: { user_id: user.id, org_group_id: group.id } });
    await prisma.user.update({ where: { id: user.id }, data: { is_group_superadmin: true } });
    await authed(request(app).patch(`/api/v1/orgs/${org.id}/settings`), (await loginAs(user)).access_token).send({ valuation_method: 'revenue_multiple', valuation_multiple: 4 });

    const res = await authed(request(app).get('/api/v1/super-dashboard/projections'), (await loginAs(user)).access_token);
    expect(res.status).toBe(200);
    expect(res.body.data.orgs).toHaveLength(1);
    expect(res.body.data.orgs[0].valuation).toMatchObject({ method: 'revenue_multiple', multiple: 4 });
    expect(res.body.data.orgs[0].projected).toHaveLength(6);
  });
});

describe('Delphic analytics', () => {
  test('revenue by client shows who brought it and who owns it, and links via account_id', async () => {
    const { token, org, membership } = await setup([]);
    const bda = await createUser({ role: 'bda', name: 'Bringer' });
    const owner = await createUser({ role: 'sales', name: 'Owner' });
    const account = await prisma.account.create({
      data: { name: 'Acme', type: 'client', stage: 'active', owner_id: owner.id, origin_owner_id: bda.id, org_id: org.id },
    });
    await prisma.dailyProjectRevenue.create({
      data: { org_id: org.id, account_id: account.id, date: new Date(), billable_hours: 8, rate: 100, revenue: 800 },
    });
    const res = await authed(request(app).get('/api/v1/analytics/revenue-by-client'), token);
    expect(res.status).toBe(200);
    expect(res.body.data.clients[0]).toMatchObject({ account_id: account.id, client_name: 'Acme', revenue: 800 });
    expect(res.body.data.clients[0].brought_by.name).toBe('Bringer');
    expect(res.body.data.clients[0].owner.name).toBe('Owner');
    expect(res.body.data.by_brought_by[0].revenue).toBe(800);
    expect(membership.id).toBeTruthy();
  });

  test('resource-wise revenue attributes a working resource to its face resource', async () => {
    const { token, org, user } = await setup([]);
    const worker = await createUser({ role: 'recruiter', name: 'Worker' });
    const workerM = await createOrgMembership(worker.id, org.id, { role: 'recruiter' });
    const face = await createUser({ role: 'sales', name: 'Face' });
    const faceM = await createOrgMembership(face.id, org.id, { role: 'sales' });
    await prisma.dailyEmployeeProfitability.create({
      data: { org_id: org.id, org_membership_id: workerM.id, date: new Date(), revenue: 500, cost: 200, margin: 300, breakdown: {} },
    });

    const map = await authed(request(app).post('/api/v1/analytics/resource-mappings'), token).send({
      face_membership_id: faceM.id, working_membership_id: workerM.id, effective_from: iso(daysAgo(30)),
    });
    expect(map.status).toBe(201);
    const self = await authed(request(app).post('/api/v1/analytics/resource-mappings'), token).send({
      face_membership_id: faceM.id, working_membership_id: faceM.id, effective_from: iso(daysAgo(30)),
    });
    expect(self.status).toBe(422);

    const res = await authed(request(app).get('/api/v1/analytics/revenue-by-resource'), token);
    expect(res.body.data.working_resources[0]).toMatchObject({ name: 'Worker', revenue: 500 });
    expect(res.body.data.working_resources[0].face_resource.name).toBe('Face');
    expect(res.body.data.face_resources[0]).toMatchObject({ name: 'Face', revenue: 500, working_resources: 1 });
    expect(user.id).toBeTruthy();
  });

  test('vendor summary separates paid from outstanding per vendor', async () => {
    const { token, org, user } = await setup([]);
    const pay = (status, amount, period_month = 1) =>
      prisma.vendorPayment.create({
        data: { org_id: org.id, vendor_name: 'Zeta Ltd', vendor_type: 'contractor', amount, period_month, period_year: 2026, status, created_by: user.id },
      });
    await pay('paid', 1000, 1);
    await pay('approved', 400, 2);
    await pay('pending', 100, 3);
    const res = await authed(request(app).get('/api/v1/analytics/vendors'), token);
    expect(res.body.data.vendors[0]).toMatchObject({ vendor_name: 'Zeta Ltd', paid: 1000, outstanding: 500, last_period: '2026-03' });
  });

  test('analytics are admin-only', async () => {
    const { token } = await setup([], 'recruiter');
    const res = await authed(request(app).get('/api/v1/analytics/live-sales'), token);
    expect(res.status).toBe(403);
  });
});

describe('calendar invites and email outbox', () => {
  test('buildInvite produces a valid, folded RFC 5545 body with attendees and join link', () => {
    const ics = buildInvite({
      uid: 'x@y', title: 'Sync, weekly; all', description: 'Line1\nLine2', url: 'https://teams.example/join/abc',
      start: new Date('2026-10-01T10:00:00Z'), end: new Date('2026-10-01T10:30:00Z'),
      organizer: { name: 'Org', email: 'o@x.com' }, attendees: [{ name: 'A', email: 'a@x.com' }],
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('DTSTART:20261001T100000Z');
    expect(ics).toContain('SUMMARY:Sync\\, weekly\\; all');
    expect(ics.split('\r\n ').join('')).toContain('mailto:a@x.com');
    expect(ics).toContain('URL:https://teams.example/join/abc');
    expect(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  });

  test('POST /invites queues one email per attendee with the .ics attached; outsiders are rejected', async () => {
    const { token, org, user } = await setup([]);
    const colleague = await createUser({ role: 'recruiter', name: 'Colleague' });
    await createOrgMembership(colleague.id, org.id, { role: 'recruiter' });
    const outsider = await createUser({ role: 'recruiter' });

    const res = await authed(request(app).post('/api/v1/invites'), token).send({
      title: 'Kickoff', start: '2026-10-05T09:00:00Z', end: '2026-10-05T09:30:00Z',
      meeting_url: 'https://teams.example/join/1', attendee_user_ids: [colleague.id], attendee_emails: ['client@example.com'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.queued).toBe(2);
    const rows = await prisma.emailOutbox.findMany({ where: { org_id: org.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ics && r.ics.includes('METHOD:REQUEST') && r.status === 'queued')).toBe(true);

    const bad = await authed(request(app).post('/api/v1/invites'), token).send({
      title: 'x', start: '2026-10-05T09:00:00Z', end: '2026-10-05T09:30:00Z', attendee_user_ids: [outsider.id],
    });
    expect(bad.status).toBe(422);
    expect(user.id).toBeTruthy();
  });

  test('processQueue sends through the transport, records failures, and marks rows skipped without SMTP', async () => {
    const { org } = await setup([]);
    const mk = (to) => outbox.enqueue(prisma, { orgId: org.id, kind: 'test', to: { email: to }, subject: 'S', text: 'Body' });
    await mk('ok@x.com');
    await mk('bad@x.com');

    const sent = [];
    const transport = {
      sendMail: async (msg) => {
        if (String(msg.to).includes('bad@')) throw new Error('mailbox unavailable');
        sent.push(msg);
      },
    };
    const first = await outbox.processQueue({ transport });
    expect(first).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(sent[0].to).toBe('ok@x.com');
    const failed = await prisma.emailOutbox.findFirst({ where: { to_email: 'bad@x.com' } });
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, last_error: 'mailbox unavailable' });

    const none = await outbox.processQueue({ transport: null });
    expect(none.skipped).toBe(1);
  });

  test('notify() emails users whose preference has email on, with the calendar invite attached', async () => {
    const { notify } = require('../src/lib/notifications');
    const { org } = await setup([]);
    const recruiter = await createUser({ role: 'recruiter', name: 'Rec' });
    await createOrgMembership(recruiter.id, org.id, { role: 'recruiter' });
    // interview_scheduled defaults to email on for everyone eligible.
    await notify(prisma, {
      type: 'interview_scheduled',
      recipientIds: [recruiter.id],
      context: { candidateName: 'Cand', requirementTitle: 'Req', scheduledAtLabel: 'tomorrow', ics: 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n', orgId: org.id },
    });
    const mail = await prisma.emailOutbox.findFirst({ where: { to_email: recruiter.email } });
    expect(mail).toBeTruthy();
    expect(mail.ics).toContain('METHOD:REQUEST');
    expect(mail.subject).toBe('Interview scheduled');

    await prisma.emailOutbox.deleteMany({});
    await prisma.notificationPreference.create({ data: { user_id: recruiter.id, type: 'interview_scheduled', in_app: true, email: false } });
    await notify(prisma, { type: 'interview_scheduled', recipientIds: [recruiter.id], context: { candidateName: 'Cand' } });
    expect(await prisma.emailOutbox.count({ where: { to_email: recruiter.email } })).toBe(0);
  });
});
