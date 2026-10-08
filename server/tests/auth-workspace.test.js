const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, PASSWORD } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const login = (body) => request(app).post('/api/v1/auth/login').send(body);

describe('public workspace lookup', () => {
  test('returns branding only — no ids, group, or status', async () => {
    await createOrg({ name: 'Delphic', slug: 'delphic' });
    await prisma.org.update({ where: { slug: 'delphic' }, data: { logo_url: 'https://cdn.example/logo.png' } });
    const res = await request(app).get('/api/v1/auth/workspace/delphic');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ name: 'Delphic', slug: 'delphic', logo_url: 'https://cdn.example/logo.png' });
  });

  test('unknown or inactive workspace is a 404; a malformed slug is rejected', async () => {
    await createOrg({ name: 'Gone', slug: 'gone', status: 'inactive' });
    expect((await request(app).get('/api/v1/auth/workspace/nope')).status).toBe(404);
    expect((await request(app).get('/api/v1/auth/workspace/gone')).status).toBe(404);
    expect((await request(app).get('/api/v1/auth/workspace/Bad_Slug!')).status).toBe(422);
  });

  test('needs no authentication', async () => {
    await createOrg({ name: 'Open', slug: 'open' });
    expect((await request(app).get('/api/v1/auth/workspace/open')).status).toBe(200);
  });
});

describe('workspace-scoped sign in', () => {
  async function twoOrgUser() {
    const first = await createOrg({ name: 'Delphic', slug: 'delphic' });
    const second = await createOrg({ name: 'Acconcy', slug: 'acconcy' });
    const user = await createUser({ role: 'admin', withOrg: false });
    await prisma.orgMembership.create({ data: { person_id: user.id, org_id: first.id, role: 'admin', joined_at: new Date('2026-01-01') } });
    await prisma.orgMembership.create({ data: { person_id: user.id, org_id: second.id, role: 'admin', joined_at: new Date('2026-06-01') } });
    return { user, first, second };
  }

  test('without a slug the earliest membership is still the default (unchanged behaviour)', async () => {
    const { user, first } = await twoOrgUser();
    const res = await login({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.active_org.id).toBe(first.id);
  });

  test('a slug selects that workspace even when it is not the earliest', async () => {
    const { user, second } = await twoOrgUser();
    const res = await login({ email: user.email, password: PASSWORD, org_slug: 'Acconcy' });
    expect(res.status).toBe(200);
    expect(res.body.data.active_org.id).toBe(second.id);
    expect(res.body.data.memberships).toHaveLength(2);
    const me = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${res.body.data.access_token}`);
    expect(me.status).toBe(200);
  });

  test('a workspace the user does not belong to is 403 — but only after the password is verified', async () => {
    const { user } = await twoOrgUser();
    await createOrg({ name: 'Outsider', slug: 'outsider' });
    const denied = await login({ email: user.email, password: PASSWORD, org_slug: 'outsider' });
    expect(denied.status).toBe(403);
    // Wrong password must never reveal membership: same 401 whatever the slug.
    const wrongPw = await login({ email: user.email, password: 'nope', org_slug: 'outsider' });
    expect(wrongPw.status).toBe(401);
    const wrongPwMember = await login({ email: user.email, password: 'nope', org_slug: 'acconcy' });
    expect(wrongPwMember.status).toBe(401);
  });
});
