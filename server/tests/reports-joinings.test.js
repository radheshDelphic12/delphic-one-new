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
let sourcerA;
let sourcerB;
let interviewerX;
let interviewerY;
let seatId;
let vendorAccountId;

const iso = (d) => d.toISOString().slice(0, 10);
const AUG = new Date('2026-08-15T00:00:00Z');
const SEP = new Date('2026-09-15T00:00:00Z');

async function mkProfile(over) {
  return prisma.profile.create({
    data: {
      name: unique('Cand '),
      total_experience_years: 5,
      primary_skills: ['Node.js'],
      source: 'direct',
      added_by: sourcerA.id,
      ...over,
    },
  });
}

async function mkClosedJoining(profileId, joinedAt) {
  const sub = await prisma.submission.create({
    data: { requirement_seat_id: seatId, profile_id: profileId, submitted_by: sourcerA.id, stage: 'closed', actual_joining_date: joinedAt },
  });
  return sub.id;
}

beforeEach(async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin' });
  const sales = await createUser({ role: 'sales' });
  const recruiter = await createUser({ role: 'recruiter' });
  sourcerA = await createUser({ role: 'recruiter', name: 'Sourcer A' });
  sourcerB = await createUser({ role: 'recruiter', name: 'Sourcer B' });
  interviewerX = await createUser({ role: 'recruiter', name: 'Ivy X' });
  interviewerY = await createUser({ role: 'recruiter', name: 'Omar Y' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));

  const account = await createActiveClientAccount(sales.id);
  const req = await createRequirement(salesToken, account.id);
  const seats = await authed(request(app).get(`/api/v1/requirements/${req.id}/seats`), salesToken);
  seatId = seats.body.data[0].id;

  const vendor = await prisma.account.create({
    data: { type: 'vendor', name: 'Acme Staffing', stage: 'active', owner_id: sales.id, origin_owner_id: sales.id },
  });
  vendorAccountId = vendor.id;

  // Aug: 1 direct joining sourced by A.  Sep: 1 direct (A) + 1 vendor (B).
  const pAug = await mkProfile();
  const pSepDirect = await mkProfile();
  const pSepVendor = await mkProfile({ added_by: sourcerB.id, source: 'vendor', vendor_account_id: vendorAccountId });

  const sAug = await mkClosedJoining(pAug.id, AUG);
  const sSep1 = await mkClosedJoining(pSepDirect.id, SEP);
  await mkClosedJoining(pSepVendor.id, SEP);

  // Aug joining: L1 with X+Y, L2 with X.  Sep direct joining: L1 with Y.
  await createInterviewRound(sAug, { round_type: 'internal_r1', interviewer_ids: [interviewerX.id, interviewerY.id] });
  await createInterviewRound(sAug, { round_type: 'internal_r2', interviewer_ids: [interviewerX.id] });
  await createInterviewRound(sSep1, { round_type: 'internal_r1', interviewer_ids: [interviewerY.id] });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const getJoinings = (token) =>
  authed(request(app).get('/api/v1/reports/joinings').query({ date_from: '2026-08-01', date_to: '2026-09-30' }), token);

const table = (body, key) => body.data.tables.find((t) => t.key === key);

describe('GET /reports/joinings', () => {
  test('admin + sales only', async () => {
    expect((await getJoinings(recruiterToken)).status).toBe(403);
    expect((await getJoinings(salesToken)).status).toBe(200);
    expect((await getJoinings(adminToken)).status).toBe(200);
  });

  test('by_sourcer groups joinings by month and sourcer', async () => {
    const rows = table((await getJoinings(adminToken)).body, 'by_sourcer').rows;
    const aug = rows.find((r) => r.month === 'Aug 2026' && r.sourcer === 'Sourcer A');
    const sepA = rows.find((r) => r.month === 'Sep 2026' && r.sourcer === 'Sourcer A');
    const sepB = rows.find((r) => r.month === 'Sep 2026' && r.sourcer === 'Sourcer B');
    expect(aug.joinings).toBe(1);
    expect(sepA.joinings).toBe(1);
    expect(sepB.joinings).toBe(1);
  });

  test('by_interviewer splits L1 / L2 and credits every linked interviewer', async () => {
    const rows = table((await getJoinings(adminToken)).body, 'by_interviewer').rows;
    const ivyAug = rows.find((r) => r.month === 'Aug 2026' && r.interviewer === 'Ivy X');
    const omarAug = rows.find((r) => r.month === 'Aug 2026' && r.interviewer === 'Omar Y');
    const omarSep = rows.find((r) => r.month === 'Sep 2026' && r.interviewer === 'Omar Y');
    expect(ivyAug).toMatchObject({ l1: 1, l2: 1, total: 2 });
    expect(omarAug).toMatchObject({ l1: 1, l2: 0, total: 1 });
    expect(omarSep).toMatchObject({ l1: 1, l2: 0, total: 1 });
  });

  test('by_vendor only counts vendor-sourced joinings', async () => {
    const rows = table((await getJoinings(adminToken)).body, 'by_vendor').rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ month: 'Sep 2026', vendor: 'Acme Staffing', joinings: 1 });
  });

  test('range excludes joinings outside it', async () => {
    const res = await authed(
      request(app).get('/api/v1/reports/joinings').query({ date_from: iso(SEP), date_to: '2026-09-30' }),
      adminToken
    );
    const rows = table(res.body, 'by_sourcer').rows;
    expect(rows.every((r) => r.month === 'Sep 2026')).toBe(true);
  });
});
