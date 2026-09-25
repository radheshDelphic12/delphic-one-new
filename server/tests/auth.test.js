const { app, prisma, request, cleanDatabase, createUser, loginAs, authed, PASSWORD } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('auth', () => {
  test('login with correct credentials returns tokens and user', async () => {
    const user = await createUser({ role: 'admin' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();
    expect(res.body.data.refresh_token).toBeTruthy();
    expect(res.body.data.user.email).toBe(user.email);
    expect(res.body.data.user.role).toBe('admin');
  });

  test('login with wrong password is rejected', async () => {
    const user = await createUser({ role: 'admin' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('login for a deactivated user is rejected', async () => {
    const user = await createUser({ role: 'sales', active: false });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });

    expect(res.status).toBe(401);
  });

  test('GET /users/me without a token is rejected', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  test('GET /users/me with a valid token returns the right user', async () => {
    const user = await createUser({ role: 'recruiter' });
    const { access_token } = await loginAs(user);

    const res = authed(request(app).get('/api/v1/users/me'), access_token);
    const result = await res;

    expect(result.status).toBe(200);
    expect(result.body.data.id).toBe(user.id);
  });

  test('refresh token issues a new access token', async () => {
    const user = await createUser({ role: 'bda' });
    const { refresh_token } = await loginAs(user);

    const res = await request(app).post('/api/v1/auth/refresh').send({ refresh_token });

    expect(res.status).toBe(200);
    expect(res.body.data.access_token).toBeTruthy();
  });

  test('refresh with a garbage token is rejected', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refresh_token: 'not-a-real-token' });
    expect(res.status).toBe(401);
  });

  test('change-password rejects wrong current password, then works and old password stops working', async () => {
    const user = await createUser({ role: 'admin' });
    const { access_token } = await loginAs(user);

    const wrong = await authed(request(app).post('/api/v1/auth/change-password'), access_token).send({
      current_password: 'not-it',
      new_password: 'NewPassword123!',
    });
    expect(wrong.status).toBe(400);

    const ok = await authed(request(app).post('/api/v1/auth/change-password'), access_token).send({
      current_password: PASSWORD,
      new_password: 'NewPassword123!',
    });
    expect(ok.status).toBe(200);

    const oldLogin = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'NewPassword123!' });
    expect(newLogin.status).toBe(200);
  });
});
