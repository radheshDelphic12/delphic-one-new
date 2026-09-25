const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createOrg,
  createOrgMembership,
  authed,
} = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedOrgAdmin() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  const membership = await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, membership, access_token };
}

async function seedOrgEmployee(org, role = 'recruiter') {
  const user = await createUser({ role });
  const membership = await createOrgMembership(user.id, org.id, { role });
  const { access_token } = await loginAs(user);
  return { user, membership, access_token };
}

// September 2026: Tue 1 -> Wed 30, 4 full weekends (5,6 / 12,13 / 19,20 / 26,27) = 8 weekend days, 22 weekdays.
const PERIOD = { period_month: 9, period_year: 2026 };

async function markPresent(orgId, membershipId, dates) {
  await prisma.attendanceRecord.createMany({
    data: dates.map((date) => ({ org_id: orgId, org_membership_id: membershipId, date: new Date(date), status: 'present' })),
  });
}

describe('Phase 4 — payroll routes require an active org membership', () => {
  test('a user with no OrgMembership gets 403, not a crash', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/api/v1/payroll/payslips/me'), access_token);
    expect(res.status).toBe(403);
  });
});

describe('Phase 4 — salary structures', () => {
  test('admin sets a salary structure; components must sum to ctc', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);

    const bad = await authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
      org_membership_id: membership.id,
      effective_from: '2026-09-01',
      ctc: 60000,
      components: { basic: 30000, hra: 20000 },
    });
    expect(bad.status).toBe(422);

    const good = await authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
      org_membership_id: membership.id,
      effective_from: '2026-09-01',
      ctc: 60000,
      components: { basic: 30000, hra: 20000, allowance: 10000 },
    });
    expect(good.status).toBe(201);
    expect(Number(good.body.data.ctc)).toBe(60000);
  });

  test('a non-admin cannot set a salary structure, but can read their own', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership, access_token: empToken } = await seedOrgEmployee(org);

    const forbidden = await authed(request(app).post('/api/v1/payroll/salary-structures'), empToken).send({
      org_membership_id: membership.id,
      effective_from: '2026-09-01',
      ctc: 60000,
      components: { basic: 60000 },
    });
    expect(forbidden.status).toBe(403);

    await authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
      org_membership_id: membership.id,
      effective_from: '2026-09-01',
      ctc: 60000,
      components: { basic: 60000 },
    });

    const mine = await authed(request(app).get('/api/v1/payroll/salary-structures/me'), empToken);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
  });

  test('a salary structure for another org is rejected', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const orgB = await createOrg({ name: 'Acconcy', slug: 'acconcy' });
    const outsider = await createUser({ role: 'recruiter' });
    const outsideMembership = await createOrgMembership(outsider.id, orgB.id, { role: 'recruiter' });

    const res = await authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
      org_membership_id: outsideMembership.id,
      effective_from: '2026-09-01',
      ctc: 60000,
      components: { basic: 60000 },
    });
    expect(res.status).toBe(404);
  });
});

describe('Phase 4 — payroll runs', () => {
  test('admin creates a run; a second run for the same period is rejected', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();

    const first = await authed(request(app).post('/api/v1/payroll/runs'), adminToken).send(PERIOD);
    expect(first.status).toBe(201);
    expect(first.body.data.status).toBe('draft');

    const dup = await authed(request(app).post('/api/v1/payroll/runs'), adminToken).send(PERIOD);
    expect(dup.status).toBe(409);
  });

  test('a non-admin cannot create a run', async () => {
    const { org } = await seedOrgAdmin();
    const { access_token } = await seedOrgEmployee(org);
    const res = await authed(request(app).post('/api/v1/payroll/runs'), access_token).send(PERIOD);
    expect(res.status).toBe(403);
  });
});

describe('Phase 4 — processing a run computes payslips from attendance + leave', () => {
  test('a fully-present employee has zero deductions; net equals gross', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership, access_token: empToken } = await seedOrgEmployee(org);

    await authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
      org_membership_id: membership.id,
      effective_from: '2026-09-01',
      ctc: 60000,
      components: { basic: 60000 },
    });

    // Every weekday in Sep 2026 marked present.
    const weekdays = [];
    for (let d = 1; d <= 30; d += 1) {
      const day = new Date(Date.UTC(2026, 8, d));
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) weekdays.push(day.toISOString().slice(0, 10));
    }
    await markPresent(org.id, membership.id, weekdays);

    const run = await authed(request(app).post('/api/v1/payroll/runs'), adminToken).send(PERIOD);
    const processed = await authed(request(app).post(`/api/v1/payroll/runs/${run.body.data.id}/process`), adminToken);
    expect(processed.status).toBe(200);
    expect(processed.body.data.payslips_generated).toBe(1);
    expect(processed.body.data.run.status).toBe('processed');

    const mine = await authed(request(app).get('/api/v1/payroll/payslips/me'), empToken);
    expect(mine.body.data).toHaveLength(1);
    const payslip = mine.body.data[0];
    expect(Number(payslip.deductions)).toBe(0);
    expect(Number(payslip.net)).toBe(60000);
    expect(payslip.breakdown.unpaid_days).toBe(0);
    expect(payslip.breakdown.weekend_days).toBe(8);
  });

  test('unpaid absences reduce net pay; approved paid leave does not', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership, access_token: empToken } = await seedOrgEmployee(org);

    await authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
      org_membership_id: membership.id,
      effective_from: '2026-09-01',
      ctc: 30000, // per_day_pay = 30000/30 = 1000
      components: { basic: 30000 },
    });

    // Present every weekday except 2 unmarked absences (2026-09-08, 2026-09-09), and
    // an approved paid leave covering 2026-09-14 (a Monday).
    const leaveType = await prisma.leaveType.create({ data: { org_id: org.id, name: 'Paid Leave', paid: true } });
    await prisma.leaveRequest.create({
      data: {
        org_id: org.id,
        org_membership_id: membership.id,
        leave_type_id: leaveType.id,
        from_date: new Date('2026-09-14'),
        to_date: new Date('2026-09-14'),
        status: 'approved',
      },
    });

    const weekdays = [];
    for (let d = 1; d <= 30; d += 1) {
      const day = new Date(Date.UTC(2026, 8, d));
      const key = day.toISOString().slice(0, 10);
      if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
      if (['2026-09-08', '2026-09-09', '2026-09-14'].includes(key)) continue;
      weekdays.push(key);
    }
    await markPresent(org.id, membership.id, weekdays);

    const run = await authed(request(app).post('/api/v1/payroll/runs'), adminToken).send(PERIOD);
    await authed(request(app).post(`/api/v1/payroll/runs/${run.body.data.id}/process`), adminToken);

    const mine = await authed(request(app).get('/api/v1/payroll/payslips/me'), empToken);
    const payslip = mine.body.data[0];
    expect(payslip.breakdown.unpaid_days).toBe(2);
    expect(payslip.breakdown.paid_leave_days).toBe(1);
    expect(Number(payslip.deductions)).toBe(2000); // 2 unpaid days * 1000/day
    expect(Number(payslip.net)).toBe(28000);
  });

  test('a member with no salary structure is skipped, not failed', async () => {
    const { org, membership: adminMembership, access_token: adminToken } = await seedOrgAdmin();
    const { membership: empMembership } = await seedOrgEmployee(org); // no salary structure set
    // The admin's own membership also has no salary structure — give it one
    // so only the employee is skipped, isolating what this test checks.
    await authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
      org_membership_id: adminMembership.id,
      effective_from: '2026-09-01',
      ctc: 80000,
      components: { basic: 80000 },
    });

    const run = await authed(request(app).post('/api/v1/payroll/runs'), adminToken).send(PERIOD);
    const processed = await authed(request(app).post(`/api/v1/payroll/runs/${run.body.data.id}/process`), adminToken);
    expect(processed.status).toBe(200);
    expect(processed.body.data.payslips_generated).toBe(1);
    expect(processed.body.data.skipped).toHaveLength(1);
    expect(processed.body.data.skipped[0].org_membership_id).toBe(empMembership.id);
    expect(processed.body.data.skipped[0].reason).toBe('no_salary_structure');
  });

  test('a run cannot be processed twice', async () => {
    const { access_token: adminToken } = await seedOrgAdmin();
    const run = await authed(request(app).post('/api/v1/payroll/runs'), adminToken).send(PERIOD);
    await authed(request(app).post(`/api/v1/payroll/runs/${run.body.data.id}/process`), adminToken);
    const again = await authed(request(app).post(`/api/v1/payroll/runs/${run.body.data.id}/process`), adminToken);
    expect(again.status).toBe(409);
  });

  test('a non-admin cannot process a run', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { access_token: empToken } = await seedOrgEmployee(org);
    const run = await authed(request(app).post('/api/v1/payroll/runs'), adminToken).send(PERIOD);
    const res = await authed(request(app).post(`/api/v1/payroll/runs/${run.body.data.id}/process`), empToken);
    expect(res.status).toBe(403);
  });
});

describe('Phase 4 — payslip access', () => {
  test('an employee cannot view another employee\'s payslip; admin can', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership: empA, access_token: tokenA } = await seedOrgEmployee(org);
    const { access_token: tokenB } = await seedOrgEmployee(org);

    await authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
      org_membership_id: empA.id,
      effective_from: '2026-09-01',
      ctc: 30000,
      components: { basic: 30000 },
    });

    const run = await authed(request(app).post('/api/v1/payroll/runs'), adminToken).send(PERIOD);
    await authed(request(app).post(`/api/v1/payroll/runs/${run.body.data.id}/process`), adminToken);

    const mineA = await authed(request(app).get('/api/v1/payroll/payslips/me'), tokenA);
    const payslipId = mineA.body.data[0].id;

    const asOwner = await authed(request(app).get(`/api/v1/payroll/payslips/${payslipId}`), tokenA);
    expect(asOwner.status).toBe(200);

    const asOther = await authed(request(app).get(`/api/v1/payroll/payslips/${payslipId}`), tokenB);
    expect(asOther.status).toBe(404);

    const asAdmin = await authed(request(app).get(`/api/v1/payroll/payslips/${payslipId}`), adminToken);
    expect(asAdmin.status).toBe(200);
  });

  test('admin lists every payslip for a run', async () => {
    const { org, access_token: adminToken } = await seedOrgAdmin();
    const { membership } = await seedOrgEmployee(org);

    await authed(request(app).post('/api/v1/payroll/salary-structures'), adminToken).send({
      org_membership_id: membership.id,
      effective_from: '2026-09-01',
      ctc: 30000,
      components: { basic: 30000 },
    });

    const run = await authed(request(app).post('/api/v1/payroll/runs'), adminToken).send(PERIOD);
    await authed(request(app).post(`/api/v1/payroll/runs/${run.body.data.id}/process`), adminToken);

    const list = await authed(request(app).get(`/api/v1/payroll/runs/${run.body.data.id}/payslips`), adminToken);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].org_membership.id).toBe(membership.id);
  });
});
