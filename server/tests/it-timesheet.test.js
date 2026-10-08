const ExcelJS = require('exceljs');
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createOrg,
  createOrgMembership,
  createActiveClientAccount,
  authed,
} = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedItUser(org, role = 'recruiter') {
  const dept = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
  const user = await createUser({ role });
  await prisma.user.update({ where: { id: user.id }, data: { department_id: dept.id } });
  const membership = await createOrgMembership(user.id, org.id, { role });
  const { access_token } = await loginAs(user);
  return { user, dept, membership, token: access_token };
}

// IT staff may only log against projects they're allocated to.
async function assign(org, membership, ...accounts) {
  const adminUser = await createUser({ role: 'admin' });
  for (const account of accounts) {
    await prisma.projectMemberAssignment.create({
      data: { org_id: org.id, account_id: account.id, org_membership_id: membership.id, created_by: adminUser.id },
    });
  }
}

async function seedNonItUser(org, role = 'recruiter') {
  const user = await createUser({ role });
  await createOrgMembership(user.id, org.id, { role });
  const { access_token } = await loginAs(user);
  return { user, token: access_token };
}

describe('IT timesheet — multi-project daily log (Date / Project / Hours / Description)', () => {
  test('an IT member logs several tasks against several assigned projects in one day; the monthly log groups them with a correct running total', async () => {
    const org = await createOrg();
    const { token, membership } = await seedItUser(org);
    const projectA = await createActiveClientAccount(membership.person_id);
    await prisma.account.update({ where: { id: projectA.id }, data: { org_id: org.id } });
    const projectB = await createActiveClientAccount(projectA.owner_id);
    await prisma.account.update({ where: { id: projectB.id }, data: { org_id: org.id } });
    await assign(org, membership, projectA, projectB);

    const date = '2026-07-01';
    const rows = [
      { account_id: projectA.id, hours: 3, notes: 'Reviewed PRs' },
      { account_id: projectA.id, hours: 1.5, notes: 'Standup' },
      { account_id: projectB.id, hours: 2, notes: 'Wrote spec' },
    ];
    for (const row of rows) {
      const res = await authed(request(app).post('/api/v1/timesheets/entries'), token).send({ date, ...row, module_name: 'ignored' });
      expect(res.status).toBe(201);
      expect(res.body.data.module_name).toBeNull(); // the Module field no longer exists
    }

    const log = await authed(request(app).get('/api/v1/timesheets/my-log').query({ month: 7, year: 2026 }), token);
    expect(log.status).toBe(200);
    expect(log.body.data).toHaveLength(1);
    expect(log.body.data[0]).toMatchObject({ date, total_hours: 6.5 });
    expect(log.body.data[0].entries).toHaveLength(3);
    expect(log.body.data[0].entries.map((e) => e.notes).sort()).toEqual(['Reviewed PRs', 'Standup', 'Wrote spec']);
    expect(log.body.data[0].entries[0]).not.toHaveProperty('module_name');
  });

  test('the 24h/day cap still applies across projects the same way it does for ordinary timesheet entries', async () => {
    const org = await createOrg();
    const { token, membership } = await seedItUser(org);
    const project = await createActiveClientAccount(membership.person_id);
    await prisma.account.update({ where: { id: project.id }, data: { org_id: org.id } });
    await assign(org, membership, project);

    const date = '2026-07-02';
    const first = await authed(request(app).post('/api/v1/timesheets/entries'), token).send({ date, account_id: project.id, hours: 20 });
    expect(first.status).toBe(201);
    const second = await authed(request(app).post('/api/v1/timesheets/entries'), token).send({ date, account_id: project.id, hours: 5 });
    expect(second.status).toBe(422);
  });

  test('a non-IT employee can open their own project log and export', async () => {
    const org = await createOrg();
    const { token } = await seedNonItUser(org);

    const log = await authed(request(app).get('/api/v1/timesheets/my-log').query({ month: 7, year: 2026 }), token);
    expect(log.status).toBe(200);

    const xlsx = await authed(request(app).get('/api/v1/timesheets/export/excel').query({ month: 7, year: 2026 }), token);
    expect(xlsx.status).toBe(200);

    const ordinary = await authed(request(app).get('/api/v1/timesheets/entries/me'), token);
    expect(ordinary.status).toBe(200);
  });

  test('an admin (not IT) can still reach the IT log and export — the oversight bypass', async () => {
    const org = await createOrg();
    const admin = await createUser({ role: 'admin' });
    await createOrgMembership(admin.id, org.id, { role: 'admin' });
    const { access_token } = await loginAs(admin);

    const log = await authed(request(app).get('/api/v1/timesheets/my-log').query({ month: 7, year: 2026 }), access_token);
    expect(log.status).toBe(200);
  });

  test('leaving the IT department does not remove the person\'s own project log', async () => {
    const org = await createOrg();
    const { user, token } = await seedItUser(org);

    const before = await authed(request(app).get('/api/v1/timesheets/my-log').query({ month: 7, year: 2026 }), token);
    expect(before.status).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { department_id: null } });

    const after = await authed(request(app).get('/api/v1/timesheets/my-log').query({ month: 7, year: 2026 }), token);
    expect(after.status).toBe(200);
  });

  test('the Excel export produces a real workbook with the title, legend, itemized rows, and a Weekly Holiday row for a weekend with nothing logged', async () => {
    const org = await createOrg();
    const { token, membership } = await seedItUser(org);
    const project = await createActiveClientAccount(membership.person_id);
    await prisma.account.update({ where: { id: project.id }, data: { org_id: org.id } });
    await assign(org, membership, project);

    await authed(request(app).post('/api/v1/timesheets/entries'), token).send({
      date: '2026-07-01', account_id: project.id, hours: 8, notes: 'Built the export',
    });

    const res = await authed(request(app).get('/api/v1/timesheets/export/excel').query({ month: 7, year: 2026 }), token).buffer(true).parse((response, cb) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    const sheet = workbook.worksheets[0];
    const allText = [];
    sheet.eachRow((row) => allText.push(row.values.filter(Boolean).join(' | ')));
    const text = allText.join('\n');

    expect(text).toContain('Timesheet for the Month of July- 2026');
    expect(text).toContain('CH - Company Holiday');
    expect(text).toContain(project.name);
    expect(text).toContain('Built the export');
    expect(text).not.toContain('Modules');
    expect(text).toContain('Weekly Holiday');
  });

  test('rejects a request for an unknown org membership (admin exporting a bogus id) instead of 500ing', async () => {
    const org = await createOrg();
    const admin = await createUser({ role: 'admin' });
    await createOrgMembership(admin.id, org.id, { role: 'admin' });
    const { access_token } = await loginAs(admin);

    const res = await authed(request(app).get('/api/v1/timesheets/export/excel').query({ month: 7, year: 2026, org_membership_id: '00000000-0000-0000-0000-000000000000' }), access_token);
    expect(res.status).toBe(404);
  });
});
