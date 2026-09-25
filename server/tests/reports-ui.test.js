/**
 * Usage-shaped coverage for RD-114 reports UI: JSON tables + Excel/PDF export.
 */
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createActiveClientAccount,
  createRequirement,
  createProfile,
  authed,
} = require('./helpers');

let adminToken;
let salesToken;
let recruiterToken;
let dateFrom;
let dateTo;

beforeEach(async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin' });
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));

  const account = await createActiveClientAccount(sales.id);
  await createRequirement(salesToken, account.id, { seats_total: 1 });
  await createProfile(recruiterToken);

  const now = new Date();
  dateFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  dateTo = now.toISOString().slice(0, 10);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('RD-114 reports JSON for tables/charts', () => {
  test('admin recruiter-performance returns array rows with chart-friendly metrics', async () => {
    const res = await authed(request(app).get('/api/v1/reports/recruiter-performance'), adminToken).query({
      date_from: dateFrom,
      date_to: dateTo,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const row = res.body.data[0];
    expect(row.recruiter).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String) }));
    expect(typeof row.submissions_total).toBe('number');
    expect(typeof row.profiles_sourced).toBe('number');
  });

  test('aging returns section bags used by the UI tables', async () => {
    const res = await authed(request(app).get('/api/v1/reports/aging'), salesToken).query({ threshold_days: 7 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        stuck_leads: expect.any(Array),
        stuck_requirements: expect.any(Array),
        stuck_submissions: expect.any(Array),
        past_sla_requirements: expect.any(Array),
      })
    );
  });

  test('aging stuck requirements include client, BDA, sales, and recruiters', async () => {
    const bda = await createUser({ role: 'bda', email: 'bda-aging@test.local' });
    const account = await createActiveClientAccount(bda.id);
    const requirement = await createRequirement(salesToken, account.id, { title: 'Aging Enriched Role' });
    await prisma.requirement.update({
      where: { id: requirement.id },
      data: {
        created_at: new Date(Date.now() - 10 * 86400000),
        updated_at: new Date(Date.now() - 10 * 86400000),
      },
    });
    await authed(request(app).post(`/api/v1/requirements/${requirement.id}/assign`), salesToken).send({
      user_id: (await createUser({ role: 'recruiter', email: 'rec-aging@test.local' })).id,
      role_on_req: 'recruiter',
    });

    const res = await authed(request(app).get('/api/v1/reports/aging'), salesToken).query({ threshold_days: 7 });
    expect(res.status).toBe(200);
    const row = res.body.data.stuck_requirements.find((r) => r.requirement?.id === requirement.id);
    expect(row).toEqual(
      expect.objectContaining({
        client: expect.objectContaining({ id: account.id }),
        bda: expect.objectContaining({ id: bda.id }),
        sales_owner: expect.objectContaining({ id: expect.any(String) }),
        recruiters: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]),
      })
    );
  });

  test('admin can open bda-performance and sales-performance', async () => {
    const bda = await createUser({ role: 'bda', email: 'bda-report@test.local' });
    await createActiveClientAccount(bda.id);

    const bdaRes = await authed(request(app).get('/api/v1/reports/bda-performance'), adminToken).query({
      date_from: dateFrom,
      date_to: dateTo,
    });
    expect(bdaRes.status).toBe(200);
    expect(Array.isArray(bdaRes.body.data)).toBe(true);
    expect(bdaRes.body.data.some((r) => r.bda?.id === bda.id)).toBe(true);

    const salesRes = await authed(request(app).get('/api/v1/reports/sales-performance'), adminToken).query({
      date_from: dateFrom,
      date_to: dateTo,
    });
    expect(salesRes.status).toBe(200);
    expect(Array.isArray(salesRes.body.data)).toBe(true);
    expect(salesRes.body.data.length).toBeGreaterThan(0);
    expect(salesRes.body.data[0]).toEqual(
      expect.objectContaining({
        sales_person: expect.objectContaining({ id: expect.any(String) }),
        requirements_opened: expect.any(Number),
      })
    );
  });

  test('recruiter cannot open sales-performance', async () => {
    const res = await authed(request(app).get('/api/v1/reports/sales-performance'), recruiterToken).query({
      date_from: dateFrom,
      date_to: dateTo,
    });
    expect(res.status).toBe(403);
  });

  test('client-performance mirrors vendor-performance shape for client accounts', async () => {
    const res = await authed(request(app).get('/api/v1/reports/client-performance'), adminToken).query({
      date_from: dateFrom,
      date_to: dateTo,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({
        client: expect.objectContaining({ id: expect.any(String), name: expect.any(String) }),
        requirements_total: expect.any(Number),
        submissions_total: expect.any(Number),
      })
    );
  });

  test('recruiter cannot open client-performance', async () => {
    const res = await authed(request(app).get('/api/v1/reports/client-performance'), recruiterToken).query({
      date_from: dateFrom,
      date_to: dateTo,
    });
    expect(res.status).toBe(403);
  });
});

describe('RD-114 export downloads', () => {
  test('xlsx export returns spreadsheet bytes for recruiter-performance', async () => {
    const res = await authed(request(app).get('/api/v1/reports/export'), adminToken)
      .query({
        type: 'xlsx',
        report: 'recruiter-performance',
        date_from: dateFrom,
        date_to: dateTo,
      })
      .buffer()
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    expect(res.headers['content-disposition']).toMatch(/\.xlsx/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(100);
  });

  test('pdf export returns pdf bytes for aging with multi-section data', async () => {
    const res = await authed(request(app).get('/api/v1/reports/export'), salesToken)
      .query({ type: 'pdf', report: 'aging', threshold_days: 7 })
      .buffer()
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
    expect(res.body.slice(0, 4).toString()).toBe('%PDF');
  });

  test('unknown report type is rejected', async () => {
    const res = await authed(request(app).get('/api/v1/reports/export'), adminToken).query({
      type: 'xlsx',
      report: 'not-a-report',
      date_from: dateFrom,
      date_to: dateTo,
    });
    expect(res.status).toBe(422);
  });
});
