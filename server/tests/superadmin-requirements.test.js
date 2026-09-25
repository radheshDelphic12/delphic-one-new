const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createActiveClientAccount,
  createRequirement,
  authed,
} = require('./helpers');

let superToken;
let salesToken;
let sales;
let account;

beforeEach(async () => {
  await cleanDatabase();
  const superUser = await createUser({ role: 'admin', is_superadmin: true });
  sales = await createUser({ role: 'sales' });
  ({ access_token: superToken } = await loginAs(superUser));
  ({ access_token: salesToken } = await loginAs(sales));
  account = await createActiveClientAccount(sales.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function dropRequirement() {
  const req = await createRequirement(salesToken, account.id);
  const drop = await authed(request(app).post(`/api/v1/requirements/${req.id}/status`), salesToken).send({
    to_status: 'dropped',
    reason: 'client cancelled',
  });
  expect(drop.status).toBe(200);
  expect(drop.body.data.status).toBe('dropped');
  expect(drop.body.data.is_locked).toBe(true);
  return req;
}

describe('superadmin requirement status override', () => {
  test('a dropped requirement has no way back via the normal status route', async () => {
    const req = await dropRequirement();
    const res = await authed(request(app).post(`/api/v1/requirements/${req.id}/status`), salesToken).send({
      to_status: 'open',
      reason: 'reopen',
    });
    expect(res.status).toBe(403); // locked
  });

  test('non-superadmin cannot use the status override route', async () => {
    const req = await dropRequirement();
    const res = await authed(request(app).post(`/api/v1/requirements/${req.id}/status/override`), salesToken).send({
      to_status: 'open',
      reason: 'reopen',
    });
    expect(res.status).toBe(403);
  });

  test('status override requires a reason', async () => {
    const req = await dropRequirement();
    const res = await authed(request(app).post(`/api/v1/requirements/${req.id}/status/override`), superToken).send({
      to_status: 'open',
    });
    expect(res.status).toBe(422);
  });

  test('superadmin can reopen a dropped/locked requirement and it is audited', async () => {
    const req = await dropRequirement();
    const res = await authed(request(app).post(`/api/v1/requirements/${req.id}/status/override`), superToken).send({
      to_status: 'open',
      reason: 'client came back',
      is_locked: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('open');
    expect(res.body.data.is_locked).toBe(false);

    const history = await prisma.stageHistory.findMany({
      where: { entity_type: 'requirement', entity_id: req.id },
      orderBy: { changed_at: 'asc' },
    });
    const last = history[history.length - 1];
    expect(last.from_stage).toBe('dropped');
    expect(last.to_stage).toBe('open');
    expect(last.reason.startsWith('[override]')).toBe(true);
  });

  test('override skips the seats-closed gate when forcing to closed and stamps closed_at', async () => {
    const req = await createRequirement(salesToken, account.id); // seat still open
    const res = await authed(request(app).post(`/api/v1/requirements/${req.id}/status/override`), superToken).send({
      to_status: 'closed',
      reason: 'closed out of band',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('closed');

    const row = await prisma.requirement.findUnique({ where: { id: req.id } });
    expect(row.closed_at).toBeTruthy();
  });

  test('reopening clears closed_at', async () => {
    const req = await createRequirement(salesToken, account.id);
    await authed(request(app).post(`/api/v1/requirements/${req.id}/status/override`), superToken).send({
      to_status: 'closed',
      reason: 'close',
    });
    await authed(request(app).post(`/api/v1/requirements/${req.id}/status/override`), superToken).send({
      to_status: 'in_progress',
      reason: 'reopen',
      is_locked: false,
    });
    const row = await prisma.requirement.findUnique({ where: { id: req.id } });
    expect(row.status).toBe('in_progress');
    expect(row.closed_at).toBeNull();
  });
});
