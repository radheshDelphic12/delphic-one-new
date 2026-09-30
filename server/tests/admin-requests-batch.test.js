// Notice period + LWD, multi-team capacity, superadmin expense / group-charge
// edit & delete, hourly minimum hours, P&L contract status, analytics
// approval filter + group expenses, admin timesheet / attendance corrections,
// and the asset vendor.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique, PASSWORD } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const admin = await createUser({ role: 'admin', is_superadmin: true });
  const adminMembership = await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const token = (await loginAs(admin)).access_token;
  const plainAdmin = await createUser({ role: 'admin' });
  await createOrgMembership(plainAdmin.id, org.id, { role: 'admin' });
  const plainToken = (await loginAs(plainAdmin)).access_token;
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Ahmedabad Calendar', is_default: true } });
  return { org, admin, adminMembership, token, plainToken };
}

async function employee(ctx, name = 'Emp') {
  const user = await createUser({ role: 'employee', name });
  const membership = await createOrgMembership(user.id, ctx.org.id, { role: 'employee', joined_at: new Date('2026-01-01') });
  return { user, membership, token: (await loginAs(user)).access_token };
}

async function project(ctx, name, extra = {}) {
  return prisma.account.create({
    data: { org_id: ctx.org.id, name, type: 'client', stage: 'active', is_project: true, service_category: 'managed_services', owner_id: ctx.admin.id, agreement_start_date: new Date('2026-01-01'), ...extra },
  });
}

describe('Notice period and last working day', () => {
  test('admin sets notice + LWD; the employee keeps working access until they exit; exit records left_at', async () => {
    const ctx = await seed();
    const emp = await employee(ctx, 'Leaving Soon');
    const url = `/api/v1/orgs/memberships/${emp.membership.id}`;

    const bad = await authed(request(app).patch(url), ctx.token).send({ employment_status: 'notice_period', notice_start_date: '2026-10-01', notice_end_date: '2026-09-01' });
    expect(bad.status).toBe(422);

    const onNotice = await authed(request(app).patch(url), ctx.token).send({ employment_status: 'notice_period', notice_start_date: '2026-09-01', notice_end_date: '2026-10-31' });
    expect(onNotice.status).toBe(200);
    expect(onNotice.body.data).toMatchObject({ employment_status: 'notice_period' });
    expect(onNotice.body.data.notice_end_date.slice(0, 10)).toBe('2026-10-31');

    // Serving notice still signs in and uses the portal.
    const login = await request(app).post('/api/v1/auth/login').send({ email: emp.user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.active_org?.id).toBe(ctx.org.id);
    expect((await authed(request(app).get('/api/v1/orgs/me/reporting'), login.body.data.access_token)).status).toBe(200);

    const exited = await authed(request(app).patch(url), ctx.token).send({ employment_status: 'terminated' });
    expect(exited.body.data.left_at.slice(0, 10)).toBe('2026-10-31');
  });
});

describe('Team capacity — several teams at once', () => {
  test('team_ids narrows the report to the chosen teams', async () => {
    const ctx = await seed();
    const [a, b, c] = await Promise.all(['Alpha', 'Beta', 'Gamma'].map((name) => prisma.team.create({ data: { org_id: ctx.org.id, name } })));
    for (const t of [a, b, c]) {
      const e = await employee(ctx, `In ${t.name}`);
      await prisma.orgMembership.update({ where: { id: e.membership.id }, data: { team_id: t.id } });
    }
    const res = await authed(request(app).get(`/api/v1/allocations/reports/team-capacity?team_ids=${a.id},${c.id}`), ctx.token);
    expect(res.status).toBe(200);
    expect(res.body.data.teams.map((r) => r.team?.name).sort()).toEqual(['Alpha', 'Gamma']);
  });
});

describe('Superadmin expense and group-expense corrections', () => {
  test('a superadmin edits a decided claim and deletes claims and group charges; a plain admin cannot', async () => {
    const ctx = await seed();
    const emp = await employee(ctx);
    const office = await prisma.location.create({ data: { org_id: ctx.org.id, name: 'Indore' } });
    const claim = (await authed(request(app).post('/api/v1/expenses/claims'), emp.token).send({ location_id: office.id, category: 'Travel', amount: 500, currency: 'INR' })).body.data;
    await authed(request(app).post(`/api/v1/expenses/claims/${claim.id}/decision`), ctx.token).send({ status: 'approved' });

    expect((await authed(request(app).patch(`/api/v1/expenses/claims/${claim.id}`), ctx.plainToken).send({ amount: 450 })).status).toBe(409);
    const edited = await authed(request(app).patch(`/api/v1/expenses/claims/${claim.id}`), ctx.token).send({ amount: 450 });
    expect(edited.status).toBe(200);
    expect(Number(edited.body.data.amount)).toBe(450);

    expect((await authed(request(app).delete(`/api/v1/expenses/claims/${claim.id}`), ctx.plainToken)).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/expenses/claims/${claim.id}`), ctx.token)).status).toBe(200);
    expect(await prisma.expenseClaim.count({ where: { id: claim.id } })).toBe(0);

    const charge = await prisma.groupBillingCharge.create({ data: { org_id: ctx.org.id, org_group_id: ctx.org.org_group_id, raised_by: ctx.admin.id, kind: 'Rent', amount: 50000, currency: 'INR', period_month: 9, period_year: 2026 } });
    expect((await authed(request(app).delete(`/api/v1/billing/group-charges/${charge.id}`), ctx.plainToken)).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/billing/group-charges/${charge.id}`), ctx.token)).status).toBe(200);
    expect(await prisma.groupBillingCharge.count({ where: { id: charge.id } })).toBe(0);
  });
});

describe('Hourly projects — minimum hours and P&L status', () => {
  test('the minimum is saved, flagged in P&L when approved hours fall short, and each P&L row carries its contract status', async () => {
    const ctx = await seed();
    const p = await project(ctx, 'Tankpros');
    await prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: p.id, rate_type: 'hourly', rate: 1000, currency: 'INR', effective_from: new Date('2026-01-01'), created_by: ctx.admin.id } });
    const saved = await authed(request(app).patch(`/api/v1/billing/projects/${p.id}`), ctx.token).send({ minimum_monthly_hours: 100 });
    expect(saved.status).toBe(200);
    expect(saved.body.data.minimum_monthly_hours).toBe(100);

    const emp = await employee(ctx);
    await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, account_id: p.id, date: new Date('2026-09-10'), hours: 8, billable: true, status: 'approved' } });
    const pnl = await authed(request(app).get('/api/v1/billing/projects-pnl?period_month=9&period_year=2026'), ctx.token);
    const row = pnl.body.data.find((r) => r.project.id === p.id);
    expect(row.minimum).toEqual({ hours: 100, shortfall_hours: 92 });
    expect(row.contract.state).toBe('running');
  });
});

describe('Live Analytics', () => {
  test('the approval filter lists only projects with hours in that state; expenses include group expenses', async () => {
    const ctx = await seed();
    const approvedP = await project(ctx, 'Approved Work');
    const pendingP = await project(ctx, 'Pending Work');
    for (const p of [approvedP, pendingP]) {
      await prisma.billingRate.create({ data: { org_id: ctx.org.id, account_id: p.id, rate_type: 'hourly', rate: 1000, currency: 'INR', effective_from: new Date('2026-01-01'), created_by: ctx.admin.id } });
    }
    const emp = await employee(ctx);
    await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, account_id: approvedP.id, date: new Date('2026-09-10'), hours: 6, billable: true, status: 'approved' } });
    await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, account_id: pendingP.id, date: new Date('2026-09-10'), hours: 4, billable: true, status: 'submitted' } });

    const q = { period: 'month', period_month: 9, period_year: 2026 };
    const pending = await authed(request(app).get('/api/v1/analytics/billing'), ctx.token).query({ ...q, status: 'pending' });
    expect(pending.body.data.projects.map((r) => r.project.name)).toEqual(['Pending Work']);
    expect(pending.body.data.totals).toMatchObject({ pending_hours: 4, approved_hours: 0 });
    const approved = await authed(request(app).get('/api/v1/analytics/billing'), ctx.token).query({ ...q, status: 'approved' });
    expect(approved.body.data.projects.map((r) => r.project.name)).toEqual(['Approved Work']);
    expect(approved.body.data.totals).toMatchObject({ approved_hours: 6, pending_hours: 0 });

    const now = new Date();
    await prisma.groupBillingCharge.create({
      data: { org_id: ctx.org.id, org_group_id: ctx.org.org_group_id, raised_by: ctx.admin.id, kind: 'Office Rent', amount: 50000, currency: 'INR', period_month: now.getUTCMonth() + 1, period_year: now.getUTCFullYear(), payment_date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) },
    });
    const expenses = await authed(request(app).get('/api/v1/analytics/expenses?months=3'), ctx.token);
    expect(expenses.body.data.group_total).toBe(50000);
    expect(expenses.body.data.total).toBe(50000);
    expect(expenses.body.data.by_group_category).toEqual([{ category: 'Office Rent', amount: 50000 }]);
  });
});

describe('Admin corrections — timesheets and attendance at any stage', () => {
  test('admin edits an approved entry on a locked day, deletes one, unlocks the day; employees cannot', async () => {
    const ctx = await seed();
    const p = await project(ctx, 'Webflow');
    const emp = await employee(ctx);
    const entry = await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, account_id: p.id, date: new Date('2026-09-10'), hours: 8, billable: true, status: 'approved' } });
    const other = await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, account_id: p.id, date: new Date('2026-09-11'), hours: 2, billable: true, status: 'submitted' } });
    await authed(request(app).post('/api/v1/timesheets/locks'), ctx.token).send({ date: '2026-09-10' });

    expect((await authed(request(app).patch(`/api/v1/timesheets/entries/${entry.id}/admin`), ctx.token).send({ hours: 6 })).status).toBe(422); // reason required
    const edited = await authed(request(app).patch(`/api/v1/timesheets/entries/${entry.id}/admin`), ctx.token).send({ hours: 6, notes: 'Fixed', reason: 'Logged 2h too many' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.entry).toMatchObject({ status: 'approved', notes: 'Fixed', account: { name: 'Webflow' } });
    expect(Number(edited.body.data.entry.hours)).toBe(6);
    expect((await authed(request(app).patch(`/api/v1/timesheets/entries/${entry.id}/admin`), emp.token).send({ hours: 1, reason: 'Trying' })).status).toBe(403);

    expect((await authed(request(app).delete(`/api/v1/timesheets/entries/${other.id}`), emp.token).send({ reason: 'mine' })).status).toBe(403);
    expect((await authed(request(app).delete(`/api/v1/timesheets/entries/${other.id}`), ctx.token).send({ reason: 'Duplicate entry' })).status).toBe(200);
    expect(await prisma.timesheetEntry.count({ where: { id: other.id } })).toBe(0);

    expect((await authed(request(app).delete('/api/v1/timesheets/locks/2026-09-10'), ctx.token)).status).toBe(200);
    expect(await prisma.timesheetLock.count({ where: { org_id: ctx.org.id } })).toBe(0);
    expect((await authed(request(app).delete('/api/v1/timesheets/locks/2026-09-10'), ctx.token)).status).toBe(404);
  });

  test('admin deletes an attendance record with a reason', async () => {
    const ctx = await seed();
    const emp = await employee(ctx);
    const record = await prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: emp.membership.id, date: new Date('2026-09-10'), status: 'present' } });
    expect((await authed(request(app).delete(`/api/v1/attendance/${record.id}`), ctx.token).send({})).status).toBe(422);
    expect((await authed(request(app).delete(`/api/v1/attendance/${record.id}`), emp.token).send({ reason: 'mine' })).status).toBe(403);
    const res = await authed(request(app).delete(`/api/v1/attendance/${record.id}`), ctx.token).send({ reason: 'Marked on the wrong day' });
    expect(res.status).toBe(200);
    expect(await prisma.attendanceRecord.count({ where: { id: record.id } })).toBe(0);
  });
});

describe('Assets — the supplying vendor', () => {
  test('a Delphic-owned asset keeps the vendor that supplied it', async () => {
    const ctx = await seed();
    const vendor = await prisma.account.create({ data: { org_id: ctx.org.id, name: 'Online Sanctum', type: 'vendor', stage: 'active', owner_id: ctx.admin.id } });
    const res = await authed(request(app).post('/api/v1/assets'), ctx.token).send({ asset_type: 'Windows Laptop', belongs_to: 'delphic', vendor_account_id: vendor.id });
    expect(res.status).toBe(201);
    expect(res.body.data.vendor_account).toMatchObject({ name: 'Online Sanctum' });
    const vendors = await authed(request(app).get('/api/v1/billing/vendors'), ctx.token);
    expect(vendors.body.data.map((v) => v.name)).toContain('Online Sanctum');
  });
});
