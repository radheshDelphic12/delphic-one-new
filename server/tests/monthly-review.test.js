// Monthly performance review (Reports): per employee and month, attendance plus the measures of the person's function; every count has
// the records behind it. Admin only.
const ExcelJS = require('exceljs');
const { prisma, request, app, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, createProfile, authed } = require('./helpers');

beforeEach(async () => { await cleanDatabase(); });
afterAll(async () => { await prisma.$disconnect(); });

const now = new Date();
const key = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 7);
const inMonth = (day) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 6));

async function seed() {
  const org = await createOrg();
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const admin = (await loginAs(adminUser)).access_token;
  const dept = async (name) => prisma.department.create({ data: { org_id: org.id, name } });
  const person = async (name, department, joined = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 3))) => {
    const user = await createUser({ role: 'recruiter', name });
    const m = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: joined });
    await prisma.orgMembership.update({ where: { id: m.id }, data: { department_id: department.id, employee_code: `E-${name.slice(0, 3)}` } });
    return { user, m };
  };
  return { org, admin, adminUser, dept, person };
}
const get = (path, token) => authed(request(app).get(`/api/v1/reports${path}`), token);

describe('monthly performance review', () => {
  test('a sales person: meetings, clients that became Active, requirements brought / owned, each with its records', async () => {
    const ctx = await seed();
    const sales = await ctx.dept('Sales');
    const dheeraj = await ctx.person('Dheeraj Kumar', sales);
    const mk = (name, stage) => prisma.account.create({ data: { org_id: ctx.org.id, name, type: 'client', stage, owner_id: dheeraj.user.id, origin_owner_id: dheeraj.user.id } });
    const acme = await mk('Acme', 'active');
    const beta = await mk('Beta', 'meeting_scheduled');
    for (const a of [acme, beta]) await prisma.stageHistory.create({ data: { entity_type: 'account', entity_id: a.id, from_stage: 'lead', to_stage: 'meeting_scheduled', changed_by: dheeraj.user.id, changed_at: inMonth(5) } });
    await prisma.requirement.create({ data: { account_id: acme.id, title: 'Java Dev', req_type: 'recruitment', sales_owner_id: dheeraj.user.id, created_at: inMonth(6) } });

    const res = await get(`/monthly-review?from_month=${key}&to_month=${key}`, ctx.admin);
    expect(res.status).toBe(200);
    const p = res.body.data.people.find((x) => x.name === 'Dheeraj Kumar');
    expect(p).toMatchObject({ function: 'sales', employee_code: 'E-Dhe' });
    const row = p.months.find((m) => m.key === key);
    const count = (k) => row.metrics.find((m) => m.key === k).count;
    expect(count('meetings_scheduled')).toBe(2);
    expect(count('clients_active')).toBe(1);
    expect(count('req_brought')).toBe(1);
    expect(count('req_owned')).toBe(1);

    const ym = `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
    const det = await get(`/monthly-review/details?org_membership_id=${dheeraj.m.id}&metric=clients_active&${ym}`, ctx.admin);
    expect(det.status).toBe(200);
    expect(det.body.data.items.map((i) => i.title)).toEqual(['Acme']);
    const det2 = await get(`/monthly-review/details?org_membership_id=${dheeraj.m.id}&metric=req_brought&${ym}`, ctx.admin);
    expect(det2.body.data.items[0]).toMatchObject({ title: 'Java Dev', sub: 'Acme' });
  });

  test('Sales and HR see every measure of the brief, in order: meetings, requirements, closures, joinings, submissions, vendors', async () => {
    const ctx = await seed();
    const sales = await ctx.dept('Sales');
    const hr = await ctx.dept('HR');
    const dheeraj = await ctx.person('Dheeraj Kumar', sales);
    const hira = await ctx.person('Hira HR', hr);
    const hiraToken = (await loginAs(hira.user)).access_token;
    const client = await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Acme', type: 'client', stage: 'active', owner_id: dheeraj.user.id, origin_owner_id: dheeraj.user.id } });
    const req = await prisma.requirement.create({ data: { account_id: client.id, title: 'Java Dev', req_type: 'recruitment', sales_owner_id: dheeraj.user.id, created_at: inMonth(2) } });
    const seat = await prisma.requirementSeat.create({ data: { requirement_id: req.id } });
    const profile = await createProfile(hiraToken, { name: 'Candidate One' });
    const sub = await prisma.submission.create({ data: { requirement_seat_id: seat.id, profile_id: profile.id, stage: 'closed', submitted_by: hira.user.id, actual_joining_date: inMonth(9) } });
    await prisma.stageHistory.create({ data: { entity_type: 'submission', entity_id: sub.id, to_stage: 'submitted_to_client', changed_by: hira.user.id, changed_at: inMonth(4) } });
    // a first meeting with the client (Dheeraj and Hira tagged) and an extra client meeting (Hira tagged)
    await prisma.account.update({ where: { id: client.id }, data: { meeting_date: inMonth(3) } });
    for (const u of [dheeraj, hira]) await prisma.accountMeetingAttendee.create({ data: { account_id: client.id, user_id: u.user.id } });
    const meeting = await prisma.clientMeeting.create({ data: { org_id: ctx.org.id, account_id: client.id, title: 'Review call', scheduled_at: inMonth(6), created_by: dheeraj.user.id } });
    await prisma.clientMeetingAttendee.create({ data: { meeting_id: meeting.id, user_id: hira.user.id } });
    // Hira took two interviews of this candidate earlier in the month (one passed); the candidate joined, so the shortlist ends in a joining
    const early = (day) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 3));
    for (const [n, day, result] of [[1, 1, 'fail'], [2, 1, 'pass']]) {
      const round = await prisma.interviewRound.create({ data: { submission_id: sub.id, round_number: n, round_type: 'internal_r1', scheduled_at: early(day), result } });
      await prisma.interviewRoundInterviewer.create({ data: { interview_round_id: round.id, user_id: hira.user.id } });
    }
    // a vendor Hira brought in
    await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Vendor Co', type: 'vendor', stage: 'active', owner_id: hira.user.id, origin_owner_id: hira.user.id } });

    const res = await get(`/monthly-review?from_month=${key}&to_month=${key}&limit=50`, ctx.admin);
    const rowOf = (name) => res.body.data.people.find((x) => x.name === name).months.find((m) => m.key === key).metrics;
    const asMap = (metrics) => Object.fromEntries(metrics.map((m) => [m.key, m.count]));
    expect(rowOf('Dheeraj Kumar').map((m) => m.key)).toEqual(['meetings_scheduled', 'clients_active', 'req_brought', 'req_brought_won', 'req_owned_live', 'req_owned', 'req_owned_won', 'meetings_attended', 'submitted_on_owned', 'joinings_owned']);
    expect(asMap(rowOf('Dheeraj Kumar'))).toMatchObject({ req_brought: 1, req_brought_won: 1, req_owned_live: 1, req_owned: 1, req_owned_won: 1, meetings_attended: 1, submitted_on_owned: 1, joinings_owned: 1 });
    expect(rowOf('Hira HR').map((m) => m.key)).toEqual(['profiles_submitted', 'interviews_taken', 'interviews_shortlisted', 'interviews_joined', 'joinings', 'vendors_onboarded', 'meetings_attended']);
    expect(asMap(rowOf('Hira HR'))).toEqual({ profiles_submitted: 1, interviews_taken: 2, interviews_shortlisted: 1, interviews_joined: 1, joinings: 1, vendors_onboarded: 1, meetings_attended: 2 });

    const ym = `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
    const att = await get(`/monthly-review/details?org_membership_id=${hira.m.id}&metric=meetings_attended&${ym}`, ctx.admin);
    expect(att.body.data.items.map((i) => i.sub).sort()).toEqual(['Client meeting', 'Review call']);
    const jo = await get(`/monthly-review/details?org_membership_id=${dheeraj.m.id}&metric=joinings_owned&${ym}`, ctx.admin);
    expect(jo.body.data.items[0].title).toBe('Candidate One');
  });

  test('a requirement is won in the month its candidate was closed, even with no joining date or one in a later month', async () => {
    const ctx = await seed();
    const sales = await ctx.dept('Sales');
    const tanvi = await ctx.person('Tanvi Saxena', sales);
    const hr = await ctx.dept('HR');
    const hira = await ctx.person('Hira HR', hr);
    const hiraToken = (await loginAs(hira.user)).access_token;
    const client = await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Acme', type: 'client', stage: 'active', owner_id: tanvi.user.id, origin_owner_id: tanvi.user.id } });
    const closedIn = (day) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 6));
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 12));
    // 1) closed this month, no joining date entered; 2) closed this month, joining planned for next month; 3) closed this month, joined this month
    for (const [title, joining] of [['No joining date', null], ['Joining next month', nextMonth], ['Joined this month', closedIn(20)]]) {
      const req = await prisma.requirement.create({ data: { account_id: client.id, title, req_type: 'recruitment', sales_owner_id: tanvi.user.id, created_at: closedIn(1) } });
      const seat = await prisma.requirementSeat.create({ data: { requirement_id: req.id, seat_status: 'closed', closed_at: closedIn(15) } });
      const profile = await createProfile(hiraToken, { name: `Candidate ${title}` });
      await prisma.submission.create({ data: { requirement_seat_id: seat.id, profile_id: profile.id, stage: 'closed', submitted_by: hira.user.id, actual_joining_date: joining } });
    }
    const res = await get(`/monthly-review?from_month=${key}&to_month=${key}&limit=50`, ctx.admin);
    const counts = (name) => Object.fromEntries(res.body.data.people.find((x) => x.name === name).months.find((m) => m.key === key).metrics.map((m) => [m.key, m.count]));
    expect(counts('Tanvi Saxena')).toMatchObject({ req_owned_won: 3, req_brought_won: 3, joinings_owned: 2 });
    // joinings follow the joining date (else the closing day): two this month, the one planned for next month waits
    expect(counts('Hira HR').joinings).toBe(2);
    const ym = `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
    const det = await get(`/monthly-review/details?org_membership_id=${tanvi.m.id}&metric=req_owned_won&${ym}`, ctx.admin);
    expect(det.body.data.items.map((i) => i.title).sort()).toEqual(['Joined this month', 'Joining next month', 'No joining date']);
  });

  test('attendance: working days and present days per month, and "data not available" for a past month with nothing recorded', async () => {
    const ctx = await seed();
    const hr = await ctx.dept('HR');
    const e = await ctx.person('Hira HR', hr, new Date(Date.UTC(2026, 0, 15)));
    await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: e.m.id, date: new Date('2026-03-03T00:00:00Z'), status: 'present' } });
    const res = await get('/monthly-review?from_month=2026-01&to_month=2026-03&function=hr', ctx.admin);
    const p = res.body.data.people.find((x) => x.name === 'Hira HR');
    const by = Object.fromEntries(p.months.map((m) => [m.key, m]));
    expect(Object.keys(by).sort()).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(by['2026-01'].working_days).toBeGreaterThan(5);
    expect(by['2026-01'].working_days).toBeLessThan(by['2026-02'].working_days + 3); // starts on 15 Jan: fewer than a full month
    expect(by['2026-01'].no_data).toBe(true);
    expect(by['2026-03'].present).toBe(1);
    expect(by['2026-03'].no_data).toBe(false);
    expect(p.months[0].key).toBe('2026-03'); // newest first
    expect(by['2026-03'].metrics.map((m) => m.key)).toEqual(['profiles_submitted', 'interviews_taken', 'interviews_shortlisted', 'interviews_joined', 'joinings', 'vendors_onboarded', 'meetings_attended']);
  });

  test('IT: active projects split into billable and non-billable, narrowed by the checkboxes', async () => {
    const ctx = await seed();
    const it = await ctx.dept('IT');
    const dev = await ctx.person('Ravi IT', it);
    const owner = ctx.adminUser;
    const proj = (name) => prisma.account.create({ data: { org_id: ctx.org.id, name, type: 'client', stage: 'active', owner_id: owner.id, is_project: true } });
    const paid = await proj('Paid Project');
    const free = await proj('Delphic Internal');
    await prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: paid.id, rate_type: 'monthly', rate: 50000, effective_from: new Date('2020-01-01'), created_by: owner.id } });
    for (const a of [paid, free]) await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: a.id, org_membership_id: dev.m.id, created_by: owner.id, start_date: new Date('2020-01-01') } });

    const metrics = async (extra) => {
      const res = await get(`/monthly-review?from_month=${key}&to_month=${key}&function=it${extra}`, ctx.admin);
      return Object.fromEntries(res.body.data.people[0].months[0].metrics.map((m) => [m.key, m.count]));
    };
    expect(await metrics('')).toEqual({ projects_active: 1, projects_billable: 1, projects_daily: 1 });
    expect(await metrics('&include_non_billable=1')).toEqual({ projects_active: 2, projects_billable: 1, projects_non_billable: 1, projects_daily: 2 });
    expect(await metrics('&include_billable=0&include_non_billable=1')).toEqual({ projects_active: 1, projects_non_billable: 1, projects_daily: 1 });

    // the daily measure lists every day with how many projects the person was on
    const ym = `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
    const daily = await get(`/monthly-review/details?org_membership_id=${dev.m.id}&metric=projects_daily&include_non_billable=1&${ym}`, ctx.admin);
    expect(daily.status).toBe(200);
    expect(daily.body.data.items.length).toBeGreaterThan(0);
    expect(daily.body.data.items.every((i) => i.title === '2 projects')).toBe(true);
  });

  test('IT: a project that ended on 15 March shows its dates, and the day-wise view stops counting it after the 15th', async () => {
    const ctx = await seed();
    const it = await ctx.dept('IT');
    const dev = await ctx.person('Esha IT', it, new Date(Date.UTC(2026, 0, 1)));
    const owner = ctx.adminUser;
    const acc = await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Neuromind', type: 'client', stage: 'active', owner_id: owner.id, is_project: true } });
    await prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: acc.id, rate_type: 'monthly', rate: 50000, effective_from: new Date('2020-01-01'), created_by: owner.id } });
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: acc.id, org_membership_id: dev.m.id, created_by: owner.id, start_date: new Date('2026-01-10'), end_date: new Date('2026-03-15') } });

    const base = `/monthly-review/details?org_membership_id=${dev.m.id}&year=2026&month=3`;
    const list = await get(`${base}&metric=projects_billable`, ctx.admin);
    expect(list.body.data.items).toEqual([expect.objectContaining({ title: 'Neuromind', start_date: '2026-01-10', end_date: '2026-03-15', state: 'ended_this_month' })]);

    const daily = (await get(`${base}&metric=projects_daily`, ctx.admin)).body.data.items;
    const on = (d) => daily.find((x) => x.date === `2026-03-${d}`);
    expect(on('15').value).toBe(1);
    expect(on('15').ended).toEqual(['Neuromind']);
    expect(on('16').value).toBe(0);

    // the day-wise view (every function): attendance of the day plus the projects, with the last day marked
    const dw = (await get(`${base}&metric=daywise`, ctx.admin)).body.data;
    const dwDay = (d) => dw.items.find((x) => x.date === `2026-03-${d}`);
    expect(dw.function).toBe('it');
    expect(dwDay('15').projects).toEqual({ count: 1, names: ['Neuromind'], ended: ['Neuromind'], started: [] });
    expect(dwDay('16').projects.count).toBe(0);
    expect(dw.items.every((x) => 'attendance' in x && Array.isArray(x.measures))).toBe(true);
  });

  test('day-wise view for HR lists the day of each record, and the export carries a Day-wise sheet', async () => {
    const ctx = await seed();
    const hr = await ctx.dept('HR');
    const e = await ctx.person('Hira HR', hr, new Date(Date.UTC(2026, 0, 1)));
    await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: e.m.id, date: new Date('2026-03-03T00:00:00Z'), status: 'present' } });
    const dw = (await get(`/monthly-review/details?org_membership_id=${e.m.id}&metric=daywise&year=2026&month=3`, ctx.admin)).body.data;
    expect(dw.function).toBe('hr');
    expect(dw.items.find((x) => x.date === '2026-03-03').attendance.kind).toBe('present');
    const bad = await get(`/monthly-review/details?org_membership_id=${e.m.id}&metric=nope&year=2026&month=3`, ctx.admin);
    expect(bad.status).toBe(400);

    const xlsx = await authed(request(app).get('/api/v1/reports/monthly-review/export?type=xlsx&function=hr'), ctx.admin).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Monthly review', 'Day-wise']);
    expect(wb.getWorksheet('Day-wise').rowCount).toBeGreaterThan(1);
  });

  test("IT: the project's own agreement dates count too, and two contracts with one name are told apart by their code", async () => {
    const ctx = await seed();
    const it = await ctx.dept('IT');
    const dev = await ctx.person('Ravi IT', it, new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)));
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevKey = prev.toISOString().slice(0, 7);
    const rate = (id) => prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: id, rate_type: 'monthly', rate: 1000, effective_from: new Date('2020-01-01'), created_by: ctx.adminUser.id } });
    const proj = (code, extra) => prisma.account.create({ data: { org_id: ctx.org.id, name: 'Glut Network', project_name: 'Glut Network', project_code: code, type: 'client', stage: 'active', owner_id: ctx.adminUser.id, is_project: true, ...extra } });
    // P0001: the agreement ended on the 10th of last month; P0002: the agreement starts next month. The allocations themselves are open-ended.
    const ended = await proj('P0001', { agreement_start_date: new Date('2020-01-01'), agreement_end_date: new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), 10)) });
    const future = await proj('P0002', { agreement_start_date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) });
    const live = await proj('P0003', { agreement_start_date: new Date('2020-01-01') });
    for (const a of [ended, future, live]) { await rate(a.id); await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: a.id, org_membership_id: dev.m.id, created_by: ctx.adminUser.id, start_date: new Date('2020-01-01') } }); }

    const res = await get(`/monthly-review?from_month=${prevKey}&to_month=${key}&function=it`, ctx.admin);
    const months = Object.fromEntries(res.body.data.people[0].months.map((m) => [m.key, Object.fromEntries(m.metrics.map((x) => [x.key, x.count]))]));
    expect(months[prevKey].projects_active).toBe(2); // P0001 (until the 10th) and P0003
    expect(months[key].projects_active).toBe(1); // only P0003: P0001 ended, P0002 has not started
    const ym = `year=${prev.getUTCFullYear()}&month=${prev.getUTCMonth() + 1}`;
    const det = await get(`/monthly-review/details?org_membership_id=${dev.m.id}&metric=projects_active&${ym}`, ctx.admin);
    expect(det.body.data.items.map((i) => i.title).sort()).toEqual(['Glut Network (P0001)', 'Glut Network (P0003)']);
  });

  test('a project that was deleted and entered again counts once: the deleted record and non-project accounts are left out', async () => {
    const ctx = await seed();
    const it = await ctx.dept('IT');
    const dev = await ctx.person('Arunim IT', it, new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)));
    const base = { org_id: ctx.org.id, name: 'Dish Network', project_name: 'Dish Network', type: 'client', stage: 'active', owner_id: ctx.adminUser.id, is_project: true };
    const rate = (id) => prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: id, rate_type: 'monthly', rate: 210000, effective_from: new Date('2020-01-01'), created_by: ctx.adminUser.id } });
    const assign = (id) => prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: id, org_membership_id: dev.m.id, created_by: ctx.adminUser.id, start_date: new Date('2020-01-01') } });
    const oldOne = await prisma.account.create({ data: { ...base, project_code: 'P0007', deleted_at: new Date() } }); // deleted earlier, assignment left behind
    const current = await prisma.account.create({ data: { ...base, project_code: 'P0123' } });
    const notAProject = await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Plain client', type: 'client', stage: 'dropped', owner_id: ctx.adminUser.id } });
    for (const a of [oldOne, current, notAProject]) { await rate(a.id); await assign(a.id); }

    const res = await get(`/monthly-review?from_month=${key}&to_month=${key}&function=it`, ctx.admin);
    const counts = Object.fromEntries(res.body.data.people[0].months[0].metrics.map((m) => [m.key, m.count]));
    expect(counts).toMatchObject({ projects_active: 1, projects_billable: 1 });
    const ym = `year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`;
    const det = await get(`/monthly-review/details?org_membership_id=${dev.m.id}&metric=projects_billable&${ym}`, ctx.admin);
    expect(det.body.data.items.map((i) => i.title)).toEqual(['Dish Network (P0123)']);
  });

  test('a deleted requirement or client is not counted as brought, owned or won', async () => {
    const ctx = await seed();
    const sales = await ctx.dept('Sales');
    const tanvi = await ctx.person('Tanvi Saxena', sales);
    const hr = await ctx.dept('HR');
    const hira = await ctx.person('Hira HR', hr);
    const hiraToken = (await loginAs(hira.user)).access_token;
    const client = await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Acme', type: 'client', stage: 'active', owner_id: tanvi.user.id, origin_owner_id: tanvi.user.id } });
    const at = (day) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 6));
    const make = async (title, deleted) => {
      const req = await prisma.requirement.create({ data: { account_id: client.id, title, req_type: 'recruitment', sales_owner_id: tanvi.user.id, created_at: at(1), ...(deleted ? { deleted_at: new Date() } : {}) } });
      const seat = await prisma.requirementSeat.create({ data: { requirement_id: req.id, seat_status: 'closed', closed_at: at(10) } });
      const profile = await createProfile(hiraToken, { name: `Candidate ${title}` });
      await prisma.submission.create({ data: { requirement_seat_id: seat.id, profile_id: profile.id, stage: 'closed', submitted_by: hira.user.id } });
    };
    await make('Live requirement', false);
    await make('Deleted requirement', true);
    const res = await get(`/monthly-review?from_month=${key}&to_month=${key}&limit=50`, ctx.admin);
    const counts = Object.fromEntries(res.body.data.people.find((x) => x.name === 'Tanvi Saxena').months[0].metrics.map((m) => [m.key, m.count]));
    expect(counts).toMatchObject({ req_brought: 1, req_owned: 1, req_owned_won: 1, req_brought_won: 1, joinings_owned: 1 });
    const hiraCounts = Object.fromEntries(res.body.data.people.find((x) => x.name === 'Hira HR').months[0].metrics.map((m) => [m.key, m.count]));
    expect(hiraCounts.joinings).toBe(1);
  });

  test('manual project status: on hold still counts, tagged; completed ends on its end date, or keeps counting and is flagged when it has none', async () => {
    const ctx = await seed();
    const it = await ctx.dept('IT');
    const dev = await ctx.person('Sujal IT', it, new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)));
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prevKey = prev.toISOString().slice(0, 7);
    const mk = async (code, extra) => {
      const a = await prisma.account.create({ data: { org_id: ctx.org.id, name: `Project ${code}`, project_name: `Project ${code}`, project_code: code, type: 'client', stage: 'active', owner_id: ctx.adminUser.id, is_project: true, agreement_start_date: new Date('2020-01-01'), ...extra } });
      await prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: a.id, rate_type: 'monthly', rate: 1000, effective_from: new Date('2020-01-01'), created_by: ctx.adminUser.id } });
      await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: a.id, org_membership_id: dev.m.id, created_by: ctx.adminUser.id, start_date: new Date('2020-01-01') } });
    };
    await mk('P1', { contract_status: 'on_hold' });
    await mk('P2', { contract_status: 'completed' }); // completed, no end date
    await mk('P3', { contract_status: 'completed', agreement_end_date: new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth(), 5)) }); // completed, ended last month

    const month = async (y, m, k) => (await get(`/monthly-review/details?org_membership_id=${dev.m.id}&metric=projects_active&year=${y}&month=${m}`, ctx.admin)).body.data.items.find((i) => i.title === `Project ${k} (${k})`) || (await get(`/monthly-review/details?org_membership_id=${dev.m.id}&metric=projects_active&year=${y}&month=${m}`, ctx.admin)).body.data.items.find((i) => i.title.includes(k));
    const now1 = await month(now.getUTCFullYear(), now.getUTCMonth() + 1, 'P1');
    expect(now1.flag).toBe('on_hold');
    expect((await month(now.getUTCFullYear(), now.getUTCMonth() + 1, 'P2')).flag).toBe('completed_no_end_date');
    expect(await month(now.getUTCFullYear(), now.getUTCMonth() + 1, 'P3')).toBeUndefined(); // ended last month: no longer counted
    expect(await month(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 'P3')).toBeDefined(); // counted in its last month
    const res = await get(`/monthly-review?from_month=${prevKey}&to_month=${key}&function=it`, ctx.admin);
    const by = Object.fromEntries(res.body.data.people[0].months.map((m) => [m.key, Object.fromEntries(m.metrics.map((x) => [x.key, x.count]))]));
    expect(by[prevKey].projects_active).toBe(3);
    expect(by[key].projects_active).toBe(2);
  });

  test('export: Excel and PDF carry every employee and month of the filtered review', async () => {
    const ctx = await seed();
    const hr = await ctx.dept('HR');
    await ctx.person('Hira HR', hr);
    const xlsx = await authed(request(app).get(`/api/v1/reports/monthly-review/export?type=xlsx&function=hr`), ctx.admin).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect(xlsx.body.length).toBeGreaterThan(500);
    const pdf = await authed(request(app).get(`/api/v1/reports/monthly-review/export?type=pdf&function=hr`), ctx.admin).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect((await get('/monthly-review/export?type=csv', ctx.admin)).status).toBe(422);
  });

  test('admin only, and paginated by employee', async () => {
    const ctx = await seed();
    const sales = await ctx.dept('Sales');
    const a = await ctx.person('Anna', sales);
    await ctx.person('Bob', sales);
    await ctx.person('Cara', sales);
    expect((await get('/monthly-review', (await loginAs(a.user)).access_token)).status).toBe(403);
    const page = await get('/monthly-review?limit=2&page=2', ctx.admin);
    expect(page.body.data.total).toBe(4);
    expect(page.body.data.pages).toBe(2);
    expect(page.body.data.people.length).toBe(2);
  });
});
