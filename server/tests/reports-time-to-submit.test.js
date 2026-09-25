const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createActiveClientAccount,
  createRequirement,
  createInterviewRound,
  authed,
  unique,
} = require('./helpers');

let adminToken;
let salesToken;
let recruiterToken;
let recruiter;
let seatId;
let reqId;

const DAY = 24 * 3600 * 1000;

async function mkProfile() {
  return prisma.profile.create({
    data: { name: unique('Cand '), total_experience_years: 4, primary_skills: ['Node.js'], source: 'direct', added_by: recruiter.id },
  });
}

beforeEach(async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin' });
  const sales = await createUser({ role: 'sales' });
  recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));

  const account = await createActiveClientAccount(sales.id);
  const req = await createRequirement(salesToken, account.id);
  reqId = req.id;
  // Backdate the requirement so every "requirement created -> …" span is positive
  // for the backdated submissions the tests seed.
  await prisma.requirement.update({ where: { id: reqId }, data: { created_at: new Date(Date.now() - 30 * DAY) } });
  const seats = await authed(request(app).get(`/api/v1/requirements/${req.id}/seats`), salesToken);
  seatId = seats.body.data[0].id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const getTts = (token) =>
  authed(
    request(app).get('/api/v1/reports/time-to-submit').query({ date_from: '2020-01-01', date_to: '2100-01-01' }),
    token
  );

describe('GET /reports/time-to-submit', () => {
  test('admin + sales only', async () => {
    expect((await getTts(recruiterToken)).status).toBe(403);
    expect((await getTts(salesToken)).status).toBe(200);
    expect((await getTts(adminToken)).status).toBe(200);
  });

  test('durations are all measured from requirement creation', async () => {
    const p = await mkProfile();
    // requirement was created 30d ago (see beforeEach)
    const created = new Date(Date.now() - 20 * DAY); // submission created 20d after the requirement
    const sub = await prisma.submission.create({
      data: { requirement_seat_id: seatId, profile_id: p.id, submitted_by: recruiter.id, stage: 'submitted_to_client', created_at: created },
    });
    await createInterviewRound(sub.id, { round_type: 'internal_r1', scheduled_at: new Date(Date.now() - 12 * DAY) }); // R1 ~18d after req
    await prisma.stageHistory.create({
      data: {
        entity_type: 'submission',
        entity_id: sub.id,
        from_stage: 'internal_screening',
        to_stage: 'submitted_to_client',
        changed_by: recruiter.id,
        changed_at: new Date(Date.now() - 4 * DAY), // submitted ~26d after req
      },
    });

    const row = (await getTts(adminToken)).body.data.rows.find((r) => r.candidate === p.name);
    // req(30d ago) -> submission(20d ago) ~= 10d ; -> R1(12d ago) ~= 18d ; -> submitted(4d ago) ~= 26d
    expect(row.req_to_submission.ms).toBeGreaterThan(9 * DAY);
    expect(row.req_to_r1.ms).toBeGreaterThan(16 * DAY);
    expect(row.req_to_submitted.ms).toBeGreaterThan(24 * DAY);
    // each successive span is longer (same anchor, later end)
    expect(row.req_to_r1.ms).toBeGreaterThan(row.req_to_submission.ms);
    expect(row.req_to_submitted.ms).toBeGreaterThan(row.req_to_r1.ms);
    // hover bounds carried on every cell
    expect(row.req_to_submission.from).toBe(row.requirement_created_at);
    expect(row.req_to_r1.to).toEqual(expect.any(String));
    expect(row.sourcer).toBe(recruiter.name);
  });

  test('reports candidate type and vendor name', async () => {
    const vendorAcc = await prisma.account.create({
      data: { name: `V ${Date.now()}`, type: 'vendor', stage: 'active', owner_id: recruiter.id, origin_owner_id: recruiter.id },
    });
    const benchP = await prisma.profile.create({
      data: { name: 'Bench Person', total_experience_years: 2, primary_skills: ['x'], source: 'direct', added_by: recruiter.id },
    });
    const vendorP = await prisma.profile.create({
      data: { name: 'Vendor Person', total_experience_years: 2, primary_skills: ['x'], source: 'vendor', added_by: recruiter.id, vendor_account_id: vendorAcc.id },
    });
    await prisma.submission.create({ data: { requirement_seat_id: seatId, profile_id: benchP.id, submitted_by: recruiter.id, stage: 'sourced' } });
    await prisma.submission.create({ data: { requirement_seat_id: seatId, profile_id: vendorP.id, submitted_by: recruiter.id, stage: 'sourced' } });

    const rows = (await getTts(adminToken)).body.data.rows;
    const bench = rows.find((r) => r.candidate === 'Bench Person');
    const vend = rows.find((r) => r.candidate === 'Vendor Person');
    expect(bench.type).toBe('Bench');
    expect(bench.vendor_name).toBe('—');
    expect(vend.type).toBe('Vendor');
    expect(vend.vendor_name).toBe(vendorAcc.name);
  });

  test('filters by sourcer, client, requirement and candidate search', async () => {
    const other = await createUser({ role: 'recruiter', name: 'Other Rec' });
    const pMine = await prisma.profile.create({
      data: { name: 'Alpha Candidate', total_experience_years: 3, primary_skills: ['x'], source: 'direct', added_by: recruiter.id },
    });
    const pOther = await prisma.profile.create({
      data: { name: 'Beta Candidate', total_experience_years: 3, primary_skills: ['x'], source: 'direct', added_by: other.id },
    });
    await prisma.submission.create({ data: { requirement_seat_id: seatId, profile_id: pMine.id, submitted_by: recruiter.id, stage: 'sourced' } });
    await prisma.submission.create({ data: { requirement_seat_id: seatId, profile_id: pOther.id, submitted_by: other.id, stage: 'sourced' } });

    const bySourcer = await authed(
      request(app).get('/api/v1/reports/time-to-submit').query({ date_from: '2020-01-01', date_to: '2100-01-01', sourcer_id: recruiter.id }),
      adminToken
    );
    expect(bySourcer.body.data.rows.every((r) => r.sourcer === recruiter.name)).toBe(true);
    expect(bySourcer.body.data.rows.some((r) => r.candidate === 'Beta Candidate')).toBe(false);

    const bySearch = await authed(
      request(app).get('/api/v1/reports/time-to-submit').query({ date_from: '2020-01-01', date_to: '2100-01-01', search: 'alpha' }),
      adminToken
    );
    expect(bySearch.body.data.rows.map((r) => r.candidate)).toEqual(['Alpha Candidate']);
  });

  test('an in-flight submission shows blanks for unreached stages', async () => {
    const p = await mkProfile();
    const sub = await prisma.submission.create({
      data: { requirement_seat_id: seatId, profile_id: p.id, submitted_by: recruiter.id, stage: 'sourced' },
    });

    const row = (await getTts(adminToken)).body.data.rows.find((r) => r.id === sub.id);
    expect(row.req_to_r1).toMatchObject({ ms: null, label: null });
    expect(row.req_to_submitted).toMatchObject({ ms: null, label: null });
    // requirement created -> submission created is always known
    expect(row.req_to_submission.ms).not.toBeNull();
  });

  test('date range filters on submission.created_at', async () => {
    const p = await mkProfile();
    const old = new Date('2019-06-01T00:00:00Z');
    await prisma.submission.create({
      data: { requirement_seat_id: seatId, profile_id: p.id, submitted_by: recruiter.id, stage: 'sourced', created_at: old },
    });
    const res = await authed(
      request(app).get('/api/v1/reports/time-to-submit').query({ date_from: '2025-01-01', date_to: '2100-01-01' }),
      adminToken
    );
    expect(res.body.data.rows.some((r) => r.candidate === p.name)).toBe(false);
  });
});
