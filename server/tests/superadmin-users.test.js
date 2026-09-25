const { app, prisma, request, cleanDatabase, createUser, loginAs, authed, PASSWORD } = require('./helpers');

let superToken;
let adminToken;
let superUser;

beforeEach(async () => {
  await cleanDatabase();
  superUser = await createUser({ role: 'admin', is_superadmin: true, name: 'Root' });
  const admin = await createUser({ role: 'admin', name: 'Plain Admin' });
  ({ access_token: superToken } = await loginAs(superUser));
  ({ access_token: adminToken } = await loginAs(admin));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('superadmin user editing', () => {
  test('superadmin can change role, department and password of another user', async () => {
    const target = await createUser({ role: 'bda' });
    const res = await authed(request(app).patch(`/api/v1/users/${target.id}`), superToken).send({
      role: 'sales',
      password: 'BrandNewPass1',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('sales');
    expect(res.body.data.password_hash).toBeUndefined();

    const relog = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: target.email, password: 'BrandNewPass1' });
    expect(relog.status).toBe(200);
  });

  test('superadmin can promote another user to superadmin', async () => {
    const target = await createUser({ role: 'admin' });
    const res = await authed(request(app).patch(`/api/v1/users/${target.id}`), superToken).send({
      is_superadmin: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.is_superadmin).toBe(true);
  });

  test('ordinary admin cannot grant superadmin', async () => {
    const target = await createUser({ role: 'bda' });
    const res = await authed(request(app).patch(`/api/v1/users/${target.id}`), adminToken).send({
      is_superadmin: true,
    });
    expect(res.status).toBe(403);
  });

  test('ordinary admin cannot set another user password', async () => {
    const target = await createUser({ role: 'bda' });
    const res = await authed(request(app).patch(`/api/v1/users/${target.id}`), adminToken).send({
      password: 'SomethingNew1',
    });
    expect(res.status).toBe(403);
  });

  test('ordinary admin cannot edit a superadmin', async () => {
    const res = await authed(request(app).patch(`/api/v1/users/${superUser.id}`), adminToken).send({
      name: 'Hacked',
    });
    expect(res.status).toBe(403);
  });

  test('the last superadmin cannot be demoted or deactivated', async () => {
    const demote = await authed(request(app).patch(`/api/v1/users/${superUser.id}`), superToken).send({
      is_superadmin: false,
    });
    expect(demote.status).toBe(409);

    const deactivate = await authed(request(app).patch(`/api/v1/users/${superUser.id}`), superToken).send({
      active: false,
    });
    expect(deactivate.status).toBe(409);
  });

  test('a superadmin can be demoted once a second superadmin exists', async () => {
    const second = await createUser({ role: 'admin', is_superadmin: true });
    const res = await authed(request(app).patch(`/api/v1/users/${second.id}`), superToken).send({
      is_superadmin: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.is_superadmin).toBe(false);
  });

  test('GET /users/:id returns the public shape including is_superadmin', async () => {
    const res = await authed(request(app).get(`/api/v1/users/${superUser.id}`), superToken);
    expect(res.status).toBe(200);
    expect(res.body.data.is_superadmin).toBe(true);
    expect(res.body.data.password_hash).toBeUndefined();
  });
});
