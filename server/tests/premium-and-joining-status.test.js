// Premium customers show and filter on requirements, the requirement board and the candidate list; a closed candidate is "joining date
// pending" until the actual joining date is entered; and that date can be cleared again.
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let token; let admin; let premiumReq; let plainReq; let subSet; let subPending;
const get = (p, q) => authed(request(app).get(`/api/v1${p}`).query(q || {}), token);
const patch = (p, b) => authed(request(app).patch(`/api/v1${p}`), token).send(b);

async function candidate(name) {
  const res = await authed(request(app).post('/api/v1/profiles'), token).send({ name, total_experience_years: 3, primary_skills: ['Java'], source: 'direct', email: `${name.replace(/\s/g, '').toLowerCase()}@x.com` });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

beforeAll(async () => {
  await cleanDatabase();
  admin = await createUser({ role: 'admin' });
  ({ access_token: token } = await loginAs(admin));
  const mkAccount = (name, is_premium) => prisma.account.create({ data: { name, type: 'client', stage: 'active', owner_id: admin.id, origin_owner_id: admin.id, is_premium } });
  const premium = await mkAccount('Premium Client', true);
  const plain = await mkAccount('Plain Client', false);
  const mkReq = (account, title) => prisma.requirement.create({ data: { account_id: account.id, title, req_type: 'recruitment', sales_owner_id: admin.id } });
  premiumReq = await mkReq(premium, 'Premium Req');
  plainReq = await mkReq(plain, 'Plain Req');
  const mkSub = async (req, name, extra) => {
    const seat = await prisma.requirementSeat.create({ data: { requirement_id: req.id, seat_status: 'closed', closed_at: new Date() } });
    return prisma.submission.create({ data: { requirement_seat_id: seat.id, profile_id: await candidate(name), stage: 'closed', is_locked: true, submitted_by: admin.id, ...extra } });
  };
  subSet = await mkSub(premiumReq, 'Joined Person', { actual_joining_date: new Date('2026-10-05') });
  subPending = await mkSub(plainReq, 'Pending Person', {});
}, 180000);
afterAll(async () => { await prisma.$disconnect(); });

describe('premium customer on requirements, the board and candidates', () => {
  test('requirements list: the account carries is_premium and premium=yes / no filters on it', async () => {
    const all = await get('/requirements', { limit: 50 });
    expect(all.body.data.map((r) => [r.title, r.account.is_premium]).sort()).toEqual([['Plain Req', false], ['Premium Req', true]]);
    expect((await get('/requirements', { premium: 'yes' })).body.data.map((r) => r.title)).toEqual(['Premium Req']);
    expect((await get('/requirements', { premium: 'no' })).body.data.map((r) => r.title)).toEqual(['Plain Req']);
    expect((await get('/requirements', { premium: 'maybe' })).status).toBe(422);
  });

  test('requirement board and matrix: same flag and filter', async () => {
    const board = await get('/pipeline/board', {});
    expect(board.status).toBe(200);
    expect(JSON.stringify(board.body)).toContain('"is_premium":true');
    const yes = await get('/pipeline/board', { premium: 'yes' });
    expect(JSON.stringify(yes.body)).toContain('Premium Req');
    expect(JSON.stringify(yes.body)).not.toContain('Plain Req');
    expect(JSON.stringify((await get('/pipeline/board', { premium: 'no' })).body)).not.toContain('Premium Req');
  });

  test('candidate list: the requirement carries account_is_premium and the premium filter works', async () => {
    const all = await get('/submissions', { limit: 50 });
    expect(all.body.data.map((s) => [s.profile.name, s.requirement.account_is_premium]).sort()).toEqual([['Joined Person', true], ['Pending Person', false]]);
    expect((await get('/submissions', { premium: 'yes' })).body.data.map((s) => s.profile.name)).toEqual(['Joined Person']);
    expect((await get('/submissions', { premium: 'no' })).body.data.map((s) => s.profile.name)).toEqual(['Pending Person']);
  });
});

describe('joining status of a closed candidate', () => {
  test('pending until the actual joining date is entered; filterable', async () => {
    const all = await get('/submissions', { limit: 50 });
    const status = Object.fromEntries(all.body.data.map((s) => [s.profile.name, s.joining_status]));
    expect(status).toEqual({ 'Joined Person': 'set', 'Pending Person': 'pending' });
    expect((await get('/submissions', { joining: 'pending' })).body.data.map((s) => s.profile.name)).toEqual(['Pending Person']);
    expect((await get('/submissions', { joining: 'set' })).body.data.map((s) => s.profile.name)).toEqual(['Joined Person']);
    expect((await get('/submissions', { joining: 'soon' })).status).toBe(422);
  });

  test('a candidate that is not closed has no joining status', async () => {
    const seat = await prisma.requirementSeat.create({ data: { requirement_id: premiumReq.id } });
    const open = await prisma.submission.create({ data: { requirement_seat_id: seat.id, profile_id: await candidate('Open Person'), stage: 'internal_screening', submitted_by: admin.id } });
    expect((await get(`/submissions/${open.id}`)).body.data.joining_status).toBeNull();
  });

  test('the joining date can be entered, cleared and entered again; a missing field leaves it alone', async () => {
    const id = subPending.id;
    const set = await patch(`/submissions/${id}`, { actual_joining_date: '2026-10-12' });
    expect(set.status).toBe(200);
    expect(set.body.data.joining_status).toBe('set');
    expect(String(set.body.data.actual_joining_date).slice(0, 10)).toBe('2026-10-12');

    
    const cleared = await patch(`/submissions/${id}`, { actual_joining_date: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.actual_joining_date).toBeNull();
    expect(cleared.body.data.joining_status).toBe('pending');
    expect((await prisma.requirementSeat.findUnique({ where: { id: subPending.requirement_seat_id } })).joined_at).toBeNull();

    await patch(`/submissions/${id}`, { actual_joining_date: '2026-10-20' });
    const blank = await patch(`/submissions/${id}`, { actual_joining_date: '' });
    expect(blank.body.data.actual_joining_date).toBeNull();
    expect((await patch(`/submissions/${id}`, { actual_joining_date: 'not a date' })).status).toBe(422);
  });

  test('entering the date keeps the seat in step', async () => {
    await patch(`/submissions/${subSet.id}`, { actual_joining_date: '2026-11-03' });
    expect(String((await prisma.requirementSeat.findUnique({ where: { id: subSet.requirement_seat_id } })).joined_at).slice(0, 15)).toContain('Nov 03 2026');
  });
});

describe('the lock on a closed candidate', () => {
  test('anyone allowed to edit it may still enter or clear the joining date, but nothing else', async () => {
    // the test admin is not a superadmin, and the closed ticket is locked
    const onlyDate = await patch(`/submissions/${subPending.id}`, { actual_joining_date: '2026-10-25' });
    expect(onlyDate.status).toBe(200);
    expect((await patch(`/submissions/${subPending.id}`, { actual_joining_date: null })).status).toBe(200);
    expect((await patch(`/submissions/${subPending.id}`, { submission_notes: 'x' })).status).toBe(403);
    expect((await patch(`/submissions/${subPending.id}`, { actual_joining_date: '2026-10-25', submission_notes: 'x' })).status).toBe(403);
    expect((await patch(`/submissions/${subPending.id}`, {})).status).toBe(403);
  });
});
