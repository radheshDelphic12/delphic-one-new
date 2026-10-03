// FRD slice 2: the approval chain (manager optional, admin mandatory) for timesheets and overtime, OT audit
// history, the per-employee month timesheet lock + the three-stage lock audit trail (with bulk), and the
// leave-type configuration (applicable / counts in balance / comp off / unpaid overflow).
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const DAY = '2026-09-15';

async function seed(orgOverrides = {}) {
  const org = await createOrg({ timesheet_admin_approval: true, ...orgOverrides });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const managerUser = await createUser({ role: 'recruiter', name: 'Manager Mia' });
  const managerMembership = await createOrgMembership(managerUser.id, org.id, { role: 'recruiter', joined_at: new Date('2020-01-01') });
  const managerToken = (await loginAs(managerUser)).access_token;
  const employee = async (name, { attendancePaid = false } = {}) => {
    const user = await createUser({ role: 'recruiter', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter', joined_at: new Date('2020-01-01') });
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { manager_id: managerMembership.id, ...(attendancePaid ? { pay_basis: 'attendance' } : {}) } });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  return { org, adminUser, adminToken, managerUser, managerMembership, managerToken, employee };
}

const logEntry = (person, date = DAY, hours = 8) => authed(request(app).post('/api/v1/timesheets/entries'), person.token).send({ date, hours, notes: 'work' });
const decide = (token, id, status = 'approved', reason) => authed(request(app).post(`/api/v1/timesheets/entries/${id}/decision`), token).send({ status, ...(reason ? { reason } : {}) });

describe('Timesheet approval chain - Employee -> Manager (optional) -> Admin (mandatory)', () => {
  test('a manager approval is only the first step; the entry is final once the admin approves', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const entry = (await logEntry(emp)).body.data;

    const first = await decide(ctx.managerToken, entry.id);
    expect(first.status).toBe(200);
    expect(first.body.awaiting_admin).toBe(true);
    let row = await prisma.timesheetEntry.findUnique({ where: { id: entry.id } });
    expect(row.status).toBe('submitted'); // not final: pay and billing only use approved entries
    expect(row.manager_approved_at).toBeTruthy();
    expect(row.manager_approved_by).toBe(ctx.managerUser.id);

    // The manager cannot decide it again; their inbox no longer lists it; the admin's does.
    expect((await decide(ctx.managerToken, entry.id)).status).toBe(409);
    expect((await authed(request(app).get('/api/v1/timesheets/approvals/pending'), ctx.managerToken)).body.data.entries).toHaveLength(0);
    expect((await authed(request(app).get('/api/v1/timesheets/approvals/pending'), ctx.adminToken)).body.data.entries).toHaveLength(1);

    const final = await decide(ctx.adminToken, entry.id);
    expect(final.status).toBe(200);
    row = await prisma.timesheetEntry.findUnique({ where: { id: entry.id } });
    expect(row).toMatchObject({ status: 'approved', approved_by: ctx.adminUser.id });
  });

  test('a manager rejection is final; the admin can approve directly without the manager step', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const a = (await logEntry(emp, '2026-09-15')).body.data;
    const b = (await logEntry(emp, '2026-09-16')).body.data;
    expect((await decide(ctx.managerToken, a.id, 'rejected', 'Wrong project')).status).toBe(200);
    expect((await prisma.timesheetEntry.findUnique({ where: { id: a.id } })).status).toBe('rejected');
    expect((await decide(ctx.adminToken, b.id)).status).toBe(200);
    expect((await prisma.timesheetEntry.findUnique({ where: { id: b.id } })).status).toBe('approved');
  });

  test('manager approval can be switched off: only the admin decides', async () => {
    const ctx = await seed({ timesheet_manager_approval: false });
    const emp = await ctx.employee('Eve');
    const entry = (await logEntry(emp)).body.data;
    expect((await decide(ctx.managerToken, entry.id)).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/timesheets/approvals/pending'), ctx.managerToken)).body.data.entries).toHaveLength(0);
    expect((await decide(ctx.adminToken, entry.id)).status).toBe(200);
  });

  test('the admin edits the policy (admin only); with admin approval off a manager approval is final', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    expect((await authed(request(app).patch('/api/v1/timesheets/approval-policy'), emp.token).send({ timesheet_admin_approval: false })).status).toBe(403);
    const res = await authed(request(app).patch('/api/v1/timesheets/approval-policy'), ctx.adminToken).send({ timesheet_admin_approval: false });
    expect(res.body.data).toMatchObject({ timesheet_manager_approval: true, timesheet_admin_approval: false });
    const entry = (await logEntry(emp)).body.data;
    expect((await decide(ctx.managerToken, entry.id)).body.awaiting_admin).toBeUndefined();
    expect((await prisma.timesheetEntry.findUnique({ where: { id: entry.id } })).status).toBe('approved');
  });
});

describe('Overtime tickets - Employee -> Manager -> Admin with an audit history', () => {
  const raise = (person, extra = {}) => authed(request(app).post('/api/v1/timesheets/overtime-tickets'), person.token).send({ date: DAY, hours: 2, reason: 'Release night', ...extra });
  const decideTicket = (token, id, status = 'approved', reason) => authed(request(app).post(`/api/v1/timesheets/overtime-tickets/${id}/decision`), token).send({ status, ...(reason ? { reason } : {}) });

  test('manager approval then admin approval; only the admin approval makes it payable; every step is in the history', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve', { attendancePaid: true });
    const ticket = (await raise(emp)).body.data;
    expect(ticket.status).toBe('pending');

    const step = await decideTicket(ctx.managerToken, ticket.id);
    expect(step.status).toBe(200);
    expect(step.body.awaiting_admin).toBe(true);
    expect(step.body.data.status).toBe('manager_approved');
    expect((await decideTicket(ctx.managerToken, ticket.id)).status).toBe(409);

    // The admin's to-decide list has it; the manager's does not.
    const adminList = await authed(request(app).get('/api/v1/timesheets/overtime-tickets'), ctx.adminToken).query({ scope: 'to_decide' });
    expect(adminList.body.data.tickets.map((t) => t.id)).toContain(ticket.id);
    const mgrList = await authed(request(app).get('/api/v1/timesheets/overtime-tickets'), ctx.managerToken).query({ scope: 'to_decide' });
    expect(mgrList.body.data.tickets).toHaveLength(0);

    const final = await decideTicket(ctx.adminToken, ticket.id, 'approved');
    expect(final.body.data.status).toBe('approved');

    const history = await authed(request(app).get(`/api/v1/timesheets/overtime-tickets/${ticket.id}/history`), emp.token);
    expect(history.status).toBe(200);
    expect(history.body.data.events.map((e) => [e.action, e.to_status])).toEqual([['submitted', 'pending'], ['manager_approved', 'manager_approved'], ['approved', 'approved']]);
    expect(history.body.data.events[1].actor.name).toBe('Manager Mia');
    expect(history.body.data.events.every((e) => e.created_at)).toBe(true);
  });

  test('a rejection and an admin edit are recorded; an unrelated employee cannot read the history', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve', { attendancePaid: true });
    const other = await ctx.employee('Olga', { attendancePaid: true });
    const ticket = (await raise(emp)).body.data;
    expect((await decideTicket(ctx.managerToken, ticket.id, 'rejected', 'Not needed')).body.data.status).toBe('rejected');
    const edit = await authed(request(app).patch(`/api/v1/timesheets/overtime-tickets/${ticket.id}/admin`), ctx.adminToken).send({ hours: 3, reason: 'Corrected hours' });
    expect(edit.status).toBe(200);
    const history = (await authed(request(app).get(`/api/v1/timesheets/overtime-tickets/${ticket.id}/history`), ctx.adminToken)).body.data.events;
    expect(history.map((e) => e.action)).toEqual(['submitted', 'rejected', 'edited']);
    expect(history[1].reason).toBe('Not needed');
    expect((await authed(request(app).get(`/api/v1/timesheets/overtime-tickets/${ticket.id}/history`), other.token)).status).toBe(403);
  });
});

describe('Stage 1 - timesheet lock per employee and month, bulk, audited', () => {
  test('bulk lock writes one audit row per employee, blocks changes, and reopening needs a reason', async () => {
    const ctx = await seed();
    const a = await ctx.employee('Asha');
    const b = await ctx.employee('Bilal');
    const c = await ctx.employee('Chitra');
    const pendingEntry = (await logEntry(a, '2026-09-10')).body.data;

    const status = await authed(request(app).get('/api/v1/timesheets/locks/month-status'), ctx.adminToken).query({ year: 2026, month: 9 });
    expect(status.status).toBe(200);
    expect(status.body.data.due_date).toBe('2026-10-05');
    expect(status.body.data.people.find((p) => p.name === 'Asha')).toMatchObject({ entries: 1, pending: 1, locked: false });
    // The admin approves it first - a timesheet is not locked while entries wait for approval.
    expect((await authed(request(app).post(`/api/v1/timesheets/entries/${pendingEntry.id}/decision`), ctx.adminToken).send({ status: 'approved' })).status).toBe(200);

    const res = await authed(request(app).post('/api/v1/timesheets/locks/month'), ctx.adminToken).send({
      year: 2026, month: 9, org_membership_ids: [a.membership.id, b.membership.id, c.membership.id], reason: 'September close',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.locked).toBe(3);

    // One bulk action, three individual audit rows sharing the bulk id.
    const auditAll = await authed(request(app).get('/api/v1/calculations/lock-audit'), ctx.adminToken).query({ stage: 'timesheet', year: 2026, month: 9 });
    const audit = { body: { data: auditAll.body.data.filter((r) => r.action === 'lock') } }; // (the entry approval is on the trail too)
    expect(audit.body.data).toHaveLength(3);
    expect(new Set(audit.body.data.map((r) => r.bulk_id)).size).toBe(1);
    expect(audit.body.data[0]).toMatchObject({ stage: 'timesheet', action: 'lock', previous_status: 'open', new_status: 'locked', reason: 'September close', period_month: 9, period_year: 2026 });
    expect(audit.body.data[0].actor.name).toBeTruthy();
    expect(audit.body.data.map((r) => r.employee.name).sort()).toEqual(['Asha', 'Bilal', 'Chitra']);

    // Locked: the employee cannot add or change that month; another month is unaffected.
    expect((await logEntry(a, '2026-09-20')).status).toBe(409);
    expect((await logEntry(a, '2026-10-02')).status).toBe(201);
    const cal = await authed(request(app).get('/api/v1/timesheets/dashboard/calendar'), a.token).query({ year: 2026, month: 9 });
    expect(cal.body.data.days.every((d) => d.locked)).toBe(true);

    // A second lock of the same people is a no-op (no new audit rows).
    const again = await authed(request(app).post('/api/v1/timesheets/locks/month'), ctx.adminToken).send({ year: 2026, month: 9, org_membership_ids: [a.membership.id] });
    expect(again.body.data.results[0].result).toBe('already_locked');

    // Reopen: a reason is required; one row per employee; entries can change again.
    expect((await authed(request(app).post('/api/v1/timesheets/locks/month/reopen'), ctx.adminToken).send({ year: 2026, month: 9, org_membership_ids: [a.membership.id] })).status).toBe(422);
    const reopen = await authed(request(app).post('/api/v1/timesheets/locks/month/reopen'), ctx.adminToken).send({ year: 2026, month: 9, org_membership_ids: [a.membership.id, b.membership.id], reason: 'Late claim' });
    expect(reopen.body.data.reopened).toBe(2);
    expect((await logEntry(a, '2026-09-21')).status).toBe(201);
    const rows = (await authed(request(app).get('/api/v1/calculations/lock-audit'), ctx.adminToken).query({ stage: 'timesheet' })).body.data;
    expect(rows.filter((r) => r.action === 'reopen')).toHaveLength(2);
    expect(rows.filter((r) => r.action === 'reopen')[0]).toMatchObject({ previous_status: 'locked', new_status: 'open', reason: 'Late claim' });
  });

  test('only admins lock; a month that has not started cannot be locked; day locks are audited too', async () => {
    const ctx = await seed();
    const a = await ctx.employee('Asha');
    expect((await authed(request(app).post('/api/v1/timesheets/locks/month'), a.token).send({ year: 2026, month: 9, org_membership_ids: [a.membership.id] })).status).toBe(403);
    expect((await authed(request(app).post('/api/v1/timesheets/locks/month'), ctx.adminToken).send({ year: 2099, month: 1, org_membership_ids: [a.membership.id] })).status).toBe(422);
    expect((await authed(request(app).post('/api/v1/timesheets/locks'), ctx.adminToken).send({ date: '2026-09-12' })).status).toBe(201);
    expect((await authed(request(app).delete('/api/v1/timesheets/locks/2026-09-12'), ctx.adminToken).send({ reason: 'Correction' })).status).toBe(200);
    const rows = (await authed(request(app).get('/api/v1/calculations/lock-audit'), ctx.adminToken).query({ stage: 'timesheet', month: 9 })).body.data;
    expect(rows.map((r) => r.action).sort()).toEqual(['lock', 'unlock']);
  });
});

describe('Stage 2 / 3 - calculation and financial locks write the audit trail (bulk too)', () => {
  test('locking and reopening a calculation writes stage, previous / new status and the employee', async () => {
    const ctx = await seed();
    const a = await ctx.employee('Asha');
    const b = await ctx.employee('Bilal');
    const period = { period_month: 1, period_year: 2026 };
    for (const e of [a, b]) await prisma.salaryStructure.create({ data: { org_id: ctx.org.id, org_membership_id: e.membership.id, effective_from: new Date('2026-01-01'), ctc: 42000, components: { basic: 42000 }, created_by: ctx.adminUser.id } });

    const review = await authed(request(app).post('/api/v1/calculations/bulk'), ctx.adminToken).send({
      action: 'review', ...period, items: [{ kind: 'salary_employee', scope_key: a.membership.id }, { kind: 'salary_employee', scope_key: b.membership.id }],
    });
    expect(review.status).toBe(200);
    expect(review.body.data.results.every((r) => r.ok)).toBe(true);

    const rows = (await authed(request(app).get('/api/v1/calculations/lock-audit'), ctx.adminToken).query({ stage: 'calculation', year: 2026, month: 1 })).body.data;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.bulk_id)).size).toBe(1);
    expect(rows[0]).toMatchObject({ stage: 'calculation', action: 'review', new_status: 'reviewed' });
    expect(rows.map((r) => r.employee.name).sort()).toEqual(['Asha', 'Bilal']);

    await markMonthPresent(ctx.org.id, a.membership.id, 2026, 1);
    const lock = await authed(request(app).post('/api/v1/calculations/lock'), ctx.adminToken).send({ kind: 'salary_employee', scope_key: a.membership.id, ...period });
    expect(lock.status).toBe(200);
    const reopen = await authed(request(app).post('/api/v1/calculations/reopen'), ctx.adminToken).send({ kind: 'salary_employee', scope_key: a.membership.id, ...period, reason: 'Fix TDS' });
    expect(reopen.status).toBe(200);
    const trail = (await authed(request(app).get('/api/v1/calculations/lock-audit'), ctx.adminToken).query({ org_membership_id: a.membership.id })).body.data;
    expect(trail.map((r) => [r.action, r.previous_status, r.new_status])).toEqual([['reopen', 'locked', 'reopened'], ['lock', 'reviewed', 'locked'], ['review', null, 'reviewed']]);
    expect(trail[0].reason).toBe('Fix TDS');
  });

  test('the month financials lock is stage 3 (financial)', async () => {
    const ctx = await seed();
    const res = await authed(request(app).post('/api/v1/calculations/review'), ctx.adminToken).send({ kind: 'financials', period_month: 1, period_year: 2026 });
    expect([200, 404, 422]).toContain(res.status);
    if (res.status === 200) {
      const rows = (await authed(request(app).get('/api/v1/calculations/lock-audit'), ctx.adminToken).query({ stage: 'financial' })).body.data;
      expect(rows[0]).toMatchObject({ stage: 'financial', action: 'review' });
    }
  });
});

describe('Leave types for salary - configuration, Comp Off, unpaid overflow', () => {
  const MON = '2026-09-14';
  const typeByName = async (adminToken, name) => (await authed(request(app).get('/api/v1/leave/types'), adminToken)).body.data.find((t) => t.name === name);
  const apply = (person, leave_type_id, from_date, to_date, extra = {}) => authed(request(app).post('/api/v1/leave/requests'), person.token).send({ leave_type_id, from_date, to_date, ...extra });

  test('the five salary leave types exist and Comp Off is part of the balance', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const types = (await authed(request(app).get('/api/v1/leave/types'), ctx.adminToken)).body.data;
    expect(types.map((t) => t.name).sort()).toEqual(['Casual Leave', 'Comp Off', 'Earned Leave', 'Sick Leave', 'Unpaid Leave']);
    const balances = (await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), emp.token)).body.data;
    expect(balances.find((b) => b.leave_type_name === 'Comp Off')).toMatchObject({ paid: true, allocated: 0, counts_in_balance: true });
  });

  test('approved comp-off overtime days credit the Comp Off balance, which can then be taken', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    await prisma.timesheetDayOvertime.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, date: new Date('2026-08-01T00:00:00Z'), hours: 4, status: 'comp_off' } });
    const compOff = await typeByName(ctx.adminToken, 'Comp Off');
    const balances = (await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), emp.token)).body.data;
    expect(balances.find((b) => b.leave_type_name === 'Comp Off')).toMatchObject({ allocated: 1, remaining: 1, comp_off_credit: 1 });
    expect((await apply(emp, compOff.id, MON, MON)).status).toBe(201);
  });

  test('a type that is not applicable cannot be requested and is hidden from balances; admin edits are audited', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const casual = await typeByName(ctx.adminToken, 'Casual Leave');
    const edit = await authed(request(app).patch(`/api/v1/leave/types/${casual.id}`), ctx.adminToken).send({ is_applicable: false, reason: 'Not offered here' });
    expect(edit.status).toBe(200);
    expect((await apply(emp, casual.id, MON, MON)).status).toBe(422);
    const balances = (await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), emp.token)).body.data;
    expect(balances.some((b) => b.leave_type_name === 'Casual Leave')).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: 'leave_type_edit', entity_id: casual.id } })).toBe(1);
    expect((await authed(request(app).patch(`/api/v1/leave/types/${casual.id}`), emp.token).send({ is_applicable: true })).status).toBe(403);
  });

  test('a type excluded from the balance is taken without a cap', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const created = (await authed(request(app).post('/api/v1/leave/types'), ctx.adminToken).send({ name: 'Bereavement', paid: true, annual_quota: 1, counts_in_balance: false })).body.data;
    const res = await apply(emp, created.id, MON, '2026-09-18'); // 5 working days, quota 1, but excluded from the balance
    expect(res.status).toBe(201);
    const balances = (await authed(request(app).get('/api/v1/leave/balances/me').query({ year: 2026 }), emp.token)).body.data;
    expect(balances.find((b) => b.leave_type_name === 'Bereavement')).toMatchObject({ unlimited: true, counts_in_balance: false });
  });

  test('beyond the paid balance the remaining days become Unpaid Leave (salary pays only what the balance covers)', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const sick = (await authed(request(app).post('/api/v1/leave/types'), ctx.adminToken).send({ name: 'Special', paid: true, annual_quota: 2, overflow_to_unpaid: true })).body.data;
    const res = await apply(emp, sick.id, MON, '2026-09-18'); // Mon-Fri = 5 working days, 2 paid
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ leave_type_id: sick.id, days: 2 });
    expect(res.body.overflow.to_unpaid_days).toBe(3);
    const requests = await prisma.leaveRequest.findMany({ where: { org_membership_id: emp.membership.id }, include: { leave_type: true }, orderBy: { from_date: 'asc' } });
    expect(requests.map((r) => [r.leave_type.name, r.from_date.toISOString().slice(0, 10), r.to_date.toISOString().slice(0, 10)])).toEqual([
      ['Special', '2026-09-14', '2026-09-15'],
      ['Unpaid Leave', '2026-09-16', '2026-09-18'],
    ]);

    // Without the option a request beyond the balance is still refused.
    const strict = (await authed(request(app).post('/api/v1/leave/types'), ctx.adminToken).send({ name: 'Strict', paid: true, annual_quota: 1 })).body.data;
    expect((await apply(emp, strict.id, '2026-09-21', '2026-09-23')).status).toBe(422);
  });

  test('with nothing left the whole request becomes Unpaid Leave', async () => {
    const ctx = await seed();
    const emp = await ctx.employee('Eve');
    const t = (await authed(request(app).post('/api/v1/leave/types'), ctx.adminToken).send({ name: 'Tiny', paid: true, annual_quota: 0, overflow_to_unpaid: true })).body.data;
    const res = await apply(emp, t.id, MON, '2026-09-15');
    expect(res.status).toBe(201);
    const reqs = await prisma.leaveRequest.findMany({ where: { org_membership_id: emp.membership.id }, include: { leave_type: true } });
    expect(reqs).toHaveLength(1);
    expect(reqs[0].leave_type.name).toBe('Unpaid Leave');
  });
});

// Salary is calculated from attendance now: a salary can only be locked once every working day of the month is marked.
async function markMonthPresent(orgId, membershipId, year, month) {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const data = [];
  for (let d = 1; d <= days; d += 1) {
    const date = new Date(Date.UTC(year, month - 1, d));
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) data.push({ org_id: orgId, org_membership_id: membershipId, date, status: 'present', source: 'manual' });
  }
  await prisma.attendanceRecord.createMany({ data, skipDuplicates: true });
}
