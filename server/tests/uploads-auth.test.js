const path = require('path');
const fs = require('fs');
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createActiveClientAccount,
  authed,
} = require('./helpers');
const env = require('../src/config/env');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('authenticated uploads', () => {
  test('GET /uploads without a token returns 401', async () => {
    const res = await request(app).get('/uploads/missing.pdf');
    expect(res.status).toBe(401);
  });

  test('GET /uploads with a valid token returns 404 for a missing file', async () => {
    const user = await createUser({ role: 'admin' });
    const { access_token } = await loginAs(user);
    const res = await authed(request(app).get('/uploads/does-not-exist.pdf'), access_token);
    expect(res.status).toBe(404);
  });

  test('GET /uploads with a valid token serves an existing file', async () => {
    const user = await createUser({ role: 'admin' });
    const { access_token } = await loginAs(user);
    fs.mkdirSync(env.uploadDir, { recursive: true });
    const filename = `test-${Date.now()}.txt`;
    const filePath = path.join(env.uploadDir, filename);
    fs.writeFileSync(filePath, 'hello');

    const res = await authed(request(app).get(`/uploads/${filename}`), access_token);
    expect(res.status).toBe(200);
    expect(res.text).toBe('hello');

    fs.unlinkSync(filePath);
  });
});
