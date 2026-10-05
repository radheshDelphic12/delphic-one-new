const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function setupZephyr(slug = 'zephyr-co') {
  const org = await createOrg({ name: `Zephyr ${slug}`, slug });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['zephyr'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, admin, token: access_token };
}

async function addMember(org, accessRole) {
  const user = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(user.id, org.id, { role: 'employee' });
  await prisma.zxPerson.create({ data: { org_id: org.id, name: user.name, user_id: user.id, access_role: accessRole } });
  const { access_token } = await loginAs(user);
  return { user, token: access_token };
}

const api = (token) => ({
  post: (path, body) => authed(request(app).post(`/api/v1/zephyr${path}`), token).send(body),
  get: (path) => authed(request(app).get(`/api/v1/zephyr${path}`), token),
  patch: (path, body) => authed(request(app).patch(`/api/v1/zephyr${path}`), token).send(body),
  del: (path) => authed(request(app).delete(`/api/v1/zephyr${path}`), token),
});
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

describe('zephyr leads CRUD and rules', () => {
  test('create defaults the owner to the creator and lists with party and owner', async () => {
    const { token, admin } = await setupZephyr();
    const a = api(token);
    const party = (await a.post('/parties', { name: 'Skyline Builders' })).body.data;
    const res = await a.post('/leads', { name: 'Tower B', category: 'client_project', party_id: party.id, estimated_value: 5000000, expected_close: day(30) });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ stage: 'new', owner_id: admin.id, estimated_value: 5000000 });
    expect(res.body.data.party.name).toBe('Skyline Builders');
    expect(res.body.data.owner.id).toBe(admin.id);
    const list = (await a.get('/leads')).body.data;
    expect(list).toHaveLength(1);
    expect((await a.get('/leads?q=tower')).body.data).toHaveLength(1);
    expect((await a.get('/leads?category=self_project')).body.data).toHaveLength(0);
  });

  test('a self-project lead needs its basis and value; other categories drop them', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    expect((await a.post('/leads', { name: 'Own villa', category: 'self_project' })).status).toBe(422);
    expect((await a.post('/leads', { name: 'Own villa', category: 'self_project', self_project_basis: 'investor' })).status).toBe(422);
    const ok = await a.post('/leads', { name: 'Own villa', category: 'self_project', self_project_basis: 'investor', basis_value: 'R. Mehta' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.basis_value).toBe('R. Mehta');
    const switched = await a.patch(`/leads/${ok.body.data.id}`, { category: 'other' });
    expect(switched.body.data).toMatchObject({ category: 'other', self_project_basis: null, basis_value: null });
    const back = await a.patch(`/leads/${ok.body.data.id}`, { category: 'self_project' });
    expect(back.status).toBe(422);
  });

  test('party and owner must be valid for this company', async () => {
    const a = await setupZephyr('zephyr-a');
    const b = await setupZephyr('zephyr-b');
    const foreignParty = (await api(b.token).post('/parties', { name: 'Foreign' })).body.data;
    expect((await api(a.token).post('/leads', { name: 'X', party_id: foreignParty.id })).status).toBe(422);
    expect((await api(a.token).post('/leads', { name: 'X', owner_id: b.admin.id })).status).toBe(422);
    const staff = await addMember(a.org, 'staff');
    expect((await api(a.token).post('/leads', { name: 'X', owner_id: staff.user.id })).status).toBe(422);
    const manager = await addMember(a.org, 'manager');
    expect((await api(a.token).post('/leads', { name: 'X', owner_id: manager.user.id })).status).toBe(201);
    const owners = (await api(a.token).get('/leads/owners')).body.data.map((o) => o.id);
    expect(owners).toEqual(expect.arrayContaining([a.admin.id, manager.user.id]));
    expect(owners).not.toContain(staff.user.id);
  });
});

describe('zephyr lead stages', () => {
  async function newLead(a, extra = {}) {
    return (await a.post('/leads', { name: 'Stage lead', estimated_value: 1000000, ...extra })).body.data;
  }

  test('moves between open stages freely and logs each move', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const lead = await newLead(a);
    for (const stage of ['contacted', 'site_visit', 'proposal', 'site_visit']) {
      expect((await a.post(`/leads/${lead.id}/stage`, { stage })).body.data.stage).toBe(stage);
    }
    expect((await a.post(`/leads/${lead.id}/stage`, { stage: 'site_visit' })).status).toBe(422);
    const acts = (await a.get(`/leads/${lead.id}/activities`)).body.data;
    expect(acts).toHaveLength(4);
    expect(acts[0].summary).toMatch(/proposal -> site_visit/);
  });

  test('lost needs a reason; won and lost lock the lead; admin can reopen with a reason', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const a = api(token);
    const lead = await newLead(a);
    expect((await a.post(`/leads/${lead.id}/stage`, { stage: 'lost' })).status).toBe(422);
    const lost = await a.post(`/leads/${lead.id}/stage`, { stage: 'lost', lost_reason: 'Went with a competitor' });
    expect(lost.body.data).toMatchObject({ stage: 'lost', lost_reason: 'Went with a competitor' });
    expect(lost.body.data.closed_at).toBeTruthy();
    expect((await a.patch(`/leads/${lead.id}`, { name: 'Renamed' })).status).toBe(409);
    expect((await a.post(`/leads/${lead.id}/stage`, { stage: 'new' })).status).toBe(409);
    expect((await a.post(`/leads/${lead.id}/activities`, { summary: 'call' })).status).toBe(409);

    expect((await api(manager.token).post(`/leads/${lead.id}/reopen`, { reason: 'Client came back' })).status).toBe(403);
    expect((await a.post(`/leads/${lead.id}/reopen`, {})).status).toBe(422);
    const reopened = await a.post(`/leads/${lead.id}/reopen`, { stage: 'proposal', reason: 'Client came back' });
    expect(reopened.body.data).toMatchObject({ stage: 'proposal', lost_reason: null, closed_at: null });
    const audit = (await a.get('/audit?entity=lead')).body.data.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['create', 'stage', 'reopen']));
    expect((await a.post(`/leads/${lead.id}/reopen`, { reason: 'again' })).status).toBe(409);
  });

  test('won keeps a self-project lead valid and clears pending follow-ups', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const lead = await newLead(a, { category: 'self_project', self_project_basis: 'project_type', basis_value: 'Row houses' });
    await a.post(`/leads/${lead.id}/activities`, { kind: 'call', summary: 'Call back', follow_up_date: day(2) });
    expect((await a.get('/leads/follow-ups')).body.data).toHaveLength(1);
    expect((await a.post(`/leads/${lead.id}/stage`, { stage: 'won' })).body.data.stage).toBe('won');
    expect((await a.get('/leads/follow-ups')).body.data).toHaveLength(0);
  });
});

describe('zephyr lead activities and follow-ups', () => {
  test('follow-ups list overdue first, can be completed, and feed the summary', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const lead = (await a.post('/leads', { name: 'Follow lead', estimated_value: 2000000 })).body.data;
    expect((await a.post(`/leads/${lead.id}/activities`, { summary: 'x', follow_up_date: day(-1) })).status).toBe(422);
    const soon = (await a.post(`/leads/${lead.id}/activities`, { kind: 'visit', summary: 'Site visit', follow_up_date: day(3) })).body.data;
    await a.post(`/leads/${lead.id}/activities`, { kind: 'note', summary: 'Sent brochure' });
    await prisma.zxLeadActivity.create({ data: { org_id: lead.org_id, lead_id: lead.id, kind: 'call', summary: 'Overdue call', follow_up_date: new Date(`${day(-2)}T00:00:00.000Z`) } });

    const due = (await a.get('/leads/follow-ups')).body.data;
    expect(due.map((d) => d.summary)).toEqual(['Overdue call', 'Site visit']);
    expect(due[0].overdue).toBe(true);
    expect(due[1].overdue).toBe(false);

    const summary = (await a.get('/leads/summary')).body.data;
    expect(summary).toMatchObject({ total: 1, open_count: 1, open_value: 2000000, follow_ups_due: 1 });
    const listed = (await a.get('/leads')).body.data[0];
    expect(listed.next_follow_up.slice(0, 10)).toBe(day(-2));

    expect((await a.patch(`/leads/${lead.id}/activities/${soon.id}`, { follow_up_done: true })).body.data.follow_up_done).toBe(true);
    expect((await a.get('/leads/follow-ups')).body.data).toHaveLength(1);
  });

  test('summary win rate counts only decided leads', async () => {
    const { token } = await setupZephyr();
    const a = api(token);
    const mk = async (n) => (await a.post('/leads', { name: n, estimated_value: 100 })).body.data;
    const w = await mk('w');
    const l = await mk('l');
    await mk('open');
    await a.post(`/leads/${w.id}/stage`, { stage: 'won' });
    await a.post(`/leads/${l.id}/stage`, { stage: 'lost', lost_reason: 'price' });
    const s = (await a.get('/leads/summary')).body.data;
    expect(s).toMatchObject({ win_rate: 50, open_count: 1, won_value: 100 });
    expect((await a.get('/leads?stage=open')).body.data).toHaveLength(1);
    expect((await a.get('/leads?stage=closed')).body.data).toHaveLength(2);
  });
});

describe('zephyr leads access and isolation', () => {
  test('manager can work leads but not delete; staff has no access', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const staff = await addMember(org, 'staff');
    const lead = (await api(manager.token).post('/leads', { name: 'By manager' })).body.data;
    expect(lead.owner_id).toBe(manager.user.id);
    expect((await api(manager.token).del(`/leads/${lead.id}`)).status).toBe(403);
    expect((await api(staff.token).get('/leads')).status).toBe(403);
    expect((await api(staff.token).post('/leads', { name: 'no' })).status).toBe(403);
    expect((await api(token).del(`/leads/${lead.id}`)).status).toBe(200);
    expect((await api(token).get(`/leads/${lead.id}`)).status).toBe(404);
  });

  test('another org sees and changes nothing', async () => {
    const a = await setupZephyr('zephyr-a');
    const b = await setupZephyr('zephyr-b');
    const lead = (await api(a.token).post('/leads', { name: 'Only A' })).body.data;
    expect((await api(b.token).get('/leads')).body.data).toHaveLength(0);
    expect((await api(b.token).get(`/leads/${lead.id}`)).status).toBe(404);
    expect((await api(b.token).patch(`/leads/${lead.id}`, { name: 'x' })).status).toBe(404);
    expect((await api(b.token).post(`/leads/${lead.id}/stage`, { stage: 'contacted' })).status).toBe(404);
    expect((await api(b.token).post(`/leads/${lead.id}/activities`, { summary: 'x' })).status).toBe(404);
    expect((await api(b.token).get(`/leads/${lead.id}/activities`)).status).toBe(404);
    expect((await api(b.token).get('/leads/summary')).body.data.total).toBe(0);
  });

  test('lead documents upload and are readable by a manager only', async () => {
    const { org, token } = await setupZephyr();
    const manager = await addMember(org, 'manager');
    const lead = (await api(token).post('/leads', { name: 'Docs lead' })).body.data;
    const up = await authed(request(app).post('/api/v1/zephyr/documents'), token)
      .field('owner_type', 'lead').field('owner_id', lead.id).field('title', 'Proposal v1')
      .attach('file', Buffer.from('%PDF-1.4 x'), 'proposal.pdf');
    expect(up.status).toBe(201);
    expect((await api(manager.token).get(`/documents?owner_type=lead&owner_id=${lead.id}`)).body.data).toHaveLength(1);
    expect((await authed(request(app).get(up.body.data.file_url), manager.token)).status).toBe(200);
    const staff = await addMember(org, 'staff');
    expect((await authed(request(app).get(up.body.data.file_url), staff.token)).status).toBe(403);
  });
});
