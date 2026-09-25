/**
 * Usage-shaped API coverage for RD-107 / RD-108 frontend flows:
 * create submission (put forward) → detail + history → PATCH commercials/BGV.
 */
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
  requirement = await createRequirement(salesToken, account.id, { seats_total: 1 });
  const seats = await authed(request(app).get(`/api/v1/requirements/${requirement.id}/seats`), salesToken);
  seatId = seats.body.data[0].id;
  profile = await createProfile(recruiterToken, { source: 'direct' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('RD-108 put candidate forward (create API)', () => {
  test('recruiter creates submission with rates and computed margin', async () => {
    const res = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seatId,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_type: 'monthly',
      proposed_rate_currency: 'INR',
      vendor_rate: 70,
      vendor_rate_type: 'monthly',
      vendor_rate_currency: 'INR',
      relevancy_score: 8,
      submission_notes: 'Strong fit',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.stage).toBe('sourced');
    expect(Number(res.body.data.margin)).toBe(30);
    expect(Number(res.body.data.margin_percentage)).toBe(30);
    expect(res.body.data.profile.name).toBe(profile.name);
    expect(res.body.data.requirement.title).toBe(requirement.title);
    expect(res.body.data.seat.id).toBe(seatId);
  });

  test('vendor profile requires vendor_rate', async () => {
    const vendorAccount = await prisma.account.create({
      data: { type: 'vendor', name: 'Vendor Co', stage: 'active', owner_id: (await prisma.user.findFirst({ where: { role: 'sales' } })).id },
    });
    const vendorProfile = await createProfile(recruiterToken, {
      source: 'vendor',
      vendor_account_id: vendorAccount.id,
    });
    const missing = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seatId,
      profile_id: vendorProfile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'INR',
    });
    expect(missing.status).toBeGreaterThanOrEqual(400);

    const ok = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seatId,
      profile_id: vendorProfile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'INR',
      vendor_rate: 60,
      vendor_rate_currency: 'INR',
    });
    expect(ok.status).toBe(201);
  });

  test('sales cannot create submissions', async () => {
    const res = await authed(request(app).post('/api/v1/submissions'), salesToken).send({
      requirement_seat_id: seatId,
      profile_id: profile.id,
      proposed_rate: 100,
      vendor_rate: 70,
    });
    expect(res.status).toBe(403);
  });
});

describe('RD-107 submission detail data (API)', () => {
  test('getOne returns nested candidate, job, seat; history is readable', async () => {
    const created = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seatId,
      profile_id: profile.id,
      proposed_rate: 120,
      proposed_rate_currency: 'INR',
      vendor_rate: 90,
      vendor_rate_currency: 'INR',
    });
    const id = created.body.data.id;

    const detail = await authed(request(app).get(`/api/v1/submissions/${id}`), recruiterToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data.profile.id).toBe(profile.id);
    expect(detail.body.data.requirement.id).toBe(requirement.id);
    expect(detail.body.data.seat.id).toBe(seatId);
    expect(Array.isArray(detail.body.data.interview_rounds)).toBe(true);

    const history = await authed(request(app).get(`/api/v1/submissions/${id}/history`), recruiterToken);
    expect(history.status).toBe(200);
    expect(Array.isArray(history.body.data)).toBe(true);
  });

  test('recruiter can PATCH commercials and BGV fields used on detail page', async () => {
    const created = await authed(request(app).post('/api/v1/submissions'), recruiterToken).send({
      requirement_seat_id: seatId,
      profile_id: profile.id,
      proposed_rate: 100,
      proposed_rate_currency: 'INR',
      vendor_rate: 70,
      vendor_rate_currency: 'INR',
    });
    const id = created.body.data.id;

    const patch = await authed(request(app).patch(`/api/v1/submissions/${id}`), recruiterToken).send({
      proposed_rate: 110,
      vendor_rate: 75,
      proposed_rate_currency: 'INR',
      vendor_rate_currency: 'INR',
      bgv_status: 'in_progress',
      bgv_notes: 'Docs requested',
      offer_ctc: 1500000,
      offer_ctc_currency: 'INR',
    });

    expect(patch.status).toBe(200);
    expect(Number(patch.body.data.proposed_rate)).toBe(110);
    expect(Number(patch.body.data.margin)).toBe(35);
    expect(patch.body.data.bgv_status).toBe('in_progress');
    expect(patch.body.data.bgv_notes).toBe('Docs requested');
  });
});
