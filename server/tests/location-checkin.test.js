// Location check-in (Delphic Global only): server-side distance check against the office map point, work-from-home people left
// unflagged, lateness against the shift, the report with the planned office / home comparison, and no effect on attendance.
const { prisma, request, app, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const service = require('../src/modules/locationCheckin/locationCheckin.service');

const OFFICE = { latitude: 22.7196, longitude: 75.8577 }; // Indore
const NEAR = { latitude: 22.7199, longitude: 75.8579 }; // ~40 m away
const FAR = { latitude: 22.9, longitude: 75.9 }; // ~20 km away
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcQAAAAABJRU5ErkJggg==', 'base64');

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE location_checkins, location_checkin_settings, office_geofences, work_place_days');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const nowMinutes = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  return Number(p.find((x) => x.type === 'hour').value) * 60 + Number(p.find((x) => x.type === 'minute').value);
};
const todayDate = () => {
  const d = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  return new Date(`${d}T00:00:00.000Z`);
};
const ymd = (d) => d.toISOString().slice(0, 10);

async function seed({ geofence = true } = {}) {
  const org = await createOrg();
  const indore = await prisma.location.create({ data: { org_id: org.id, name: 'Indore' } });
  if (geofence) await prisma.officeGeofence.create({ data: { org_id: org.id, location_id: indore.id, ...OFFICE, radius_m: 150 } });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const admin = (await loginAs(adminUser)).access_token;
  const person = async (name, { workMode = null, workerType = null, shift = null } = {}) => {
    const user = await createUser({ role: 'recruiter', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: new Date('2020-01-01T00:00:00Z') });
    await prisma.orgMembership.update({
      where: { id: membership.id },
      data: { work_mode: workMode, location_id: indore.id, ...(workerType ? { worker_type: workerType } : {}), ...(shift ? { shift_id: shift.id } : {}) },
    });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  return { org, indore, admin, person };
}

const api = (method, path, token) => authed(request(app)[method](`/api/v1/location-checkin${path}`), token);
const checkIn = (token, point, { selfie = true } = {}) => {
  const r = api('post', '/check-in', token);
  if (point) r.field('latitude', String(point.latitude)).field('longitude', String(point.longitude)).field('accuracy_m', '12');
  if (selfie) r.attach('selfie', PNG, { filename: 'me.png', contentType: 'image/png' });
  return r;
};
const range = `from=${ymd(todayDate())}&to=${ymd(todayDate())}`;

describe('helpers', () => {
  test('distance in metres between two points', () => {
    expect(service.distanceMeters(OFFICE.latitude, OFFICE.longitude, OFFICE.latitude, OFFICE.longitude)).toBe(0);
    const d = service.distanceMeters(OFFICE.latitude, OFFICE.longitude, NEAR.latitude, NEAR.longitude);
    expect(d).toBeGreaterThan(20);
    expect(d).toBeLessThan(80);
    expect(service.distanceMeters(OFFICE.latitude, OFFICE.longitude, FAR.latitude, FAR.longitude)).toBeGreaterThan(15000);
  });

  test('late minutes follow the shift start and grace; no shift uses the default cutoff', () => {
    const at = (h, m) => new Date(Date.UTC(2026, 10, 3, h, m) - 330 * 60000); // 03 Nov 2026, local h:m IST
    const shift = { start_minutes: 570, grace_minutes: 15, end_minutes: 1110 }; // 09:30 + 15
    expect(service.lateness(shift, 600, at(9, 40), 'Asia/Kolkata')).toEqual({ cutoff_minutes: 585, late_minutes: 0 });
    expect(service.lateness(shift, 600, at(10, 0), 'Asia/Kolkata').late_minutes).toBe(30);
    expect(service.lateness(null, 600, at(10, 20), 'Asia/Kolkata')).toEqual({ cutoff_minutes: 600, late_minutes: 20 });
    expect(service.lateness(null, 600, at(9, 0), 'Asia/Kolkata').late_minutes).toBe(0);
  });
});

describe('check-in / check-out', () => {
  test('inside the office radius is saved as in office, away is flagged, a second check-in is refused', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Asha');
    const res = await checkIn(emp.token, NEAR);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ check_in_result: 'in_office', check_in_at_office: true, planned_place: 'office', has_photo: true });
    expect((await checkIn(emp.token, NEAR)).status).toBe(409);

    const out = await api('post', '/check-out', emp.token).field('latitude', String(FAR.latitude)).field('longitude', String(FAR.longitude));
    expect(out.status).toBe(200);
    expect(out.body.data.check_out_result).toBe('outside_office');
    expect((await api('post', '/check-out', emp.token)).status).toBe(409);

    const other = await ctx.person('Bhanu');
    const away = await checkIn(other.token, FAR);
    expect(away.body.data).toMatchObject({ check_in_result: 'outside_office', check_in_at_office: false });
    expect(away.body.data.check_in_distance_m).toBeGreaterThan(15000);
  });

  test('a selfie is required by default and optional once an admin turns it off; no location is flagged unavailable', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Asha');
    const noSelfie = await checkIn(emp.token, NEAR, { selfie: false });
    expect(noSelfie.status).toBe(422);

    expect((await api('put', '/settings', ctx.admin).send({ selfie_mode: 'optional' })).status).toBe(200);
    expect((await api('get', '/today', emp.token)).body.data.selfie_mode).toBe('optional');
    const res = await checkIn(emp.token, null, { selfie: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ check_in_result: 'location_unavailable', has_photo: false });
  });

  test('optional keeps a selfie that is sent; off never keeps one; only an admin changes the mode', async () => {
    const ctx = await seed();
    const a = await ctx.person('Asha');
    const b = await ctx.person('Bhanu');
    expect((await api('put', '/settings', a.token).send({ selfie_mode: 'off' })).status).toBe(403);

    await api('put', '/settings', ctx.admin).send({ selfie_mode: 'optional' });
    expect((await checkIn(a.token, NEAR)).body.data.has_photo).toBe(true);

    await api('put', '/settings', ctx.admin).send({ selfie_mode: 'off' });
    expect((await checkIn(b.token, NEAR)).body.data.has_photo).toBe(false);
    expect((await api('put', '/settings', ctx.admin).send({ selfie_mode: 'sometimes' })).status).toBe(422);
  });

  test('an admin sets the late time for a shift; clearing it goes back to the shift start plus grace', async () => {
    const ctx = await seed();
    // the shift itself starts an hour ahead, so by its own rule nobody is late
    const shift = await prisma.shift.create({ data: { org_id: ctx.org.id, name: 'Day', start_minutes: (nowMinutes() + 60) % 1440, end_minutes: 1000, grace_minutes: 15 } });
    const a = await ctx.person('Asha', { shift });
    const b = await ctx.person('Bhanu', { shift });
    expect((await api('put', `/shifts/${shift.id}`, a.token).send({ late_after_minutes: 10 })).status).toBe(403);

    // the admin's time is 45 minutes ago, so a check-in now is about 45 minutes late
    const set = (nowMinutes() - 45 + 1440) % 1440;
    expect((await api('put', `/shifts/${shift.id}`, ctx.admin).send({ late_after_minutes: set })).status).toBe(200);
    const list = await api('get', '/shifts', ctx.admin);
    expect(list.body.data.find((s) => s.shift_id === shift.id)).toMatchObject({ late_after_minutes: set, default_late_after_minutes: (shift.start_minutes + 15) % 1440 });
    const late = (await checkIn(a.token, NEAR)).body.data;
    expect(late.late_minutes).toBeGreaterThanOrEqual(44);
    expect(late.late_minutes).toBeLessThanOrEqual(46);
    expect(late.cutoff_minutes).toBe(set);

    expect((await api('put', `/shifts/${shift.id}`, ctx.admin).send({ late_after_minutes: null })).status).toBe(200);
    expect((await api('get', '/shifts', ctx.admin)).body.data.find((s) => s.shift_id === shift.id).late_after_minutes).toBeNull();
    expect((await checkIn(b.token, NEAR)).body.data.late_minutes).toBe(0);
  });

  test('a work-from-home person is never flagged for being away from the office', async () => {
    const ctx = await seed();
    const remote = await ctx.person('Remote Rina', { workMode: 'remote' });
    const res = await checkIn(remote.token, FAR);
    expect(res.body.data).toMatchObject({ planned_place: 'home', check_in_result: 'work_from_home', check_in_at_office: false });

    const approved = await ctx.person('Home Day Hari');
    await prisma.workPlaceDay.create({ data: { org_id: ctx.org.id, org_membership_id: approved.membership.id, date: todayDate(), work_place: 'home', status: 'approved' } });
    const second = await checkIn(approved.token, FAR);
    expect(second.body.data).toMatchObject({ planned_place: 'home', check_in_result: 'work_from_home' });

    // a pending request does not change the day
    const pending = await ctx.person('Pending Pia');
    await prisma.workPlaceDay.create({ data: { org_id: ctx.org.id, org_membership_id: pending.membership.id, date: todayDate(), work_place: 'home', status: 'pending' } });
    expect((await checkIn(pending.token, FAR)).body.data).toMatchObject({ planned_place: 'office', check_in_result: 'outside_office' });
  });

  test('lateness is worked out against the person\'s shift', async () => {
    const ctx = await seed();
    const lateShift = await prisma.shift.create({ data: { org_id: ctx.org.id, name: 'Late', start_minutes: (nowMinutes() - 90 + 1440) % 1440, end_minutes: 1000, grace_minutes: 15 } });
    const earlyShift = await prisma.shift.create({ data: { org_id: ctx.org.id, name: 'Early', start_minutes: (nowMinutes() + 60) % 1440, end_minutes: 1000, grace_minutes: 15 } });
    const a = await ctx.person('Late Lena', { shift: lateShift });
    const b = await ctx.person('Early Ela', { shift: earlyShift });
    const late = (await checkIn(a.token, NEAR)).body.data;
    expect(late.late_minutes).toBeGreaterThanOrEqual(89);
    expect(late.late_minutes).toBeLessThanOrEqual(91);
    expect((await checkIn(b.token, NEAR)).body.data.late_minutes).toBe(0);
  });

  test('contractors cannot use it, and it only exists in the master workspace', async () => {
    const ctx = await seed();
    const contractor = await ctx.person('Con', { workerType: 'contractor' });
    expect((await checkIn(contractor.token, NEAR)).status).toBe(403);
    expect((await api('get', '/today', contractor.token)).body.data?.eligible).not.toBe(true);

    // an admin can open it to contractors too
    await api('put', '/settings', ctx.admin).send({ full_time_only: false });
    const included = await checkIn(contractor.token, NEAR);
    expect(included.status).toBe(200);
    expect(included.body.data.check_in_result).toBe('in_office');
    await api('put', '/settings', ctx.admin).send({ full_time_only: true });
    const other2 = await ctx.person('Con Two', { workerType: 'contractor' });
    expect((await checkIn(other2.token, NEAR)).status).toBe(403);

    const other = await createOrg({ is_master_workspace: false });
    const user = await createUser({ role: 'recruiter' });
    await createOrgMembership(user.id, other.id, { role: 'recruiter' });
    const token = (await loginAs(user)).access_token;
    expect((await api('get', '/today', token)).status).toBe(403);
  });
});

describe('report', () => {
  test('shows planned office / home against where each person checked in, late, outside and a CSV', async () => {
    const ctx = await seed();
    // people with no shift are measured against the company default: put it an hour ahead so they are on time whatever the clock says
    await api('put', '/settings', ctx.admin).send({ default_cutoff_minutes: (nowMinutes() + 60) % 1440 });
    const lateShift = await prisma.shift.create({ data: { org_id: ctx.org.id, name: 'Late', start_minutes: (nowMinutes() - 120 + 1440) % 1440, end_minutes: 1000, grace_minutes: 15 } });
    const onTime = await ctx.person('On Time Omi');
    const late = await ctx.person('Late Lena', { shift: lateShift });
    const away = await ctx.person('Away Avi');
    const wfhAtOffice = await ctx.person('Remote Reva', { workMode: 'remote' });
    await checkIn(onTime.token, NEAR);
    await checkIn(late.token, NEAR);
    await checkIn(away.token, FAR);
    await checkIn(wfhAtOffice.token, NEAR);

    const res = await api('get', `/report?${range}`, ctx.admin);
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data.rows.map((r) => [r.name, r]));
    expect(byName['On Time Omi']).toMatchObject({ planned_place: 'office', check_in_result: 'in_office', comparison: 'as_planned' });
    expect(byName['Away Avi']).toMatchObject({ check_in_result: 'outside_office', comparison: 'office_day_outside' });
    expect(byName['Remote Reva']).toMatchObject({ planned_place: 'home', comparison: 'home_day_at_office' });
    expect(byName['Late Lena'].late_minutes).toBeGreaterThan(0);
    expect(res.body.data.summary).toMatchObject({ check_ins: 4, outside_office: 1, work_from_home: 1, office_day_outside: 1, home_day_at_office: 1 });
    expect(res.body.data.people[0].name).toBe('Late Lena');

    expect((await api('get', `/report?${range}&late_only=true`, ctx.admin)).body.data.rows.map((r) => r.name)).toEqual(['Late Lena']);
    expect((await api('get', `/report?${range}&outside_only=true`, ctx.admin)).body.data.rows.map((r) => r.name)).toEqual(['Away Avi']);
    expect((await api('get', `/report?${range}&mismatch_only=true`, ctx.admin)).body.data.rows).toHaveLength(2);
    expect((await api('get', `/report?${range}&planned_place=home`, ctx.admin)).body.data.rows.map((r) => r.name)).toEqual(['Remote Reva']);

    const csv = await api('get', `/report.csv?${range}`, ctx.admin);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\n')[0]).toContain('Comparison');
    expect(csv.text).toContain('Away Avi');
  });

  test('employees cannot read the report or the office points, and an admin sets them', async () => {
    const ctx = await seed({ geofence: false });
    const emp = await ctx.person('Asha');
    expect((await api('get', `/report?${range}`, emp.token)).status).toBe(403);
    expect((await api('get', '/offices', emp.token)).status).toBe(403);
    expect((await api('put', `/offices/${ctx.indore.id}`, emp.token).send({ ...OFFICE, radius_m: 200 })).status).toBe(403);

    expect((await api('put', `/offices/${ctx.indore.id}`, ctx.admin).send({ ...OFFICE, radius_m: 200 })).status).toBe(200);
    const list = await api('get', '/offices', ctx.admin);
    expect(list.body.data.find((o) => o.name === 'Indore')).toMatchObject({ configured: true, radius_m: 200, latitude: OFFICE.latitude, employees: 1 });
    expect((await checkIn(emp.token, NEAR)).body.data.check_in_result).toBe('in_office');
  });

  test('without an office map point the check-in is saved but cannot be placed', async () => {
    const ctx = await seed({ geofence: false });
    const emp = await ctx.person('Asha');
    expect((await checkIn(emp.token, NEAR)).body.data.check_in_result).toBe('location_unavailable');
  });

  test('the selfie is served to its owner and the admin, not to a colleague', async () => {
    const ctx = await seed();
    const a = await ctx.person('Asha');
    const b = await ctx.person('Bhanu');
    const id = (await checkIn(a.token, NEAR)).body.data.id;
    expect((await api('get', `/records/${id}/selfie`, a.token)).status).toBe(200);
    expect((await api('get', `/records/${id}/selfie`, ctx.admin)).status).toBe(200);
    expect((await api('get', `/records/${id}/selfie`, b.token)).status).toBe(404);
  });
});

describe('isolation', () => {
  test('checking in changes nothing in attendance', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Asha');
    const before = await prisma.attendanceRecord.count();
    await checkIn(emp.token, NEAR);
    await api('post', '/check-out', emp.token);
    expect(await prisma.attendanceRecord.count()).toBe(before);
  });
});
