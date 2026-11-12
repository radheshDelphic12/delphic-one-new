const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setupZephyr(slug = 'zephyr-wages') {
  const org = await createOrg({ name: `Zephyr ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['zephyr'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}

async function addMember(org, accessRole) {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  await prisma.zxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole } });
  const { access_token } = await loginAs(user);
  return access_token;
}

const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/zephyr${path}`), token).send(body || {}),
  put: (path, body) => authed(request(app).put(`/api/v1/zephyr${path}`), token).send(body || {}),
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/zephyr${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/zephyr${path}`), token),
});

async function fixture() {
  const x = await setupZephyr();
  const a = api(x.token);
  const p1 = await prisma.zxProject.create({ data: { org_id: x.org.id, code: 'ZP-1', name: 'Tower A' } });
  const p2 = await prisma.zxProject.create({ data: { org_id: x.org.id, code: 'ZP-2', name: 'Villa B' } });
  const ramu = (await a.post('/wages/workers', { name: 'Ramu', trade: 'Mason', daily_rate: 800, phone: '9999900000' })).body.data.worker;
  const sita = (await a.post('/wages/workers', { name: 'Sita', trade: 'Helper', daily_rate: 500 })).body.data.worker;
  return { ...x, a, p1, p2, ramu, sita };
}

describe('zephyr daily wages', () => {
  test('workers: create, edit, list with filters, delete only without history', async () => {
    const { a, ramu, sita, p1 } = await fixture();
    expect(ramu).toMatchObject({ name: 'Ramu', daily_rate: 800, active: true });
    expect((await a.patch(`/wages/workers/${ramu.id}`, { daily_rate: 850, trade: 'Senior mason' })).body.data.worker).toMatchObject({ daily_rate: 850, trade: 'Senior mason' });
    await a.patch(`/wages/workers/${sita.id}`, { active: false });
    expect((await a.get('/wages/workers?active=true')).body.data.workers.map((w) => w.name)).toEqual(['Ramu']);
    expect((await a.get('/wages/workers?q=sit')).body.data.workers).toHaveLength(1);
    expect((await a.post('/wages/workers', { name: 'x', daily_rate: 0 })).status).toBe(422);
    await a.put('/wages/attendance', { project_id: p1.id, work_date: '2026-11-02', marks: [{ worker_id: ramu.id, status: 'present' }] });
    expect((await a.del(`/wages/workers/${ramu.id}`)).status).toBe(409);
    expect((await a.del(`/wages/workers/${sita.id}`)).status).toBe(200);
  });

  test('attendance: present / half / OT amounts, upsert, clear, one-day cap across projects', async () => {
    const { a, p1, p2, ramu, sita } = await fixture();
    const r = await a.put('/wages/attendance', { project_id: p1.id, work_date: '2026-11-02', marks: [{ worker_id: ramu.id, status: 'present', ot_hours: 2 }, { worker_id: sita.id, status: 'half' }] });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ saved: 2, cleared: 0, locked: [] });
    const rows = (await a.get('/wages/attendance?from=2026-11-01&to=2026-11-30')).body.data.attendance;
    expect(rows.find((x) => x.worker_id === ramu.id)).toMatchObject({ day_fraction: 1, ot_hours: 2, rate: 800, amount: 1000 }); // 800 + 2 x 800/8
    expect(rows.find((x) => x.worker_id === sita.id)).toMatchObject({ day_fraction: 0.5, amount: 250 });

    // a half day can be split with a second project, but not more than one day in total
    expect((await a.put('/wages/attendance', { project_id: p2.id, work_date: '2026-11-02', marks: [{ worker_id: sita.id, status: 'half' }] })).status).toBe(200);
    const over = await a.put('/wages/attendance', { project_id: p2.id, work_date: '2026-11-02', marks: [{ worker_id: ramu.id, status: 'half' }] });
    expect(over.status).toBe(422);
    const sheet = (await a.get(`/wages/sheet?date=2026-11-02&project_id=${p2.id}`)).body.data.workers;
    expect(sheet.find((w) => w.id === sita.id)).toMatchObject({ mark: { status: 'half' }, other_fraction: 0.5 });
    expect(sheet.find((w) => w.id === ramu.id)).toMatchObject({ mark: null, other_fraction: 1 });

    // edit in place, absent has no pay, clear removes
    await a.put('/wages/attendance', { project_id: p1.id, work_date: '2026-11-02', marks: [{ worker_id: ramu.id, status: 'absent', ot_hours: 3 }, { worker_id: sita.id, status: 'clear' }] });
    const after = (await a.get(`/wages/attendance?from=2026-11-02&to=2026-11-02&project_id=${p1.id}`)).body.data.attendance;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: 'absent', amount: 0, ot_hours: 0 });
    expect((await a.put('/wages/attendance', { project_id: p1.id, work_date: '2026-11-02', marks: [{ worker_id: ramu.id, status: 'present' }, { worker_id: ramu.id, status: 'half' }] })).status).toBe(422);
  });

  test('advances, payable preview and payout: gross, advance recovery, per-project split, lock, void', async () => {
    const { a, p1, p2, ramu } = await fixture();
    for (const [d, p] of [['2026-11-02', p1], ['2026-11-03', p1], ['2026-11-04', p2]]) {
      await a.put('/wages/attendance', { project_id: p.id, work_date: d, marks: [{ worker_id: ramu.id, status: 'present' }] });
    }
    await a.put('/wages/attendance', { project_id: p2.id, work_date: '2026-11-05', marks: [{ worker_id: ramu.id, status: 'half' }] });
    const adv = await a.post('/wages/advances', { worker_id: ramu.id, given_on: '2026-11-01', amount: 1000, payment_mode: 'cash' });
    expect(adv.status).toBe(201);

    const prev = (await a.get(`/wages/payable?worker_id=${ramu.id}&to_date=2026-11-30`)).body.data;
    expect(prev).toMatchObject({ days: 3.5, gross: 2800, advance_outstanding: 1000 });
    expect(prev.projects.map((p) => [p.code, p.days, p.amount])).toEqual(expect.arrayContaining([['ZP-1', 2, 1600], ['ZP-2', 1.5, 1200]]));

    expect((await a.post('/wages/payouts', { worker_id: ramu.id, to_date: '2026-11-30', paid_on: '2026-11-06', advance_recovered: 1500 })).status).toBe(422);
    expect((await a.post('/wages/payouts', { worker_id: ramu.id, to_date: '2026-11-30', paid_on: '2026-11-06', advance_recovered: 600, other_deductions: 200, payment_mode: 'upi', reference: 'UTR1' })).body.data.payout).toMatchObject({ gross: 2800, advance_recovered: 600, other_deductions: 200, net: 2000, days: 3.5, status: 'paid' });
    const list = (await a.get('/wages/workers')).body.data.workers.find((w) => w.id === ramu.id);
    expect(list).toMatchObject({ unpaid: 0, advance_outstanding: 400 });
    expect((await a.post('/wages/payouts', { worker_id: ramu.id, to_date: '2026-11-30', paid_on: '2026-11-06' })).status).toBe(422); // nothing left

    // a paid day is locked
    const locked = await a.put('/wages/attendance', { project_id: p1.id, work_date: '2026-11-02', marks: [{ worker_id: ramu.id, status: 'absent' }] });
    expect(locked.body.data.locked).toEqual(['Ramu']);
    const paidRow = (await a.get('/wages/attendance?from=2026-11-02&to=2026-11-02')).body.data.attendance[0];
    expect((await a.del(`/wages/attendance/${paidRow.id}`)).status).toBe(409);
    // an advance already recovered cannot be removed below what was recovered
    expect((await a.del(`/wages/advances/${adv.body.data.advance.id}`)).status).toBe(422);

    // report by project: earned vs paid
    const sum = (await a.get('/wages/summary?from=2026-11-01&to=2026-11-30')).body.data;
    expect(sum.totals).toMatchObject({ days: 3.5, amount: 2800, paid: 2800, unpaid: 0 });
    expect(sum.projects.find((p) => p.code === 'ZP-2')).toMatchObject({ days: 1.5, amount: 1200, workers: 1 });

    // void frees the days and returns the advance
    const payoutId = (await a.get('/wages/payouts')).body.data.payouts[0].id;
    expect((await a.get(`/wages/payouts/${payoutId}`)).body.data.payout.attendance).toHaveLength(4);
    expect((await a.post(`/wages/payouts/${payoutId}/void`, {})).status).toBe(422);
    expect((await a.post(`/wages/payouts/${payoutId}/void`, { reason: 'Wrong amount' })).body.data.payout.status).toBe('voided');
    expect((await a.get(`/wages/payable?worker_id=${ramu.id}&to_date=2026-11-30`)).body.data).toMatchObject({ gross: 2800, advance_outstanding: 1000 });
    expect((await a.post(`/wages/payouts/${payoutId}/void`, { reason: 'again' })).status).toBe(409);
  });

  test('payout can be limited to one project and a date range', async () => {
    const { a, p1, p2, ramu } = await fixture();
    await a.put('/wages/attendance', { project_id: p1.id, work_date: '2026-11-02', marks: [{ worker_id: ramu.id, status: 'present' }] });
    await a.put('/wages/attendance', { project_id: p2.id, work_date: '2026-11-03', marks: [{ worker_id: ramu.id, status: 'present' }] });
    const paid = await a.post('/wages/payouts', { worker_id: ramu.id, project_id: p2.id, to_date: '2026-11-30', paid_on: '2026-11-04' });
    expect(paid.body.data.payout).toMatchObject({ gross: 800, project_id: p2.id });
    expect((await a.get(`/wages/payable?worker_id=${ramu.id}&to_date=2026-11-30`)).body.data.gross).toBe(800);
  });

  test('wage cost flows into project profit and the monthly report', async () => {
    const { a, p1, ramu } = await fixture();
    await a.put('/wages/attendance', { project_id: p1.id, work_date: '2026-11-02', marks: [{ worker_id: ramu.id, status: 'present' }] });
    const o = (await a.get('/overview?preset=custom&from=2026-11-01&to=2026-11-30')).body.data;
    expect(o.summary.salaries).toBe(800);
    expect(o.by_project.find((p) => p.project_id === p1.id)).toMatchObject({ salaries: 800, profit: -800 });
    expect(o.trend.find((m) => m.month === '2026-11').salaries).toBe(800);
    expect((await a.get(`/projects/${p1.id}/money`)).body.data).toMatchObject({ salaries: 800, profit: -800 });
  });

  test('roles: manager marks attendance but cannot pay; finance pays but cannot mark; staff sees nothing', async () => {
    const { org, a, p1, ramu } = await fixture();
    const manager = api(await addMember(org, 'manager'));
    const finance = api(await addMember(org, 'finance'));
    const staff = api(await addMember(org, 'staff'));
    expect((await manager.put('/wages/attendance', { project_id: p1.id, work_date: '2026-11-02', marks: [{ worker_id: ramu.id, status: 'present' }] })).status).toBe(200);
    expect((await manager.get('/wages/workers')).status).toBe(200);
    expect((await manager.post('/wages/payouts', { worker_id: ramu.id, to_date: '2026-11-30', paid_on: '2026-11-04' })).status).toBe(403);
    expect((await manager.post('/wages/advances', { worker_id: ramu.id, given_on: '2026-11-01', amount: 10 })).status).toBe(403);
    expect((await finance.get('/wages/summary?from=2026-11-01&to=2026-11-30')).status).toBe(200);
    expect((await finance.put('/wages/attendance', { project_id: p1.id, work_date: '2026-11-03', marks: [{ worker_id: ramu.id, status: 'present' }] })).status).toBe(403);
    expect((await finance.post('/wages/payouts', { worker_id: ramu.id, to_date: '2026-11-30', paid_on: '2026-11-04' })).status).toBe(201);
    expect((await staff.get('/wages/workers')).status).toBe(403);
    expect((await a.get('/audit?entity=wage_payout')).body.data.map((r) => r.action)).toContain('pay');
  });
});
