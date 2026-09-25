const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createOrg,
  createOrgMembership,
  createActiveClientAccount,
  createRequirement,
  createProfile,
  authed,
} = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function adminIn(orgOverrides = {}) {
  const org = await createOrg(orgOverrides);
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}

// A closed submission sourced from a vendor — the one shape a commission can
// legitimately be raised against. Built by hand (not through the stage
// machine) because only the end state matters for this fixture, same as
// createInterviewRound bypasses the route layer elsewhere in this suite.
async function closedVendorSubmission(orgId, adminId, adminToken, { profileSource = 'vendor' } = {}) {
  const vendorAccount = await prisma.account.create({
    data: { org_id: orgId, type: 'vendor', name: `Vendor ${Date.now()}${Math.random()}`, stage: 'active', owner_id: adminId, origin_owner_id: adminId },
  });
  const clientAccount = await createActiveClientAccount(adminId);
  await prisma.account.update({ where: { id: clientAccount.id }, data: { org_id: orgId } });
  const requirement = await createRequirement(adminToken, clientAccount.id);
  const seat = await prisma.requirementSeat.findFirst({ where: { requirement_id: requirement.id } });
  const profile = await createProfile(adminToken, {
    source: profileSource,
    ...(profileSource === 'vendor' ? { vendor_account_id: vendorAccount.id } : {}),
  });
  const submission = await prisma.submission.create({
    data: { org_id: orgId, requirement_seat_id: seat.id, profile_id: profile.id, stage: 'closed', submitted_by: adminId },
  });
  return { vendorAccount, submission };
}

describe('vendor commission ledger — recruitment-sourcing payouts, master workspace only', () => {
  test('full create -> decide -> pay flow', async () => {
    const { org, admin, token } = await adminIn();
    const { vendorAccount, submission } = await closedVendorSubmission(org.id, admin.id, token);

    const eligible = await authed(request(app).get('/api/v1/vendor-commissions/eligible-submissions'), token);
    expect(eligible.status).toBe(200);
    expect(eligible.body.data.map((s) => s.id)).toContain(submission.id);

    const create = await authed(request(app).post('/api/v1/vendor-commissions'), token).send({
      submission_id: submission.id,
      amount: 25000,
      currency: 'INR',
    });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({ status: 'pending', vendor_account_id: vendorAccount.id, submission_id: submission.id });
    const commissionId = create.body.data.id;

    // Now that it has a commission, it drops out of the eligible list.
    const eligibleAfter = await authed(request(app).get('/api/v1/vendor-commissions/eligible-submissions'), token);
    expect(eligibleAfter.body.data.map((s) => s.id)).not.toContain(submission.id);

    const list = await authed(request(app).get('/api/v1/vendor-commissions'), token);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].vendor_account.id).toBe(vendorAccount.id);

    const payTooSoon = await authed(request(app).post(`/api/v1/vendor-commissions/${commissionId}/pay`), token);
    expect(payTooSoon.status).toBe(422);

    const decide = await authed(request(app).post(`/api/v1/vendor-commissions/${commissionId}/decision`), token).send({ status: 'approved' });
    expect(decide.status).toBe(200);
    expect(decide.body.data.status).toBe('approved');

    const decideAgain = await authed(request(app).post(`/api/v1/vendor-commissions/${commissionId}/decision`), token).send({ status: 'approved' });
    expect(decideAgain.status).toBe(409);

    const pay = await authed(request(app).post(`/api/v1/vendor-commissions/${commissionId}/pay`), token);
    expect(pay.status).toBe(200);
    expect(pay.body.data.status).toBe('paid');
    expect(pay.body.data.paid_at).toBeTruthy();
  });

  test('rejects a submission that is not closed yet', async () => {
    const { org, admin, token } = await adminIn();
    const { submission } = await closedVendorSubmission(org.id, admin.id, token);
    await prisma.submission.update({ where: { id: submission.id }, data: { stage: 'interview_scheduled' } });

    const res = await authed(request(app).post('/api/v1/vendor-commissions'), token).send({ submission_id: submission.id, amount: 1000 });
    expect(res.status).toBe(422);
  });

  test('rejects a submission whose candidate was not vendor-sourced', async () => {
    const { org, admin, token } = await adminIn();
    const { submission } = await closedVendorSubmission(org.id, admin.id, token, { profileSource: 'direct' });

    const res = await authed(request(app).post('/api/v1/vendor-commissions'), token).send({ submission_id: submission.id, amount: 1000 });
    expect(res.status).toBe(422);
  });

  test('rejects a second commission for the same submission', async () => {
    const { org, admin, token } = await adminIn();
    const { submission } = await closedVendorSubmission(org.id, admin.id, token);
    const first = await authed(request(app).post('/api/v1/vendor-commissions'), token).send({ submission_id: submission.id, amount: 1000 });
    expect(first.status).toBe(201);

    const second = await authed(request(app).post('/api/v1/vendor-commissions'), token).send({ submission_id: submission.id, amount: 1000 });
    expect(second.status).toBe(409);
  });

  test('a non-master workspace gets 403 on every route', async () => {
    const { token } = await adminIn({ is_master_workspace: false });
    expect((await authed(request(app).get('/api/v1/vendor-commissions'), token)).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/vendor-commissions/eligible-submissions'), token)).status).toBe(403);
    expect((await authed(request(app).post('/api/v1/vendor-commissions'), token).send({ submission_id: '00000000-0000-0000-0000-000000000000', amount: 1 })).status).toBe(403);
  });

  test('a non-admin role gets 403', async () => {
    const org = await createOrg();
    const recruiter = await createUser({ role: 'recruiter' });
    await createOrgMembership(recruiter.id, org.id, { role: 'recruiter' });
    const { access_token } = await loginAs(recruiter);
    const res = await authed(request(app).get('/api/v1/vendor-commissions'), access_token);
    expect(res.status).toBe(403);
  });

  test('another org cannot see or act on this org\'s commission', async () => {
    const { org, admin, token } = await adminIn();
    const { submission } = await closedVendorSubmission(org.id, admin.id, token);
    const created = await authed(request(app).post('/api/v1/vendor-commissions'), token).send({ submission_id: submission.id, amount: 1000 });

    const { token: otherToken } = await adminIn();
    const res = await authed(request(app).post(`/api/v1/vendor-commissions/${created.body.data.id}/decision`), otherToken).send({ status: 'approved' });
    expect(res.status).toBe(404);
  });
});
