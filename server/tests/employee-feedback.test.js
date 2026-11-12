// Employee Feedback: any employee gives feedback (named or anonymous); ONLY the board (people an admin names) reads it; the board's notes never reach the giver.
const { prisma, request, app, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE employee_feedback, employee_feedback_board');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const F = '/api/v1/employee-feedback';
const get = (path, token) => authed(request(app).get(`${F}${path}`), token);
const post = (path, token, body) => authed(request(app).post(`${F}${path}`), token).send(body);
const patch = (path, token, body) => authed(request(app).patch(`${F}${path}`), token).send(body);
const put = (path, token, body) => authed(request(app).put(`${F}${path}`), token).send(body);

async function seed() {
  const org = await createOrg();
  const adminUser = await createUser({ role: 'admin', name: 'Paras Admin' });
  const adminMember = await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const person = async (name) => {
    const user = await createUser({ role: 'recruiter', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter' });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  return { org, admin: (await loginAs(adminUser)).access_token, adminMember, person, anna: await person('Anna Employee'), bob: await person('Bob Board'), cara: await person('Cara Colleague') };
}
const give = (who, over = {}) => post('/', who.token, { category: 'suggestion', subject: 'Better chairs', message: 'The chairs on the third floor hurt after a few hours of work.', ...over });

describe('employee feedback', () => {
  test('anyone can give feedback; nobody reads it until a board is named, and then only the board does', async () => {
    const ctx = await seed();
    expect((await give(ctx.anna)).status).toBe(201);
    expect((await give(ctx.anna, { subject: 'Hidden name', anonymous: true })).status).toBe(201);

    // nobody is on the board yet: not even the admin can read it
    expect((await get('/', ctx.admin)).status).toBe(403);
    expect((await get('/', ctx.anna.token)).status).toBe(403);

    // only an admin (Employee Feedback > manage) names the board
    expect((await put('/board', ctx.anna.token, { membership_ids: [ctx.bob.membership.id] })).status).toBe(403);
    const board = await put('/board', ctx.admin, { membership_ids: [ctx.bob.membership.id] });
    expect(board.status).toBe(200);
    expect((await put('/board', ctx.admin, { membership_ids: ['3d0d7a3e-9d3b-4b53-8f6c-0a9c7c3b1a11'] })).status).toBe(422);
    const named = await get('/board', ctx.admin);
    expect(named.body.data.members.map((m) => m.name)).toEqual(['Bob Board']);
    expect(named.body.data.people.map((p) => p.name)).toEqual(expect.arrayContaining(['Anna Employee', 'Bob Board']));
    expect((await get('/board', ctx.anna.token)).status).toBe(403);

    // the board reads everything; the admin who is not on the board still does not
    const inbox = await get('/', ctx.bob.token);
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.counts).toMatchObject({ new: 2, read: 0 });
    const bySubject = Object.fromEntries(inbox.body.data.items.map((i) => [i.subject, i]));
    expect(bySubject['Better chairs']).toMatchObject({ from: 'Anna Employee', anonymous: false });
    expect(bySubject['Hidden name']).toMatchObject({ from: 'Anonymous', anonymous: true });
    expect((await get('/', ctx.admin)).status).toBe(403);
    expect((await get('/', ctx.cara.token)).status).toBe(403);
  });

  test('anonymous feedback stores no person; the giver sees their own named feedback and its status, never the board note', async () => {
    const ctx = await seed();
    await put('/board', ctx.admin, { membership_ids: [ctx.bob.membership.id] });
    await give(ctx.anna);
    await give(ctx.anna, { subject: 'Hidden name', anonymous: true });

    const rows = await prisma.employeeFeedback.findMany({ orderBy: { created_at: 'asc' } });
    expect(rows[0].submitter_membership_id).toBe(ctx.anna.membership.id);
    expect(rows[1].submitter_membership_id).toBeNull();

    const mine = await get('/mine', ctx.anna.token);
    expect(mine.body.data.map((r) => r.subject)).toEqual(['Better chairs']); // the anonymous one cannot be tied back
    expect((await get('/mine', ctx.cara.token)).body.data).toEqual([]);

    const id = rows[0].id;
    expect((await patch(`/${id}`, ctx.anna.token, { status: 'closed' })).status).toBe(403);
    expect((await patch(`/${id}`, ctx.bob.token, {})).status).toBe(422);
    const done = await patch(`/${id}`, ctx.bob.token, { status: 'actioned', board_note: 'Ordering new chairs for floor 3' });
    expect(done.status).toBe(200);

    const mineAfter = await get('/mine', ctx.anna.token);
    expect(mineAfter.body.data[0].status).toBe('actioned');
    expect(JSON.stringify(mineAfter.body)).not.toContain('Ordering new chairs'); // the board's note is the board's

    const inbox = await get('/?status=actioned', ctx.bob.token);
    expect(inbox.body.data.items).toHaveLength(1);
    expect(inbox.body.data.items[0]).toMatchObject({ board_note: 'Ordering new chairs for floor 3', handled_by: 'Bob Board' });
    expect((await get('/?category=concern', ctx.bob.token)).body.data.items).toHaveLength(0);
  });

  test('checks the form: category, a short title and a real message are needed', async () => {
    const ctx = await seed();
    expect((await give(ctx.anna, { category: 'gossip' })).status).toBe(422);
    expect((await give(ctx.anna, { subject: 'Hi' })).status).toBe(422);
    expect((await give(ctx.anna, { message: 'short' })).status).toBe(422);
    expect((await get('/meta', ctx.anna.token)).body.data).toMatchObject({ is_board: false, can_manage: false });
    await put('/board', ctx.admin, { membership_ids: [ctx.bob.membership.id] });
    expect((await get('/meta', ctx.bob.token)).body.data.is_board).toBe(true);
    expect((await get('/meta', ctx.admin)).body.data.can_manage).toBe(true);
  });
});
