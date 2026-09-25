/**
 * The dashboard KPI tiles drill into the list pages with query params. These
 * cover the params that were added so a tile's click-through matches its count:
 *   accounts:     ?stuck=stuck, ?stage=<csv>
 *   submissions:  ?sales_owner_id=, ?joined_from=/joined_to=
 *   requirements: ?closed_from=/closed_to=
 */
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createRequirement,
  createProfile,
  authed,
  unique,
} = require('./helpers');

let adminToken;
let sales;
let salesToken;
let recruiter;
let recruiterToken;

beforeEach(async () => {
  await cleanDatabase();
  const admin = await createUser({ role: 'admin' });
  sales = await createUser({ role: 'sales' });
  recruiter = await createUser({ role: 'recruiter' });
  ({ access_token: adminToken } = await loginAs(admin));
  ({ access_token: salesToken } = await loginAs(sales));
  ({ access_token: recruiterToken } = await loginAs(recruiter));
});

afterAll(async () => {
  await prisma.$disconnect();
});

const daysAgo = (n) => new Date(Date.now() - n * 86400000);

async function mkAccount(over = {}) {
  return prisma.account.create({
    data: { type: 'client', name: unique('Acct '), stage: 'lead', owner_id: sales.id, origin_owner_id: sales.id, ...over },
  });
}

describe('accounts list — stuck + CSV stage', () => {
  test('?stuck=stuck returns only stale lead/meeting/rescheduled accounts', async () => {
    const staleLead = await mkAccount({ stage: 'lead', updated_at: daysAgo(10) });
    await mkAccount({ stage: 'meeting_scheduled', updated_at: daysAgo(9) }); // stale meeting
    await mkAccount({ stage: 'lead', updated_at: daysAgo(1) }); // fresh
    await mkAccount({ stage: 'active', updated_at: daysAgo(30) }); // active never counts

    const res = await authed(request(app).get('/api/v1/accounts').query({ stuck: 'stuck' }), adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.every((a) => ['lead', 'meeting_scheduled', 'rescheduled'].includes(a.stage))).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data.map((a) => a.id)).toContain(staleLead.id);
  });

  test('?stage=meeting_scheduled,rescheduled accepts a CSV of stages', async () => {
    await mkAccount({ stage: 'meeting_scheduled' });
    await mkAccount({ stage: 'rescheduled' });
    await mkAccount({ stage: 'lead' });

    const res = await authed(
      request(app).get('/api/v1/accounts').query({ stage: 'meeting_scheduled,rescheduled' }),
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data.every((a) => ['meeting_scheduled', 'rescheduled'].includes(a.stage))).toBe(true);
  });

  test('a bad stage CSV is rejected', async () => {
    const res = await authed(request(app).get('/api/v1/accounts').query({ stage: 'lead,nope' }), adminToken);
    expect(res.status).toBe(422);
  });
});

describe('submissions list — sales_owner_id + joined_from/to', () => {
  async function seatFor(ownerToken, accountId) {
    const req = await createRequirement(ownerToken, accountId);
    const seats = await authed(request(app).get(`/api/v1/requirements/${req.id}/seats`), ownerToken);
    return seats.body.data[0].id;
  }

  test('?sales_owner_id scopes to submissions on that owner’s requirements', async () => {
    const otherSales = await createUser({ role: 'sales' });
    const { access_token: otherToken } = await loginAs(otherSales);
    const acctA = await prisma.account.create({ data: { type: 'client', name: unique('A '), stage: 'active', owner_id: sales.id, origin_owner_id: sales.id } });
    const acctB = await prisma.account.create({ data: { type: 'client', name: unique('B '), stage: 'active', owner_id: otherSales.id, origin_owner_id: otherSales.id } });
    const seatA = await seatFor(salesToken, acctA.id);
    const seatB = await seatFor(otherToken, acctB.id);
    const p = await createProfile(recruiterToken);
    const p2 = await createProfile(recruiterToken);
    await prisma.submission.create({ data: { requirement_seat_id: seatA, profile_id: p.id, submitted_by: recruiter.id, stage: 'sourced' } });
    await prisma.submission.create({ data: { requirement_seat_id: seatB, profile_id: p2.id, submitted_by: recruiter.id, stage: 'sourced' } });

    const res = await authed(request(app).get('/api/v1/submissions').query({ sales_owner_id: sales.id }), adminToken);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
  });

  test('?joined_from / ?joined_to window actual_joining_date', async () => {
    const acct = await prisma.account.create({ data: { type: 'client', name: unique('C '), stage: 'active', owner_id: sales.id, origin_owner_id: sales.id } });
    const seat = await seatFor(salesToken, acct.id);
    const pEarly = await createProfile(recruiterToken);
    const pLate = await createProfile(recruiterToken);
    await prisma.submission.create({ data: { requirement_seat_id: seat, profile_id: pEarly.id, submitted_by: recruiter.id, stage: 'closed', actual_joining_date: daysAgo(40) } });
    await prisma.submission.create({ data: { requirement_seat_id: seat, profile_id: pLate.id, submitted_by: recruiter.id, stage: 'closed', actual_joining_date: daysAgo(3) } });

    const res = await authed(
      request(app).get('/api/v1/submissions').query({ stage: 'closed', joined_from: daysAgo(10).toISOString() }),
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(new Date(res.body.data[0].actual_joining_date).getTime()).toBeGreaterThan(daysAgo(10).getTime());
  });
});

describe('requirements list — closed_from/to', () => {
  test('?closed_from windows closed_at', async () => {
    const acct = await prisma.account.create({ data: { type: 'client', name: unique('D '), stage: 'active', owner_id: sales.id, origin_owner_id: sales.id } });
    const rOld = await createRequirement(salesToken, acct.id);
    const rNew = await createRequirement(salesToken, acct.id);
    await prisma.requirement.update({ where: { id: rOld.id }, data: { status: 'closed', closed_at: daysAgo(40) } });
    await prisma.requirement.update({ where: { id: rNew.id }, data: { status: 'closed', closed_at: daysAgo(2) } });

    const res = await authed(
      request(app).get('/api/v1/requirements').query({ status: 'closed', closed_from: daysAgo(10).toISOString() }),
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].id).toBe(rNew.id);
  });
});
