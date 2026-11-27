/** People > Seating: desks per office, who sits where, who is in today, and the room left for hiring. */
const { app, prisma, request, cleanDatabase, createUser, createOrgMembership, loginAs, authed } = require('./helpers');

test('add desks, seat people (one desk each), free a desk, delete a free desk; the summary counts the room for hiring', async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE office_seats');
  const admin = await createUser({ role: 'admin' });
  const token = (await loginAs(admin)).access_token;
  const org = await prisma.org.findUnique({ where: { id: (await prisma.orgMembership.findFirst({ where: { person_id: admin.id } })).org_id } });
  const office = await prisma.location.create({ data: { org_id: org.id, name: 'Pune HQ' } });
  const person = async (name, extra = {}) => { const u = await createUser({ role: 'employee', name, withOrg: false }); const m = await createOrgMembership(u.id, org.id, { role: 'employee' }); return prisma.orgMembership.update({ where: { id: m.id }, data: { location_id: office.id, ...extra } }); };
  const asha = await person('Asha');
  const ben = await person('Ben');
  await person('Cara');
  await person('Dev Joining', { employment_status: 'pending_onboarding' });
  await prisma.team.create({ data: { org_id: org.id, name: 'Eng', open_positions: 2 } });
  await prisma.attendanceRecord.create({ data: { org_id: org.id, org_membership_id: asha.id, date: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`), status: 'present' } });

  const api = (m, url) => authed(request(app)[m](`/api/v1/seating${url}`), token);
  expect((await api('post', '/seats').send({ location_id: office.id, prefix: 'A-', count: 4, zone: 'Floor 1' })).body.data).toMatchObject({ added: 4 });
  expect((await api('post', '/seats').send({ location_id: office.id, labels: ['A-1', 'B-1'] })).body.data).toMatchObject({ added: 1, skipped: 1 });
  let o = (await api('get', `?location_id=${office.id}`)).body.data;
  expect(o.seats.map((s) => s.label).sort()).toEqual(['A-1', 'A-2', 'A-3', 'A-4', 'B-1']);
  const seat = (label) => o.seats.find((s) => s.label === label);
  await api('put', `/seats/${seat('A-1').id}/person`).send({ org_membership_id: asha.id });
  await api('put', `/seats/${seat('A-2').id}/person`).send({ org_membership_id: ben.id });
  // Ben moves to A-3: A-2 is free again
  await api('put', `/seats/${seat('A-3').id}/person`).send({ org_membership_id: ben.id });
  o = (await api('get', `?location_id=${office.id}`)).body.data;
  expect(seat('A-1').id).toBeTruthy();
  expect(o.seats.find((s) => s.label === 'A-1').person).toMatchObject({ name: 'Asha', in_office_today: true });
  expect(o.seats.find((s) => s.label === 'A-2').person).toBeNull();
  expect(o.seats.find((s) => s.label === 'A-3').person.name).toBe('Ben');
  expect(o.unseated.map((p) => p.name)).toEqual(['Cara']);
  expect(o.summary).toMatchObject({ seats: 5, occupied: 2, free: 3, people: 3, unseated: 1, in_office_today: 1, joining_soon: 1, open_positions: 2, room_for_hiring: 1 });
  // a desk someone sits at cannot be deleted or switched off; a free one can
  expect((await api('delete', `/seats/${seat('A-1').id}`)).status).toBe(409);
  expect((await api('patch', `/seats/${seat('A-1').id}`).send({ active: false })).status).toBe(409);
  expect((await api('delete', `/seats/${seat('A-4').id}`)).status).toBe(200);
  expect((await api('put', `/seats/${seat('A-1').id}/person`).send({ org_membership_id: null })).status).toBe(200);
  // an employee without HR settings cannot change desks
  const emp = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(emp.id, org.id, { role: 'employee' });
  expect((await authed(request(app).post('/api/v1/seating/seats'), (await loginAs(emp)).access_token).send({ location_id: office.id, count: 1 })).status).toBeGreaterThanOrEqual(401);
  await prisma.$disconnect();
});
