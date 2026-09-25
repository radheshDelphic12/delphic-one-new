const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createActiveClientAccount,
  createRequirement,
  createProfile,
  authed,
} = require('./helpers');

let salesToken;
let recruiterToken;
let account;
let requirement;
let seatId;
let profile;

beforeEach(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  account = await createActiveClientAccount(sales.id);
  requirement = await createRequirement(salesToken, account.id);
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
  seatId = seats.body.data[0].id;
  profile = await createProfile(recruiterToken);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createSubmission(overrides = {}) {
  const res = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
    requirement_seat_id: seatId,
    profile_id: profile.id,
    proposed_rate: 100,
    proposed_rate_currency: 'USD',
    vendor_rate: 70,
    vendor_rate_currency: 'USD',
    ...overrides,
  });
  if (res.status !== 201) {
    throw new Error(`create submission failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

async function advanceTo(submissionId, stages) {
  for (const to_stage of stages) {
    const res = await authed(request(app).post(`/api/v1/submissions/${submissionId}/stage`), recruiterToken).send({
      to_stage,
    });
    if (res.status !== 200) {
      throw new Error(`advance to ${to_stage} failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }
}

describe('submission create + margin', () => {
  test('new submissions start as sourced and compute margin', async () => {
    const sub = await createSubmission();
    expect(sub.stage).toBe('sourced');
    expect(Number(sub.margin)).toBe(30);
    expect(Number(sub.margin_percentage)).toBe(30);
  });

  test('vendor-sourced profiles require a vendor_rate', async () => {
    const vendorAccount = await prisma.account.create({
      data: { type: 'vendor', name: 'Vendor Co', stage: 'active', owner_id: (await createUser({ role: 'bda' })).id },
    });
    const vendorProfile = await createProfile(recruiterToken, {
      source: 'vendor',
      vendor_account_id: vendorAccount.id,
    });

    const missing = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seatId,
      profile_id: vendorProfile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'USD',
    });
    expect(missing.status).toBe(400);

    const ok = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seatId,
      profile_id: vendorProfile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'USD',
      vendor_rate: 60,
      vendor_rate_currency: 'USD',
    });
    expect(ok.status).toBe(201);
    expect(Number(ok.body.data.margin)).toBe(40);
  });

  test('duplicate active submission for same profile+seat is rejected', async () => {
    await createSubmission();
    const dup = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seatId,
      profile_id: profile.id,
      proposed_rate: 90,
      proposed_rate_currency: 'USD',
    });
    expect(dup.status).toBe(400);
  });
});

describe('sales may only put forward bench candidates', () => {
  test('sales can create a submission for a bench candidate', async () => {
    const benchProfile = await createProfile(recruiterToken, { on_bench: true });
    const res = await authed(request(app).post('/api/v1/submissions'), salesToken).send({
      requirement_seat_id: seatId,
      profile_id: benchProfile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'USD',
    });
    expect(res.status).toBe(201);
  });

  test('sales is blocked from an off-bench candidate', async () => {
    // `profile` (from beforeEach) is source=direct with the on_bench default (false).
    const res = await authed(request(app).post('/api/v1/submissions'), salesToken).send({
      requirement_seat_id: seatId,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'USD',
    });
    expect(res.status).toBe(403);
  });

  test('sales is blocked from a vendor-sourced candidate', async () => {
    const vendorAccount = await prisma.account.create({
      data: { type: 'vendor', name: 'Vendor Co', stage: 'active', owner_id: (await createUser({ role: 'bda' })).id },
    });
    const vendorProfile = await createProfile(recruiterToken, { source: 'vendor', vendor_account_id: vendorAccount.id });
    const res = await authed(request(app).post('/api/v1/submissions'), salesToken).send({
      requirement_seat_id: seatId,
      profile_id: vendorProfile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'USD',
      vendor_rate: 60,
      vendor_rate_currency: 'USD',
    });
    expect(res.status).toBe(403);
  });

  test('recruiter and admin are unaffected — off-bench candidates still work for them', async () => {
    const admin = await createUser({ role: 'admin' });
    const { access_token: adminToken } = await loginAs(admin);
    const asAdmin = await authed(request(app).post('/api/v1/submissions'), adminToken).send({
      requirement_seat_id: seatId,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'USD',
    });
    expect(asAdmin.status).toBe(201);
  });
});

describe('submission stage machine', () => {
  test('cannot skip from sourced straight to offer', async () => {
    const sub = await createSubmission();
    const res = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'offer_sent',
    });
    expect(res.status).toBe(400);
  });

  test('backout and rejection require a reason', async () => {
    const sub = await createSubmission();

    const backoutMissing = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'backout',
    });
    expect(backoutMissing.status).toBe(400);

    const rejectMissing = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'rejected',
    });
    expect(rejectMissing.status).toBe(400);

    const rejected = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'rejected',
      rejection_reason: 'skills mismatch',
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.stage).toBe('rejected');
    expect(rejected.body.data.rejection_reason).toBe('skills mismatch');
  });

  test('cannot advance to offer while interview rounds are unresolved', async () => {
    const sub = await createSubmission();
    await advanceTo(sub.id, ['internal_screening', 'submitted_to_client']);

    // no rounds yet — offer is blocked
    const noRounds = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'offer_sent',
    });
    // still at submitted_to_client; offer isn't a valid next stage either, but once we reach interview_result the gate matters
    expect(noRounds.status).toBe(400);

    const round = await authed(request(app).post(`/api/v1/submissions/${sub.id}/interview-rounds`), recruiterToken).send({
      round_type: 'client_r1',
      round_name: 'L1',
      scheduled_at: new Date().toISOString(),
    });
    expect(round.status).toBe(201);

    // adding a round from submitted_to_client auto-moves to interview_scheduled
    const afterRound = await authed(request(app).get(`/api/v1/submissions/${sub.id}`), recruiterToken);
    expect(afterRound.body.data.stage).toBe('interview_scheduled');

    // interview_scheduled → interview_result is a manual move, allowed even with pending rounds
    const pendingOffer = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'interview_result',
    });
    // interview_scheduled → interview_result is allowed by the machine even with pending rounds
    expect(pendingOffer.status).toBe(200);

    const blocked = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'offer_sent',
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/round/i);

    await authed(request(app).patch(`/api/v1/interview-rounds/${round.body.data.id}`), recruiterToken).send({
      result: 'pass',
      rating: 8,
    });

    const offer = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'offer_sent',
    });
    expect(offer.status).toBe(200);
    expect(offer.body.data.stage).toBe('offer_sent');
  });

  test('cannot close without bgv_status cleared; full happy path locks on close', async () => {
    const sub = await createSubmission();
    await advanceTo(sub.id, ['internal_screening', 'submitted_to_client']);

    const round = await authed(request(app).post(`/api/v1/submissions/${sub.id}/interview-rounds`), recruiterToken).send({
      round_type: 'client_r1',
      scheduled_at: new Date().toISOString(),
    });
    await authed(request(app).patch(`/api/v1/interview-rounds/${round.body.data.id}`), recruiterToken).send({
      result: 'pass',
    });
    // interview_scheduled -> interview_result is a manual move (round results never auto-advance)
    await advanceTo(sub.id, ['interview_result', 'offer_sent', 'bgv']);

    const blocked = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'closed',
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/bgv/i);

    await authed(request(app).patch(`/api/v1/submissions/${sub.id}`), recruiterToken).send({
      bgv_status: 'cleared',
      actual_joining_date: new Date().toISOString(),
    });

    const closed = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'closed',
    });
    expect(closed.status).toBe(200);
    expect(closed.body.data.stage).toBe('closed');
    expect(closed.body.data.is_locked).toBe(true);

    // closing a submission also closes its seat
    const seat = await prisma.requirementSeat.findUnique({ where: { id: seatId } });
    expect(seat.seat_status).toBe('closed');
    expect(seat.is_locked).toBe(true);

    const history = await authed(request(app).get(`/api/v1/submissions/${sub.id}/history`), recruiterToken);
    expect(history.status).toBe(200);
    expect(history.body.data.map((h) => h.to_stage)).toEqual([
      'internal_screening',
      'submitted_to_client',
      'interview_scheduled',
      'interview_result',
      'offer_sent',
      'bgv',
      'closed',
    ]);
    expect(history.body.data.every((h) => h.changed_by?.name)).toBe(true);
  });

  test('admin may step back with a reason; recruiter may not', async () => {
    const admin = await createUser({ role: 'admin' });
    const { access_token: adminToken } = await loginAs(admin);
    const sub = await createSubmission();
    await advanceTo(sub.id, ['internal_screening', 'submitted_to_client']);
    const round = await authed(request(app).post(`/api/v1/submissions/${sub.id}/interview-rounds`), recruiterToken).send({
      round_type: 'client_r1',
      scheduled_at: new Date().toISOString(),
    });
    expect(round.status).toBe(201);

    const denied = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'submitted_to_client',
      reason: 'mis-click',
    });
    expect(denied.status).toBe(403);

    const missingReason = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), adminToken).send({
      to_stage: 'submitted_to_client',
    });
    expect(missingReason.status).toBe(400);

    const ok = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), adminToken).send({
      to_stage: 'submitted_to_client',
      reason: 'accidental interview stage',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.stage).toBe('submitted_to_client');

    const history = await authed(request(app).get(`/api/v1/submissions/${sub.id}/history`), adminToken);
    const last = history.body.data[history.body.data.length - 1];
    expect(last.to_stage).toBe('submitted_to_client');
    expect(last.reason).toBe('accidental interview stage');
    expect(last.changed_by?.name).toBeTruthy();
  });

  test('admin can reactivate a rejected submission on the same ticket', async () => {
    const admin = await createUser({ role: 'admin' });
    const { access_token: adminToken } = await loginAs(admin);
    const sub = await createSubmission();
    await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'rejected',
      rejection_reason: 'skills mismatch',
    });

    const reactivated = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), adminToken).send({
      to_stage: 'sourced',
      reason: 'retry after coaching',
    });
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.data.stage).toBe('sourced');
    expect(reactivated.body.data.rejection_reason).toBeNull();
    expect(reactivated.body.data.rejection_stage).toBeNull();
  });

  test('resolving all rounds does NOT auto-advance; interview_scheduled -> interview_result stays manual', async () => {
    const sub = await createSubmission();
    await advanceTo(sub.id, ['internal_screening', 'submitted_to_client']);

    const round = await authed(request(app).post(`/api/v1/submissions/${sub.id}/interview-rounds`), recruiterToken).send({
      round_type: 'hr_cto_ceo',
      scheduled_at: new Date().toISOString(),
    });
    expect(round.status).toBe(201);

    let current = await authed(request(app).get(`/api/v1/submissions/${sub.id}`), recruiterToken);
    expect(current.body.data.stage).toBe('interview_scheduled');

    await authed(request(app).patch(`/api/v1/interview-rounds/${round.body.data.id}`), recruiterToken).send({
      result: 'pass',
    });

    // Recording the result must not move the submission on its own.
    current = await authed(request(app).get(`/api/v1/submissions/${sub.id}`), recruiterToken);
    expect(current.body.data.stage).toBe('interview_scheduled');

    // Only an explicit stage move advances it.
    const moved = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), recruiterToken).send({
      to_stage: 'interview_result',
    });
    expect(moved.status).toBe(200);
    expect(moved.body.data.stage).toBe('interview_result');
  });
});

describe('sales stage permissions', () => {
  test('sales can do any forward transition, on any submission (not just their own requirement)', async () => {
    // A requirement owned by a different sales user.
    const otherSales = await createUser({ role: 'sales' });
    const { access_token: otherSalesToken } = await loginAs(otherSales);
    const otherAccount = await createActiveClientAccount(otherSales.id);
    const otherReq = await createRequirement(otherSalesToken, otherAccount.id);
    const otherSeats = await authed(request(app).get(`/api/v1/requirements/${otherReq.id}/seats`), otherSalesToken);
    const sub = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: otherSeats.body.data[0].id,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'USD',
      vendor_rate: 70,
      vendor_rate_currency: 'USD',
    });
    expect(sub.status).toBe(201);

    // our salesToken user owns neither the requirement nor the account
    const toScreening = await authed(request(app).post(`/api/v1/submissions/${sub.body.data.id}/stage`), salesToken).send({
      to_stage: 'internal_screening',
    });
    expect(toScreening.status).toBe(200);

    const toClient = await authed(request(app).post(`/api/v1/submissions/${sub.body.data.id}/stage`), salesToken).send({
      to_stage: 'submitted_to_client',
    });
    expect(toClient.status).toBe(200);
    expect(toClient.body.data.stage).toBe('submitted_to_client');
  });

  test('sales can reject / backout, and the reason is still required', async () => {
    const sub = await createSubmission();
    const rejected = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), salesToken).send({
      to_stage: 'rejected',
      rejection_reason: 'client passed',
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.stage).toBe('rejected');

    const sub2 = await createSubmission({ profile_id: (await createProfile(recruiterToken)).id });
    const missingReason = await authed(request(app).post(`/api/v1/submissions/${sub2.id}/stage`), salesToken).send({
      to_stage: 'backout',
    });
    expect(missingReason.status).toBe(400);

    const backedOut = await authed(request(app).post(`/api/v1/submissions/${sub2.id}/stage`), salesToken).send({
      to_stage: 'backout',
      backout_reason: 'candidate withdrew',
    });
    expect(backedOut.status).toBe(200);
    expect(backedOut.body.data.stage).toBe('backout');
  });

  test('sales still cannot step a submission backward', async () => {
    const sub = await createSubmission();
    await advanceTo(sub.id, ['internal_screening', 'submitted_to_client']);
    const back = await authed(request(app).post(`/api/v1/submissions/${sub.id}/stage`), salesToken).send({
      to_stage: 'internal_screening',
      reason: 'oops',
    });
    expect(back.status).toBe(403);
  });
});
