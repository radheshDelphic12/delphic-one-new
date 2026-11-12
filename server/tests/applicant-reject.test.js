// Applicants: "Reject" at screening. Only a categorisation: the person leaves the Pool / My candidates / All lists and shows under
// Rejected with who, when and why; no Profile or submission is touched; an admin (or whoever rejected) can take them back.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');

let sToken;
let r1;
let r1Token;
let r2Token;
let adminToken;
let reqA;

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
  await prisma.requirement.update({ where: { id: reqA.id }, data: { status: 'in_progress' } });
}, 120000);

afterAll(async () => {
  await prisma.$disconnect();
});

const api = '/api/v1/applicants';
const add = (body, token = sToken) => authed(request(app).post(api), token).send(body);
const post = (path, token, body = {}) => authed(request(app).post(`${api}${path}`), token).send(body);
const list = async (query, token = adminToken) => (await authed(request(app).get(api).query(query), token)).body;
const names = (body) => body.data.map((a) => a.name).sort();
const newApplicant = async (name) => (await add({ requirement_id: reqA.id, name, email: `${name.replace(/\s/g, '').toLowerCase()}@example.com` })).body.data;

describe('reject at screening', () => {
  test('a pool applicant is rejected with a reason: it leaves Pool and All, shows under Rejected with who, when and why', async () => {
    const a = await newApplicant('Asha Rao');
    await newApplicant('Bala K');
    const res = await post(`/${a.id}/reject`, r1Token, { reason: 'Not enough React experience' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'rejected', reject_reason: 'Not enough React experience', rejected_by: { id: r1.id, name: 'Rec One' } });
    expect(res.body.data.rejected_at).toBeTruthy();

    expect(names(await list({ view: 'pool' }))).toEqual(['Bala K']);
    expect(names(await list({ view: 'all' }))).toEqual(['Bala K']);
    const rejected = await list({ view: 'rejected' });
    expect(names(rejected)).toEqual(['Asha Rao']);
    expect(rejected.data[0]).toMatchObject({ reject_reason: 'Not enough React experience', rejected_by: { name: 'Rec One' } });
    expect((await list({ view: 'pool' })).counts).toMatchObject({ pool: 1, all: 1, rejected: 1 });
  });

  test('the reason is optional', async () => {
    const a = await newApplicant('No Reason');
    const res = await post(`/${a.id}/reject`, sToken); // sales may reject from the pool, like deleting
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'rejected', reject_reason: null });
  });

  test('a claimed applicant is rejected only by the recruiter who holds them or an admin, and leaves My candidates', async () => {
    const a = await newApplicant('Claimed One');
    await post(`/${a.id}/assign`, r1Token);
    expect(names(await list({ view: 'mine' }, r1Token))).toEqual(['Claimed One']);

    expect((await post(`/${a.id}/reject`, r2Token, { reason: 'x' })).status).toBe(403); // someone else's candidate
    expect((await post(`/${a.id}/reject`, r1Token, { reason: 'Salary too high' })).status).toBe(200);
    expect(names(await list({ view: 'mine' }, r1Token))).toEqual([]);
    expect((await list({ view: 'mine' }, r1Token)).counts.mine).toBe(0);
    expect(names(await list({ view: 'rejected' }))).toEqual(['Claimed One']);

    const b = await newApplicant('Admin Rejects');
    await post(`/${b.id}/assign`, r1Token);
    expect((await post(`/${b.id}/reject`, adminToken, { reason: 'Duplicate profile' })).status).toBe(200);
  });

  test('rejecting touches nothing else: a Profile already created stays, and the screening answers are kept', async () => {
    const a = await newApplicant('Has Profile');
    await post(`/${a.id}/assign`, r1Token);
    const made = await post(`/${a.id}/create-profile`, r1Token);
    expect(await prisma.profile.count()).toBe(1);
    const res = await post(`/${a.id}/reject`, r1Token, { reason: 'Failed screening call' });
    expect(res.body.data.profile_id).toBe(made.body.data.profile_id);
    expect(await prisma.profile.count()).toBe(1);
    expect(await prisma.submission.count()).toBe(0);
  });

  test('a rejected person cannot be rejected again, claimed, or have a profile made; unlinked ones cannot be rejected', async () => {
    const a = await newApplicant('Done Deal');
    await post(`/${a.id}/reject`, r1Token, { reason: 'x' });
    expect((await post(`/${a.id}/reject`, r1Token, { reason: 'again' })).status).toBe(409);
    expect((await post(`/${a.id}/assign`, r1Token)).status).toBe(409);
    expect((await post(`/${a.id}/create-profile`, r1Token)).status).toBe(409);

    const u = await newApplicant('Unlinked One');
    await post(`/${u.id}/assign`, r1Token);
    await post(`/${u.id}/unlink`, r1Token);
    expect((await post(`/${u.id}/reject`, r1Token)).status).toBe(409);
    expect((await post('/00000000-0000-4000-8000-000000000000/reject', r1Token)).status).toBe(404);
  });

  test('the reason is limited to 300 characters', async () => {
    const a = await newApplicant('Long Reason');
    const res = await post(`/${a.id}/reject`, r1Token, { reason: 'x'.repeat(301) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await authed(request(app).get(api).query({ view: 'pool' }), adminToken)).body.data.map((r) => r.name)).toContain('Long Reason');
  });
});

describe('take a rejected applicant back', () => {
  test('an admin or whoever rejected them puts them back in the Pool (claim cleared); others cannot', async () => {
    const a = await newApplicant('Second Chance');
    await post(`/${a.id}/assign`, r1Token);
    await post(`/${a.id}/reject`, r1Token, { reason: 'Maybe later' });

    expect((await post(`/${a.id}/unreject`, r2Token)).status).toBe(403);
    const back = await post(`/${a.id}/unreject`, r1Token); // the rejecter
    expect(back.status).toBe(200);
    expect(back.body.data).toMatchObject({ status: 'new', assigned_to: null, reject_reason: null, rejected_by: null, rejected_at: null });
    expect(names(await list({ view: 'pool' }))).toEqual(['Second Chance']);
    expect(names(await list({ view: 'rejected' }))).toEqual([]);

    await post(`/${a.id}/reject`, r1Token, { reason: 'again' });
    expect((await post(`/${a.id}/unreject`, adminToken)).status).toBe(200); // an admin may always
    expect((await post(`/${a.id}/unreject`, adminToken)).status).toBe(409); // not rejected any more
  });

  test('the rejection and the restore are written to the audit log', async () => {
    const a = await newApplicant('Audited');
    await post(`/${a.id}/reject`, r1Token, { reason: 'Not a fit' });
    await post(`/${a.id}/unreject`, adminToken);
    const actions = (await prisma.auditLog.findMany({ where: { entity_id: a.id, entity_type: 'job_applicant' } })).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['applicant_reject', 'applicant_unreject']));
  });
});

describe('filters keep working with the Rejected list', () => {
  test('search and requirement filters apply inside Rejected, and the assignment filter does not pull rejected people into other views', async () => {
    const a = await newApplicant('Rejected Rita');
    const b = await newApplicant('Waiting Wally');
    await post(`/${a.id}/reject`, r1Token, { reason: 'x' });
    expect(names(await list({ view: 'rejected', search: 'rita' }))).toEqual(['Rejected Rita']);
    expect(names(await list({ view: 'rejected', search: 'wally' }))).toEqual([]);
    expect(names(await list({ view: 'all', assignment: 'unassigned' }))).toEqual(['Waiting Wally']);
    expect(names(await list({ view: 'rejected', requirement_id: reqA.id }))).toEqual(['Rejected Rita']);
    expect(b.id).toBeTruthy();
  });
});
