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

describe('Client-brief amendment — shift + automatic overtime', () => {
  test('admin creates a shift; overtime is null with no shift assigned', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);

    const shift = await authed(request(app).post('/api/v1/attendance/shifts'), adminToken).send({
      name: 'General',
      start_minutes: 9 * 60,
      end_minutes: 18 * 60,
      grace_minutes: 15,
    });
    expect(shift.status).toBe(201);

    await authed(request(app).post('/api/v1/attendance/check-in'), empToken);
    const checkOut = await authed(request(app).post('/api/v1/attendance/check-out'), empToken);
    expect(checkOut.status).toBe(200);
    expect(checkOut.body.data.overtime_minutes).toBeNull();
  });

  test('overtime is computed against the assigned shift + grace period', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken, membership } = await seedOrgEmployee(org);

    const shift = await authed(request(app).post('/api/v1/attendance/shifts'), adminToken).send({
      name: 'General',
      start_minutes: 9 * 60,
      end_minutes: 18 * 60, // 9h shift
      grace_minutes: 15,
    });
    await authed(request(app).patch(`/api/v1/orgs/memberships/${membership.id}`), adminToken).send({
      shift_id: shift.body.data.id,
    });

    await authed(request(app).post('/api/v1/attendance/check-in'), empToken);
    // Backdate check_in_at to 10 hours ago so check-out sees a 10h work span
    // (9h shift + 15m grace = 555m allowed; 600m worked -> 45m overtime).
    await prisma.attendanceRecord.updateMany({
      where: { org_membership_id: membership.id },
      data: { check_in_at: new Date(Date.now() - 10 * 60 * 60 * 1000) },
    });

    const checkOut = await authed(request(app).post('/api/v1/attendance/check-out'), empToken);
    expect(checkOut.status).toBe(200);
    expect(checkOut.body.data.overtime_minutes).toBe(45);
  });

  test('no overtime when worked time is within the shift + grace window', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken, membership } = await seedOrgEmployee(org);

    const shift = await authed(request(app).post('/api/v1/attendance/shifts'), adminToken).send({
      name: 'General',
      start_minutes: 9 * 60,
      end_minutes: 18 * 60,
      grace_minutes: 30,
    });
    await authed(request(app).patch(`/api/v1/orgs/memberships/${membership.id}`), adminToken).send({
      shift_id: shift.body.data.id,
    });

    await authed(request(app).post('/api/v1/attendance/check-in'), empToken);
    await prisma.attendanceRecord.updateMany({
      where: { org_membership_id: membership.id },
      data: { check_in_at: new Date(Date.now() - 9 * 60 * 60 * 1000) }, // exactly 9h worked
    });

    const checkOut = await authed(request(app).post('/api/v1/attendance/check-out'), empToken);
    expect(checkOut.body.data.overtime_minutes).toBe(0);
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
