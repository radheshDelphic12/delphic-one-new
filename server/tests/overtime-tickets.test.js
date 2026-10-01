// Phase 3 + 4 of the client / project timesheet redesign (docs/features/CLIENT-PROJECT-TIMESHEET.md):
//  3. overtime for attendance-paid people is a TICKET (employee raises, manager / admin approves); approved
//     hours are paid as OT and billed to the client where the project bills overtime - never derived from
//     timesheet hours;
//  4. a vendor resource logs 8h or 9h a day on the one timesheet; the vendor payout counts a full day at
//     THEIR billable hours (assignment billable_hours_per_day), the client bill uses the same entries.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');
const salaryEngine = require('../src/modules/calculations/engines/salary.engine');
const billingEngine = require('../src/modules/calculations/engines/billing.engine');
const vendorEngine = require('../src/modules/calculations/engines/vendorPayment.engine');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const ymd = (d) => d.toISOString().slice(0, 10);
const SEP = { period_month: 9, period_year: 2026 };
const DAYS = [];
for (let d = 1; d <= 30; d += 1) {
  const date = new Date(Date.UTC(2026, 8, d));
  if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) DAYS.push(ymd(date));
}
// September 2026 is in the past (today is 1 Oct 2026), so a ticket may be raised for any of its days.
const TICKET_DAY = DAYS[6];

async function seed() {
  const org = await createOrg();
  const it = await prisma.department.create({ data: { org_id: org.id, name: 'IT' } });
  const adminUser = await createUser({ role: 'admin' });
  const adminMembership = await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const adminToken = (await loginAs(adminUser)).access_token;
  const person = async (name, { manager = null, basis = null, role = 'recruiter' } = {}) => {
    const user = await createUser({ role, name });
    await prisma.user.update({ where: { id: user.id }, data: { department_id: it.id } });
    const membership = await createOrgMembership(user.id, org.id, { role, department_id: it.id, joined_at: new Date('2026-01-01') });
    await prisma.orgMembership.update({ where: { id: membership.id }, data: { manager_id: manager?.membership.id ?? null, pay_basis: basis } });
    await prisma.salaryStructure.create({ data: { org_id: org.id, org_membership_id: membership.id, effective_from: new Date('2026-01-01'), ctc: 198000, components: { basic: 198000 }, created_by: adminUser.id } });
    await prisma.attendanceRecord.createMany({ data: DAYS.map((d) => ({ org_id: org.id, org_membership_id: membership.id, date: new Date(d), status: 'present' })) });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  const project = async (name, extra = {}) => {
    const account = await prisma.account.create({
      data: { org_id: org.id, type: 'client', name, stage: 'active', is_project: true, service_category: 'managed_services', owner_id: adminUser.id, origin_owner_id: adminUser.id, agreement_start_date: new Date('2026-01-01'), ...extra },
    });
    await prisma.billingRate.create({ data: { org_id: org.id, account_id: account.id, rate_type: 'monthly', rate: 160000, currency: 'INR', effective_from: new Date('2026-01-01'), created_by: adminUser.id } });
    return account;
  };
  return { org, it, adminUser, adminMembership, adminToken, person, project };
}

const raise = (who, body) => authed(request(app).post('/api/v1/timesheets/overtime-tickets'), who.token).send(body);
const decide = (who, id, body) => authed(request(app).post(`/api/v1/timesheets/overtime-tickets/${id}/decision`), who.token ?? who).send(body);
const salaryOf = async (ctx, who) => (await salaryEngine.computeSalary(ctx.org.id, { ...SEP, filters: { org_membership_id: who.membership.id } })).lines[0];

describe('Phase 3 - overtime tickets', () => {
  test('only attendance-paid people raise tickets; the manager approves; approved hours are paid as OT (hours x hourly rate), pending ones are the projection, rejected pay nothing', async () => {
    const ctx = await seed();
    const manager = await ctx.person('Manager', { role: 'admin' });
    const dev = await ctx.person('Dev', { manager, basis: 'attendance' });
    const clerk = await ctx.person('Clerk', { manager }); // timesheet-paid: keeps the timesheet overtime flow

    expect((await raise(clerk, { date: TICKET_DAY, hours: 2, reason: 'Release night' })).status).toBe(422);
    expect((await raise(dev, { date: TICKET_DAY, hours: 2 })).status).toBe(422); // a reason is required
    expect((await raise(dev, { date: '2099-01-01', hours: 2, reason: 'Future' })).status).toBe(422);
    const t1 = await raise(dev, { date: TICKET_DAY, hours: 3, reason: 'Production release' });
    expect(t1.status).toBe(201);
    expect(t1.body.data).toMatchObject({ status: 'pending', hours: 3, employee: 'Dev' });
    // One day cannot hold more than 12h of tickets.
    expect((await raise(dev, { date: TICKET_DAY, hours: 10, reason: 'Too much' })).status).toBe(422);

    // Pending = projection only: net unchanged, projected_net up by 3h x 1000.
    let line = await salaryOf(ctx, dev);
    expect(line).toMatchObject({ net: 198000, projected_net: 201000, ot_amount: 0 });
    expect(line.breakdown).toMatchObject({ ot_pending_hours: 3, ot_approved_hours: 0, source: 'attendance' });

    // Not the employee, not a stranger: only the manager (or an admin) decides.
    expect((await decide(dev, t1.body.data.id, { status: 'approved' })).status).toBe(403);
    expect((await decide(clerk, t1.body.data.id, { status: 'approved' })).status).toBe(403);
    expect((await decide(manager, t1.body.data.id, { status: 'rejected' })).status).toBe(422); // rejection needs a reason
    const approved = await decide(manager, t1.body.data.id, { status: 'approved' });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: 'approved' });

    line = await salaryOf(ctx, dev);
    expect(line).toMatchObject({ net: 201000, ot_amount: 3000 });
    expect(line.breakdown).toMatchObject({ ot_approved_hours: 3, ot_pending_hours: 0 });

    // A manager decides once; the admin may revise (approved -> rejected pays nothing again).
    expect((await decide(manager, t1.body.data.id, { status: 'rejected', reason: 'again' })).status).toBe(200); // manager here is an admin role
    const t2 = (await raise(dev, { date: DAYS[7], hours: 2, reason: 'Hotfix' })).body.data;
    expect((await decide(ctx.adminToken, t2.id, { status: 'rejected', reason: 'Not needed' })).status).toBe(200);
    line = await salaryOf(ctx, dev);
    expect(line).toMatchObject({ net: 198000, ot_amount: 0 });
    expect(line.breakdown.ot_rejected_hours).toBe(5);
  });

  test('the employee can cancel a pending ticket; an admin can edit or delete any ticket with a reason (audited)', async () => {
    const ctx = await seed();
    const manager = await ctx.person('Manager', { role: 'admin' });
    const dev = await ctx.person('Dev', { manager, basis: 'attendance' });
    const t = (await raise(dev, { date: TICKET_DAY, hours: 2, reason: 'Release' })).body.data;

    const mine = await authed(request(app).get('/api/v1/timesheets/overtime-tickets').query({ scope: 'mine' }), dev.token);
    expect(mine.body.data).toMatchObject({ uses_tickets: true, tickets: [expect.objectContaining({ id: t.id })] });
    const queue = await authed(request(app).get('/api/v1/timesheets/overtime-tickets').query({ scope: 'to_decide' }), manager.token);
    expect(queue.body.data.tickets.map((x) => x.id)).toEqual([t.id]);
    expect((await authed(request(app).get('/api/v1/timesheets/overtime-tickets').query({ scope: 'all' }), dev.token)).status).toBe(403);

    const edit = await authed(request(app).patch(`/api/v1/timesheets/overtime-tickets/${t.id}/admin`), ctx.adminToken).send({ hours: 4, status: 'approved', reason: 'Manager approved on paper' });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ hours: 4, status: 'approved' });
    expect((await salaryOf(ctx, dev)).ot_amount).toBe(4000);
    expect((await authed(request(app).patch(`/api/v1/timesheets/overtime-tickets/${t.id}/admin`), dev.token).send({ hours: 9, reason: 'sneaky' })).status).toBe(403);

    expect((await authed(request(app).delete(`/api/v1/timesheets/overtime-tickets/${t.id}`), ctx.adminToken).send({ reason: 'Raised by mistake' })).status).toBe(200);
    expect((await salaryOf(ctx, dev)).ot_amount).toBe(0);
    const actions = (await prisma.auditLog.findMany({ where: { org_id: ctx.org.id, entity_type: 'overtime_ticket' } })).map((a) => a.action).sort();
    expect(actions).toEqual(['overtime_ticket_delete', 'overtime_ticket_edit']);

    const t2 = (await raise(dev, { date: DAYS[8], hours: 1, reason: 'Oops' })).body.data;
    expect((await authed(request(app).post(`/api/v1/timesheets/overtime-tickets/${t2.id}/cancel`), dev.token)).body.data.status).toBe('cancelled');
    expect((await decide(manager, t2.id, { status: 'approved' })).status).toBe(409); // a cancelled ticket cannot be approved
  });

  test('timesheet overtime hours are refused for attendance-paid people - they raise a ticket instead', async () => {
    const ctx = await seed();
    const dev = await ctx.person('Dev', { basis: 'attendance' });
    const account = await ctx.project('Miicare');
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: account.id, org_membership_id: dev.membership.id, created_by: ctx.adminUser.id } });
    const res = await authed(request(app).post('/api/v1/timesheets/entries'), dev.token).send({ date: DAYS[0], account_id: account.id, hours: 6, overtime_hours: 2 });
    expect(res.status).toBe(422);
    expect(res.body.message || res.body.error?.message || JSON.stringify(res.body)).toMatch(/ticket/i);
    expect((await authed(request(app).post('/api/v1/timesheets/entries'), dev.token).send({ date: DAYS[0], account_id: account.id, hours: 6 })).status).toBe(201);
  });

  test('an approved ticket on a project that bills overtime is billed to the client (rate / benchmark x multiplier); a pending one holds the month; no overtime billing = nothing', async () => {
    const ctx = await seed();
    const manager = await ctx.person('Manager', { role: 'admin' });
    const dev = await ctx.person('Dev', { manager, basis: 'attendance' });
    const billed = await ctx.project('Overtime billed', { overtime_billable: true, overtime_multiplier: 1.5 });
    const free = await ctx.project('Overtime free');

    const t = (await raise(dev, { date: TICKET_DAY, hours: 4, account_id: billed.id, reason: 'Client escalation' })).body.data;
    const other = (await raise(dev, { date: TICKET_DAY, hours: 2, account_id: free.id, reason: 'Support' })).body.data;
    let month = await billingEngine.computeProjectMonth(ctx.org.id, billed.id, SEP);
    expect(month.readiness.blockers.map((b) => b.code)).toContain('pending_overtime_tickets');

    await decide(manager, t.id, { status: 'approved' });
    await decide(manager, other.id, { status: 'approved' });
    month = await billingEngine.computeProjectMonth(ctx.org.id, billed.id, SEP);
    expect(month.readiness.blockers.map((b) => b.code)).not.toContain('pending_overtime_tickets');
    const day = month.days.find((d) => d.date === TICKET_DAY);
    // 160000 / 160h benchmark = 1000 / h, x 1.5 multiplier, 4h = 6000 on top of the retainer.
    expect(day.hours.overtime_approved).toBe(4);
    expect(day.overtime_amount).toBe(6000);
    expect(billingEngine.lockedAmount(month)).toBe(160000 + 6000);
    expect(day.resources.find((r) => r.name === 'Dev')).toMatchObject({ overtime_hours: 4 });

    // The project that does not bill overtime never bills the ticket (it still pays the employee).
    const freeMonth = await billingEngine.computeProjectMonth(ctx.org.id, free.id, SEP);
    expect(billingEngine.lockedAmount(freeMonth)).toBe(160000);
    expect((await salaryOf(ctx, dev)).ot_amount).toBe(6000); // 4h + 2h at Rs 1000
  });
});

describe('Phase 4 - vendor resource: one timesheet, day length from their own billable hours', () => {
  async function contractorSetup(ctx, billableHours) {
    const vendor = await prisma.account.create({ data: { org_id: ctx.org.id, type: 'vendor', name: 'Acme Vendor', stage: 'active', owner_id: ctx.adminUser.id, origin_owner_id: ctx.adminUser.id } });
    const project = await ctx.project('Vendor project', { agreement_end_date: new Date('2026-12-31') });
    const user = await createUser({ role: 'recruiter', name: 'Ravi' });
    const membership = await prisma.orgMembership.create({ data: { person_id: user.id, org_id: ctx.org.id, role: 'recruiter', worker_type: 'contractor', vendor_account_id: vendor.id, vendor_rate: 88000, vendor_rate_currency: 'INR', joined_at: new Date('2026-01-01') } });
    await prisma.projectMemberAssignment.create({ data: { org_id: ctx.org.id, account_id: project.id, org_membership_id: membership.id, billable_hours_per_day: billableHours, created_by: ctx.adminUser.id } });
    return { vendor, project, membership };
  }
  const log = (ctx, c, dates, hours) =>
    prisma.timesheetEntry.createMany({ data: dates.map((d) => ({ org_id: ctx.org.id, org_membership_id: c.membership.id, account_id: c.project.id, date: new Date(d), hours, billable: true, status: 'approved', approved_by: ctx.adminUser.id, approved_at: new Date() })) });
  const payout = async (ctx, c) => (await vendorEngine.computeVendorPayments(ctx.org.id, { ...SEP, vendor_account_id: c.vendor.id })).lines[0];

  test('a contractor on 9h days: 20 full 9h days of 22 = 20/22 of the rate (9h is a full day for them); half a 9h day pays half', async () => {
    const ctx = await seed();
    const c = await contractorSetup(ctx, 9);
    await log(ctx, c, DAYS.slice(0, 18), 9); // 18 full days
    await log(ctx, c, DAYS.slice(18, 20), 4.5); // 2 half days
    const line = await payout(ctx, c);
    // 88000 / 22 = 4000 a day; 18 + 2 x 0.5 = 19 payable days = 76000.
    expect(line).toMatchObject({ payout_basis: 'approved_hours', day_hours: 9, contract_working_days: 22, payable_days: 19, amount: 76000 });
  });

  test('an 8h contractor logging 9h is capped at one day (8h is a full day for them)', async () => {
    const ctx = await seed();
    const c = await contractorSetup(ctx, 8);
    await log(ctx, c, DAYS.slice(0, 20), 9);
    expect(await payout(ctx, c)).toMatchObject({ day_hours: 8, payable_days: 20, amount: 80000 });
  });

  test('a 9h contractor logging only 8h is paid 8/9 of a day - the day length follows the resource, not one project number', async () => {
    const ctx = await seed();
    const c = await contractorSetup(ctx, 9);
    await log(ctx, c, DAYS.slice(0, 20), 8);
    const line = await payout(ctx, c);
    expect(line.payable_days).toBeCloseTo(20 * (8 / 9), 1);
  });

  test('the one contractor timesheet also drives the client bill (same approved entries)', async () => {
    const ctx = await seed();
    const c = await contractorSetup(ctx, 9);
    await log(ctx, c, DAYS.slice(0, 20), 9);
    await prisma.account.update({ where: { id: c.project.id }, data: { client_billing_basis: 'approved_hours', billable_day_hours: 9 } });
    const month = await billingEngine.computeProjectMonth(ctx.org.id, c.project.id, SEP);
    // 160000 / 22 x 20 approved 9h days.
    expect(billingEngine.lockedAmount(month)).toBeCloseTo((160000 / 22) * 20, 0);
  });
});
