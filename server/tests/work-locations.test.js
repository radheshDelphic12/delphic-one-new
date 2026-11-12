// Work location away from the base office: a dated project-site / travel assignment per person. Overlaps are refused,
// check-in is measured against the site on those days (and the base office otherwise), and the register carries "away".
const { prisma, request, app, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const workLocation = require('../src/modules/attendanceDashboard/workLocation.service');

const OFFICE = { latitude: 22.7196, longitude: 75.8577 }; // Indore
const PUNE = { latitude: 18.5204, longitude: 73.8567 };
const PUNE_NEAR = { latitude: 18.5206, longitude: 73.8569 };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE location_checkin_sessions, location_checkins, location_checkin_settings, office_geofences, work_place_days, work_location_assignments, work_sites');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const day = (offset = 0) => new Date(new Date(`${new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)}T00:00:00.000Z`).getTime() + offset * 86400000);
const ymd = (d) => d.toISOString().slice(0, 10);

async function seed() {
  const org = await createOrg();
  const indore = await prisma.location.create({ data: { org_id: org.id, name: 'Indore', city: 'Indore' } });
  await prisma.officeGeofence.create({ data: { org_id: org.id, location_id: indore.id, ...OFFICE, radius_m: 150 } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const admin = (await loginAs(adminUser)).access_token;
  const user = await createUser({ role: 'recruiter', name: 'Asha' });
  const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: new Date('2020-01-01T00:00:00Z') });
  await prisma.orgMembership.update({ where: { id: membership.id }, data: { location_id: indore.id } });
  const token = (await loginAs(user)).access_token;
  const site = (await authed(request(app).post('/api/v1/attendance-dashboard/work-sites'), admin).send({ name: 'Client tower', city: 'Pune', ...PUNE, radius_m: 150 })).body.data;
  return { org, indore, admin, membership, token, site };
}

const assign = (ctx, body) => authed(request(app).post('/api/v1/attendance-dashboard/work-locations'), ctx.admin)
  .send({ org_membership_id: ctx.membership.id, from_date: ymd(day(-1)), to_date: ymd(day(3)), work_site_id: ctx.site.id, purpose: 'project', ...body });
const checkIn = (token, point) => authed(request(app).post('/api/v1/location-checkin/check-in'), token)
  .field('latitude', String(point.latitude)).field('longitude', String(point.longitude)).field('accuracy_m', '10').attach('selfie', PNG, { filename: 'me.png', contentType: 'image/png' });

describe('work location assignments', () => {
  test('overlapping assignments for one person are refused; a cancelled one frees the dates', async () => {
    const ctx = await seed();
    const first = await assign(ctx, {});
    expect(first.status).toBe(201);
    const clash = await assign(ctx, { from_date: ymd(day(2)), to_date: ymd(day(6)) });
    expect(clash.status).toBe(409);
    expect((await authed(request(app).post(`/api/v1/attendance-dashboard/work-locations/${first.body.data.id}/cancel`), ctx.admin).send({ reason: 'trip dropped' })).status).toBe(200);
    expect((await assign(ctx, { from_date: ymd(day(2)), to_date: ymd(day(6)) })).status).toBe(201);
  });

  test('exactly one of an office / a site, dates in order, and only admin writes', async () => {
    const ctx = await seed();
    expect((await assign(ctx, { location_id: ctx.indore.id })).status).toBe(422);
    expect((await assign(ctx, { from_date: ymd(day(3)), to_date: ymd(day(1)) })).status).toBe(422);
    const asEmployee = await authed(request(app).post('/api/v1/attendance-dashboard/work-locations'), ctx.token)
      .send({ org_membership_id: ctx.membership.id, from_date: ymd(day(0)), to_date: ymd(day(1)), work_site_id: ctx.site.id });
    expect(asEmployee.status).toBe(403);
  });

  test('placeOn picks the assignment over the base office, and falls back after to_date or a cancel', async () => {
    const ctx = await seed();
    const created = await assign(ctx, { from_date: ymd(day(0)), to_date: ymd(day(2)) });
    const member = { id: ctx.membership.id, location_id: ctx.indore.id };
    const inside = await workLocation.placeOn(ctx.org.id, member, day(1));
    expect(inside).toMatchObject({ kind: 'site', work_site_id: ctx.site.id, assignment_id: created.body.data.id });
    const after = await workLocation.placeOn(ctx.org.id, member, day(3));
    expect(after).toMatchObject({ kind: 'base', location_id: ctx.indore.id, assignment_id: null });
    await authed(request(app).post(`/api/v1/attendance-dashboard/work-locations/${created.body.data.id}/cancel`), ctx.admin).send({ reason: 'not going' });
    expect((await workLocation.placeOn(ctx.org.id, member, day(1))).kind).toBe('base');
  });

  test('check-in inside the site radius is in_office with work_site_id set; at the base office it is outside while the assignment runs', async () => {
    const ctx = await seed();
    const created = await assign(ctx, { from_date: ymd(day(0)), to_date: ymd(day(4)), purpose: 'travel' });
    const res = await checkIn(ctx.token, PUNE_NEAR);
    expect(res.status).toBe(200);
    expect(res.body.data.check_in_result).toBe('in_office');
    const row = await prisma.locationCheckin.findFirst({ where: { org_membership_id: ctx.membership.id } });
    expect(row).toMatchObject({ work_site_id: ctx.site.id, assignment_id: created.body.data.id });
    const today = (await authed(request(app).get('/api/v1/location-checkin/today'), ctx.token)).body.data;
    expect(today.place).toMatchObject({ kind: 'site', name: 'Client tower', purpose: 'travel' });
  });

  test('the register day carries away, and the base office still measures other days', async () => {
    const ctx = await seed();
    await assign(ctx, { from_date: ymd(day(0)), to_date: ymd(day(0)) });
    const d = new Date();
    const res = await authed(request(app).get(`/api/v1/attendance-dashboard/register?year=${d.getUTCFullYear()}&month=${d.getUTCMonth() + 1}`), ctx.admin);
    expect(res.status).toBe(200);
    const person = res.body.data.people.find((p) => p.name === 'Asha');
    const away = person.days.filter((x) => x.away);
    expect(away).toHaveLength(1);
    expect(away[0].away).toMatchObject({ place_name: 'Client tower', city: 'Pune', purpose: 'project' });
  });
});
