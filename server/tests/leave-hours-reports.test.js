// The two read-only reports behind "leave still counts as worked": the leave/hours diagnostic (which condition matched)
// and the paid-leave billing report (how much billing comes from approved leave). Neither may change any data.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');
const leaveService = require('../src/modules/leave/leave.service');
const { diagnose } = require('../scripts/leave-hours-diagnostic');
const { report } = require('../scripts/paid-leave-billing-report');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const api = (path) => `/api/v1${path}`;
const d = (s) => new Date(`${s}T00:00:00.000Z`);
const OCT = { year: 2026, month: 10 };

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const adminUser = await createUser({ role: 'admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  await prisma.calendar.create({ data: { org_id: org.id, name: 'Calendar', is_default: true } });
  await leaveService.listTypes(org.id);
  const casual = await prisma.leaveType.findFirst({ where: { org_id: org.id, name: 'Casual Leave' } });
  const client = await prisma.account.create({ data: { type: 'client', name: unique('Client '), stage: 'active', owner_id: adminUser.id, org_id: org.id, industry: 'IT' } });
  const person = async (name) => {
    const user = await createUser({ role: 'employee', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'employee', joined_at: new Date('2020-01-01') });
    return { user, membership };
  };
  return { org, adminUser, adminToken, casual, client, person };
}

async function addProject(ctx, name, { rate = 22000 } = {}) {
  const res = await authed(request(app).post(api('/calendars/projects')), ctx.adminToken).send({ name, service_category: 'managed_services', client_account_id: ctx.client.id });
  expect(res.status).toBe(201);
  const patch = await authed(request(app).patch(api(`/billing/projects/${res.body.data.id}`)), ctx.adminToken).send({ agreement_start_date: '2026-01-01', billing: { rate_type: 'monthly', rate, currency: 'INR' } });
  expect(patch.status).toBe(200);
  return patch.body.data;
}

const assign = (ctx, accountId, membershipId) =>
  prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: accountId, org_membership_id: membershipId, created_by: ctx.adminUser.id } });
const leave = (ctx, membershipId, from, to = from, extra = {}) =>
  prisma.leaveRequest.create({ data: { org_id: ctx.org.id, org_membership_id: membershipId, leave_type_id: ctx.casual.id, from_date: d(from), to_date: d(to), status: 'approved', ...extra } });
const attendance = (ctx, membershipId, date, data) =>
  prisma.attendanceRecord.create({ data: { org_id: ctx.org.id, org_membership_id: membershipId, date: d(date), status: 'present', ...data } });
const entry = (ctx, membershipId, accountId, date, hours) =>
  prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: membershipId, account_id: accountId, date: d(date), hours, status: 'approved' } });
const days = (result, group) => (result.groups[group] || []).map((r) => r.date).sort();

describe('leave / hours diagnostic', () => {
  test('groups leave days by the condition that matched, and leaves a clean day alone', async () => {
    const ctx = await seed();
    const e = await ctx.person('Asha');
    const project = await addProject(ctx, 'Alpha');
    await assign(ctx, project.id, e.membership.id);
    // 6 Oct automatic present (new form), 7 Oct automatic present (legacy form), 8 Oct project hours,
    // 9 Oct a person's own present entry, 13 Oct nothing at all
    for (const date of ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-13']) await leave(ctx, e.membership.id, date);
    await attendance(ctx, e.membership.id, '2026-10-06', { source: 'auto', regularized_reason: 'auto_daily' });
    await attendance(ctx, e.membership.id, '2026-10-07', { source: 'manual', regularized_reason: 'auto_daily' });
    await entry(ctx, e.membership.id, project.id, '2026-10-08', 8);
    await attendance(ctx, e.membership.id, '2026-10-09', { source: 'manual', regularized_by: ctx.adminUser.id, regularized_reason: 'forgot to punch' });

    const result = await diagnose(prisma, { ...OCT, orgId: ctx.org.id });
    expect(days(result, 'auto_present')).toEqual(['2026-10-06', '2026-10-07']);
    expect(days(result, 'project_hours')).toEqual(['2026-10-08']);
    expect(days(result, 'manual_present')).toEqual(['2026-10-09']);
    // the contract-billed project is informational and lists every full leave day
    expect(days(result, 'billed_contract')).toHaveLength(5);
    expect(result.leave_days).toBe(5);
    expect(result.clean_days).toBe(1); // 13 Oct
  });

  test('half-day leave is flagged only when the hours exceed what the half day leaves free; locked months are marked', async () => {
    const ctx = await seed();
    const e = await ctx.person('Bala');
    const project = await addProject(ctx, 'Beta');
    await assign(ctx, project.id, e.membership.id);
    await leave(ctx, e.membership.id, '2026-10-06', '2026-10-06', { is_half_day: true, half_day_session: 'FIRST_HALF' });
    await leave(ctx, e.membership.id, '2026-10-07', '2026-10-07', { is_half_day: true, half_day_session: 'FIRST_HALF' });
    await entry(ctx, e.membership.id, project.id, '2026-10-06', 4); // fits the 8h project day minus half
    await entry(ctx, e.membership.id, project.id, '2026-10-07', 7); // does not
    await prisma.timesheetMonthLock.create({ data: { org_id: ctx.org.id, org_membership_id: e.membership.id, period_month: 10, period_year: 2026, locked_by: ctx.adminUser.id } });

    const result = await diagnose(prisma, { ...OCT, orgId: ctx.org.id });
    expect(days(result, 'half_day_hours_over_capacity')).toEqual(['2026-10-07']);
    expect(result.groups.half_day_hours_over_capacity[0].month_locked).toBe(true);
  });

  test('rejected hours and other months are ignored, and nothing is written', async () => {
    const ctx = await seed();
    const e = await ctx.person('Chitra');
    const project = await addProject(ctx, 'Gamma');
    await leave(ctx, e.membership.id, '2026-10-06');
    await prisma.timesheetEntry.create({ data: { org_id: ctx.org.id, org_membership_id: e.membership.id, account_id: project.id, date: d('2026-10-06'), hours: 8, status: 'rejected' } });
    const before = [await prisma.attendanceRecord.count(), await prisma.timesheetEntry.count(), await prisma.leaveRequest.count()];
    const result = await diagnose(prisma, { ...OCT, orgId: ctx.org.id });
    expect(result.groups.project_hours).toBeUndefined();
    expect((await diagnose(prisma, { year: 2026, month: 11, orgId: ctx.org.id })).leave_days).toBe(0);
    expect([await prisma.attendanceRecord.count(), await prisma.timesheetEntry.count(), await prisma.leaveRequest.count()]).toEqual(before);
  });

  test('an own-rate resource on a paid-leave day is reported as billed, and a project rule of 0 removes it', async () => {
    const ctx = await seed();
    const e = await ctx.person('Dev');
    const project = await addProject(ctx, 'Delta');
    await prisma.resourceBillingRate.create({ data: { org_id: ctx.org.id, account_id: project.id, org_membership_id: e.membership.id, rate_type: 'monthly', rate: 22000, effective_from: d('2026-01-01'), created_by: ctx.adminUser.id } });
    await leave(ctx, e.membership.id, '2026-10-06');
    expect(days(await diagnose(prisma, { ...OCT, orgId: ctx.org.id }), 'billed_resource')).toEqual(['2026-10-06']);
    await prisma.account.update({ where: { id: project.id }, data: { billing_leave_rules: { pl: 0, npl: 0 } } });
    expect((await diagnose(prisma, { ...OCT, orgId: ctx.org.id })).groups.billed_resource).toBeUndefined();
  });
});

describe('paid-leave billing report', () => {
  test('contract project: a day where the whole team is on leave is billed and reported; a partly staffed day is counted but not "all on leave"', async () => {
    const ctx = await seed();
    const a = await ctx.person('Esha');
    const b = await ctx.person('Farid');
    const project = await addProject(ctx, 'Epsilon', { rate: 22000 });
    await assign(ctx, project.id, a.membership.id);
    await assign(ctx, project.id, b.membership.id);
    await leave(ctx, a.membership.id, '2026-10-06'); // only Esha: counted, not everyone
    await leave(ctx, a.membership.id, '2026-10-07');
    await leave(ctx, b.membership.id, '2026-10-07'); // both: the whole team

    const rows = await report(prisma, { from: '2026-10', to: '2026-10', orgId: ctx.org.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ project: expect.stringContaining('Epsilon'), month: '2026-10', contract_days_with_leave: 2, all_on_leave_days: 1, lock: 'draft' });
    expect(rows[0].all_on_leave_amount).toBeGreaterThan(0);
  });

  test('own-rate resource: paid-leave days and their amount are reported; a project with the paid-leave rule at 0 is not', async () => {
    const ctx = await seed();
    const e = await ctx.person('Gita');
    const other = await ctx.person('Hari'); // keeps the contract team staffed so only the resource path is under test
    const project = await addProject(ctx, 'Zeta', { rate: 44000 });
    await assign(ctx, project.id, e.membership.id);
    await assign(ctx, project.id, other.membership.id);
    await prisma.resourceBillingRate.create({ data: { org_id: ctx.org.id, account_id: project.id, org_membership_id: e.membership.id, rate_type: 'monthly', rate: 22000, effective_from: d('2026-01-01'), created_by: ctx.adminUser.id } });
    await leave(ctx, e.membership.id, '2026-10-06', '2026-10-07');

    const rows = await report(prisma, { from: '2026-10', to: '2026-10', orgId: ctx.org.id });
    expect(rows[0].resource_leave_days).toBe(2);
    expect(JSON.parse(rows[0].resource_leave_by_status)).toEqual({ pl: 2 });
    expect(rows[0].resource_leave_amount).toBeGreaterThan(0);

    await prisma.account.update({ where: { id: project.id }, data: { billing_leave_rules: { pl: 0 } } });
    const after = await report(prisma, { from: '2026-10', to: '2026-10', orgId: ctx.org.id });
    expect(after[0]?.resource_leave_days || 0).toBe(0);
  });

  test('a locked billing month is reported as locked and left untouched', async () => {
    const ctx = await seed();
    const a = await ctx.person('Ivy');
    const project = await addProject(ctx, 'Eta');
    await assign(ctx, project.id, a.membership.id);
    await leave(ctx, a.membership.id, '2026-10-06');
    await prisma.financialCalculation.create({ data: { org_id: ctx.org.id, kind: 'billing', scope_key: project.id, period_month: 10, period_year: 2026, status: 'locked' } });
    const rows = await report(prisma, { from: '2026-10', to: '2026-10', orgId: ctx.org.id });
    expect(rows[0].lock).toBe('locked');
    expect(await prisma.financialCalculation.count()).toBe(1);
  });
});
