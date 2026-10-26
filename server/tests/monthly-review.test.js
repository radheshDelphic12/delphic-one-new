// Monthly performance review (Reports): per employee and month, attendance plus the measures of the person's function; every count has
// the records behind it. Admin only.
const { prisma, request, app, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => { await cleanDatabase(); });
afterAll(async () => { await prisma.$disconnect(); });

const now = new Date();
const key = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 7);
const inMonth = (day) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 6));

async function seed() {
  const org = await createOrg();
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const admin = (await loginAs(adminUser)).access_token;
  const dept = async (name) => prisma.department.create({ data: { org_id: org.id, name } });
  const person = async (name, department, joined = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 3))) => {
    const user = await createUser({ role: 'recruiter', name });
    const m = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: joined });
    await prisma.orgMembership.update({ where: { id: m.id }, data: { department_id: department.id, employee_code: `E-${name.slice(0, 3)}` } });
    return { user, m };
  };
  return { org, admin, adminUser, dept, person };
}
const get = (path, token) => authed(request(app).get(`/api/v1/reports${path}`), token);

describe('monthly performance review', () => {
  test('a sales person: meetings, clients that became Active, requirements brought / owned, each with its records', async () => {
    const ctx = await seed();
    const sales = await ctx.dept('Sales');
    const dheeraj = await ctx.person('Dheeraj Kumar', sales);
    const mk = (name, stage) => prisma.account.create({ data: { org_id: ctx.org.id, name, type: 'client', stage, owner_id: dheeraj.user.id, origin_owner_id: dheeraj.user.id } });
    const acme = await mk('Acme', 'active');
    const beta = await mk('Beta', 'meeting_scheduled');
    for (const a of [acme, beta]) await prisma.stageHistory.create({ data: { entity_type: 'account', entity_id: a.id, from_stage: 'lead', to_stage: 'meeting_scheduled', changed_by: dheeraj.user.id, changed_at: inMonth(5) } });
    await prisma.requirement.create({ data: { account_id: acme.id, title: 'Java Dev', req_type: 'recruitment', sales_owner_id: dheeraj.user.id, created_at: inMonth(6) } });

    const res = await get(`/monthly-review?from_month=${key}&to_month=${key}`, ctx.admin);
    expect(res.status).toBe(200);
    const p = res.body.data.people.find((x) => x.name === 'Dheeraj Kumar');
    expect(p).toMatchObject({ function: 'sales', employee_code: 'E-Dhe' });
    const row = p.months.find((m) => m.key === key);
    const count = (k) => row.metrics.find((m) => m.key === k).count;
    expect(count('meetings_scheduled')).toBe(2);
    expect(count('clients_active')).toBe(1);
    expect(count('req_brought')).toBe(1);
    expect(count('req_owned')).toBe(1);

    const ym = `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
    const det = await get(`/monthly-review/details?org_membership_id=${dheeraj.m.id}&metric=clients_active&${ym}`, ctx.admin);
    expect(det.status).toBe(200);
    expect(det.body.data.items.map((i) => i.title)).toEqual(['Acme']);
    const det2 = await get(`/monthly-review/details?org_membership_id=${dheeraj.m.id}&metric=req_brought&${ym}`, ctx.admin);
    expect(det2.body.data.items[0]).toMatchObject({ title: 'Java Dev', sub: 'Acme' });
  });

  test('attendance: working days and present days per month, and "data not available" for a past month with nothing recorded', async () => {
    const ctx = await seed();
    const hr = await ctx.dept('HR');
    const e = await ctx.person('Hira HR', hr, new Date(Date.UTC(2026, 0, 15)));
    await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: e.m.id, date: new Date('2026-03-03T00:00:00Z'), status: 'present' } });
    const res = await get('/monthly-review?from_month=2026-01&to_month=2026-03&function=hr', ctx.admin);
    const p = res.body.data.people.find((x) => x.name === 'Hira HR');
    const by = Object.fromEntries(p.months.map((m) => [m.key, m]));
    expect(Object.keys(by).sort()).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(by['2026-01'].working_days).toBeGreaterThan(5);
    expect(by['2026-01'].working_days).toBeLessThan(by['2026-02'].working_days + 3); // starts on 15 Jan: fewer than a full month
    expect(by['2026-01'].no_data).toBe(true);
    expect(by['2026-03'].present).toBe(1);
    expect(by['2026-03'].no_data).toBe(false);
    expect(p.months[0].key).toBe('2026-03'); // newest first
    expect(by['2026-03'].metrics.map((m) => m.key)).toEqual(['profiles_submitted', 'joinings', 'vendors_onboarded']);
  });

  test('IT: active projects split into billable and non-billable, narrowed by the checkboxes', async () => {
    const ctx = await seed();
    const it = await ctx.dept('IT');
    const dev = await ctx.person('Ravi IT', it);
    const owner = ctx.adminUser;
    const proj = (name) => prisma.account.create({ data: { org_id: ctx.org.id, name, type: 'client', stage: 'active', owner_id: owner.id, is_project: true } });
    const paid = await proj('Paid Project');
    const free = await proj('Delphic Internal');
    await prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: paid.id, rate_type: 'monthly', rate: 50000, effective_from: new Date('2020-01-01'), created_by: owner.id } });
    for (const a of [paid, free]) await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: a.id, org_membership_id: dev.m.id, created_by: owner.id, start_date: new Date('2020-01-01') } });

    const metrics = async (extra) => {
      const res = await get(`/monthly-review?from_month=${key}&to_month=${key}&function=it${extra}`, ctx.admin);
      return Object.fromEntries(res.body.data.people[0].months[0].metrics.map((m) => [m.key, m.count]));
    };
    expect(await metrics('')).toEqual({ projects_active: 1, projects_billable: 1, projects_daily: 1 });
    expect(await metrics('&include_non_billable=1')).toEqual({ projects_active: 2, projects_billable: 1, projects_non_billable: 1, projects_daily: 2 });
    expect(await metrics('&include_billable=0&include_non_billable=1')).toEqual({ projects_active: 1, projects_non_billable: 1, projects_daily: 1 });

    // the daily measure lists every day with how many projects the person was on
    const ym = `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
    const daily = await get(`/monthly-review/details?org_membership_id=${dev.m.id}&metric=projects_daily&include_non_billable=1&${ym}`, ctx.admin);
    expect(daily.status).toBe(200);
    expect(daily.body.data.items.length).toBeGreaterThan(0);
    expect(daily.body.data.items.every((i) => i.title === '2 projects')).toBe(true);
  });

  test('export: Excel and PDF carry every employee and month of the filtered review', async () => {
    const ctx = await seed();
    const hr = await ctx.dept('HR');
    await ctx.person('Hira HR', hr);
    const xlsx = await authed(request(app).get(`/api/v1/reports/monthly-review/export?type=xlsx&function=hr`), ctx.admin).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect(xlsx.body.length).toBeGreaterThan(500);
    const pdf = await authed(request(app).get(`/api/v1/reports/monthly-review/export?type=pdf&function=hr`), ctx.admin).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect((await get('/monthly-review/export?type=csv', ctx.admin)).status).toBe(422);
  });

  test('admin only, and paginated by employee', async () => {
    const ctx = await seed();
    const sales = await ctx.dept('Sales');
    const a = await ctx.person('Anna', sales);
    await ctx.person('Bob', sales);
    await ctx.person('Cara', sales);
    expect((await get('/monthly-review', (await loginAs(a.user)).access_token)).status).toBe(403);
    const page = await get('/monthly-review?limit=2&page=2', ctx.admin);
    expect(page.body.data.total).toBe(4);
    expect(page.body.data.pages).toBe(2);
    expect(page.body.data.people.length).toBe(2);
  });
});
