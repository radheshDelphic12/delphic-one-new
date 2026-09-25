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

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('comments module', () => {
  test('create and list comments on an account', async () => {
    const bda = await createUser({ role: 'bda' });
    const { access_token } = await loginAs(bda);
    const account = await createActiveClientAccount(bda.id);

    const created = await authed(request(app).post('/api/v1/comments'), access_token).send({
      entity_type: 'account',
      entity_id: account.id,
      body: 'Follow up next week',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.body).toBe('Follow up next week');
    expect(created.body.data.user.id).toBe(bda.id);

    const listed = await authed(request(app).get('/api/v1/comments'), access_token).query({
      entity_type: 'account',
      entity_id: account.id,
    });
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
  });

  test('list without entity filters is rejected', async () => {
    const bda = await createUser({ role: 'bda' });
    const { access_token } = await loginAs(bda);
    const res = await authed(request(app).get('/api/v1/comments'), access_token);
    expect(res.status).toBe(422);
  });
});

describe('documents module', () => {
  test('upload, list, and delete a document', async () => {
    const bda = await createUser({ role: 'bda' });
    const { access_token } = await loginAs(bda);
    const account = await createActiveClientAccount(bda.id);

    const tmp = path.join(__dirname, 'tmp-upload.txt');
    fs.writeFileSync(tmp, 'resume content');

    const uploaded = await authed(request(app).post('/api/v1/documents'), access_token)
      .field('entity_type', 'account')
      .field('entity_id', account.id)
      .field('label', 'Note')
      .attach('file', tmp, 'note.pdf');

    fs.unlinkSync(tmp);

    expect(uploaded.status).toBe(201);
    expect(uploaded.body.data.label).toBe('Note');
    expect(uploaded.body.data.file_url).toMatch(/^\/uploads\//);

    const listed = await authed(request(app).get('/api/v1/documents'), access_token).query({
      entity_type: 'account',
      entity_id: account.id,
    });
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);

    const deleted = await authed(request(app).delete(`/api/v1/documents/${uploaded.body.data.id}`), access_token);
    expect(deleted.status).toBe(200);

    const after = await authed(request(app).get('/api/v1/documents'), access_token).query({
      entity_type: 'account',
      entity_id: account.id,
    });
    expect(after.body.data).toHaveLength(0);
  });
});

describe('admin unlock module (split)', () => {
  test('admin can unlock a locked account via the service layer path', async () => {
    const admin = await createUser({ role: 'admin' });
    const bda = await createUser({ role: 'bda' });
    const { access_token: adminToken } = await loginAs(admin);
    const { access_token: bdaToken } = await loginAs(bda);

    const create = await authed(request(app).post('/api/v1/accounts'), bdaToken).send({
      type: 'client',
      name: 'To Unlock',
    });
    await authed(request(app).post(`/api/v1/accounts/${create.body.data.id}/stage`), bdaToken).send({
      to_stage: 'meeting_scheduled',
      meeting_mode: 'online',
      meeting_date: new Date().toISOString(),
    });
    await authed(request(app).post(`/api/v1/accounts/${create.body.data.id}/stage`), bdaToken).send({
      to_stage: 'dropped',
      reason: 'cold',
    });

    const unlock = await authed(
      request(app).post(`/api/v1/admin/account/${create.body.data.id}/unlock`),
      adminToken
    ).send({ reason: 'reopen' });
    expect(unlock.status).toBe(200);
    expect(unlock.body.message).toBe('Record unlocked');
  });
});
