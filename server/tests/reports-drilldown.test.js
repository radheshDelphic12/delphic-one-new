/**
 * GET /reports/drilldown — the records behind one count in a report table.
 * Every list must add up to the count it was opened from.
 */
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createRequirement,
  authed,
  unique,
} = require('./helpers');

let adminToken;
let bda;
let bdaToken;
let otherBda;
let sales;
let salesToken;
let otherSales;
let otherSalesToken;
let recruiter;
let recruiterToken;

const iso = (d) => d.toISOString().slice(0, 10);
const SEP = new Date('2026-09-10T06:00:00Z');
const RANGE_END = new Date(Math.max(Date.now(), Date.parse('2026-09-30T00:00:00Z')) + 2 * 86400000);
const RANGE = { date_from: '2026-09-01', date_to: iso(RANGE_END) };

const mkAccount = (over = {}) =>
  prisma.account.create({
    data: { type: 'client', name: unique('Client '), stage: 'lead', owner_id: bda.id, origin_owner_id: bda.id, ...over },
  });

const drill = (token, query) => authed(request(app).get('/api/v1/reports/drilldown').query(query), token);

beforeEach(async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin' });
  bda = await createUser({ role: 'bda', name: 'Dheeraj BDA' });
  otherBda = await createUser({ role: 'bda', name: 'Other BDA' });
  sales = await createUser({ role: 'sales', name: 'Chahak Sales' });
  otherSales = await createUser({ role: 'sales', name: 'Tanvi Sales' });
  recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: bdaToken } = await loginAs(bda));
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: otherSalesToken } = await loginAs(otherSales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('drilldown: bda-reports', () => {
  test('accounts brought: the list matches the per-day count', async () => {
    await mkAccount({ created_at: SEP });
    await mkAccount({ type: 'vendor', created_at: SEP });
    await mkAccount({ created_at: SEP, origin_owner_id: otherBda.id });

    const report = await authed(request(app).get('/api/v1/reports/bda-reports').query(RANGE), adminToken);
    const row = report.body.data.tables.find((t) => t.key === 'accounts_created').rows.find((r) => r.bda_id === bda.id);
    expect(row.count).toBe(2);

    const res = await drill(adminToken, { report: 'bda-reports', table: 'accounts_created', person_id: bda.id, date: row.date });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(row.count);
    expect(res.body.data.rows).toHaveLength(2);
    expect(res.body.data.rows[0].link).toMatch(/^\/accounts\//);
  });

  test('a BDA cannot widen a drill-down to another BDA', async () => {
    await mkAccount({ created_at: SEP });
    await mkAccount({ created_at: SEP, origin_owner_id: otherBda.id });
    const res = await drill(bdaToken, { report: 'bda-reports', table: 'accounts_created', person_id: otherBda.id, date: '2026-09-10' });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
  });

  test('converted-to-active counts an account once even if it was rescheduled', async () => {
    const account = await mkAccount();
    const meet = (token) =>
      authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), token).send({
        to_stage: 'meeting_scheduled',
        meeting_mode: 'online',
        meeting_date: SEP.toISOString(),
      });
    expect((await meet(bdaToken)).status).toBe(200);
    expect(
      (await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({ to_stage: 'rescheduled' })).status
    ).toBe(200);
    expect((await meet(bdaToken)).status).toBe(200);
    await authed(request(app).post(`/api/v1/accounts/${account.id}/stage`), bdaToken).send({ to_stage: 'active' });

    const report = await authed(request(app).get('/api/v1/reports/bda-reports').query(RANGE), adminToken);
    const rollup = report.body.data.tables.find((t) => t.key === 'meetings_conversion').rows.find((r) => r.bda_id === bda.id);
    expect(rollup.meetings_scheduled).toBe(2);
    expect(rollup.converted_to_active).toBe(1);

    const scheduled = await drill(adminToken, { report: 'bda-reports', table: 'meetings_conversion', metric: 'meetings_scheduled', person_id: bda.id, ...RANGE });
    expect(scheduled.body.data.total).toBe(2);
    const converted = await drill(adminToken, { report: 'bda-reports', table: 'meetings_conversion', metric: 'converted_to_active', person_id: bda.id, ...RANGE });
    expect(converted.body.data.total).toBe(1);
  });
});

describe('drilldown: sales-reports', () => {
  test('requirements created lists exactly that sales person\'s requirements for the day', async () => {
    const client = await mkAccount({ stage: 'active' });
    await createRequirement(salesToken, client.id, { title: 'Mine A' });
    await createRequirement(salesToken, client.id, { title: 'Mine B' });
    await createRequirement(otherSalesToken, client.id, { title: 'Theirs' });

    const report = await authed(request(app).get('/api/v1/reports/sales-reports').query(RANGE), adminToken);
    const row = report.body.data.tables.find((t) => t.key === 'requirements_created').rows.find((r) => r.sales_poc_id === sales.id);
    expect(row.count).toBe(2);

    const res = await drill(adminToken, { report: 'sales-reports', table: 'requirements_created', person_id: sales.id, date: row.date });
    expect(res.status).toBe(200);
    expect(res.body.data.rows.map((r) => r.title).sort()).toEqual(['Mine A', 'Mine B']);
  });

  test('a sales user is pinned to their own rows', async () => {
    const client = await mkAccount({ stage: 'active' });
    await createRequirement(salesToken, client.id, { title: 'Mine' });
    const other = await createRequirement(otherSalesToken, client.id, { title: 'Theirs' });
    const date = iso(new Date(other.created_at));

    const res = await drill(salesToken, { report: 'sales-reports', table: 'requirements_created', person_id: otherSales.id, date });
    expect(res.status).toBe(200);
    expect(res.body.data.rows.map((r) => r.title)).toEqual(['Mine']);
  });
});

describe('drilldown: coverage reports + access', () => {
  test('clients-without-requirements lists the active requirements behind the count', async () => {
    const client = await mkAccount({ stage: 'active' });
    await createRequirement(salesToken, client.id, { title: 'Open one' });
    const closed = await createRequirement(salesToken, client.id, { title: 'Closed one' });
    await prisma.requirement.update({ where: { id: closed.id }, data: { status: 'closed' } });

    const report = await authed(request(app).get('/api/v1/reports/clients-without-requirements').query({ stage: 'active', bucket: 'all' }), adminToken);
    expect(report.body.data.find((r) => r.client.id === client.id).active_requirements_count).toBe(1);

    const res = await drill(adminToken, { report: 'clients-without-requirements', table: 'main', metric: 'active_requirements_count', account_id: client.id });
    expect(res.body.data.rows.map((r) => r.title)).toEqual(['Open one']);
  });

  test('recruiter-vendor-gaps: sourced profiles behind a vendor row', async () => {
    const vendor = await mkAccount({ type: 'vendor', stage: 'active' });
    await prisma.profile.createMany({
      data: [
        { name: 'P1', added_by: recruiter.id, vendor_account_id: vendor.id, source: 'vendor', total_experience_years: 3, primary_skills: ['x'] },
        { name: 'P2', added_by: recruiter.id, vendor_account_id: vendor.id, source: 'vendor', total_experience_years: 3, primary_skills: ['x'] },
      ],
    });
    const report = await authed(request(app).get('/api/v1/reports/recruiter-vendor-gaps'), recruiterToken);
    expect(report.body.data.find((r) => r.vendor.id === vendor.id).profiles_sourced).toBe(2);

    const res = await drill(recruiterToken, { report: 'recruiter-vendor-gaps', table: 'main', metric: 'profiles_sourced', account_id: vendor.id });
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);
  });

  test('roles that cannot open a report cannot drill into it, and unknown tables are rejected', async () => {
    expect((await drill(recruiterToken, { report: 'hr', table: 'sourcing' })).status).toBe(403);
    expect((await drill(salesToken, { report: 'hr', table: 'sourcing' })).status).toBe(403);
    expect((await drill(adminToken, { report: 'hr', table: 'nope' })).status).toBe(422);
  });
});
