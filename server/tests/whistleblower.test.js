// Speak Up - Confidential Reporting (internally 'whistleblower'): raise a complaint, routed to the handlers an admin sets per category; confidential and anonymous modes;
// restricted categories; people named as involved never see the case; internal notes stay with the handlers; nothing in the change log.
const { prisma, request, app, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE whistle_attachments, whistle_events, whistle_messages, whistle_cases, whistle_categories, whistle_settings CASCADE');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const W = '/api/v1/whistleblower';
const get = (path, token) => authed(request(app).get(`${W}${path}`), token);
const post = (path, token, body) => authed(request(app).post(`${W}${path}`), token).send(body);
const patch = (path, token, body) => authed(request(app).patch(`${W}${path}`), token).send(body);
const put = (path, token, body) => authed(request(app).put(`${W}${path}`), token).send(body);

async function seed({ enable = true } = {}) {
  const org = await createOrg();
  const adminUser = await createUser({ role: 'admin', name: 'Paras Admin' });
  await createOrgMembership(adminUser.id, org.id, { role: 'admin' });
  const admin = (await loginAs(adminUser)).access_token;
  const person = async (name) => {
    const user = await createUser({ role: 'recruiter', name });
    const membership = await createOrgMembership(user.id, org.id, { role: 'recruiter' });
    return { user, membership, token: (await loginAs(user)).access_token };
  };
  const ctx = { org, admin, person, anna: await person('Anna Reporter'), hari: await person('Hari HR'), bob: await person('Bob Colleague'), vik: await person('Vik Involved') };
  if (enable) expect((await put('/settings', admin, { enabled: true })).status).toBe(200);
  ctx.categories = (await get('/categories', admin)).body.data.categories;
  ctx.cat = (name) => ctx.categories.find((c) => c.name.startsWith(name));
  return ctx;
}

const raise = (ctx, who, over = {}) => post('/cases', who.token, { category_id: ctx.cat('Salary').id, subject: 'Wrong deduction', description: 'My salary was cut without any reason this month.', ...over });
const setHandlers = (ctx, cat, members) => patch(`/categories/${cat.id}`, ctx.admin, { handler_membership_ids: members.map((m) => m.membership.id) });

describe('whistleblower: switched off until an admin enables it', () => {
  test('nobody can raise a concern while it is off; the admin enables it and the 20 categories are there', async () => {
    const ctx = await seed({ enable: false });
    const meta = await get('/meta', ctx.anna.token);
    expect(meta.status).toBe(200);
    expect(meta.body.data).toMatchObject({ enabled: false, is_handler: false, can_manage: false });
    const category = meta.body.data.categories[0];
    expect((await post('/cases', ctx.anna.token, { category_id: category.id, subject: 'Something', description: 'Something happened here.' })).status).toBe(403);

    expect((await put('/settings', ctx.anna.token, { enabled: true })).status).toBe(403); // an employee cannot switch it on
    expect((await put('/settings', ctx.admin, { enabled: true })).status).toBe(200);
    const after = await get('/meta', ctx.anna.token);
    expect(after.body.data.enabled).toBe(true);
    expect(after.body.data.categories).toHaveLength(20);
    expect(after.body.data.categories.map((c) => c.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

describe('whistleblower: routing and who sees what', () => {
  test('a concern goes to the company admins when its category has no handler; other employees cannot see it', async () => {
    const ctx = await seed();
    const res = await raise(ctx, ctx.anna);
    expect(res.status).toBe(201);
    expect(res.body.data.case.case_no).toMatch(/^SU-\d{4}-0001$/);
    expect(res.body.data.access_code).toBeNull();
    const id = res.body.data.case.id;

    const inbox = await get('/cases', ctx.admin);
    expect(inbox.body.data.cases.map((c) => [c.case_no, c.reporter, c.status])).toEqual([[res.body.data.case.case_no, 'Anna Reporter', 'new']]);
    expect((await get(`/cases/${id}`, ctx.bob.token)).status).toBe(404);
    expect((await get('/cases', ctx.bob.token)).body.data.cases).toEqual([]);
    expect((await get('/cases', ctx.hari.token)).body.data.cases).toEqual([]);

    // the admin is told, without the subject, the text or the reporter
    const admin = await prisma.user.findFirst({ where: { name: 'Paras Admin' } });
    const notes = await prisma.notification.findMany({ where: { user_id: admin.id, type: 'whistleblower_new' } });
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe('New complaint received');
    expect(`${notes[0].title} ${notes[0].body}`).not.toMatch(/deduction|Anna/i); // the category is named, never the subject, the text or the reporter
    expect(notes[0]).toMatchObject({ entity_type: 'whistle_case', entity_id: id });
    // the reporter is not notified of their own concern
    expect(await prisma.notification.count({ where: { user_id: ctx.anna.user.id } })).toBe(0);
  });

  test('named handlers receive and see their category; a non-restricted category is also seen by the admin', async () => {
    const ctx = await seed();
    expect((await setHandlers(ctx, ctx.cat('Salary'), [ctx.hari])).status).toBe(200);
    const id = (await raise(ctx, ctx.anna)).body.data.case.id;
    expect((await get(`/cases/${id}`, ctx.hari.token)).status).toBe(200);
    expect((await get(`/cases/${id}`, ctx.admin)).status).toBe(200);
    expect((await get(`/cases/${id}`, ctx.bob.token)).status).toBe(404);
    expect(await prisma.notification.count({ where: { user_id: ctx.hari.user.id, type: 'whistleblower_new' } })).toBe(1);
    // a different category stays with the admins
    const other = (await raise(ctx, ctx.anna, { category_id: ctx.cat('Favouritism').id, subject: 'Bias in tasks' })).body.data.case.id;
    expect((await get(`/cases/${other}`, ctx.hari.token)).status).toBe(404);
  });

  test('a restricted category (POSH) is seen only by its named handlers, not by every admin', async () => {
    const ctx = await seed();
    const posh = ctx.cat('POSH');
    expect(posh.restricted).toBe(true);
    expect((await setHandlers(ctx, posh, [ctx.hari])).status).toBe(200);
    const id = (await raise(ctx, ctx.anna, { category_id: posh.id, subject: 'Behaviour at the office' })).body.data.case.id;
    expect((await get(`/cases/${id}`, ctx.hari.token)).status).toBe(200);
    expect((await get(`/cases/${id}`, ctx.admin)).status).toBe(404);
    expect((await get('/cases', ctx.admin)).body.data.cases).toEqual([]);
    // the group admin sees everything
    const group = await prisma.user.findFirst({ where: { name: 'Paras Admin' } });
    await prisma.user.update({ where: { id: group.id }, data: { is_group_superadmin: true } });
    expect((await get(`/cases/${id}`, ctx.admin)).status).toBe(200);
  });

  test('a person named as involved never sees or hears of the case, even as a handler, and cannot be assigned to it', async () => {
    const ctx = await seed();
    expect((await setHandlers(ctx, ctx.cat('Misuse'), [ctx.hari, ctx.vik])).status).toBe(200);
    const res = await raise(ctx, ctx.anna, { category_id: ctx.cat('Misuse').id, subject: 'My manager threatens me', involved_membership_ids: [ctx.vik.membership.id] });
    expect(res.status).toBe(201);
    const id = res.body.data.case.id;
    expect((await get(`/cases/${id}`, ctx.vik.token)).status).toBe(404);
    expect((await get('/cases', ctx.vik.token)).body.data.cases).toEqual([]);
    expect(await prisma.notification.count({ where: { user_id: ctx.vik.user.id } })).toBe(0);
    expect((await get(`/cases/${id}`, ctx.hari.token)).status).toBe(200);
    expect((await patch(`/cases/${id}`, ctx.hari.token, { assigned_membership_id: ctx.vik.membership.id })).status).toBe(422);
    // somebody who is not in the company cannot be named
    const stranger = await prisma.user.create({ data: { name: 'Stranger', email: 'stranger@example.com', password_hash: 'x', role: 'recruiter' } });
    const bad = await raise(ctx, ctx.anna, { involved_membership_ids: [stranger.id] });
    expect(bad.status).toBe(422);
  });
});

describe('whistleblower: following a concern', () => {
  test('the reporter sees replies and status, never the internal notes; closing needs a resolution; a reply reopens', async () => {
    const ctx = await seed();
    await setHandlers(ctx, ctx.cat('Salary'), [ctx.hari]);
    const id = (await raise(ctx, ctx.anna)).body.data.case.id;

    expect((await post(`/cases/${id}/messages`, ctx.hari.token, { body: 'Note: check the payroll run first', internal: true })).status).toBe(200);
    expect((await post(`/cases/${id}/messages`, ctx.hari.token, { body: 'Thanks, we are looking into it.' })).status).toBe(200);
    expect((await patch(`/cases/${id}`, ctx.hari.token, { status: 'investigating' })).status).toBe(200);

    const mine = await get(`/mine/${id}`, ctx.anna.token);
    expect(mine.status).toBe(200);
    expect(mine.body.data.case.messages.map((m) => [m.from, m.body])).toEqual([['team', 'Thanks, we are looking into it.']]);
    expect(mine.body.data.case.status).toBe('investigating');
    expect(JSON.stringify(mine.body.data)).not.toMatch(/Hari|payroll run/);
    // the reporter was told twice (a reply and a status change), still without any detail
    const told = await prisma.notification.findMany({ where: { user_id: ctx.anna.user.id } });
    expect(told).toHaveLength(2);
    expect(told.map((n) => n.body).join(' ')).not.toMatch(/deduction|salary/i);
    // the handler sees the whole thread
    const full = await get(`/cases/${id}`, ctx.hari.token);
    expect(full.body.data.case.messages.map((m) => [m.internal, m.author])).toEqual([[true, 'Hari HR'], [false, 'Hari HR']]);

    // closing needs a resolution
    expect((await patch(`/cases/${id}`, ctx.hari.token, { status: 'closed' })).status).toBe(422);
    const closed = await patch(`/cases/${id}`, ctx.hari.token, { status: 'closed', resolution: 'The deduction was an error and has been reversed.' });
    expect(closed.status).toBe(200);
    expect(closed.body.data.case.status).toBe('closed');
    expect((await get(`/mine/${id}`, ctx.anna.token)).body.data.case.resolution).toMatch(/reversed/);

    // the reporter writes again: the case reopens for the handlers
    const reply = await post(`/mine/${id}/messages`, ctx.anna.token, { body: 'It happened again this month.' });
    expect(reply.status).toBe(200);
    expect(reply.body.data.case.status).toBe('in_review');
    expect((await get(`/cases/${id}`, ctx.hari.token)).body.data.case.status).toBe('in_review');
    // another employee can neither read nor answer it
    expect((await get(`/mine/${id}`, ctx.bob.token)).status).toBe(404);
    expect((await post(`/mine/${id}/messages`, ctx.bob.token, { body: 'hi' })).status).toBe(404);
  });

  test('only a handler can act: a view-only person and a stranger cannot answer or change it', async () => {
    const ctx = await seed();
    const id = (await raise(ctx, ctx.anna)).body.data.case.id;
    expect((await post(`/cases/${id}/messages`, ctx.bob.token, { body: 'x' })).status).toBe(404);
    expect((await patch(`/cases/${id}`, ctx.bob.token, { status: 'closed', resolution: 'x' })).status).toBe(404);
    // assigned person becomes a handler for that case
    expect((await patch(`/cases/${id}`, ctx.admin, { assigned_membership_id: ctx.hari.membership.id })).status).toBe(200);
    expect((await patch(`/cases/${id}`, ctx.hari.token, { status: 'in_review' })).status).toBe(200);
    expect(await prisma.notification.count({ where: { user_id: ctx.hari.user.id } })).toBe(1);
  });

  test('a case nobody touched for the SLA days shows as overdue, and the summary counts it', async () => {
    const ctx = await seed();
    const id = (await raise(ctx, ctx.anna)).body.data.case.id;
    await prisma.whistleCase.update({ where: { id }, data: { last_activity_at: new Date(Date.now() - 9 * 86400000) } });
    const inbox = await get('/cases?overdue=true', ctx.admin);
    expect(inbox.body.data.cases.map((c) => c.overdue)).toEqual([true]);
    expect((await get('/summary', ctx.admin)).body.data).toMatchObject({ enabled: true, handling: { new: 1, open: 1, overdue: 1 } });
    expect((await get('/summary', ctx.anna.token)).body.data).toMatchObject({ my_open: 1, handling: null });
    expect((await get('/summary', ctx.bob.token)).body.data).toMatchObject({ my_open: 0, handling: null });
  });
});

describe('whistleblower: anonymous concerns', () => {
  test('nothing about the person is stored; the tracking code follows the case without a login', async () => {
    const ctx = await seed();
    const res = await raise(ctx, ctx.anna, { mode: 'anonymous' });
    expect(res.status).toBe(201);
    const { access_code: code } = res.body.data;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const id = res.body.data.case.id;

    const row = await prisma.whistleCase.findUnique({ where: { id }, include: { events: true } });
    expect(row).toMatchObject({ is_anonymous: true, reporter_membership_id: null });
    expect(row.access_code_hash).not.toContain(code.replace(/-/g, ''));
    expect(row.events.every((e) => e.actor_membership_id === null)).toBe(true);
    expect(JSON.stringify(row)).not.toContain(ctx.anna.membership.id);
    expect(JSON.stringify(row)).not.toContain(ctx.anna.user.id);

    // not in the reporter's own list; the handler sees no name
    expect((await get('/mine', ctx.anna.token)).body.data).toEqual([]);
    expect((await get(`/cases/${id}`, ctx.admin)).body.data.case).toMatchObject({ is_anonymous: true, reporter: null });
    expect((await get('/cases', ctx.admin)).body.data.cases[0].reporter).toBeNull();

    // the handler answers; the reporter reads it by code, with no token
    await post(`/cases/${id}/messages`, ctx.admin, { body: 'We have started looking into this.' });
    const track = await request(app).post('/api/v1/public/whistleblower/track').send({ case_no: row.case_no, code });
    expect(track.status).toBe(200);
    expect(track.body.data.case.messages.map((m) => m.body)).toEqual(['We have started looking into this.']);
    expect((await request(app).post('/api/v1/public/whistleblower/track').send({ case_no: row.case_no, code: 'AAAA-BBBB-CCCC' })).status).toBe(404);
    expect((await request(app).post('/api/v1/public/whistleblower/track').send({ case_no: 'SU-2026-0999', code })).status).toBe(404);

    const reply = await request(app).post('/api/v1/public/whistleblower/reply').send({ case_no: row.case_no, code, body: 'Thank you. The person did it again yesterday.' });
    expect(reply.status).toBe(200);
    const thread = (await get(`/cases/${id}`, ctx.admin)).body.data.case.messages;
    expect(thread.map((m) => [m.from, m.author])).toEqual([['handler', 'Paras Admin'], ['reporter', 'Anonymous reporter']]);
  });

  test('an admin can switch anonymous concerns off', async () => {
    const ctx = await seed();
    expect((await put('/settings', ctx.admin, { allow_anonymous: false })).status).toBe(200);
    expect((await raise(ctx, ctx.anna, { mode: 'anonymous' })).status).toBe(403);
    expect((await raise(ctx, ctx.anna)).status).toBe(201);
  });
});

describe('whistleblower: files, settings and privacy', () => {
  test('an attachment is downloaded only by the reporter and the people who may see the case; it carries no uploader', async () => {
    const ctx = await seed();
    await setHandlers(ctx, ctx.cat('Salary'), [ctx.hari]);
    const res = await authed(request(app).post(`${W}/cases`), ctx.anna.token)
      .field('category_id', ctx.cat('Salary').id)
      .field('subject', 'Wrong deduction')
      .field('description', 'See the attached payslip for the deduction.')
      .attach('files', Buffer.from('payslip evidence'), 'payslip.txt');
    expect(res.status).toBe(201);
    const detail = (await get(`/cases/${res.body.data.case.id}`, ctx.hari.token)).body.data.case;
    expect(detail.attachments).toHaveLength(1);
    const attachmentId = detail.attachments[0].id;
    const download = (token) => authed(request(app).get(`${W}/attachments/${attachmentId}`), token);
    expect((await download(ctx.hari.token)).status).toBe(200);
    expect((await download(ctx.anna.token)).status).toBe(200);
    expect((await download(ctx.bob.token)).status).toBe(404);
    expect(Object.keys(await prisma.whistleAttachment.findUnique({ where: { id: attachmentId } }))).not.toEqual(expect.arrayContaining(['uploaded_by']));
  });

  test('categories are editable by the admin: reword, switch off, add one, set handlers (people of this company only)', async () => {
    const ctx = await seed();
    const cat = ctx.cat('Discrimination');
    expect((await patch(`/categories/${cat.id}`, ctx.admin, { name: 'Discrimination and inclusion', active: false })).status).toBe(200);
    expect((await get('/meta', ctx.anna.token)).body.data.categories.map((c) => c.name)).not.toContain('Discrimination and inclusion');
    expect((await post('/categories', ctx.admin, { name: 'Remote work abuse', examples: 'Working two jobs' })).body.data.category.number).toBe(21);
    expect((await patch(`/categories/${cat.id}`, ctx.admin, { handler_membership_ids: ['00000000-0000-4000-8000-000000000000'] })).status).toBe(422);
    expect((await get('/categories', ctx.anna.token)).status).toBe(403);
    expect((await patch(`/categories/${cat.id}`, ctx.anna.token, { name: 'Renamed by an employee' })).status).toBe(403);
    // a deactivated category cannot be used
    expect((await raise(ctx, ctx.anna, { category_id: cat.id })).status).toBe(404);
  });

  test('the change log never records a concern, and the module is closed to people outside the company', async () => {
    const ctx = await seed();
    await raise(ctx, ctx.anna);
    const logged = await prisma.$queryRawUnsafe("SELECT count(*)::int AS n FROM change_logs WHERE entity_type ILIKE '%whistle%'");
    expect(logged[0].n).toBe(0);
    const outsider = await createUser({ role: 'recruiter', withOrg: false });
    expect((await get('/meta', (await loginAs(outsider)).access_token)).status).toBe(403);
    expect((await request(app).get(`${W}/meta`)).status).toBe(401);
  });
});

describe('speak up: the incident details, evidence and the reference number', () => {
  test('the complaint keeps the date, office, department and people; the handler and the reporter both see them', async () => {
    const ctx = await seed();
    const office = await prisma.location.create({ data: { org_id: ctx.org.id, name: 'Indore' } });
    const dept = await prisma.department.create({ data: { org_id: ctx.org.id, name: 'Sales' } });
    const res = await raise(ctx, ctx.anna, { incident_date: '2026-10-20', location_id: office.id, department_id: dept.id, people_involved: 'A manager from the Sales team, name not known' });
    expect(res.status).toBe(201);
    const id = res.body.data.case.id;
    const expected = { incident_date: '2026-10-20', office: 'Indore', department: 'Sales', people_involved: 'A manager from the Sales team, name not known' };
    expect((await get(`/cases/${id}`, ctx.admin)).body.data.case).toMatchObject(expected);
    expect((await get(`/mine/${id}`, ctx.anna.token)).body.data.case).toMatchObject(expected);
    expect((await get('/meta', ctx.anna.token)).body.data.departments.map((d) => d.name)).toEqual(['Sales']);
    // an office or department of another company is refused
    const other = await createOrg({ name: 'Other', slug: 'other', is_master_workspace: false });
    const foreign = await prisma.department.create({ data: { org_id: other.id, name: 'Foreign' } });
    expect((await raise(ctx, ctx.anna, { department_id: foreign.id })).status).toBe(404);
    expect((await raise(ctx, ctx.anna, { incident_date: '2026-13-45' })).status).toBe(422); // not a real day
    expect((await raise(ctx, ctx.anna, { incident_date: '2099-01-01' })).status).toBe(422); // not in the future
  });

  test('the reference number is unique and counts up; the reporter finds the complaint by it', async () => {
    const ctx = await seed();
    const first = (await raise(ctx, ctx.anna)).body.data.case.case_no;
    const second = (await raise(ctx, ctx.bob, { subject: 'Another one' })).body.data.case.case_no;
    expect(first).toMatch(/^SU-\d{4}-0001$/);
    expect(second).toMatch(/^SU-\d{4}-0002$/);
    const mine = (await get('/mine', ctx.anna.token)).body.data;
    expect(mine.map((c) => c.case_no)).toEqual([first]); // only my own
  });

  test('supporting evidence can be added after submission, confidential or anonymous, and the handler can open it', async () => {
    const ctx = await seed();
    const id = (await raise(ctx, ctx.anna)).body.data.case.id;
    const add = await authed(request(app).post(`${W}/mine/${id}/messages`), ctx.anna.token).field('body', 'Here is the screenshot I mentioned.').attach('files', Buffer.from('fake image'), 'screenshot.png');
    expect(add.status).toBe(200);
    expect(add.body.data.case.attachments.map((a) => a.file_name)).toEqual(['screenshot.png']);
    const detail = (await get(`/cases/${id}`, ctx.admin)).body.data.case;
    expect(detail.attachments).toHaveLength(1);
    expect((await authed(request(app).get(`${W}/attachments/${detail.attachments[0].id}`), ctx.admin)).status).toBe(200);
    // a type that is not a document or picture is refused
    const bad = await authed(request(app).post(`${W}/mine/${id}/messages`), ctx.anna.token).field('body', 'run this').attach('files', Buffer.from('x'), 'virus.exe');
    expect(bad.status).toBeGreaterThanOrEqual(400);

    // anonymous: more evidence with the tracking code, no login
    const anon = (await raise(ctx, ctx.anna, { mode: 'anonymous', subject: 'Anonymous one' })).body.data;
    const reply = await request(app).post('/api/v1/public/whistleblower/reply').field('case_no', anon.case.case_no).field('code', anon.access_code).field('body', 'Photo of the notice board.').attach('files', Buffer.from('fake photo'), 'photo.jpg');
    expect(reply.status).toBe(200);
    expect(reply.body.data.case.attachments.map((a) => a.file_name)).toEqual(['photo.jpg']);
    const seen = (await get(`/cases/${anon.case.id}`, ctx.admin)).body.data.case;
    expect(seen.attachments.map((a) => a.file_name)).toEqual(['photo.jpg']);
    expect(seen.messages.map((m) => m.author)).toEqual(['Anonymous reporter']);
  });
});
