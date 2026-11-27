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

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedOrgAdmin() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, access_token };
}

async function seedOrgEmployee(org, role = 'recruiter') {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role });
  const { access_token } = await loginAs(user);
  return { user, membership, access_token };
}

describe('Client-brief amendment — locations', () => {
  test('admin creates default locations, everyone can list them', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);

    for (const name of ['Ahmedabad', 'Indore', 'Gurgaon']) {
      const res = await authed(request(app).post('/api/v1/orgs/locations'), adminToken).send({
        name,
        city: name,
        country: 'India',
      });
      expect(res.status).toBe(201);
    }

    const dup = await authed(request(app).post('/api/v1/orgs/locations'), adminToken).send({ name: 'Ahmedabad' });
    expect(dup.status).toBe(409);

    const list = await authed(request(app).get('/api/v1/orgs/locations'), empToken);
    expect(list.status).toBe(200);
    expect(list.body.data.map((l) => l.name).sort()).toEqual(['Ahmedabad', 'Gurgaon', 'Indore']);
  });

  test('a non-admin cannot create a location', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const res = await authed(request(app).post('/api/v1/orgs/locations'), access_token).send({ name: 'Pune' });
    expect(res.status).toBe(403);
  });
});

describe('Client-brief amendment — HR POC, sourcing POC, manager mapping', () => {
  test('admin sets location/shift/HR POC/sourcing POC/manager on a membership', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { user: hr } = await seedOrgEmployee(org, 'admin');
    const { user: recruiter } = await seedOrgEmployee(org, 'recruiter');
    const { membership: managerMembership } = await seedOrgEmployee(org, 'admin');
    const { membership: empMembership } = await seedOrgEmployee(org);

    const loc = await authed(request(app).post('/api/v1/orgs/locations'), adminToken).send({ name: 'Gurgaon' });

    const patch = await authed(request(app).patch(`/api/v1/orgs/memberships/${empMembership.id}`), adminToken).send({
      location_id: loc.body.data.id,
      hr_poc_id: hr.id,
      sourcing_poc_id: recruiter.id,
      manager_id: managerMembership.id,
    });
    expect(patch.status).toBe(200);
    expect(patch.body.data.location.name).toBe('Gurgaon');
    expect(patch.body.data.hr_poc.id).toBe(hr.id);
    expect(patch.body.data.sourcing_poc.id).toBe(recruiter.id);
    expect(patch.body.data.manager.id).toBe(managerMembership.id);
  });

  test('a membership cannot be set as its own manager', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);

    const res = await authed(request(app).patch(`/api/v1/orgs/memberships/${membership.id}`), adminToken).send({
      manager_id: membership.id,
    });
    expect(res.status).toBe(422);
  });

  test('manager must be a membership in the same org', async () => {
    const { org: orgA, access_token: adminToken } = await seedOrgAdmin();
    const orgB = await createOrg({ name: 'Acconcy', slug: 'acconcy' });
    const { membership: empA } = await seedOrgEmployee(orgA);
    const { membership: empB } = await seedOrgEmployee(orgB);

    const res = await authed(request(app).patch(`/api/v1/orgs/memberships/${empA.id}`), adminToken).send({
      manager_id: empB.id,
    });
    expect(res.status).toBe(404);
  });
});

describe('Client-brief amendment — shifts', () => {
  test('admin creates a shift (check-in / overtime-from-check-out no longer exist)', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const shift = await authed(request(app).post('/api/v1/attendance/shifts'), adminToken).send({
      name: 'General',
      start_minutes: 9 * 60,
      end_minutes: 18 * 60,
      grace_minutes: 15,
    });
    expect(shift.status).toBe(201);
    const dup = await authed(request(app).post('/api/v1/attendance/shifts'), adminToken).send({
      name: 'General',
      start_minutes: 9 * 60,
      end_minutes: 18 * 60,
      grace_minutes: 15,
    });
    expect(dup.status).toBe(409);
  });

  test('HR settings edit: a shift, a department and a designation can be renamed / retimed; a clash or an unknown id is refused', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const post = (url, body) => authed(request(app).post(`/api/v1${url}`), adminToken).send(body);
    const patch = (url, body) => authed(request(app).patch(`/api/v1${url}`), adminToken).send(body);
    const day = (await post('/attendance/shifts', { name: 'Day', start_minutes: 540, end_minutes: 1080, grace_minutes: 15 })).body.data;
    await post('/attendance/shifts', { name: 'Night', start_minutes: 1260, end_minutes: 360 });
    const edited = await patch(`/attendance/shifts/${day.id}`, { name: 'Day (10-7)', start_minutes: 600, end_minutes: 1140, grace_minutes: 10 });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ name: 'Day (10-7)', start_minutes: 600, end_minutes: 1140, grace_minutes: 10 });
    expect((await patch(`/attendance/shifts/${day.id}`, { name: 'Night' })).status).toBe(409);
    expect((await patch(`/attendance/shifts/${day.id}`, {})).status).toBe(422);
    expect((await patch('/attendance/shifts/00000000-0000-4000-8000-000000000000', { name: 'X' })).status).toBe(404);

    const dept = (await post('/departments', { name: 'Engg' })).body.data;
    expect((await patch(`/departments/${dept.id}`, { name: 'Engineering' })).body.data.name).toBe('Engineering');
    const desig = (await post('/designations', { name: 'SDE' })).body.data;
    expect((await patch(`/designations/${desig.id}`, { name: 'Software Engineer' })).body.data.name).toBe('Software Engineer');
  });

  test('HR settings delete: a department, designation or shift in use is refused with the count; an unused one is deleted', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const post = (url, body) => authed(request(app).post(`/api/v1${url}`), adminToken).send(body);
    const del = (url) => authed(request(app).delete(`/api/v1${url}`), adminToken);
    const dept = (await post('/departments', { name: 'Used Dept' })).body.data;
    const spare = (await post('/departments', { name: 'Spare Dept' })).body.data;
    const desig = (await post('/designations', { name: 'Used Role' })).body.data;
    const shift = (await post('/attendance/shifts', { name: 'Used Shift', start_minutes: 540, end_minutes: 1080 })).body.data;
    const spareShift = (await post('/attendance/shifts', { name: 'Spare Shift', start_minutes: 600, end_minutes: 1140 })).body.data;
    const { membership } = await seedOrgEmployee(org);
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { department_id: dept.id, designation_id: desig.id, shift_id: shift.id } });
    const d1 = await del(`/departments/${dept.id}`);
    expect(d1.status).toBe(409);
    expect(d1.body.message).toMatch(/1 people/);
    expect((await del(`/designations/${desig.id}`)).status).toBe(409);
    expect((await del(`/attendance/shifts/${shift.id}`)).status).toBe(409);
    expect((await del(`/departments/${spare.id}`)).status).toBe(200);
    expect((await del(`/attendance/shifts/${spareShift.id}`)).status).toBe(200);
    expect(await prisma.department.count({ where: { id: spare.id } })).toBe(0);
    expect((await del('/departments/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

describe('Client-brief amendment — multi-project calendar mapping', () => {
  test('an employee can carry a default calendar plus one per active project at once', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);

    const defaultCal = await authed(request(app).post('/api/v1/calendars'), adminToken).send({ name: 'Indian Holidays' });
    const usCal = await authed(request(app).post('/api/v1/calendars'), adminToken).send({ name: 'US Client Holidays', kind: 'client' });

    const account = await prisma.account.create({
      data: { type: 'client', name: 'US Client Co', stage: 'active', owner_id: (await prisma.user.findFirst({ where: { role: 'admin' } })).id, org_id: org.id },
    });

    const assignDefault = await authed(request(app).post(`/api/v1/calendars/${defaultCal.body.data.id}/assign`), adminToken).send({
      org_membership_id: membership.id,
    });
    expect(assignDefault.status).toBe(200);

    const assignProject = await authed(request(app).post(`/api/v1/calendars/${usCal.body.data.id}/assign`), adminToken).send({
      org_membership_id: membership.id,
      account_id: account.id,
    });
    expect(assignProject.status).toBe(200);

    const list = await authed(request(app).get(`/api/v1/calendars/assignments/${membership.id}`), adminToken);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    const byAccount = list.body.data.find((a) => a.account_id === account.id);
    expect(byAccount.calendar.name).toBe('US Client Holidays');
    const byDefault = list.body.data.find((a) => a.account_id === null);
    expect(byDefault.calendar.name).toBe('Indian Holidays');
  });

  test('reassigning the same project replaces the mapping instead of duplicating it', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);
    const calA = await authed(request(app).post('/api/v1/calendars'), adminToken).send({ name: 'Calendar A' });
    const calB = await authed(request(app).post('/api/v1/calendars'), adminToken).send({ name: 'Calendar B' });

    await authed(request(app).post(`/api/v1/calendars/${calA.body.data.id}/assign`), adminToken).send({
      org_membership_id: membership.id,
    });
    await authed(request(app).post(`/api/v1/calendars/${calB.body.data.id}/assign`), adminToken).send({
      org_membership_id: membership.id,
    });

    const list = await authed(request(app).get(`/api/v1/calendars/assignments/${membership.id}`), adminToken);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].calendar.name).toBe('Calendar B');
  });
});

describe('Locations: one default, edit, delete', () => {
  test('marking a location default moves the flag; edit and delete work; a location in use cannot be deleted', async () => {
    const { org, access_token: token } = await seedOrgAdmin();
    const add = (body) => authed(request(app).post('/api/v1/orgs/locations'), token).send(body);
    const list = async () => (await authed(request(app).get('/api/v1/orgs/locations'), token)).body.data;
    const ahm = (await add({ name: 'Ahmedabad Office', is_default: true })).body.data;
    const ind = (await add({ name: 'Indore Office', is_default: true })).body.data;
    expect((await list()).filter((l) => l.is_default).map((l) => l.name)).toEqual(['Indore Office']);

    const patched = await authed(request(app).patch(`/api/v1/orgs/locations/${ahm.id}`), token).send({ is_default: true, city: 'Ahmedabad' });
    expect(patched.body.data).toMatchObject({ is_default: true, city: 'Ahmedabad' });
    expect((await list()).filter((l) => l.is_default).map((l) => l.name)).toEqual(['Ahmedabad Office']);
    expect((await authed(request(app).patch(`/api/v1/orgs/locations/${ind.id}`), token).send({ name: 'Ahmedabad Office' })).status).toBe(409);

    const emp = await seedOrgEmployee(org);
    await prisma.orgMembership.update({ where: { id: emp.membership.id }, data: { location_id: ind.id } });
    const blocked = await authed(request(app).delete(`/api/v1/orgs/locations/${ind.id}`), token);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('1 employee');
    await prisma.orgMembership.update({ where: { id: emp.membership.id }, data: { location_id: null } });
    expect((await authed(request(app).delete(`/api/v1/orgs/locations/${ind.id}`), token)).status).toBe(200);
    expect((await authed(request(app).delete(`/api/v1/orgs/locations/${ahm.id}`), emp.access_token)).status).toBe(403);
  });
});
