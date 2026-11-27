/** Time & Attendance > Timesheet gaps: a month in one table, per person and project; a working day with nothing logged is a gap. */
const { app, prisma, request, cleanDatabase, createUser, createOrgMembership, loginAs, authed } = require('./helpers');

let org; let admin; let adminToken;
beforeEach(async () => {
  await cleanDatabase();
  admin = await createUser({ role: 'admin', name: 'Admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  org = await prisma.org.findUnique({ where: { id: (await prisma.orgMembership.findFirst({ where: { person_id: admin.id } })).org_id } });
});
afterAll(async () => { await prisma.$disconnect(); });

test('logged days show their hours, working days with nothing logged on the project are gaps, days outside the allocation are not', async () => {
  const u = await createUser({ role: 'employee', name: 'Dev One', withOrg: false });
  const m = await createOrgMembership(u.id, org.id, { role: 'employee' });
  const p1 = await prisma.account.create({ data: { org_id: org.id, type: 'client', name: 'Proj A', is_project: true, stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
  const p2 = await prisma.account.create({ data: { org_id: org.id, type: 'client', name: 'Proj B', is_project: true, stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
  await prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: p1.id, org_membership_id: m.id, created_by: admin.id } });
  // project B only from the 17th
  await prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: p2.id, org_membership_id: m.id, start_date: new Date('2026-08-17T00:00:00Z'), created_by: admin.id } });
  // August 2026: 3rd (Mon) and 4th (Tue) logged on A
  for (const d of ['2026-08-03', '2026-08-04']) await prisma.timesheetEntry.create({ data: { org_id: org.id, org_membership_id: m.id, account_id: p1.id, date: new Date(`${d}T00:00:00Z`), hours: 8 } });

  const res = await authed(request(app).get('/api/v1/timesheets/missing-matrix'), adminToken).query({ year: 2026, month: 8 });
  expect(res.status).toBe(200);
  const d = res.body.data;
  expect(d.dates).toHaveLength(31);
  const a = d.rows.find((r) => r.project.name === 'Proj A');
  const b = d.rows.find((r) => r.project.name === 'Proj B');
  expect(a.days['2026-08-03']).toMatchObject({ hours: 8, state: 'logged' });
  expect(a.days['2026-08-05'].state).toBe('gap'); // Wednesday, nothing logged
  expect(a.days['2026-08-08'].state).not.toBe('gap'); // Saturday
  expect(a.gap_days).not.toContain('2026-08-03');
  expect(b.days['2026-08-05'].state).toBe('not_allocated');
  expect(b.days['2026-08-18'].state).toBe('gap');
  expect(a.gap_count).toBeGreaterThan(b.gap_count);
  expect(d.summary).toMatchObject({ rows: 2, with_gaps: 2 });
  // one project only
  const onlyB = (await authed(request(app).get('/api/v1/timesheets/missing-matrix'), adminToken).query({ year: 2026, month: 8, project_id: p2.id })).body.data;
  expect(onlyB.rows.map((r) => r.project.name)).toEqual(['Proj B']);

  // an employee sees only their own rows
  const other = await createUser({ role: 'employee', name: 'Dev Two', withOrg: false });
  await createOrgMembership(other.id, org.id, { role: 'employee' });
  const mine = (await authed(request(app).get('/api/v1/timesheets/missing-matrix'), (await loginAs(other)).access_token).query({ year: 2026, month: 8 })).body.data;
  expect(mine.rows).toHaveLength(0);
});
