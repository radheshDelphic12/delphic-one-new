// A browser render crash (client ErrorBoundary) is reported to the server log.
const { app, prisma, request, cleanDatabase, createUser, loginAs, authed } = require('./helpers');
const logger = require('../src/config/logger');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

test('a signed-in client error is logged as client_error; anonymous and oversized reports are refused', async () => {
  const spy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  const user = await createUser({ role: 'employee' });
  const token = (await loginAs(user)).access_token;

  const res = await authed(request(app).post('/api/v1/client-errors'), token).send({
    message: 'Cannot read properties of undefined',
    stack: 'TypeError: …\n    at BillingSalesTab',
    component_stack: 'at BillingSalesTab\n at AnalyticsPage',
    url: '/analytics?section=sales',
  });
  expect(res.status).toBe(200);
  expect(spy).toHaveBeenCalledWith('client_error', expect.objectContaining({ message: 'Cannot read properties of undefined', url: '/analytics?section=sales', user_id: user.id }));

  expect((await request(app).post('/api/v1/client-errors').send({ message: 'x' })).status).toBe(401);
  expect((await authed(request(app).post('/api/v1/client-errors'), token).send({ message: 'x'.repeat(2001) })).status).toBe(422);
  spy.mockRestore();
});
