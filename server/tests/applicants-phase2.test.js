// Applicants flow: claim without a Profile, "Create profile", unlink, soft delete, the new filters and the database-level
// one-application-per-email rule.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');

let sToken;
let r1;
let r1Token;
let r2Token;
let adminToken;
let reqA;
let reqB;

beforeEach(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  ({ access_token: sToken } = await loginAs(sales));
  r1 = await createUser({ role: 'recruiter', name: 'Rec One' });
  const r2 = await createUser({ role: 'recruiter', name: 'Rec Two' });
  ({ access_token: r1Token } = await loginAs(r1));
  ({ access_token: r2Token } = await loginAs(r2));
  ({ access_token: adminToken } = await loginAs(await createUser({ role: 'admin' })));
  const account = await createActiveClientAccount(sales.id);
  reqA = await createRequirement(sToken, account.id, { title: 'Java Developer' });
  reqB = await createRequirement(sToken, account.id, { title: 'Java Lead' });
  await prisma.requirement.updateMany({ where: { id: { in: [reqA.id, reqB.id] } }, data: { status: 'in_progress' } });
}, 120000);

afterAll(async () => {
  await prisma.$disconnect();
});

const api = '/api/v1/applicants';
const add = (body, token = sToken) => authed(request(app).post(api), token).send(body);
const post = (path, token, body = {}) => authed(request(app).post(`${api}${path}`), token).send(body);
const list = async (query, token = adminToken) => (await authed(request(app).get(api).query(query), token)).body;

describe('claim, then create the profile', () => {
  test('"Assign to me" only claims; "Create profile" makes it once; only the holder or an admin can', async () => {
    const a = (await add({ requirement_id: reqA.id, name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210' })).body.data;
    const claimed = await post(`/${a.id}/assign`, r1Token);
    expect(claimed.status).toBe(200);
    expect(claimed.body.data).toMatchObject({ status: 'assigned', profile_id: null, profile_created: false });
    expect(await prisma.profile.count()).toBe(0);

    expect((await post(`/${a.id}/create-profile`, r2Token)).status).toBe(403); // someone else
    const made = await post(`/${a.id}/create-profile`, r1Token);
    expect(made.status).toBe(200);
    expect(made.body.data.profile_created).toBe(true);
    const again = await post(`/${a.id}/create-profile`, r1Token);
    expect(again.body.data.profile_id).toBe(made.body.data.profile_id);
    expect(await prisma.profile.count()).toBe(1);

    const pool = (await add({ requirement_id: reqA.id, name: 'Bala K', email: 'bala@example.com' })).body.data;
    expect((await post(`/${pool.id}/create-profile`, r1Token)).status).toBe(409); // not claimed yet
  });

  test('profiles made before this change stay as they are (an applicant that already has one shows it)', async () => {
    const a = (await add({ requirement_id: reqA.id, name: 'Old Flow', email: 'old@example.com' })).body.data;
    const profile = await prisma.profile.create({ data: { name: 'Old Flow', total_experience_years: 2, primary_skills: [], source: 'linkedin', added_by: r1.id } });
    await prisma.jobApplicant.update({ where: { id: a.id }, data: { status: 'assigned', assigned_to: r1.id, profile_id: profile.id } });
    const row = (await list({ view: 'mine' }, r1Token)).data[0];
    expect(row).toMatchObject({ profile_id: profile.id, profile_created: true });
  });
});

describe('a linked Profile that was deleted afterwards', () => {
  test('the row offers "Create profile" again, and pressing it links a live Profile', async () => {
    const a = (await add({ requirement_id: reqA.id, name: 'Gone Profile', email: 'gone@example.com' })).body.data;
    await post(`/${a.id}/assign`, r1Token);
    const made = (await post(`/${a.id}/create-profile`, r1Token)).body.data;
    await prisma.profile.updateMany({ where: { id: made.profile_id, deleted_at: null }, data: { deleted_at: new Date() } });

    const row = (await list({ view: 'mine' }, r1Token)).data[0];
    expect(row).toMatchObject({ profile_id: null, profile_created: false });

    const again = await post(`/${a.id}/create-profile`, r1Token);
    expect(again.status).toBe(200);
    expect(again.body.data.created).toBeUndefined();
    expect(again.body.data.profile_id).toBeTruthy();
    expect(again.body.data.profile_id).not.toBe(made.profile_id);
    expect((await list({ view: 'mine' }, r1Token)).data[0].profile_created).toBe(true);
  });
});

describe('unlink from the job', () => {
  test('the holder unlinks: they leave My candidates, the Profile is kept, an outsider cannot', async () => {
    const a = (await add({ requirement_id: reqA.id, name: 'Asha Rao', email: 'asha@example.com' })).body.data;
    await post(`/${a.id}/assign`, r1Token);
    const made = await post(`/${a.id}/create-profile`, r1Token);
    expect((await post(`/${a.id}/unlink`, r2Token)).status).toBe(403);
    const res = await post(`/${a.id}/unlink`, r1Token);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('unlinked');
    expect((await list({ view: 'mine' }, r1Token)).data).toHaveLength(0);
    expect((await list({ view: 'pool' })).data).toHaveLength(0);
    expect((await list({ view: 'all' })).data.map((x) => x.status)).toEqual(['unlinked']);
    expect(await prisma.profile.findUnique({ where: { id: made.body.data.profile_id } })).toBeTruthy();
  });
});

describe('delete (soft)', () => {
  test('a pool applicant can be deleted by a recruiter; it disappears but the row is kept for a restore; claimed ones only by their holder or an admin', async () => {
    const a = (await add({ requirement_id: reqA.id, name: 'Spam', email: 'spam@example.com' })).body.data;
    const b = (await add({ requirement_id: reqA.id, name: 'Held', email: 'held@example.com' })).body.data;
    await post(`/${b.id}/assign`, r1Token);
    expect((await authed(request(app).delete(`${api}/${b.id}`), r2Token)).status).toBe(403);
    expect((await authed(request(app).delete(`${api}/${a.id}`), r2Token)).status).toBe(200);
    expect((await list({ view: 'all' })).data.map((x) => x.name)).toEqual(['Held']);
    const kept = await prisma.jobApplicant.findFirst({ where: { id: a.id, deleted_at: { not: null } } });
    expect(kept).toMatchObject({ deleted_by: expect.any(String), dedupe_key: null });
    // the same person can apply again, and the restore refuses while a live copy exists
    expect((await add({ requirement_id: reqA.id, name: 'Spam again', email: 'spam@example.com' })).status).toBe(201);
    expect((await authed(request(app).delete(`${api}/${b.id}`), adminToken)).status).toBe(200);
  });
});

describe('filters', () => {
  test('All includes claimed people; unassigned / assigned, profile created or not, and by recruiter combine with each other', async () => {
    const mk = async (name, email) => (await add({ requirement_id: reqA.id, name, email })).body.data;
    const pool = await mk('In Pool', 'pool@example.com');
    const c1 = await mk('Claimed No Profile', 'c1@example.com');
    const c2 = await mk('Claimed With Profile', 'c2@example.com');
    const c3 = await mk('Other Recruiter', 'c3@example.com');
    await post(`/${c1.id}/assign`, r1Token);
    await post(`/${c2.id}/assign`, r1Token);
    await post(`/${c2.id}/create-profile`, r1Token);
    await post(`/${c3.id}/assign`, r2Token);
    const names = async (q) => (await list({ view: 'all', ...q })).data.map((x) => x.name).sort();

    expect(await names({})).toEqual(['Claimed No Profile', 'Claimed With Profile', 'In Pool', 'Other Recruiter']);
    expect((await list({ view: 'all' })).counts).toMatchObject({ pool: 1, all: 4 });
    expect(await names({ assignment: 'unassigned' })).toEqual(['In Pool']);
    expect(await names({ assignment: 'assigned' })).toEqual(['Claimed No Profile', 'Claimed With Profile', 'Other Recruiter']);
    expect(await names({ profile: 'created' })).toEqual(['Claimed With Profile']);
    expect(await names({ profile: 'not_created' })).toEqual(['Claimed No Profile', 'In Pool', 'Other Recruiter']);
    expect(await names({ recruiter_id: r1.id })).toEqual(['Claimed No Profile', 'Claimed With Profile']);
    expect(await names({ recruiter_id: r1.id, profile: 'not_created' })).toEqual(['Claimed No Profile']);
    // the screening filters still work next to them
    await prisma.jobApplicant.update({ where: { id: pool.id }, data: { joiner_status: 'yes' } });
    expect(await names({ joiner: 'yes', assignment: 'unassigned' })).toEqual(['In Pool']);
    expect(await names({ joiner: 'yes', assignment: 'assigned' })).toEqual([]);
  });
});

describe('one application per email, enforced by the database', () => {
  test('the API refuses a second application with the same email (any case) with a clear 409', async () => {
    expect((await add({ requirement_id: reqA.id, name: 'Asha', email: 'Asha@Example.com' })).status).toBe(201);
    const dup = await add({ requirement_id: reqA.id, name: 'Asha again', email: ' asha@example.COM ' });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toMatch(/already applied/);
    expect((await add({ requirement_id: reqB.id, name: 'Asha', email: 'asha@example.com' })).status).toBe(201); // another requirement is fine
  });

  test('even a write that skips the application checks cannot create a duplicate (unique index), and simultaneous requests do not 500', async () => {
    await add({ requirement_id: reqA.id, name: 'Asha', email: 'asha@example.com' });
    await expect(prisma.jobApplicant.create({ data: { requirement_id: reqA.id, name: 'X', email: 'asha@example.com', dedupe_key: 'asha@example.com' } })).rejects.toMatchObject({ code: 'P2002' });
    const twin = { requirement_id: reqB.id, name: 'Twin', email: 'twin@example.com' };
    const both = await Promise.all([add(twin), add(twin)]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  test('editing an email onto someone else\'s is refused', async () => {
    const a = (await add({ requirement_id: reqA.id, name: 'A', email: 'a@example.com' })).body.data;
    await add({ requirement_id: reqA.id, name: 'B', email: 'b@example.com' });
    const res = await authed(request(app).patch(`${api}/${a.id}`), adminToken).send({ email: 'b@example.com' });
    expect(res.status).toBe(409);
  });
});
