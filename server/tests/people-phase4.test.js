// Phase 4: FnF on exit, birthdays and anniversaries, increment reminders, previous months' unpaid salary.
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed, unique } = require('./helpers');
const lwdExit = require('../src/jobs/lwdExit');
const announcements = require('../src/modules/orgs/announcements.service');
const increments = require('../src/modules/payroll/incrementReminders.service');

let org; let admin; let adminToken; let superUser; let superToken;

const d = (s) => new Date(`${s}T00:00:00.000Z`);

beforeEach(async () => {
  await cleanDatabase();
  org = await createOrg({ name: 'Delphic', slug: unique('d-') });
  admin = await createUser({ role: 'admin', name: 'Plain Admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  superUser = await createUser({ role: 'admin', name: 'Super Admin', withOrg: false });
  await prisma.user.update({ where: { id: superUser.id }, data: { is_superadmin: true } });
  await createOrgMembership(superUser.id, org.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(superUser));
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function employee(name, data = {}) {
  const user = await createUser({ role: 'employee', name, withOrg: false });
  const created = await createOrgMembership(user.id, org.id, { role: 'employee', employment_status: data.employment_status, joined_at: data.joined_at || d('2024-01-10') });
  const { employment_status: _skip, joined_at: _j, ...rest } = data;
  const m = Object.keys(rest).length ? await prisma.orgMembership.update({ where: { id: created.id }, data: rest }) : created;
  return { user, m };
}

describe('FnF', () => {
  test('the nightly job exits the person and starts a Pending FnF with the last working day as its start; running again changes nothing', async () => {
    const { m } = await employee('Leaver');
    await prisma.orgMembership.update({ where: { id: m.id }, data: { employment_status: 'notice_period', notice_start_date: d('2026-09-01'), notice_end_date: d('2026-10-15') } });
    expect((await lwdExit.run(d('2026-10-16'))).exited).toBe(1);
    const fnf = await prisma.fnfRecord.findUnique({ where: { org_membership_id: m.id } });
    expect(fnf).toMatchObject({ status: 'pending', amount: null });
    expect(fnf.start_date.toISOString().slice(0, 10)).toBe('2026-10-15');
    await prisma.fnfRecord.update({ where: { id: fnf.id }, data: { amount: 5000, status: 'in_progress' } });
    await lwdExit.run(d('2026-10-17'));
    expect(await prisma.fnfRecord.count()).toBe(1);
    expect(await prisma.fnfRecord.findUnique({ where: { id: fnf.id } })).toMatchObject({ status: 'in_progress' }); // what an admin filled in stays
  });

  test('exiting someone by hand starts the same FnF', async () => {
    const { m } = await employee('Manual Leaver');
    const res = await authed(request(app).patch(`/api/v1/orgs/memberships/${m.id}`), adminToken).send({ employment_status: 'terminated' });
    expect(res.status).toBe(200);
    expect(await prisma.fnfRecord.findUnique({ where: { org_membership_id: m.id } })).toMatchObject({ status: 'pending' });
  });

  test('the FnF list shows every exited employee; an admin fills in amount and dates and moves the status; settling stamps the date', async () => {
    const { m } = await employee('Settled Soon');
    const { m: other } = await employee('Still Here');
    await prisma.orgMembership.update({ where: { id: m.id }, data: { employment_status: 'terminated', left_at: d('2026-09-30') } });
    const list = (await authed(request(app).get('/api/v1/payroll/fnf'), adminToken)).body.data;
    expect(list.map((r) => r.name)).toEqual(['Settled Soon']);
    expect(list[0]).toMatchObject({ status: 'not_started', last_working_day: '2026-09-30', fnf: null });

    const patch = (body, id = m.id) => authed(request(app).patch(`/api/v1/payroll/fnf/${id}`), adminToken).send(body);
    const started = await patch({ amount: 45000.5, start_date: '2026-10-01', status: 'in_progress' });
    expect(started.status).toBe(200);
    const settled = await patch({ status: 'settled' });
    expect(settled.body.data.fnf_date).toBeTruthy(); // stamped
    const after = (await authed(request(app).get('/api/v1/payroll/fnf').query({ status: 'settled' }), adminToken)).body.data;
    expect(after[0].fnf).toMatchObject({ amount: 45000.5, status: 'settled', start_date: '2026-10-01' });

    expect((await patch({ amount: 1 }, other.id)).status).toBe(422); // not exited
    const empToken = (await loginAs(await createUser({ role: 'employee', withOrg: false }).then(async (u) => { await createOrgMembership(u.id, org.id, { role: 'employee' }); return u; }))).access_token;
    expect((await authed(request(app).get('/api/v1/payroll/fnf'), empToken)).status).toBe(403);
  });
});

describe('birthdays and work anniversaries', () => {
  test('the next 14 days: birthday (no year), anniversary (years); contractors, people who left and far dates are left out', async () => {
    const today = d('2026-10-20');
    const soon = await employee('Birthday Soon', { date_of_birth: d('1990-10-25'), joined_at: d('2026-06-01') });
    await employee('Anniversary Soon', { joined_at: d('2023-10-22'), date_of_birth: d('1988-03-01') });
    await employee('First Year Not Yet', { joined_at: d('2026-10-22') }); // joined this year: no anniversary
    await employee('Far Birthday', { date_of_birth: d('1991-12-25'), joined_at: d('2026-01-01') });
    await employee('Left', { date_of_birth: d('1991-10-21'), employment_status: 'terminated' });
    const contractor = await employee('Contractor', { date_of_birth: d('1991-10-21'), worker_type: 'contractor' });
    expect(contractor.m.worker_type).toBe('contractor');
    await employee('Today', { date_of_birth: d('1995-10-20'), joined_at: d('2026-02-01') });

    const res = await announcements.upcoming(org.id, { days: 14, today });
    expect(res.birthdays.map((b) => [b.name, b.days_away])).toEqual([['Today', 0], ['Birthday Soon', 5]]);
    expect(res.anniversaries.map((a) => [a.name, a.years, a.days_away])).toEqual([['Anniversary Soon', 3, 2]]);
    expect(JSON.stringify(res)).not.toContain('1990'); // the birth year is never shown
    expect(soon.m.id).toBeTruthy();

    // through the API: any employee of the company can read it
    const empToken = (await loginAs(soon.user)).access_token;
    const api = await authed(request(app).get('/api/v1/orgs/announcements').query({ days: 60 }), empToken);
    expect(api.status).toBe(200);
    expect(api.body.data.days).toBe(60);
  });

  test('29 February is celebrated on 28 February in a year that has none; the year wraps over New Year', () => {
    expect(announcements.nextOccurrence(d('1992-02-29'), d('2027-02-01')).toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(announcements.nextOccurrence(d('1992-02-29'), d('2028-02-01')).toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(announcements.nextOccurrence(d('1990-01-03'), d('2026-12-28')).toISOString().slice(0, 10)).toBe('2027-01-03');
  });

  test('an employee sets their own birthday and an admin can set anyone\'s (personal details)', async () => {
    const { user, m } = await employee('Self Service');
    const token = (await loginAs(user)).access_token;
    const own = await authed(request(app).put(`/api/v1/orgs/memberships/${m.id}/details`), token).send({ date_of_birth: '1994-04-09' });
    expect(own.status).toBe(200);
    expect((await prisma.orgMembership.findUnique({ where: { id: m.id } })).date_of_birth.toISOString().slice(0, 10)).toBe('1994-04-09');
    const byAdmin = await authed(request(app).put(`/api/v1/orgs/memberships/${m.id}/details`), adminToken).send({ date_of_birth: '1994-04-10' });
    expect(byAdmin.status).toBe(200);
  });
});

describe('increment reminders', () => {
  test('a reminder on each anniversary, to the Super Admin users only; salary is not touched; one per person and year', async () => {
    const { m } = await employee('Two Years', { joined_at: d('2024-10-20') });
    await employee('This Year', { joined_at: d('2026-10-20') });
    await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: m.id, effective_from: d('2024-10-20'), ctc: 600000, components: { basic: 600000 }, created_by: superUser.id } });

    expect((await increments.generate({ today: d('2026-10-20') })).created).toBe(1);
    expect((await increments.generate({ today: d('2026-10-20') })).created).toBe(0); // again: nothing new
    const reminder = await prisma.incrementReminder.findFirst();
    expect(reminder).toMatchObject({ years_completed: 2, status: 'pending' });
    const notes = await prisma.notification.findMany({ where: { type: 'increment_review_due' } });
    expect(notes.map((n) => n.user_id)).toEqual([superUser.id]); // not the plain admin
    expect(notes[0].body).toMatch(/Two Years/);
    expect(Number((await prisma.salaryStructure.findFirst({ where: { org_membership_id: m.id } })).ctc)).toBe(600000);
  });

  test('a missed night is caught up (looks back a week); only Super Admin users can see and decide them; pending stays pending', async () => {
    const { m } = await employee('Missed Night', { joined_at: d('2023-10-17') });
    expect((await increments.generate({ today: d('2026-10-20') })).created).toBe(1); // 17 Oct was 3 days ago
    expect((await authed(request(app).get('/api/v1/payroll/increment-reminders'), adminToken)).status).toBe(403);
    const list = await authed(request(app).get('/api/v1/payroll/increment-reminders'), superToken);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ name: 'Missed Night', years_completed: 3, due_date: '2026-10-17', status: 'pending' });
    // still pending the next day, and the day after: it keeps showing
    expect((await authed(request(app).get('/api/v1/payroll/increment-reminders'), superToken)).body.data).toHaveLength(1);
    const id = list.body.data[0].id;
    expect((await authed(request(app).post(`/api/v1/payroll/increment-reminders/${id}/decision`), adminToken).send({ status: 'completed' })).status).toBe(403);
    expect((await authed(request(app).post(`/api/v1/payroll/increment-reminders/${id}/decision`), superToken).send({ status: 'ignored' })).status).toBe(200);
    expect((await authed(request(app).get('/api/v1/payroll/increment-reminders'), superToken)).body.data).toHaveLength(0);
    expect((await authed(request(app).get('/api/v1/payroll/increment-reminders').query({ status: 'ignored' }), superToken)).body.data).toHaveLength(1);
    expect(m.id).toBeTruthy();
  });
});

describe('previous month unpaid salary', () => {
  async function seedOctober() {
    const { m } = await employee('Late Joiner', { joined_at: d('2026-10-26') });
    const { m: full } = await employee('Paid Fully', { joined_at: d('2026-01-05') });
    for (const x of [m, full]) await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: x.id, effective_from: d('2026-01-01'), ctc: 1200000, components: { basic: 1200000 }, created_by: admin.id } });
    // attendance for every working day each was employed in October
    for (const x of [m, full]) {
      for (let day = 1; day <= 31; day += 1) {
        const date = new Date(Date.UTC(2026, 9, day));
        const dow = date.getUTCDay();
        if (dow === 0 || dow === 6) continue;
        if (x.id === m.id && date < d('2026-10-26')) continue;
        await prisma.attendanceRecord.create({ data: { org_id: org.id, org_membership_id: x.id, date, status: 'present', source: 'manual' } });
      }
    }
    // October was processed, but the late joiner has no payslip in it (they were added after); the other was paid
    const run = await prisma.payrollRun.create({ data: { org_id: org.id, period_month: 10, period_year: 2026, status: 'processed', run_at: new Date() } });
    const payroll = require('../src/modules/payroll/payroll.service');
    const { rows } = await payroll.runLines(org.id, run);
    const fullRow = rows.find((r) => r.org_membership_id === full.id);
    await prisma.payslip.create({ data: { org_id: org.id, payroll_run_id: run.id, org_membership_id: full.id, gross: fullRow.gross, deductions: fullRow.deductions, net: fullRow.net, breakdown: fullRow.breakdown } });
    return { m, full };
  }

  test('lists who was not paid for the days they worked, adds only what the admin chooses, never twice, never automatically', async () => {
    const { m, full } = await seedOctober();
    const nov = await prisma.payrollRun.create({ data: { org_id: org.id, period_month: 11, period_year: 2026 } });
    const dues = await authed(request(app).get(`/api/v1/payroll/runs/${nov.id}/previous-dues`), adminToken);
    expect(dues.status).toBe(200);
    expect(dues.body.data.map((x) => x.name)).toEqual(['Late Joiner']); // the fully paid one is not listed
    const due = dues.body.data[0];
    expect(due).toMatchObject({ org_membership_id: m.id, due_month: 10, due_year: 2026, had_payslip: false });
    expect(due.amount).toBeGreaterThan(0);
    expect(await prisma.salaryAdjustment.count()).toBe(0); // nothing is added by itself

    const add = await authed(request(app).post(`/api/v1/payroll/runs/${nov.id}/previous-dues/add`), adminToken).send({ org_membership_id: m.id, due_month: 10, due_year: 2026 });
    expect(add.status).toBe(200);
    const adj = await prisma.salaryAdjustment.findFirst();
    expect(adj).toMatchObject({ org_membership_id: m.id, period_month: 11, period_year: 2026, kind: 'addition' });
    expect(Number(adj.amount)).toBeCloseTo(due.amount, 2);
    expect(adj.note).toMatch(/Oct 2026/);
    expect((await authed(request(app).get(`/api/v1/payroll/runs/${nov.id}/previous-dues`), adminToken)).body.data).toHaveLength(0);
    expect((await authed(request(app).post(`/api/v1/payroll/runs/${nov.id}/previous-dues/add`), adminToken).send({ org_membership_id: m.id, due_month: 10, due_year: 2026 })).status).toBe(409);
    expect(full.id).toBeTruthy();
  });

  test('what is not added is offered again the following month', async () => {
    const { m } = await seedOctober();
    const nov = await prisma.payrollRun.create({ data: { org_id: org.id, period_month: 11, period_year: 2026 } });
    await authed(request(app).get(`/api/v1/payroll/runs/${nov.id}/previous-dues`), adminToken); // looked at, not added
    const dec = await prisma.payrollRun.create({ data: { org_id: org.id, period_month: 12, period_year: 2026 } });
    const again = await authed(request(app).get(`/api/v1/payroll/runs/${dec.id}/previous-dues`), adminToken);
    expect(again.body.data.map((x) => x.org_membership_id)).toEqual([m.id]);
    expect((await authed(request(app).get(`/api/v1/payroll/runs/${dec.id}/previous-dues`), (await loginAs(await createUser({ role: 'employee', withOrg: false }).then(async (u) => { await createOrgMembership(u.id, org.id, { role: 'employee' }); return u; }))).access_token)).status).toBe(403);
  });
});
