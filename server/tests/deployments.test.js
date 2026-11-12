const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const calc = require('../src/modules/deployments/deployments.calc');

// Group Travel > Deployments: the record, its budget maths, the approval chain, allocation changes, expenses with bills, recoveries,
// onsite logs, reviews and the dashboard. Group admins manage; deployed people and managers act on their own part.

const G = '/api/v1/super-dashboard/group/deployments';
const E = '/api/v1/deployments';
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe('deployment maths (pure)', () => {
  test('months: 30-day blocks, at least one; funding split of a line; recovery state', () => {
    expect(calc.daysBetween('2026-01-01', '2026-01-01')).toBe(1);
    expect(calc.monthsOf('2026-01-01', '2026-01-30')).toBe(1);
    expect(calc.monthsOf('2026-01-01', '2026-01-31')).toBe(2);
    expect(calc.monthsOf(day(-10), day(80))).toBe(4); // 91 days
    expect(calc.clientPart(1000, 'company')).toBe(0);
    expect(calc.clientPart(1000, 'client')).toBe(1000);
    expect(calc.clientPart(1000, 'shared', 30)).toBe(300);
    expect(calc.clientPart(1000, 'client_reimbursable')).toBe(1000);
    expect(calc.recoveryStatus(500, 0)).toBe('pending');
    expect(calc.recoveryStatus(500, 200)).toBe('partial');
    expect(calc.recoveryStatus(500, 500)).toBe('recovered');
    expect(calc.recoveryStatus(0, 0)).toBe('none');
  });

  test('estimate: monthly lines recur, funding and billable splits; actuals: variance, months, pending recovery', () => {
    const lines = [
      { category: 'accommodation', amount: 20000, frequency: 'monthly', funding: 'client_reimbursable', billable: true },
      { category: 'food', amount: 5000, frequency: 'monthly', funding: 'shared', client_share_pct: 40, billable: false },
      { category: 'travel_ticket', amount: 10000, frequency: 'one_time', funding: 'company', billable: false },
      { category: 'other', amount: 6000, frequency: 'one_time', funding: 'client', billable: true },
    ];
    const est = calc.estimate(lines, 3);
    expect(est).toMatchObject({ total: 20000 * 3 + 5000 * 3 + 10000 + 6000, one_time: 16000, monthly_per_month: 25000, monthly_total: 75000, billable: 66000, non_billable: 25000, recoverable: 60000, client_borne: 6000 + 6000 });
    expect(est.company_borne).toBe(10000 + 9000); // the company's 60% of the shared food, and the ticket
    const expenses = [
      { month: '2026-01', amount: 30000, status: 'verified', funding: 'client_reimbursable', client_amount: 30000, recovered_amount: 10000, billable: true },
      { month: '2026-02', amount: 8000, status: 'submitted', funding: 'company', client_amount: 0, recovered_amount: 0, billable: false },
      { month: '2026-02', amount: 999, status: 'rejected', funding: 'company', client_amount: 0, recovered_amount: 0, billable: false },
    ];
    const act = calc.actuals(expenses, est, '2026-01-05', '2026-03-20');
    expect(act).toMatchObject({ total: 38000, billable: 30000, non_billable: 8000, unverified: 8000, pending_recovery: 20000, recovered: 10000, variance: est.total - 38000 });
    expect(act.months.map((m) => [m.month, m.budget, m.actual])).toEqual([['2026-01', 25000 + 16000, 30000], ['2026-02', 25000, 8000], ['2026-03', 25000, 0]]);
  });
});

describe('group deployments', () => {
  let org; let other; let superToken; let su;
  let emp; let empToken; let mgr; let mgrToken; let dm; let finToken; let stranger; let strangerToken;

  const mk = async (o, role = 'employee', name) => {
    const u = await createUser({ role: role === 'admin' ? 'admin' : 'employee', withOrg: false, ...(name ? { name } : {}) });
    await createOrgMembership(u.id, o.id, { role });
    const { access_token: token } = await loginAs(u);
    return { user: u, token };
  };

  beforeEach(async () => {
    await cleanDatabase();
    org = await createOrg({ name: 'Alpha Global' });
    other = await createOrg({ name: 'Beta Trading', org_group_id: org.org_group_id });
    su = await createUser({ role: 'admin', withOrg: false });
    await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
    await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: org.org_group_id } });
    await createOrgMembership(su.id, org.id, { role: 'admin' });
    ({ access_token: superToken } = await loginAs(su));
    ({ user: emp, token: empToken } = await mk(org, 'employee', 'Eva Engineer'));
    ({ user: mgr, token: mgrToken } = await mk(org, 'employee', 'Rita Reporting'));
    ({ user: dm } = await mk(org, 'employee', 'Dev Delivery'));
    ({ token: finToken } = await mk(org, 'admin', 'Finn Finance'));
    ({ user: stranger, token: strangerToken } = await mk(org, 'employee', 'Sam Stranger'));
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const g = (path, t = superToken) => authed(request(app).get(`${G}${path}`), t);
  const gp = (path, body, t = superToken) => authed(request(app).post(`${G}${path}`), t).send(body || {});
  const e = (path, t) => authed(request(app).get(`${E}${path}`), t);
  const ep = (path, body, t) => authed(request(app).post(`${E}${path}`), t).send(body || {});
  const body = (over = {}) => ({
    title: 'Onsite support', client_name: 'Acme Corp', client_location: 'Pune', start_date: day(-10), expected_end_date: day(80), working_arrangement: 'hybrid', org_id: org.id,
    reporting_manager_user_id: mgr.id, delivery_manager_user_id: dm.id, client_supervisor_name: 'Carl Client',
    people: [{ user_id: emp.id, name: emp.name, org_id: org.id, role: 'Developer' }],
    budget_lines: [
      { category: 'accommodation', amount: 20000, frequency: 'monthly', funding: 'client_reimbursable', billable: true },
      { category: 'travel_ticket', amount: 10000, funding: 'company' },
    ],
    travel: [{ mode: 'flight', from_place: 'Delhi', to_place: 'Pune', start_date: day(-10), vendor: 'IndiGo', estimated_cost: 8000 }, { mode: 'accommodation', to_place: 'Pune', start_date: day(-10), end_date: day(80) }],
    ...over,
  });
  const create = async (over) => (await gp('', body(over))).body.data.deployment;
  const decide = (reqId, decision, t, comment) => ep(`/requests/${reqId}/decide`, { decision, comment }, t);
  /** submit, approve every step as the people who hold them, and start */
  const runningDeployment = async (over) => {
    const d = await create(over);
    const sub = (await gp(`/${d.id}/submit`)).body.data.deployment;
    for (let i = 0; i < 4; i += 1) {
      const req = (await g(`/${d.id}`)).body.data.deployment.requests.find((r) => r.status === 'pending');
      if (!req) break;
      await decide(req.id, 'approve', superToken);
    }
    void sub;
    expect((await gp(`/${d.id}/start`)).status).toBe(200);
    return (await g(`/${d.id}`)).body.data.deployment;
  };

  test('only a group admin manages deployments; the record carries people, budget lines, travel and a numbered code', async () => {
    expect((await g('', strangerToken)).status).toBe(403);
    const d = await create();
    expect(d).toMatchObject({ code: 'DEP-0001', status: 'draft', kind: 'deployment', client_name: 'Acme Corp', working_arrangement: 'hybrid', reporting_manager_name: 'Rita Reporting', delivery_manager_name: 'Dev Delivery', months: 4, days: 91 });
    expect(d.people).toHaveLength(1);
    expect(d.travel.map((t) => t.mode).sort()).toEqual(['accommodation', 'flight']);
    expect(d.estimate).toMatchObject({ total: 20000 * 4 + 10000, billable: 80000, recoverable: 80000, company_borne: 10000 });
    expect((await create({ title: 'Second' })).code).toBe('DEP-0002');
    // bad input
    expect((await gp('', body({ expected_end_date: day(-20) }))).status).toBe(422);
    expect((await gp('', body({ org_id: '00000000-0000-4000-8000-000000000000' }))).status).toBe(422);
    expect((await gp('', body({ budget_lines: [{ category: 'food', amount: 100, funding: 'shared' }] }))).status).toBe(422); // shared needs the client share
    // the list filters
    const list = (await g('?status=open')).body.data.deployments;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ people_count: 1 });
    expect((await g('?q=nomatch')).body.data.deployments).toHaveLength(0);
    // only a draft is edited freely and deleted
    expect((await authed(request(app).patch(`${G}/${d.id}`), superToken).send({ title: 'Renamed', client_location: 'Mumbai' })).body.data.deployment).toMatchObject({ title: 'Renamed', client_location: 'Mumbai' });
    expect((await authed(request(app).delete(`${G}/${d.id}`), superToken)).status).toBe(200);
    expect((await g(`/${d.id}`)).status).toBe(404);
  });

  test('submit needs people and a budget (or an emergency); the chain runs in order, skips unnamed steps and a reject sends it back to draft', async () => {
    const noPeople = await create({ people: [] });
    expect((await gp(`/${noPeople.id}/submit`)).status).toBe(422);
    const noBudget = await create({ budget_lines: [] });
    expect((await gp(`/${noBudget.id}/submit`)).status).toBe(422);

    const d = await create({ delivery_manager_user_id: null, delivery_manager_name: null }); // nobody is named for the delivery step
    const sub = (await gp(`/${d.id}/submit`)).body.data.deployment;
    expect(sub.status).toBe('pending_approval');
    const req = sub.requests[0];
    expect(req.steps.map((s) => [s.role, s.status])).toEqual([['reporting_manager', 'pending'], ['delivery_manager', 'approved'], ['finance', 'pending'], ['admin', 'pending']]);
    expect((await gp(`/${d.id}/start`)).status).toBe(409); // not approved yet

    // the next step is the reporting manager's: nobody else (except the group admin) may decide it
    expect((await decide(req.id, 'approve', empToken)).status).toBe(403);
    expect((await e('/approvals', mgrToken)).body.data.requests.map((r) => r.id)).toEqual([req.id]);
    expect((await e('/approvals', empToken)).body.data.requests).toEqual([]);
    expect((await decide(req.id, 'approve', mgrToken)).status).toBe(200);
    expect((await decide(req.id, 'approve', mgrToken)).status).toBe(403); // now it is Finance's turn
    expect((await decide(req.id, 'reject', finToken)).status).toBe(422); // a rejection needs a reason
    const rejected = await decide(req.id, 'reject', finToken, 'Budget too high');
    expect(rejected.status).toBe(200);
    const after = (await g(`/${d.id}`)).body.data.deployment;
    expect(after.status).toBe('draft');
    expect(after.requests[0]).toMatchObject({ status: 'rejected', decision_note: 'Budget too high' });
    expect((await decide(req.id, 'approve', superToken)).status).toBe(409); // already decided
    expect(after.events.map((x) => x.kind)).toEqual(expect.arrayContaining(['created', 'submitted', 'step_approved', 'rejected']));

    // resubmit and approve all the way (a group admin may decide any step)
    await gp(`/${d.id}/submit`);
    for (let i = 0; i < 3; i += 1) {
      const pending = (await g(`/${d.id}`)).body.data.deployment.requests.find((r) => r.status === 'pending');
      if (pending) await decide(pending.id, 'approve', superToken);
    }
    expect((await g(`/${d.id}`)).body.data.deployment.status).toBe('approved');
    expect((await gp(`/${d.id}/start`)).body.data.deployment).toMatchObject({ status: 'active' });
  });

  test('settings: an admin sets the chain; an empty chain approves at once; an emergency may start before approval', async () => {
    const S = `${G}/settings`;
    expect((await authed(request(app).get(S), superToken)).body.data.approval_steps).toEqual(['reporting_manager', 'delivery_manager', 'finance', 'admin']);
    expect((await authed(request(app).put(S), strangerToken).send({ approval_steps: [] })).status).toBe(403);
    expect((await authed(request(app).put(S), superToken).send({ approval_steps: ['finance', 'finance'] })).status).toBe(422);
    const set = await authed(request(app).put(S), superToken).send({ approval_steps: ['finance'], ending_soon_days: 30, overrun_tolerance_pct: 10 });
    expect(set.body.data).toMatchObject({ approval_steps: ['finance'], ending_soon_days: 30, overrun_tolerance_pct: 10 });

    const emergency = await create();
    expect((await gp(`/${emergency.id}/submit`, { emergency: true })).status).toBe(422); // the reason is required
    const sub = (await gp(`/${emergency.id}/submit`, { emergency: true, emergency_reason: 'Client outage' })).body.data.deployment;
    expect(sub).toMatchObject({ status: 'pending_approval', emergency: true });
    expect((await gp(`/${emergency.id}/start`)).body.data.deployment.status).toBe('active'); // started before approval

    await authed(request(app).put(S), superToken).send({ approval_steps: [] });
    const quick = await create({ title: 'No chain' });
    expect((await gp(`/${quick.id}/submit`)).body.data.deployment.status).toBe('approved');
    await authed(request(app).put(S), superToken).send({ emergency_allowed: false });
    const noEmergency = await create({ title: 'Emergency off' });
    expect((await gp(`/${noEmergency.id}/submit`, { emergency: true, emergency_reason: 'x' })).status).toBe(403);
  });

  test('extension, allocation changes (add / replace / release) and a budget revision go through approval once the deployment is submitted; history keeps all of it', async () => {
    const d = await runningDeployment();
    expect(d.status).toBe('active');
    const newEnd = day(120);
    // extension: a request, applied when approved; a second one is refused while it waits
    expect((await gp(`/${d.id}/extend`, { new_end_date: day(10), reason: 'earlier' })).status).toBe(422);
    const ext = await gp(`/${d.id}/extend`, { new_end_date: newEnd, reason: 'Client needs us longer' });
    expect(ext.body.data).toMatchObject({ requested: true, applied: false });
    expect(ext.body.data.deployment.expected_end_date).toBe(day(80));
    expect((await gp(`/${d.id}/extend`, { new_end_date: day(130), reason: 'again' })).status).toBe(409);
    const extReq = ext.body.data.deployment.requests.find((r) => r.kind === 'extension' && r.status === 'pending');
    for (let i = 0; i < 4; i += 1) { const r = (await g(`/${d.id}`)).body.data.deployment.requests.find((x) => x.kind === 'extension' && x.status === 'pending'); if (r) await decide(r.id, 'approve', superToken); }
    expect(extReq).toBeTruthy();
    let now = (await g(`/${d.id}`)).body.data.deployment;
    expect(now.expected_end_date).toBe(newEnd);
    expect(now.events.find((x) => x.kind === 'extended').detail).toMatchObject({ from: day(80), to: newEnd });
    // once running, the end date moves only through an extension
    expect((await authed(request(app).patch(`${G}/${d.id}`), superToken).send({ expected_end_date: day(200) })).status).toBe(409);

    // allocation: replace Eva with another person (a request; the old one stays until it is approved)
    const sam = { user_id: stranger.id, name: stranger.name, org_id: org.id, role: 'Tester' };
    const evaRow = now.people[0];
    expect((await gp(`/${d.id}/allocation`, { action: 'replace', person_id: evaRow.id, person: sam })).status).toBe(422); // a reason is needed
    const rep = await gp(`/${d.id}/allocation`, { action: 'replace', person_id: evaRow.id, person: sam, reason: 'Eva is on leave' });
    expect(rep.body.data.requested).toBe(true);
    expect(rep.body.data.deployment.people.map((p) => [p.name, p.status])).toEqual([['Eva Engineer', 'active']]);
    for (let i = 0; i < 4; i += 1) { const r = (await g(`/${d.id}`)).body.data.deployment.requests.find((x) => x.kind === 'allocation' && x.status === 'pending'); if (r) await decide(r.id, 'approve', superToken); }
    now = (await g(`/${d.id}`)).body.data.deployment;
    expect(now.people.map((p) => [p.name, p.status])).toEqual([['Eva Engineer', 'replaced'], ['Sam Stranger', 'active']]);
    expect(now.people[1].replaces_id).toBe(evaRow.id);
    expect(now.events.map((x) => x.kind)).toEqual(expect.arrayContaining(['person_replaced']));
    // releasing with approvals switched off applies at once
    await authed(request(app).put(`${G}/settings`), superToken).send({ allocation_needs_approval: false, extension_needs_approval: false });
    const rel = await gp(`/${d.id}/allocation`, { action: 'release', person_id: now.people[1].id, reason: 'Work is done early', on: day(0) });
    expect(rel.body.data.applied).toBe(true);
    expect(rel.body.data.deployment.people[1]).toMatchObject({ status: 'released', release_reason: 'Work is done early' });
    expect((await gp(`/${d.id}/allocation`, { action: 'release', person_id: evaRow.id, reason: 'already gone' })).status).toBe(404);
    const added = await gp(`/${d.id}/allocation`, { action: 'add', person: { name: 'Guest Contractor', role: 'QA' } });
    expect(added.body.data.deployment.people.filter((p) => p.status === 'active').map((p) => p.name)).toEqual(['Guest Contractor']);

    // a budget revision on a running deployment is a request (approvals are back on for it)
    await authed(request(app).put(`${G}/settings`), superToken).send({ approval_steps: ['admin'] });
    const rev = await authed(request(app).put(`${G}/${d.id}/budget`), superToken).send({ lines: [{ category: 'food', amount: 3000, frequency: 'monthly', funding: 'company' }], reason: 'Food added' });
    expect(rev.body.data.requested).toBe(true);
    expect((await g(`/${d.id}`)).body.data.deployment.budget_lines).toHaveLength(2); // not yet
    await decide(rev.body.data.deployment.requests.find((r) => r.kind === 'budget' && r.status === 'pending').id, 'approve', superToken);
    const revised = (await g(`/${d.id}`)).body.data.deployment;
    expect(revised.budget_lines.map((l) => l.category)).toEqual(['food']);
    expect(revised.estimate.total).toBe(3000 * revised.months);
  });

  test('expenses: a deployed person submits with a bill; Finance verifies and settles; the client part is recovered; an overrun needs approval first', async () => {
    const d = await runningDeployment(); // estimate 90,000 = 4 x 20,000 reimbursable + 10,000 ticket
    // not part of it: refused; a draft takes no expenses
    const draft = await create({ title: 'Draft' });
    expect((await authed(request(app).post(`${E}/${draft.id}/expenses`), empToken).field('expense_date', day(-1)).field('category', 'food').field('amount', '100')).status).toBe(409);
    expect((await authed(request(app).post(`${E}/${d.id}/expenses`), strangerToken).field('expense_date', day(-1)).field('category', 'food').field('amount', '100')).status).toBe(403);
    expect((await authed(request(app).post(`${E}/${d.id}/expenses`), empToken).field('expense_date', day(-1)).field('category', 'food').field('amount', '100').field('funding', 'shared')).status).toBe(422);

    const submit = (t, fields, file = true) => {
      let r = authed(request(app).post(`${E}/${d.id}/expenses`), t);
      Object.entries(fields).forEach(([k, v]) => { r = r.field(k, String(v)); });
      if (file) r = r.attach('file', Buffer.from('receipt'), 'bill.pdf');
      return r;
    };
    const first = await submit(empToken, { expense_date: day(-3), category: 'accommodation', description: 'Hotel, first month', amount: 20000, funding: 'client_reimbursable', billable: true });
    expect(first.status).toBe(201);
    let dep = (await g(`/${d.id}`)).body.data.deployment;
    const ex = dep.expenses[0];
    expect(ex).toMatchObject({ amount: 20000, status: 'submitted', client_amount: 20000, billable: true, has_bill: true, over_budget: false, recovery_status: 'none' });
    expect(dep.actual).toMatchObject({ total: 20000, unverified: 20000, billable: 20000, pending_recovery: 0 });

    // the bill: the submitter and the group admin can open it, a stranger cannot
    expect((await authed(request(app).get(ex.bill_url), empToken)).status).toBe(200);
    expect((await authed(request(app).get(ex.bill_url), superToken)).status).toBe(200);
    expect((await authed(request(app).get(ex.bill_url), strangerToken)).status).toBe(403);

    // Finance: the queue, verify (not for the plain employee), settle, recover in parts
    expect((await e('/finance-queue', empToken)).status).toBe(403);
    expect((await e('/finance-queue', finToken)).body.data.expenses.map((x) => x.id)).toEqual([ex.id]);
    expect((await ep(`/expenses/${ex.id}/verify`, { decision: 'verify' }, empToken)).status).toBe(403);
    expect((await ep(`/expenses/${ex.id}/recover`, { amount: 100 }, finToken)).status).toBe(409); // not verified yet
    expect((await ep(`/expenses/${ex.id}/verify`, { decision: 'verify', note: 'Bill checked' }, finToken)).status).toBe(200);
    dep = (await g(`/${d.id}`)).body.data.deployment;
    expect(dep.expenses[0]).toMatchObject({ status: 'verified', recovery_status: 'pending', verified_by_name: 'Finn Finance' });
    expect(dep.actual.pending_recovery).toBe(20000);
    expect((await ep(`/expenses/${ex.id}/settle`, { settlement_ref: 'UTR-1' }, finToken)).status).toBe(200);
    expect((await ep(`/expenses/${ex.id}/recover`, { amount: 30000 }, finToken)).status).toBe(422); // more than the client owes
    expect((await ep(`/expenses/${ex.id}/recover`, { amount: 5000 }, finToken)).status).toBe(200);
    dep = (await g(`/${d.id}`)).body.data.deployment;
    expect(dep.expenses[0]).toMatchObject({ status: 'settled', settlement_ref: 'UTR-1', recovery_status: 'partial', recovered_amount: 5000 });
    expect(dep.actual).toMatchObject({ pending_recovery: 15000, recovered: 5000 });
    await ep(`/expenses/${ex.id}/recover`, { amount: 15000 }, finToken);
    expect((await g(`/${d.id}`)).body.data.deployment.expenses[0].recovery_status).toBe('recovered');

    // a rejected expense stays out of the totals and needs a reason
    const small = await submit(empToken, { expense_date: day(-2), category: 'food', amount: 400 }, false);
    expect(small.status).toBe(201);
    const smallId = (await g(`/${d.id}`)).body.data.deployment.expenses.find((x) => x.amount === 400).id;
    expect((await ep(`/expenses/${smallId}/verify`, { decision: 'reject' }, finToken)).status).toBe(422);
    expect((await ep(`/expenses/${smallId}/verify`, { decision: 'reject', note: 'Not a work expense' }, finToken)).status).toBe(200);
    expect((await g(`/${d.id}`)).body.data.deployment.actual.total).toBe(20000);

    // an overrun: 20,000 spent + 75,000 > the 90,000 estimate, so the expense waits for approval and cannot be verified meanwhile
    const big = await submit(empToken, { expense_date: day(-1), category: 'other', description: 'Equipment', amount: 75000, funding: 'company' }, false);
    expect(big.status).toBe(201);
    dep = (await g(`/${d.id}`)).body.data.deployment;
    const bigExp = dep.expenses.find((x) => x.amount === 75000);
    expect(bigExp.over_budget).toBe(true);
    const overrun = dep.requests.find((r) => r.kind === 'budget_overrun' && r.status === 'pending');
    expect(overrun.payload).toMatchObject({ expense_id: bigExp.id, over_by: 5000 });
    expect(overrun.steps.map((s) => s.role)).toEqual(['finance', 'admin']); // only Finance and Admin judge an overrun
    expect((await ep(`/expenses/${bigExp.id}/verify`, { decision: 'verify' }, finToken)).status).toBe(409);
    await decide(overrun.id, 'approve', finToken);
    await decide(overrun.id, 'approve', superToken);
    expect((await ep(`/expenses/${bigExp.id}/verify`, { decision: 'verify' }, finToken)).status).toBe(200);
    expect((await g(`/${d.id}`)).body.data.deployment.actual).toMatchObject({ total: 95000, over_budget: true, variance: -5000 });
  });

  test('onsite logs: a deployed person logs their own days (hybrid: office or remote); no future days; managers read, strangers do not', async () => {
    const d = await runningDeployment();
    const mine = (await e('/mine', empToken)).body.data.deployments;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: d.id, client_name: 'Acme Corp', logged_today: false, person: { arrangement: 'hybrid' } });
    expect((await e('/mine', strangerToken)).body.data.deployments).toEqual([]);

    const log = (t, o) => ep(`/${d.id}/logs`, { log_date: day(-1), location_mode: 'client_office', hours: 8, activities: 'Fixed login bug', deliverables: 'Patch 1.2', pending_tasks: 'Write tests', ...o }, t);
    expect((await log(strangerToken)).status).toBe(403);
    expect((await log(empToken, { log_date: day(1) })).status).toBe(422);
    expect((await log(empToken, { log_date: day(-30) })).status).toBe(422); // before the deployment began
    expect((await log(empToken, { hours: 30 })).status).toBe(422);
    expect((await log(empToken)).status).toBe(201);
    expect((await log(empToken, { location_mode: 'remote', hours: 6, activities: 'Same day edited' })).status).toBe(201); // one row per day
    await log(empToken, { log_date: day(0), hours: 7 });
    const logs = (await e(`/${d.id}/logs`, empToken)).body.data;
    expect(logs.logs).toHaveLength(2);
    expect(logs.logs.find((l) => l.log_date === day(-1))).toMatchObject({ location_mode: 'remote', hours: 6, activities: 'Same day edited' });
    expect(logs.summary).toMatchObject({ days: 2, hours: 13, client_office_days: 1, remote_days: 1 });
    expect((await e(`/${d.id}/logs`, mgrToken)).status).toBe(200); // the reporting manager reads them
    expect((await e(`/${d.id}/logs`, strangerToken)).status).toBe(403);
    const detail = (await g(`/${d.id}`)).body.data.deployment;
    expect(detail.presence).toMatchObject({ client_office: 1, remote: 0, not_logged: 0 }); // today's log was at the client office
    expect((await e('/managed', mgrToken)).body.data.deployments.map((x) => x.id)).toEqual([d.id]);
  });

  test('reviews: the weekly review is dated to its Monday, the client feedback to the 1st; only a manager or group admin writes them', async () => {
    const d = await runningDeployment();
    const wednesday = '2026-10-14';
    expect((await ep(`/${d.id}/reviews`, { kind: 'weekly', period_start: wednesday, summary: 'Good week' }, strangerToken)).status).toBe(403);
    expect((await ep(`/${d.id}/reviews`, { kind: 'weekly', period_start: wednesday, summary: 'Good week, API done', rating: 4 }, mgrToken)).status).toBe(201);
    expect((await gp(`/${d.id}/reviews`, { kind: 'client_feedback', period_start: '2026-10-20', summary: 'Client is happy', rating: 5, client_contact: 'Carl Client' })).status).toBe(201);
    expect((await gp(`/${d.id}/reviews`, { kind: 'client_feedback', period_start: '2026-10-20', summary: 'x', rating: 9 })).status).toBe(422);
    const reviews = (await g(`/${d.id}`)).body.data.deployment.reviews;
    expect(reviews.map((r) => [r.kind, r.period_start, r.rating])).toEqual(expect.arrayContaining([['weekly', '2026-10-12', 4], ['client_feedback', '2026-10-01', 5]]));
  });

  test('close releases everyone, cancel stops a deployment; neither can be edited afterwards; the dashboard adds it all up', async () => {
    const a = await runningDeployment({ title: 'Alpha site', client_name: 'Acme Corp' });
    const b = await runningDeployment({ title: 'Beta site', client_name: 'Globex', org_id: other.id, expected_end_date: day(5), people: [{ name: 'Guest One' }, { name: 'Guest Two' }] });
    await authed(request(app).post(`${E}/${a.id}/expenses`), empToken).field('expense_date', day(-2)).field('category', 'food').field('amount', '1000').field('funding', 'client').field('billable', 'true');
    await authed(request(app).post(`${E}/${a.id}/expenses`), empToken).field('expense_date', day(-1)).field('category', 'other').field('amount', '500');
    const expenses = (await g(`/${a.id}`)).body.data.deployment.expenses;
    for (const x of expenses) await ep(`/expenses/${x.id}/verify`, { decision: 'verify' }, finToken);

    const dash = (await g('/dashboard')).body.data;
    expect(dash.summary).toMatchObject({ active: 2, deployed_people: 3, ending_soon: 1, actual_total: 1500, billable_actual: 1000, non_billable_actual: 500, client_funded_actual: 1000, company_funded_actual: 500, pending_recovery: 1000 });
    expect(dash.by_client.map((c) => [c.label, c.people])).toEqual(expect.arrayContaining([['Acme Corp', 1], ['Globex', 2]]));
    expect(dash.by_company.map((c) => c.label).sort()).toEqual(['Alpha Global', 'Beta Trading']);
    expect(dash.upcoming_ends[0]).toMatchObject({ title: 'Beta site', days_left: 5, people: 2 });
    expect(dash.recoveries).toEqual([expect.objectContaining({ title: 'Alpha site', owed: 1000 })]);
    expect(dash.monthly.reduce((s, m) => s + m.actual, 0)).toBe(1500);
    expect(dash.history.length).toBeGreaterThan(0);

    const closed = await gp(`/${b.id}/close`, { reason: 'Finished early', actual_end_date: day(-1) });
    expect(closed.body.data.deployment).toMatchObject({ status: 'closed', actual_end_date: day(-1), close_reason: 'Finished early' });
    expect(closed.body.data.deployment.people.every((p) => p.status === 'released')).toBe(true);
    expect((await gp(`/${b.id}/close`)).status).toBe(409);
    expect((await authed(request(app).patch(`${G}/${b.id}`), superToken).send({ title: 'x' })).status).toBe(409);
    expect((await gp(`/${b.id}/extend`, { new_end_date: day(100), reason: 'later' })).status).toBe(409);
    expect((await gp(`/${a.id}/cancel`, {})).status).toBe(422); // a reason is needed
    expect((await gp(`/${a.id}/cancel`, { reason: 'Contract ended' })).body.data.deployment.status).toBe('cancelled');
    expect((await g('?status=open')).body.data.deployments).toHaveLength(0);
    expect((await g('?status=closed')).body.data.deployments.map((x) => x.id)).toEqual([b.id]);
    expect((await g('/dashboard')).body.data.summary.active).toBe(0);
  });

  test('optional project link: a Project Management project of the group can be linked, one outside it cannot', async () => {
    const outsider = await createOrg({ name: 'Outside Group' });
    const mine = await prisma.pmProject.create({ data: { org_id: org.id, code: 'PM-1', name: 'Portal rebuild', created_by: su.id } });
    const foreign = await prisma.pmProject.create({ data: { org_id: outsider.id, code: 'PM-9', name: 'Foreign', created_by: su.id } });
    expect((await gp('', body({ pm_project_id: foreign.id }))).status).toBe(422);
    const d = (await gp('', body({ pm_project_id: mine.id }))).body.data.deployment;
    expect(d.project).toMatchObject({ code: 'PM-1', name: 'Portal rebuild' });
    expect((await gp('', body({ title: 'No project' }))).status).toBe(201); // linking is never mandatory
    const dash = (await g('/dashboard')).body.data;
    expect(dash.by_project.map((p) => p.label)).toEqual(expect.arrayContaining(['PM-1 Portal rebuild', 'No project']));
    expect((await g('/options')).body.data.projects.map((p) => p.code)).toEqual(['PM-1']);
  });
});
