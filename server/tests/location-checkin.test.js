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
  await prisma.$executeRawUnsafe('TRUNCATE TABLE location_checkin_sessions, location_checkins, location_checkin_settings, office_geofences, work_place_days');
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

const checkOut = (token, point, reason) => {
  const r = api('post', '/check-out', token);
  if (point) r.field('latitude', String(point.latitude)).field('longitude', String(point.longitude));
  if (reason) r.field('reason', reason);
  return r;
};

describe('several check-ins a day and breaks', () => {
  test('after a check-out the person can check in again; the gap is time out of desk, and late is judged on the first check-in only', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Asha');
    const first = await checkIn(emp.token, NEAR);
    expect(first.body.data.sessions).toHaveLength(1);
    expect((await checkIn(emp.token, NEAR)).status).toBe(409); // still in
    const out = await checkOut(emp.token, NEAR, 'lunch');
    expect(out.status).toBe(200);
    expect(out.body.data).toMatchObject({ currently_in: false });
    expect(out.body.data.sessions[0].out_reason).toBe('lunch');
    expect((await checkOut(emp.token, NEAR)).status).toBe(409); // not in

    const again = await checkIn(emp.token, NEAR);
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ currently_in: true, check_out_at: null });
    expect(again.body.data.sessions).toHaveLength(2);
    expect(again.body.data.late_minutes).toBe(first.body.data.late_minutes);

    // push the first session an hour back so the gap between the two is measurable
    const sessions = await prisma.locationCheckinSession.findMany({ orderBy: { in_at: 'asc' } });
    await prisma.locationCheckinSession.update({ where: { id: sessions[0].id }, data: { in_at: new Date(sessions[0].in_at.getTime() - 3600000), out_at: new Date(Date.now() - 1800000) } });
    const today = (await api('get', '/today', emp.token)).body.data.record;
    expect(today.break_count).toBe(1);
    expect(today.out_of_desk_minutes).toBeGreaterThanOrEqual(29);
    expect(today.out_of_desk_minutes).toBeLessThanOrEqual(31);
    expect(today.worked_minutes).toBeGreaterThanOrEqual(29);
    expect((await checkOut(emp.token, NEAR, 'sometimes')).status).toBe(422);
    expect((await checkOut(emp.token, NEAR)).status).toBe(200);
  });

  test('a re-check-in still needs a selfie when the admin requires one', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Asha');
    await checkIn(emp.token, NEAR);
    await checkOut(emp.token, NEAR);
    expect((await checkIn(emp.token, NEAR, { selfie: false })).status).toBe(422);
    expect((await checkIn(emp.token, NEAR)).status).toBe(200);
  });
});

describe('admin corrections', () => {
  async function twoSessions(ctx, emp) {
    await checkIn(emp.token, NEAR);
    await checkOut(emp.token, NEAR);
    await checkIn(emp.token, NEAR);
    const rows = await prisma.locationCheckinSession.findMany({ orderBy: { in_at: 'asc' } });
    const base = Date.now() - 4 * 3600000;
    await prisma.locationCheckinSession.update({ where: { id: rows[0].id }, data: { in_at: new Date(base), out_at: new Date(base + 3600000) } });
    await prisma.locationCheckinSession.update({ where: { id: rows[1].id }, data: { in_at: new Date(base + 2 * 3600000), out_at: null } });
    return (await prisma.locationCheckinSession.findMany({ orderBy: { in_at: 'asc' } })).map((s) => s.id);
  }

  test('only an admin edits, with a reason; the day row follows and the change is audited', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Asha');
    const [first, second] = await twoSessions(ctx, emp);
    const newOut = new Date(Date.now() - 3 * 3600000 + 600000).toISOString();

    expect((await api('patch', `/sessions/${first}`, emp.token).send({ out_at: newOut, reason: 'fix' })).status).toBe(403);
    expect((await api('patch', `/sessions/${first}`, ctx.admin).send({ out_at: newOut })).status).toBe(422); // reason is mandatory
    const ok = await api('patch', `/sessions/${first}`, ctx.admin).send({ out_at: newOut, out_reason: 'meeting', reason: 'Forgot to check out' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.sessions[0]).toMatchObject({ out_reason: 'meeting', edited: true });
    expect(await prisma.auditLog.count({ where: { entity_type: 'location_checkin', action: 'edit_session', reason: 'Forgot to check out' } })).toBe(1);

    // out before in, and overlapping the other session, are refused
    const inAt = (await prisma.locationCheckinSession.findUnique({ where: { id: first } })).in_at;
    expect((await api('patch', `/sessions/${first}`, ctx.admin).send({ out_at: new Date(inAt.getTime() - 1000).toISOString(), reason: 'oops' })).status).toBe(422);
    expect((await api('patch', `/sessions/${first}`, ctx.admin).send({ out_at: new Date(Date.now()).toISOString(), reason: 'oops' })).status).toBe(409);

    // closing the open session makes it the latest check-out
    const closed = await api('patch', `/sessions/${second}`, ctx.admin).send({ out_at: new Date().toISOString(), reason: 'Left for the day' });
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({ currently_in: false });
    expect(closed.body.data.check_out_at).toBeTruthy();
  });

  test('deleting a session keeps the day; deleting the last one, or the whole day, removes it; each is audited', async () => {
    const ctx = await seed();
    const emp = await ctx.person('Asha');
    const [first, second] = await twoSessions(ctx, emp);
    expect((await api('delete', `/sessions/${first}`, emp.token).send({ reason: 'x y z' })).status).toBe(403);
    expect((await api('delete', `/sessions/${first}`, ctx.admin).send({})).status).toBe(422);

    const one = await api('delete', `/sessions/${first}`, ctx.admin).send({ reason: 'Duplicate tap' });
    expect(one.status).toBe(200);
    expect(one.body.data.day_removed).toBe(false);
    expect(one.body.data.record.sessions).toHaveLength(1);

    const last = await api('delete', `/sessions/${second}`, ctx.admin).send({ reason: 'Wrong person' });
    expect(last.body.data.day_removed).toBe(true);
    expect(await prisma.locationCheckin.count()).toBe(0);

    await checkIn(emp.token, NEAR);
    const dayId = (await prisma.locationCheckin.findFirst()).id;
    expect((await api('delete', `/records/${dayId}`, emp.token).send({ reason: 'mine' })).status).toBe(403);
    expect((await api('delete', `/records/${dayId}`, ctx.admin).send({ reason: 'Test entry' })).status).toBe(200);
    expect(await prisma.locationCheckin.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { entity_type: 'location_checkin' } })).toBe(3);
  });
});

describe('report: attendance status, not as planned, no check-in', () => {
  test('location unavailable on an office day counts as not as planned; a home day without a location does not', async () => {
    const ctx = await seed({ geofence: false });
    await api('put', '/settings', ctx.admin).send({ default_cutoff_minutes: (nowMinutes() + 60) % 1440 });
    const officeDay = await ctx.person('Office Olga');
    const homeDay = await ctx.person('Remote Ravi', { workMode: 'remote' });
    await checkIn(officeDay.token, NEAR); // no map point: location unavailable
    await checkIn(homeDay.token, null);
    const res = await api('get', `/report?${range}&mismatch_only=true`, ctx.admin);
    expect(res.body.data.rows.map((r) => r.name)).toEqual(['Office Olga']);
    expect(res.body.data.rows[0].comparison).toBe('no_location');
    expect(res.body.data.summary.not_as_planned).toBe(1);
  });

  test('shows the attendance status and approved leave type beside the check-in, and lists a working day with no check-in', async () => {
    const ctx = await seed();
    await api('put', '/settings', ctx.admin).send({ default_cutoff_minutes: (nowMinutes() + 60) % 1440 });
    const present = await ctx.person('Present Pia');
    const onLeave = await ctx.person('Leave Lata');
    const silent = await ctx.person('Silent Sam');
    const away = await ctx.person('Leave But Here');
    const date = todayDate();
    const cl = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'CL' } });
    await prisma.attendanceRecord.createMany({
      data: [
        { org_id: ctx.org.id, org_membership_id: present.membership.id, date, status: 'present' },
        { org_id: ctx.org.id, org_membership_id: onLeave.membership.id, date, status: 'leave' },
        { org_id: ctx.org.id, org_membership_id: silent.membership.id, date, status: 'present' },
        { org_id: ctx.org.id, org_membership_id: away.membership.id, date, status: 'leave' },
      ],
    });
    await prisma.leaveRequest.createMany({
      data: [onLeave, away].map((p) => ({ org_id: ctx.org.id, org_membership_id: p.membership.id, leave_type_id: cl.id, from_date: date, to_date: date, status: 'approved' })),
    });
    await checkIn(present.token, NEAR);
    await checkIn(away.token, NEAR);

    const res = await api('get', `/report?${range}`, ctx.admin);
    const byName = Object.fromEntries(res.body.data.rows.map((r) => [r.name, r]));
    expect(byName['Present Pia']).toMatchObject({ attendance_status: 'present', attendance_label: 'Present', check_in_result: 'in_office' });
    expect(byName['Silent Sam']).toMatchObject({ id: null, comparison: 'no_checkin', flags: ['present_no_checkin'], attendance_status: 'present' });
    expect(byName['Leave Lata']).toMatchObject({ id: null, comparison: 'on_leave', leave_type: 'CL', attendance_label: 'CL' });
    expect(byName['Leave Lata'].flags).toEqual([]);
    expect(byName['Leave But Here'].flags).toEqual(['leave_but_checked_in']);
    expect(res.body.data.summary).toMatchObject({ check_ins: 2, no_checkin: 1, leave_but_checked_in: 1 });

    expect((await api('get', `/report?${range}&no_checkin_only=true`, ctx.admin)).body.data.rows.map((r) => r.name).sort()).toEqual(['Leave Lata', 'Silent Sam']);
    expect((await api('get', `/report?${range}&attendance_status=leave`, ctx.admin)).body.data.rows.map((r) => r.name).sort()).toEqual(['Leave But Here', 'Leave Lata']);
    // the stricter filters never list people who did not check in
    expect((await api('get', `/report?${range}&late_only=true`, ctx.admin)).body.data.rows.every((r) => r.id)).toBe(true);
    const csv = await api('get', `/report.csv?${range}`, ctx.admin);
    expect(csv.text.split('\n')[0]).toContain('Attendance status');
    expect(csv.text).toContain('Silent Sam');
    // none of it changed attendance
    expect(await prisma.attendanceRecord.count()).toBe(4);
  });
});

describe('register: every employee x every day', () => {
  test('lists everyone, shows check-ins with their times, marks a working day without one as missing, and leaves weekly offs and leave alone', async () => {
    const ctx = await seed();
    const here = await ctx.person('Here Hari');
    await ctx.person('Missing Mina');
    const leave = await ctx.person('Leave Lata');
    const contractor = await ctx.person('Con Tractor', { workerType: 'contractor' });
    const tue = new Date('2026-09-01T00:00:00.000Z'); // a Tuesday
    const sat = new Date('2026-09-05T00:00:00.000Z'); // a Saturday
    const at = (h, m) => new Date(Date.UTC(2026, 8, 1, h, m) - 330 * 60000);
    const day = await prisma.locationCheckin.create({
      data: {
        org_id: ctx.org.id, org_membership_id: here.membership.id, date: tue, planned_place: 'office', check_in_at: at(10, 45), check_in_result: 'in_office', check_in_at_office: true, late_minutes: 15, check_out_at: at(18, 0),
        sessions: { create: [{ org_id: ctx.org.id, org_membership_id: here.membership.id, date: tue, in_at: at(10, 45), in_result: 'in_office', out_at: at(13, 0) }, { org_id: ctx.org.id, org_membership_id: here.membership.id, date: tue, in_at: at(13, 30), in_result: 'in_office', out_at: at(18, 0) }] },
      },
    });
    const cl = await prisma.leaveType.create({ data: { org_id: ctx.org.id, name: 'Casual Leave' } });
    await prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: leave.membership.id, leave_type_id: cl.id, from_date: tue, to_date: tue, status: 'approved' } });

    expect((await api('get', '/register?year=2026&month=9', here.token)).status).toBe(403);
    const res = await api('get', '/register?year=2026&month=9', ctx.admin);
    expect(res.status).toBe(200);
    const names = res.body.data.people.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Here Hari', 'Missing Mina', 'Leave Lata']));
    expect(names).not.toContain('Con Tractor'); // contractors have no attendance
    const cell = (name, date) => res.body.data.people.find((p) => p.name === name).days.find((d) => d.date === date);

    const hari = cell('Here Hari', '2026-09-01');
    expect(hari.state).toBe('checked_in');
    expect(hari.checkin).toMatchObject({ id: day.id, late_minutes: 15, out_of_desk_minutes: 30, break_count: 1, result: 'in_office', currently_in: false });
    expect(hari.checkin.sessions).toHaveLength(2);
    expect(cell('Missing Mina', '2026-09-01').state).toBe('missing');
    expect(cell('Leave Lata', '2026-09-01').state).toBe('leave');
    expect(cell('Missing Mina', '2026-09-05').state).toBe('off'); // weekly off
    expect(cell('Missing Mina', '2026-09-02').state).toBe('missing');
    const mina = res.body.data.people.find((p) => p.name === 'Missing Mina');
    expect(mina.totals.missing).toBeGreaterThan(15);
    expect(res.body.data.people.find((p) => p.name === 'Here Hari').totals).toMatchObject({ checked_in: 1, late: 1, out_of_desk_minutes: 30 });
    expect(sat.getUTCDay()).toBe(6);
    expect(contractor.membership.id).toBeTruthy();
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
