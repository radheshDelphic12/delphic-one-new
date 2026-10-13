/** The applicant pool: in-progress requirements, first-come-first-served claiming, one Profile per person. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');

let sales;
let sToken;
let r1Token;
let r2Token;
let r1;
let r2;
let adminToken;
let empToken;
let reqA;
let reqB;

beforeAll(async () => {
  await cleanDatabase();
  sales = await createUser({ role: 'sales' });
  ({ access_token: sToken } = await loginAs(sales));
  r1 = await createUser({ role: 'recruiter' });
  r2 = await createUser({ role: 'recruiter' });
  ({ access_token: r1Token } = await loginAs(r1));
  ({ access_token: r2Token } = await loginAs(r2));
  ({ access_token: adminToken } = await loginAs(await createUser({ role: 'admin' })));
  ({ access_token: empToken } = await loginAs(await createUser({ role: 'employee' })));
  const account = await createActiveClientAccount(sales.id);
  reqA = await createRequirement(sToken, account.id, { title: 'Java Developer' });
  reqB = await createRequirement(sToken, account.id, { title: 'Java Lead' });
  await prisma.requirement.updateMany({ where: { id: { in: [reqA.id, reqB.id] } }, data: { status: 'in_progress' } });
}, 120000);

afterAll(async () => {
  await prisma.$disconnect();
});

const api = '/api/v1/applicants';
const add = (token, body) => authed(request(app).post(api), token).send(body);
const claim = (token, id, body = {}) => authed(request(app).post(`${api}/${id}/assign`), token).send(body);

describe('applicant pool', () => {
  test('only sales, recruiters and admins use it; the in-progress requirements show their pool counts and their website state', async () => {
    expect((await authed(request(app).get(api), empToken)).status).toBe(403);
    const first = await add(sToken, { requirement_id: reqA.id, name: 'Asha Rao', email: 'Asha@Example.com', phone: '+91 98765 43210', experience_years: 4.5 });
    expect(first.status).toBe(201);
    const reqs = (await authed(request(app).get(`${api}/requirements`), r1Token)).body.data;
    expect(reqs.map((r) => r.title).sort()).toEqual(['Java Developer', 'Java Lead']);
    expect(reqs.find((r) => r.id === reqA.id)).toMatchObject({ applicants: { new: 1, assigned: 0 }, website: { published: false, closed: false } });
  });

  test('the same person cannot apply twice to one requirement; an open (not in-progress) requirement takes nobody', async () => {
    const dupEmail = await add(sToken, { requirement_id: reqA.id, name: 'Asha again', email: 'asha@example.com' });
    expect(dupEmail.status).toBe(409);
    const dupPhone = await add(sToken, { requirement_id: reqA.id, name: 'Asha phone', phone: '9876543210' });
    expect(dupPhone.status).toBe(409);
    const open = await createRequirement(sToken, (await createActiveClientAccount(sales.id)).id, { title: 'Not started' });
    expect((await add(sToken, { requirement_id: open.id, name: 'Zed' })).status).toBe(409);
    expect((await add(sToken, { requirement_id: reqA.id, name: '' })).status).toBe(422);
  });

  test('two recruiters claiming together: exactly one wins; the Profile is created and the winner joins the requirement', async () => {
    const pool = (await authed(request(app).get(`${api}?view=pool`), r1Token)).body.data;
    expect(pool).toHaveLength(1);
    const id = pool[0].id;
    const [a, b] = await Promise.all([claim(r1Token, id), claim(r2Token, id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? r1 : r2;
    const row = await prisma.jobApplicant.findUnique({ where: { id } });
    expect(row).toMatchObject({ status: 'assigned', assigned_to: winner.id });
    const profile = await prisma.profile.findUnique({ where: { id: row.profile_id } });
    expect(profile).toMatchObject({ name: 'Asha Rao', email: 'asha@example.com', added_by: winner.id });
    expect(await prisma.requirementAssignment.count({ where: { requirement_id: reqA.id, user_id: winner.id, role_on_req: 'recruiter', unassigned_at: null } })).toBe(1);

    // gone from the pool, shown under the winner's own list only
    expect((await authed(request(app).get(`${api}?view=pool`), r1Token)).body.data).toHaveLength(0);
    const winnerToken = winner.id === r1.id ? r1Token : r2Token;
    const loserToken = winner.id === r1.id ? r2Token : r1Token;
    expect((await authed(request(app).get(`${api}?view=mine`), winnerToken)).body.data).toHaveLength(1);
    expect((await authed(request(app).get(`${api}?view=mine`), loserToken)).body.data).toHaveLength(0);
  });

  test('the same person applying to a second requirement reuses the same Profile; release returns them to the pool', async () => {
    const second = await add(sToken, { requirement_id: reqB.id, name: 'Asha R', email: 'asha@example.com' });
    expect(second.status).toBe(201);
    const first = await prisma.jobApplicant.findFirst({ where: { requirement_id: reqA.id } });
    const win = await claim(r2Token, second.body.data.id);
    expect(win.status).toBe(200);
    expect(win.body.data.profile_id).toBe(first.profile_id);
    expect(await prisma.profile.count({ where: { email: 'asha@example.com' } })).toBe(1);

    expect((await authed(request(app).post(`${api}/${second.body.data.id}/release`), r1Token)).status).toBe(403);
    const rel = await authed(request(app).post(`${api}/${second.body.data.id}/release`), r2Token);
    expect(rel.status).toBe(200);
    expect(rel.body.data.status).toBe('new');
    expect((await authed(request(app).get(`${api}?view=pool`), r1Token)).body.data.map((x) => x.id)).toContain(second.body.data.id);
  });

  test('an admin can hand an applicant to a chosen recruiter; a recruiter cannot hand one to someone else', async () => {
    const extra = await add(sToken, { requirement_id: reqB.id, name: 'Bala K', phone: '9000000001' });
    expect((await claim(r1Token, extra.body.data.id, { user_id: r2.id })).status).toBe(403);
    const handed = await claim(adminToken, extra.body.data.id, { user_id: r2.id });
    expect(handed.status).toBe(200);
    expect(handed.body.data.assigned_to.id).toBe(r2.id);
    expect((await claim(r1Token, extra.body.data.id)).status).toBe(409);
  });
});
