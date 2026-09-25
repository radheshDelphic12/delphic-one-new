const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedOrgAdmin() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  const membership = await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, membership, access_token };
}

async function seedOrgEmployee(org, role = 'recruiter') {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role });
  const { access_token } = await loginAs(user);
  return { user, membership, access_token };
}

async function createAccount(token, name, kind) {
  const res = await authed(request(app).post('/api/v1/accounting/ledger-accounts'), token).send({ name, kind });
  return res.body.data;
}

describe('Phase 8 — accounting routes require an active org membership and admin role', () => {
  test('a user with no OrgMembership gets 403, not a crash', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/api/v1/accounting/ledger-accounts'), access_token);
    expect(res.status).toBe(403);
  });

  test('a non-admin org member cannot create ledger accounts or view reports', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);

    const create = await authed(request(app).post('/api/v1/accounting/ledger-accounts'), empToken).send({
      name: 'Cash',
      kind: 'asset',
    });
    expect(create.status).toBe(403);

    const report = await authed(request(app).get('/api/v1/accounting/reports/trial-balance'), empToken);
    expect(report.status).toBe(403);
  });
});

describe('Phase 8 — ledger accounts', () => {
  test('admin creates accounts of each kind; a duplicate name in the same org is rejected', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();

    const cash = await createAccount(adminToken, 'Cash', 'asset');
    expect(cash.kind).toBe('asset');

    const dup = await authed(request(app).post('/api/v1/accounting/ledger-accounts'), adminToken).send({
      name: 'Cash',
      kind: 'liability',
    });
    expect(dup.status).toBe(409);
  });

  test('the same account name is allowed again in a different org', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    await createAccount(adminToken, 'Cash', 'asset');

    const otherOrg = await createOrg({ name: 'Acconcy', slug: 'acconcy' });
    const otherAdmin = await createUser({ role: 'admin' });
    await createOrgMembership(otherAdmin.id, otherOrg.id, { role: 'admin' });
    const { access_token: otherToken } = await loginAs(otherAdmin);

    const res = await authed(request(app).post('/api/v1/accounting/ledger-accounts'), otherToken).send({
      name: 'Cash',
      kind: 'asset',
    });
    expect(res.status).toBe(201);
  });
});

describe('Phase 8 — journal entries (double-entry posting)', () => {
  test('a balanced two-line entry posts; both lines share one transaction_id', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const cash = await createAccount(adminToken, 'Cash', 'asset');
    const revenue = await createAccount(adminToken, 'Service Revenue', 'revenue');

    const res = await authed(request(app).post('/api/v1/accounting/journal-entries'), adminToken).send({
      date: '2026-09-16',
      memo: 'Consulting revenue received',
      lines: [
        { ledger_account_id: cash.id, debit: 50000, credit: 0 },
        { ledger_account_id: revenue.id, debit: 0, credit: 50000 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.entries).toHaveLength(2);
    const [a, b] = res.body.data.entries;
    expect(a.transaction_id).toBe(b.transaction_id);
    expect(a.transaction_id).toBe(res.body.data.transaction_id);
  });

  test('an unbalanced entry is rejected', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const cash = await createAccount(adminToken, 'Cash', 'asset');
    const revenue = await createAccount(adminToken, 'Service Revenue', 'revenue');

    const res = await authed(request(app).post('/api/v1/accounting/journal-entries'), adminToken).send({
      date: '2026-09-16',
      lines: [
        { ledger_account_id: cash.id, debit: 50000, credit: 0 },
        { ledger_account_id: revenue.id, debit: 0, credit: 40000 },
      ],
    });
    expect(res.status).toBe(422);
  });

  test('a line with both a debit and a credit fails validation before it reaches the service', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const cash = await createAccount(adminToken, 'Cash', 'asset');
    const revenue = await createAccount(adminToken, 'Service Revenue', 'revenue');

    const res = await authed(request(app).post('/api/v1/accounting/journal-entries'), adminToken).send({
      date: '2026-09-16',
      lines: [
        { ledger_account_id: cash.id, debit: 50000, credit: 50000 },
        { ledger_account_id: revenue.id, debit: 0, credit: 50000 },
      ],
    });
    expect(res.status).toBe(422);
  });

  test('a ledger account belonging to another org is rejected', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const cash = await createAccount(adminToken, 'Cash', 'asset');

    const otherOrg = await createOrg({ name: 'Acconcy', slug: 'acconcy' });
    const otherAdmin = await createUser({ role: 'admin' });
    await createOrgMembership(otherAdmin.id, otherOrg.id, { role: 'admin' });
    const { access_token: otherToken } = await loginAs(otherAdmin);
    const otherRevenue = await createAccount(otherToken, 'Service Revenue', 'revenue');

    const res = await authed(request(app).post('/api/v1/accounting/journal-entries'), adminToken).send({
      date: '2026-09-16',
      lines: [
        { ledger_account_id: cash.id, debit: 50000, credit: 0 },
        { ledger_account_id: otherRevenue.id, debit: 0, credit: 50000 },
      ],
    });
    expect(res.status).toBe(404);
  });

  test('ledger entries can be listed and filtered by ledger_account_id', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const cash = await createAccount(adminToken, 'Cash', 'asset');
    const revenue = await createAccount(adminToken, 'Service Revenue', 'revenue');
    await authed(request(app).post('/api/v1/accounting/journal-entries'), adminToken).send({
      date: '2026-09-16',
      lines: [
        { ledger_account_id: cash.id, debit: 50000, credit: 0 },
        { ledger_account_id: revenue.id, debit: 0, credit: 50000 },
      ],
    });

    const all = await authed(request(app).get('/api/v1/accounting/ledger-entries'), adminToken);
    expect(all.body.data).toHaveLength(2);

    const cashOnly = await authed(request(app).get(`/api/v1/accounting/ledger-entries?ledger_account_id=${cash.id}`), adminToken);
    expect(cashOnly.body.data).toHaveLength(1);
    expect(cashOnly.body.data[0].ledger_account.name).toBe('Cash');
  });
});

describe('Phase 8 — reports (trial balance, P&L, balance sheet)', () => {
  async function seedBookedOrg() {
    const seeded = await seedOrgAdmin();
    const { access_token: adminToken } = seeded;
    const cash = await createAccount(adminToken, 'Cash', 'asset');
    const equity = await createAccount(adminToken, 'Owner Equity', 'equity');
    const revenue = await createAccount(adminToken, 'Service Revenue', 'revenue');
    const expense = await createAccount(adminToken, 'Office Expense', 'expense');

    // Owner invests capital.
    await authed(request(app).post('/api/v1/accounting/journal-entries'), adminToken).send({
      date: '2026-09-01',
      lines: [
        { ledger_account_id: cash.id, debit: 100000, credit: 0 },
        { ledger_account_id: equity.id, debit: 0, credit: 100000 },
      ],
    });
    // Revenue earned in cash.
    await authed(request(app).post('/api/v1/accounting/journal-entries'), adminToken).send({
      date: '2026-09-10',
      lines: [
        { ledger_account_id: cash.id, debit: 50000, credit: 0 },
        { ledger_account_id: revenue.id, debit: 0, credit: 50000 },
      ],
    });
    // Office expense paid in cash.
    await authed(request(app).post('/api/v1/accounting/journal-entries'), adminToken).send({
      date: '2026-09-12',
      lines: [
        { ledger_account_id: expense.id, debit: 20000, credit: 0 },
        { ledger_account_id: cash.id, debit: 0, credit: 20000 },
      ],
    });

    return { ...seeded, cash, equity, revenue, expense };
  }

  test('trial balance sums debits and credits per account and balances overall', async () => {
    const { access_token: adminToken } = await seedBookedOrg();
    const res = await authed(request(app).get('/api/v1/accounting/reports/trial-balance'), adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.is_balanced).toBe(true);
    expect(res.body.data.totals.debit_total).toBe(170000);
    expect(res.body.data.totals.credit_total).toBe(170000);

    const cashRow = res.body.data.accounts.find((a) => a.name === 'Cash');
    expect(cashRow.balance).toBe(130000);
    const equityRow = res.body.data.accounts.find((a) => a.name === 'Owner Equity');
    expect(equityRow.balance).toBe(100000);
  });

  test('profit and loss nets revenue against expense for the period', async () => {
    const { access_token: adminToken } = await seedBookedOrg();
    const res = await authed(
      request(app).get('/api/v1/accounting/reports/profit-and-loss?from=2026-09-01&to=2026-09-30'),
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.data.total_revenue).toBe(50000);
    expect(res.body.data.total_expense).toBe(20000);
    expect(res.body.data.net_profit).toBe(30000);
  });

  test('balance sheet totals assets/liabilities/equity; the gap reflects unclosed P&L', async () => {
    const { access_token: adminToken } = await seedBookedOrg();
    const res = await authed(request(app).get('/api/v1/accounting/reports/balance-sheet'), adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.total_assets).toBe(130000);
    expect(res.body.data.total_liabilities).toBe(0);
    expect(res.body.data.total_equity).toBe(100000);
    // Net profit (30000) hasn't been closed into equity — this module posts
    // journal entries but doesn't do period-close, so the gap is reported.
    expect(res.body.data.balances).toBe(30000);
  });
});

describe('Phase 8 — tax records', () => {
  test('admin creates a tax record, files it, then marks it paid; skipping straight to paid is rejected', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();

    const created = await authed(request(app).post('/api/v1/accounting/tax-records'), adminToken).send({
      period_month: 9,
      period_year: 2026,
      jurisdiction: 'IN-GST',
      kind: 'GST',
      amount: 18000,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('pending');
    const id = created.body.data.id;

    const tooEarly = await authed(request(app).post(`/api/v1/accounting/tax-records/${id}/pay`), adminToken);
    expect(tooEarly.status).toBe(409);

    const filed = await authed(request(app).post(`/api/v1/accounting/tax-records/${id}/file`), adminToken);
    expect(filed.status).toBe(200);
    expect(filed.body.data.status).toBe('filed');
    expect(filed.body.data.filed_at).not.toBeNull();

    const refile = await authed(request(app).post(`/api/v1/accounting/tax-records/${id}/file`), adminToken);
    expect(refile.status).toBe(409);

    const paid = await authed(request(app).post(`/api/v1/accounting/tax-records/${id}/pay`), adminToken);
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('paid');
    expect(paid.body.data.paid_at).not.toBeNull();
  });

  test('tax records list, filterable by period and jurisdiction', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    await authed(request(app).post('/api/v1/accounting/tax-records'), adminToken).send({
      period_month: 9,
      period_year: 2026,
      jurisdiction: 'IN-GST',
      kind: 'GST',
      amount: 18000,
    });
    await authed(request(app).post('/api/v1/accounting/tax-records'), adminToken).send({
      period_month: 9,
      period_year: 2026,
      jurisdiction: 'IN-TDS',
      kind: 'TDS',
      amount: 5000,
    });

    const byJurisdiction = await authed(request(app).get('/api/v1/accounting/tax-records?jurisdiction=IN-TDS'), adminToken);
    expect(byJurisdiction.body.data).toHaveLength(1);
    expect(byJurisdiction.body.data[0].kind).toBe('TDS');

    const all = await authed(request(app).get('/api/v1/accounting/tax-records?period_month=9&period_year=2026'), adminToken);
    expect(all.body.data).toHaveLength(2);
  });
});
