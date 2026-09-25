const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');

let recruiterToken;
let salesToken;
let bda;
let inactiveSales;

beforeEach(async () => {
  await cleanDatabase();
  const recruiter = await createUser({ role: 'recruiter', name: 'Rhea Recruiter' });
  const sales = await createUser({ role: 'sales', name: 'Sam Sales' });
  bda = await createUser({ role: 'bda', name: 'Garv Gulati' });
  inactiveSales = await createUser({ role: 'sales', name: 'Prashanth Old', active: false });
  ({ access_token: recruiterToken } = await loginAs(recruiter));
  ({ access_token: salesToken } = await loginAs(sales));
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /users/directory', () => {
  test('a recruiter (blocked from GET /users) can read the full directory', async () => {
    const blocked = await authed(request(app).get('/api/v1/users'), recruiterToken);
    expect(blocked.status).toBe(403);

    const res = await authed(request(app).get('/api/v1/users/directory'), recruiterToken);
    expect(res.status).toBe(200);
    const names = res.body.data.map((u) => u.name);
    expect(names).toEqual(expect.arrayContaining(['Rhea Recruiter', 'Sam Sales', 'Garv Gulati', 'Prashanth Old']));
    // lightweight shape — no email / phone
    expect(res.body.data[0]).not.toHaveProperty('email');
  });

  test('inactive users are included by default; ?active=true drops them', async () => {
    const all = await authed(request(app).get('/api/v1/users/directory'), recruiterToken);
    expect(all.body.data.some((u) => u.id === inactiveSales.id)).toBe(true);

    const activeOnly = await authed(
      request(app).get('/api/v1/users/directory').query({ active: 'true' }),
      recruiterToken
    );
    expect(activeOnly.body.data.some((u) => u.id === inactiveSales.id)).toBe(false);
  });

  test('sales is NOT clamped to recruiters here (unlike GET /users)', async () => {
    const viaList = await authed(request(app).get('/api/v1/users').query({ limit: 100 }), salesToken);
    expect(viaList.body.data.every((u) => u.role === 'recruiter')).toBe(true);

    const viaDir = await authed(request(app).get('/api/v1/users/directory'), salesToken);
    expect(viaDir.body.data.some((u) => u.role === 'bda')).toBe(true);
    expect(viaDir.body.data.some((u) => u.id === bda.id)).toBe(true);
  });

  test('?role= narrows the directory', async () => {
    const res = await authed(request(app).get('/api/v1/users/directory').query({ role: 'bda' }), recruiterToken);
    expect(res.status).toBe(200);
    expect(res.body.data.every((u) => u.role === 'bda')).toBe(true);
  });
});
