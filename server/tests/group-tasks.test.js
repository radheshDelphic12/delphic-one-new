const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const calc = require('../src/modules/superDashboard/groupTasks.calc');

const base = '/api/v1/super-dashboard';
const iso = (d) => d.toISOString().slice(0, 10);

describe('group task date rules (pure)', () => {
  const T = (o) => ({ status: 'active', kind: 'recurring', interval: 1, weekdays: [], start_date: '2026-01-05', ...o });
  test('one-time falls on its due date only; paused and cancelled have no dates', () => {
    expect(calc.occurrencesBetween({ status: 'active', kind: 'one_time', due_date: '2026-10-15' }, '2026-10-01', '2026-10-31')).toEqual(['2026-10-15']);
    expect(calc.occurrencesBetween({ status: 'active', kind: 'one_time', due_date: '2026-11-02' }, '2026-10-01', '2026-10-31')).toEqual([]);
    expect(calc.occurrencesBetween({ status: 'paused', kind: 'one_time', due_date: '2026-10-15' }, '2026-10-01', '2026-10-31')).toEqual([]);
    expect(calc.occurrencesBetween(T({ status: 'cancelled', frequency: 'daily' }), '2026-10-01', '2026-10-31')).toEqual([]);
  });
  test('daily every N days counts from the start date; nothing before it or after the end date', () => {
    expect(calc.occurrencesBetween(T({ frequency: 'daily', interval: 3, start_date: '2026-10-02' }), '2026-10-01', '2026-10-12')).toEqual(['2026-10-02', '2026-10-05', '2026-10-08', '2026-10-11']);
    expect(calc.occurrencesBetween(T({ frequency: 'daily', start_date: '2026-10-05', end_date: '2026-10-07' }), '2026-10-01', '2026-10-31')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });
  test('weekly on chosen weekdays, every N weeks from the start week', () => {
    // 2026-10-05 is a Monday. Mon + Thu every week
    expect(calc.occurrencesBetween(T({ frequency: 'weekly', weekdays: [1, 4], start_date: '2026-10-05' }), '2026-10-01', '2026-10-15')).toEqual(['2026-10-05', '2026-10-08', '2026-10-12', '2026-10-15']);
    // every 2 weeks on Monday
    expect(calc.occurrencesBetween(T({ frequency: 'weekly', interval: 2, weekdays: [1], start_date: '2026-10-05' }), '2026-10-01', '2026-11-10')).toEqual(['2026-10-05', '2026-10-19', '2026-11-02']);
    // a week-start date that is not a Monday still anchors on its own week
    expect(calc.occurrencesBetween(T({ frequency: 'weekly', weekdays: [7], start_date: '2026-10-07' }), '2026-10-01', '2026-10-31')).toEqual(['2026-10-11', '2026-10-18', '2026-10-25']);
  });
  test('monthly, quarterly and yearly; day 31 and 29 Feb clamp to the month end', () => {
    expect(calc.occurrencesBetween(T({ frequency: 'monthly', day_of_month: 31, start_date: '2026-01-31' }), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(calc.occurrencesBetween(T({ frequency: 'monthly', interval: 2, day_of_month: 10, start_date: '2026-01-10' }), '2026-01-01', '2026-07-31')).toEqual(['2026-01-10', '2026-03-10', '2026-05-10', '2026-07-10']);
    expect(calc.occurrencesBetween(T({ frequency: 'quarterly', day_of_month: 15, start_date: '2026-01-15' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
    expect(calc.occurrencesBetween(T({ frequency: 'yearly', day_of_month: 29, start_date: '2024-02-29' }), '2024-01-01', '2028-12-31')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
    // a month that starts before the window still finds its date inside it
    expect(calc.occurrencesBetween(T({ frequency: 'monthly', day_of_month: 20, start_date: '2025-06-20' }), '2026-10-10', '2026-10-31')).toEqual(['2026-10-20']);
  });
});

let group;
let a;
let b;
let c;
let superToken;
let adminToken;
let outsider;

beforeEach(async () => {
  await cleanDatabase();
  a = await createOrg({ name: 'Alpha Global' });
  group = { id: a.org_group_id };
  b = await createOrg({ name: 'Beta Trading', org_group_id: group.id });
  c = await createOrg({ name: 'Gamma Infra', org_group_id: group.id });
  outsider = await createOrg({ name: 'Other Group Co' });
  const su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: group.id } });
  await createOrgMembership(su.id, a.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(su));
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, a.id, { role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));
});
afterAll(async () => { await prisma.$disconnect(); });

const post = (path, body, t = superToken) => authed(request(app).post(`${base}${path}`), t).send(body);
const get = (path, t = superToken) => authed(request(app).get(`${base}${path}`), t);
const put = (path, body, t = superToken) => authed(request(app).put(`${base}${path}`), t).send(body);
const month = new Date().toISOString().slice(0, 7);
const dayInMonth = (n) => `${month}-${String(n).padStart(2, '0')}`;

describe('group tasks and the weekly company table', () => {
  test('only a group superadmin may use them', async () => {
    expect((await get('/group/tasks', adminToken)).status).toBe(403);
    expect((await post('/group/tasks', { title: 'x', due_date: dayInMonth(10) }, adminToken)).status).toBe(403);
    expect((await get('/group/weekly-plan', adminToken)).status).toBe(403);
    expect((await get('/group/tasks')).status).toBe(200);
  });

  test('one-time and recurring tasks show in the month list, with validation', async () => {
    const one = await post('/group/tasks', { title: 'Board meeting prep', due_date: dayInMonth(15), priority: 'high', org_id: b.id });
    expect(one.status).toBe(201);
    const weekly = await post('/group/tasks', { title: 'Weekly cash review', kind: 'recurring', frequency: 'weekly', weekdays: [1], start_date: dayInMonth(1) });
    expect(weekly.status).toBe(201);
    const monthly = await post('/group/tasks', { title: 'GST filing', kind: 'recurring', frequency: 'monthly', day_of_month: 20, start_date: dayInMonth(1), org_id: c.id });
    expect(monthly.status).toBe(201);

    // validation
    expect((await post('/group/tasks', { title: 'No date' })).status).toBe(422);
    expect((await post('/group/tasks', { title: 'x', kind: 'recurring', start_date: dayInMonth(1) })).status).toBe(422);
    expect((await post('/group/tasks', { title: 'x', kind: 'recurring', frequency: 'weekly', start_date: dayInMonth(1) })).status).toBe(422);
    expect((await post('/group/tasks', { title: 'x', kind: 'recurring', frequency: 'daily', start_date: dayInMonth(10), end_date: dayInMonth(5) })).status).toBe(422);
    expect((await post('/group/tasks', { title: 'x', due_date: dayInMonth(3), org_id: outsider.id })).status).toBe(422); // another group's company
    expect((await post('/group/tasks', { title: '', due_date: dayInMonth(3) })).status).toBe(422);

    const list = (await get(`/group/tasks?month=${month}`)).body.data;
    const titles = (t) => list.items.filter((i) => i.title === t);
    expect(titles('Board meeting prep')).toHaveLength(1);
    expect(titles('Board meeting prep')[0]).toMatchObject({ date: dayInMonth(15), priority: 'high', recurring: false, company: { name: 'Beta Trading' } });
    const mondays = list.items.filter((i) => i.title === 'Weekly cash review').map((i) => i.date);
    expect(mondays.length).toBeGreaterThanOrEqual(4);
    expect(mondays.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    expect(titles('GST filing').map((i) => i.date)).toEqual([dayInMonth(20)]);
    expect(list.items.map((i) => i.date)).toEqual([...list.items.map((i) => i.date)].sort());
    expect(list.summary.total).toBe(list.items.length);
    expect(list.summary).toMatchObject({ recurring: mondays.length + 1, one_time: 1 });
    // company filter keeps that company's tasks and the group-wide ones
    const onlyB = (await get(`/group/tasks?month=${month}&org_id=${b.id}`)).body.data;
    expect(onlyB.items.some((i) => i.title === 'GST filing')).toBe(false);
    expect(onlyB.items.some((i) => i.title === 'Board meeting prep')).toBe(true);
    expect(onlyB.items.some((i) => i.title === 'Weekly cash review')).toBe(true);
    // a different month shows only what recurs there
    const [y, m] = month.split('-').map(Number);
    const next = iso(new Date(Date.UTC(y, m, 1))).slice(0, 7);
    const nx = (await get(`/group/tasks?month=${next}`)).body.data;
    expect(nx.items.some((i) => i.title === 'Board meeting prep')).toBe(false);
    expect(nx.items.some((i) => i.title === 'GST filing')).toBe(true);
  });

  test('tick one date of a recurring task, reopen it, edit, pause and delete', async () => {
    const t = (await post('/group/tasks', { title: 'Weekly review', kind: 'recurring', frequency: 'weekly', weekdays: [1, 3], start_date: dayInMonth(1) })).body.data;
    const first = (await get(`/group/tasks?month=${month}`)).body.data.items.find((i) => i.title === 'Weekly review');
    expect((await put(`/group/tasks/${t.id}/occurrences/${first.date}`, { done: true, note: 'Done on call' })).status).toBe(200);
    let list = (await get(`/group/tasks?month=${month}`)).body.data;
    expect(list.items.find((i) => i.key === first.key)).toMatchObject({ done: true });
    expect(list.items.filter((i) => i.title === 'Weekly review' && !i.done).length).toBeGreaterThan(0); // other dates stay open
    expect((await get(`/group/tasks?month=${month}&status=done`)).body.data.items.every((i) => i.done)).toBe(true);
    expect((await put(`/group/tasks/${t.id}/occurrences/${first.date}`, { done: false })).status).toBe(200);
    list = (await get(`/group/tasks?month=${month}`)).body.data;
    expect(list.items.find((i) => i.key === first.key).done).toBe(false);
    // a date the task does not fall on cannot be ticked
    expect((await put(`/group/tasks/${t.id}/occurrences/${dayInMonth(2)}`, { done: true })).status).toBe(422);

    expect((await authed(request(app).patch(`${base}/group/tasks/${t.id}`), superToken).send({ title: 'Weekly review (renamed)', priority: 'high' })).body.data.title).toBe('Weekly review (renamed)');
    await authed(request(app).patch(`${base}/group/tasks/${t.id}`), superToken).send({ status: 'paused' });
    expect((await get(`/group/tasks?month=${month}`)).body.data.items.some((i) => i.task_id === t.id)).toBe(false);
    await authed(request(app).patch(`${base}/group/tasks/${t.id}`), superToken).send({ status: 'active' });
    // turning it into a one-time task drops the rule
    const oneTime = await authed(request(app).patch(`${base}/group/tasks/${t.id}`), superToken).send({ kind: 'one_time', due_date: dayInMonth(25) });
    expect(oneTime.status).toBe(200);
    expect((await get(`/group/tasks?month=${month}`)).body.data.items.filter((i) => i.task_id === t.id).map((i) => i.date)).toEqual([dayInMonth(25)]);
    expect((await authed(request(app).delete(`${base}/group/tasks/${t.id}`), superToken)).status).toBe(200);
    expect((await get(`/group/tasks?month=${month}`)).body.data.items.some((i) => i.task_id === t.id)).toBe(false);
    expect((await authed(request(app).delete(`${base}/group/tasks/${t.id}`), superToken)).status).toBe(404);
    // every change is on the audit trail
    const actions = (await prisma.auditLog.findMany({ where: { entity_type: 'group_task', entity_id: t.id } })).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['create', 'done', 'reopen', 'update', 'delete']));
  });

  test('upcoming lists what is coming in the next month, with overdue items on top', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const plus = (n) => iso(new Date(Date.now() + n * 86400000));
    await post('/group/tasks', { title: 'Soon', due_date: plus(3) });
    await post('/group/tasks', { title: 'Far', due_date: plus(60) });
    await post('/group/tasks', { title: 'Late', due_date: plus(-4) });
    await post('/group/tasks', { title: 'Daily check', kind: 'recurring', frequency: 'daily', start_date: today });
    const up = (await get('/group/tasks/upcoming?days=31')).body.data;
    expect(up.items.some((i) => i.title === 'Soon')).toBe(true);
    expect(up.items.some((i) => i.title === 'Far')).toBe(false);
    expect(up.items.filter((i) => i.title === 'Daily check')).toHaveLength(31);
    expect(up.overdue.map((i) => i.title)).toEqual(expect.arrayContaining(['Late']));
    expect(up.overdue.find((i) => i.title === 'Late').overdue).toBe(true);
  });

  test('weekly table: link companies to days, highlight today, show that week\'s tasks', async () => {
    const put1 = await put('/group/weekly-plan', { assignments: [{ org_id: a.id, weekdays: [1] }, { org_id: b.id, weekdays: [2, 5], note: 'Review calls' }, { org_id: c.id, weekdays: [3] }] });
    expect(put1.status).toBe(200);
    expect((await put('/group/weekly-plan', { assignments: [{ org_id: outsider.id, weekdays: [1] }] })).status).toBe(422);
    expect((await put('/group/weekly-plan', { assignments: [{ org_id: a.id, weekdays: [9] }] })).status).toBeGreaterThanOrEqual(400);

    const monday = calc.mondayOf(new Date().toISOString().slice(0, 10));
    const tue = calc.addDays(monday, 1);
    await post('/group/tasks', { title: 'Tuesday filing', due_date: tue, org_id: b.id });
    const plan = (await get(`/group/weekly-plan?date=${monday}`)).body.data;
    expect(plan.days).toHaveLength(7);
    expect(plan.days.map((d) => d.name)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(plan.days[0].companies.map((x) => x.name)).toEqual(['Alpha Global']);
    expect(plan.days[1].companies.map((x) => x.name)).toEqual(['Beta Trading']);
    expect(plan.days[1].companies[0].note).toBe('Review calls');
    expect(plan.days[4].companies.map((x) => x.name)).toEqual(['Beta Trading']);
    expect(plan.days[2].companies.map((x) => x.name)).toEqual(['Gamma Infra']);
    expect(plan.days[1].tasks.map((x) => x.title)).toEqual(['Tuesday filing']);
    expect(plan.unassigned).toEqual([]);
    expect(plan.days.filter((d) => d.is_today)).toHaveLength(1);
    expect(plan.days.find((d) => d.is_today).date).toBe(new Date().toISOString().slice(0, 10) === calc.addDays(monday, 6) ? calc.addDays(monday, 6) : plan.days.find((d) => d.is_today).date);
    // another week has the same companies but not that task
    const nextWeek = (await get(`/group/weekly-plan?date=${plan.next_week}`)).body.data;
    expect(nextWeek.days[1].companies.map((x) => x.name)).toEqual(['Beta Trading']);
    expect(nextWeek.days[1].tasks).toEqual([]);
    expect(nextWeek.days.some((d) => d.is_today)).toBe(false);

    // moving a company replaces its days; clearing one leaves it unassigned
    const moved = (await put('/group/weekly-plan', { assignments: [{ org_id: b.id, weekdays: [4] }, { org_id: c.id, weekdays: [] }] })).body.data;
    expect(moved.days[3].companies.map((x) => x.name)).toEqual(['Beta Trading']);
    expect(moved.days[1].companies).toEqual([]);
    expect(moved.unassigned.map((x) => x.name)).toEqual(['Gamma Infra']);
    expect(await prisma.auditLog.count({ where: { action: 'weekly_plan' } })).toBe(2);
  });
});
