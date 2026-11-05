const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

// The database snapshot viewer (dbviewer/) asks this endpoint "is this token a super admin?".
let superToken;
let adminToken;
let superUser;

beforeEach(async () => {
  await cleanDatabase();
  superUser = await createUser({ withOrg: true, role: 'admin', is_superadmin: true, name: 'Root Person' });
  const admin = await createUser({ withOrg: true, role: 'admin', name: 'Plain Admin' });
  ({ access_token: superToken } = await loginAs(superUser));
  ({ access_token: adminToken } = await loginAs(admin));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /superadmin/whoami', () => {
  test('a super admin gets their id, name and email', async () => {
    const res = await authed(request(app).get('/api/v1/superadmin/whoami'), superToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: superUser.id, name: 'Root Person', email: superUser.email });
  });

  test('an ordinary admin is refused with 403', async () => {
    const res = await authed(request(app).get('/api/v1/superadmin/whoami'), adminToken);
    expect(res.status).toBe(403);
  });

  test('no token is 401', async () => {
    const res = await request(app).get('/api/v1/superadmin/whoami');
    expect(res.status).toBe(401);
  });

  test('a demoted super admin loses access on the very next call', async () => {
    await prisma.user.update({ where: { id: superUser.id }, data: { is_superadmin: false } });
    const res = await authed(request(app).get('/api/v1/superadmin/whoami'), superToken);
    expect(res.status).toBe(403);
  });
});
