/** Dashboard > My projects: the caller's own projects and hours, by week / month / quarter / year. */
const { app, prisma, request, cleanDatabase, createUser, createOrgMembership, loginAs, authed } = require('./helpers');

test('own allocations and hours, split by day / week / month; another person sees only theirs', async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin' });
  await loginAs(admin);
  const org = await prisma.org.findUnique({ where: { id: (await prisma.orgMembership.findFirst({ where: { person_id: admin.id } })).org_id } });
  const u = await createUser({ role: 'employee', name: 'Dev', withOrg: false });
  const m = await createOrgMembership(u.id, org.id, { role: 'employee' });
  const token = (await loginAs(u)).access_token;
  const pa = await prisma.account.create({ data: { org_id: org.id, type: 'client', name: 'A', project_name: 'Proj A', is_project: true, stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
  const pb = await prisma.account.create({ data: { org_id: org.id, type: 'client', name: 'B', project_name: 'Proj B', is_project: true, stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
  await prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: pa.id, org_membership_id: m.id, allocation_percent: 60, created_by: admin.id } });
  await prisma.projectMemberAssignment.create({ data: { org_id: org.id, account_id: pb.id, org_membership_id: m.id, created_by: admin.id } });
  const log = (acc, d, h) => prisma.timesheetEntry.create({ data: { org_id: org.id, org_membership_id: m.id, account_id: acc.id, date: new Date(`${d}T00:00:00Z`), hours: h } });
  await log(pa, '2026-11-23', 5); await log(pb, '2026-11-23', 3); await log(pa, '2026-11-25', 8); await log(pa, '2026-10-05', 4);

  const get = (q, t = token) => authed(request(app).get('/api/v1/timesheets/my-work'), t).query(q);
  const week = (await get({ period: 'week', date: '2026-11-25' })).body.data;
  expect(week).toMatchObject({ label: 'Week of 23 Nov 2026', from: '2026-11-23', to: '2026-11-29', total_hours: 16, previous: '2026-11-22', next: '2026-11-30' });
  const a = week.projects.find((p) => p.name === 'Proj A');
  expect(a).toMatchObject({ hours: 13, allocated: true, allocation: { percent: 60 } });
  expect(a.by_part).toEqual({ '2026-11-23': 5, '2026-11-25': 8 });
  expect(week.totals['2026-11-23']).toBe(8);
  const quarter = (await get({ period: 'quarter', date: '2026-11-25' })).body.data;
  expect(quarter.label).toBe('Q4 2026');
  expect(quarter.projects.find((p) => p.name === 'Proj A').by_part).toEqual({ '2026-10': 4, '2026-11': 13 });
  const year = (await get({ period: 'year', date: '2026-11-25' })).body.data;
  expect(year.parts).toHaveLength(12);
  expect(year.total_hours).toBe(20);

  const other = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(other.id, org.id, { role: 'employee' });
  const theirs = (await get({ period: 'year', date: '2026-11-25' }, (await loginAs(other)).access_token)).body.data;
  expect(theirs.projects).toHaveLength(0);
  await prisma.$disconnect();
});
