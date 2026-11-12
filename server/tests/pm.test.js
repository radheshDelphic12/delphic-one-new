jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

// Project Management (Delphic Global): projects with their own tickets; contracts can be linked later, tickets never depend on them.

const P = '/api/v1/pm';
let org; let other; let admin; let adminToken; let annToken; let bobToken; let annM; let bobM;

const mkUser = async (o, role = 'employee') => {
  const u = await createUser({ role, withOrg: false });
  const m = await createOrgMembership(u.id, o.id, { role });
  const { access_token: token } = await loginAs(u);
  return { u, m, token };
};

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE pm_activity, pm_ticket_comments, pm_tickets, pm_project_members, pm_project_contracts, pm_projects, pm_statuses RESTART IDENTITY CASCADE');
  org = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
  other = await createOrg({ name: 'Other Co', slug: 'other', org_group_id: org.org_group_id, is_master_workspace: false });
  const a = await mkUser(org, 'admin'); admin = a.u; adminToken = a.token;
  const an = await mkUser(org); annToken = an.token; annM = an.m;
  const bo = await mkUser(org); bobToken = bo.token; bobM = bo.m;
});
afterAll(async () => { await prisma.$disconnect(); });

const post = (url, t, body) => authed(request(app).post(`${P}${url}`), t).send(body || {});
const patch = (url, t, body) => authed(request(app).patch(`${P}${url}`), t).send(body || {});
const get = (url, t) => authed(request(app).get(`${P}${url}`), t);
const del = (url, t) => authed(request(app).delete(`${P}${url}`), t);
const project = async (over = {}) => (await post('/projects', adminToken, { name: 'Website revamp', member_ids: [annM.id], ...over })).body.data;
const contract = (over = {}) => prisma.contract.create({ data: { org_id: org.id, kind: 'service', title: 'MSA 2026', counterparty_name: 'Acme', start_date: new Date('2026-04-01'), created_by: admin.id, progress_percent: 10, ...over } });

describe('who can use it', () => {
  test('only the master workspace (Delphic Global) has it', async () => {
    const o = await mkUser(other, 'admin');
    expect((await get('/projects', o.token)).status).toBe(403);
    expect((await get('/projects', adminToken)).status).toBe(200);
  });

  test('an admin creates projects; a plain employee cannot; an employee sees only projects they belong to', async () => {
    expect((await post('/projects', annToken, { name: 'Nope' })).status).toBe(403);
    const mine = await project({ name: 'Mine' });
    await project({ name: 'Not Ann\'s', member_ids: [bobM.id] });
    expect(mine.code).toBe('PRJ-001');
    const annSees = (await get('/projects', annToken)).body.data;
    expect(annSees.map((p) => p.name)).toEqual(['Mine']);
    expect((await get('/projects', adminToken)).body.data).toHaveLength(2);
    const hidden = (await get('/projects', adminToken)).body.data.find((p) => p.name === 'Not Ann\'s');
    expect((await get(`/projects/${hidden.id}`, annToken)).status).toBe(404);
  });

  test('an admin can edit and delete a project; an ordinary member cannot', async () => {
    const p = await project();
    expect((await patch(`/projects/${p.id}`, annToken, { name: 'Renamed' })).status).toBe(403);
    const ok = await patch(`/projects/${p.id}`, adminToken, { name: 'Renamed', status: 'active' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ name: 'Renamed', status: 'active' });
    expect((await del(`/projects/${p.id}`, annToken)).status).toBe(403);
    expect((await del(`/projects/${p.id}`, adminToken)).status).toBe(200);
    expect(await prisma.pmProject.count()).toBe(0);
  });

  test('the project owner (lead) manages it without being an admin', async () => {
    const p = await project({ owner_membership_id: annM.id });
    expect((await patch(`/projects/${p.id}`, annToken, { description: 'Owned by Ann' })).status).toBe(200);
    expect((await post(`/projects/${p.id}/members`, annToken, { add: [bobM.id] })).status).toBe(200);
    expect((await post(`/projects/${p.id}/tickets`, bobToken, { title: 'Bob can raise tickets' })).status).toBe(201);
  });
});

describe('tickets', () => {
  test('numbered per project, with an assignee who must belong to the project', async () => {
    const p = await project();
    const t1 = await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Design home page', assignee_membership_id: annM.id, priority: 'high', due_date: '2026-11-10' });
    expect(t1.status).toBe(201);
    expect(t1.body.data).toMatchObject({ number: 1, status_key: 'open', category: 'todo', priority: 'high', due_date: '2026-11-10' });
    expect(t1.body.data.assignee.name).toBeTruthy();
    expect((await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Second' })).body.data.number).toBe(2);
    const out = await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Bob is not in it', assignee_membership_id: bobM.id });
    expect(out.status).toBe(422);
    const p2 = await project({ name: 'Other project' });
    expect((await post(`/projects/${p2.id}/tickets`, adminToken, { title: 'First of its own' })).body.data.number).toBe(1);
  });

  test('moving to a done status needs a resolution; reopening clears it; every change is in the activity', async () => {
    const p = await project();
    const t = (await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Fix login', assignee_membership_id: annM.id })).body.data;
    expect((await patch(`/tickets/${t.id}`, annToken, { status_key: 'resolved' })).status).toBe(422);
    const done = await patch(`/tickets/${t.id}`, annToken, { status_key: 'resolved', resolution: 'Reset the cookie domain' });
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ category: 'done', resolution: 'Reset the cookie domain' });
    expect(done.body.data.resolved_at).toBeTruthy();
    const reopened = await patch(`/tickets/${t.id}`, annToken, { status_key: 'in_progress' });
    expect(reopened.body.data.resolved_at).toBeNull();
    const detail = (await get(`/tickets/${t.id}`, annToken)).body.data;
    expect(detail.activity.map((a) => a.action)).toEqual(expect.arrayContaining(['ticket_created', 'status_changed', 'resolution_changed']));
  });

  test('a member edits only tickets assigned to or raised by them; comments are open to the project', async () => {
    const p = await project({ member_ids: [annM.id, bobM.id] });
    const t = (await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Admin raised', assignee_membership_id: annM.id })).body.data;
    expect((await patch(`/tickets/${t.id}`, bobToken, { priority: 'urgent' })).status).toBe(403);
    expect((await patch(`/tickets/${t.id}`, annToken, { priority: 'urgent' })).status).toBe(200);
    expect((await post(`/tickets/${t.id}/comments`, bobToken, { body: 'Looking into it' })).status).toBe(201);
    expect((await get(`/tickets/${t.id}`, annToken)).body.data.comments).toHaveLength(1);
    expect((await del(`/tickets/${t.id}`, bobToken)).status).toBe(403);
    expect((await del(`/tickets/${t.id}`, adminToken)).status).toBe(200);
  });

  test('progress counts done tickets and overdue open ones', async () => {
    const p = await project();
    const mk = (b) => post(`/projects/${p.id}/tickets`, adminToken, b);
    const a = (await mk({ title: 'Ticket A', due_date: '2020-01-01' })).body.data;
    await mk({ title: 'Ticket B', status_key: 'blocked' });
    const c = (await mk({ title: 'Ticket C' })).body.data;
    await patch(`/tickets/${c.id}`, adminToken, { status_key: 'closed', resolution: 'Done' });
    const prog = (await get(`/projects/${p.id}`, adminToken)).body.data.progress;
    expect(prog).toMatchObject({ total: 3, done: 1, blocked: 1, overdue: 1, percent: 33 });
    const overdue = (await get(`/projects/${p.id}/tickets?overdue=true`, adminToken)).body.data;
    expect(overdue.map((t) => t.id)).toEqual([a.id]);
    const listed = (await get('/projects', adminToken)).body.data[0];
    expect(listed.progress.percent).toBe(33);
  });
});

describe('ticket statuses are admin-editable data', () => {
  test('the admin adds, renames and switches off statuses; others cannot', async () => {
    expect((await get('/meta', annToken)).body.data.statuses.map((s) => s.key)).toEqual(['open', 'in_progress', 'blocked', 'resolved', 'closed']);
    expect((await post('/statuses', annToken, { key: 'qa', label: 'In QA', category: 'in_progress' })).status).toBe(403);
    const made = await post('/statuses', adminToken, { key: 'qa', label: 'In QA', category: 'in_progress' });
    expect(made.status).toBe(201);
    expect((await post('/statuses', adminToken, { key: 'qa', label: 'dup', category: 'todo' })).status).toBe(409);
    expect((await patch(`/statuses/${made.body.data.id}`, adminToken, { label: 'QA review' })).body.data.label).toBe('QA review');
    const p = await project();
    expect((await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Needs QA', status_key: 'qa' })).status).toBe(201);
    await patch(`/statuses/${made.body.data.id}`, adminToken, { is_active: false });
    expect((await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Too late', status_key: 'qa' })).status).toBe(422);
  });
});

describe('contracts: linked later, independent of tickets', () => {
  test('projects and tickets work with no contract; a contract is linked afterwards and shows ticket progress next to its own', async () => {
    const p = await project();
    const t = (await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Ship it' })).body.data;
    await patch(`/tickets/${t.id}`, adminToken, { status_key: 'closed', resolution: 'Shipped' });
    await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Docs' });
    expect((await get(`/projects/${p.id}`, adminToken)).body.data.contracts).toEqual([]);

    const c = await contract();
    expect((await post(`/projects/${p.id}/contracts`, annToken, { contract_id: c.id })).status).toBe(403);
    const linked = await post(`/projects/${p.id}/contracts`, adminToken, { contract_id: c.id });
    expect(linked.status).toBe(201);
    const row = linked.body.data.contracts[0];
    expect(row).toMatchObject({ contract_id: c.id, is_primary: true, manual_progress_percent: 10 });
    expect(row.ticket_progress).toMatchObject({ total: 2, done: 1, percent: 50 });
    // the contract's own progress is untouched until an admin copies the ticket figure over
    expect((await prisma.contract.findUnique({ where: { id: c.id } })).progress_percent).toBe(10);
    expect((await post(`/projects/${p.id}/contracts/${c.id}/copy-progress`, annToken)).status).toBe(403);
    expect((await post(`/projects/${p.id}/contracts/${c.id}/copy-progress`, adminToken)).status).toBe(200);
    expect((await prisma.contract.findUnique({ where: { id: c.id } })).progress_percent).toBe(50);
  });

  test('a project links to the Finance projects (P0045 ...): they are listed, show their contract state, and are never listed twice', async () => {
    const fin = (over = {}) => prisma.account.create({ data: { org_id: org.id, type: 'client', stage: 'active', is_project: true, name: 'Delphic One', project_name: 'Delphic One', project_code: `PT${Date.now() % 100000}`, client_name: 'Delphic Global', owner_id: admin.id, origin_owner_id: admin.id, agreement_start_date: new Date('2026-01-01'), ...over } });
    const a = await fin();
    const b = await fin({ name: 'Secure', project_name: 'Secure', project_code: `PU${Date.now() % 100000}`, contract_status: 'on_hold' });
    await prisma.account.create({ data: { org_id: org.id, type: 'client', stage: 'active', name: 'Plain client', owner_id: admin.id, origin_owner_id: admin.id } }); // not a project: never listed
    const p = await project();
    const listed = (await get('/contracts/linkable', adminToken)).body.data;
    expect(listed.map((x) => x.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(listed.map((x) => x.title)).not.toContain('Plain client');
    expect(listed.find((x) => x.id === b.id).status).toBe('on_hold'); // the Finance contract status wins over the dates
    expect(listed.find((x) => x.id === a.id)).toMatchObject({ title: `${a.project_code} · Delphic One`, counterparty_name: 'Delphic Global', status: 'running' });

    expect((await post(`/projects/${p.id}/contracts`, annToken, { contract_id: a.id })).status).toBe(403);
    const linked = await post(`/projects/${p.id}/contracts`, adminToken, { contract_id: a.id });
    expect(linked.status).toBe(201);
    expect(linked.body.data.contracts[0]).toMatchObject({ contract_id: a.id, kind: 'finance_project', is_primary: true, manual_progress_percent: null, status: 'running' });
    expect((await get('/contracts/linkable', adminToken)).body.data.map((x) => x.id)).not.toContain(a.id);
    const other2 = await project({ name: 'Other' });
    expect((await post(`/projects/${other2.id}/contracts`, adminToken, { contract_id: a.id })).status).toBe(409);
    expect((await post(`/projects/${p.id}/contracts/${a.id}/copy-progress`, adminToken)).status).toBe(422);
    // a ticket can be tagged to the linked Finance project
    const t = await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Billing', contract_id: a.id });
    expect(t.status).toBe(201);
    expect((await del(`/projects/${p.id}/contracts/${a.id}`, adminToken)).status).toBe(200);
    await prisma.account.deleteMany({ where: { org_id: org.id, type: 'client' } });
  });

  test('a contract belongs to one project; several contracts per project, one primary; tickets can be tagged per contract', async () => {
    const p = await project();
    const p2 = await project({ name: 'Second' });
    const c1 = await contract(); const c2 = await contract({ title: 'Work order 1' });
    await post(`/projects/${p.id}/contracts`, adminToken, { contract_id: c1.id });
    expect((await post(`/projects/${p2.id}/contracts`, adminToken, { contract_id: c1.id })).status).toBe(409);
    const both = await post(`/projects/${p.id}/contracts`, adminToken, { contract_id: c2.id, is_primary: true });
    expect(both.body.data.contracts.find((x) => x.contract_id === c2.id).is_primary).toBe(true);
    expect(both.body.data.contracts.find((x) => x.contract_id === c1.id).is_primary).toBe(false);
    const tagged = await post(`/projects/${p.id}/tickets`, adminToken, { title: 'For WO1', contract_id: c2.id });
    expect(tagged.status).toBe(201);
    expect((await post(`/projects/${p2.id}/tickets`, adminToken, { title: 'Wrong contract', contract_id: c2.id })).status).toBe(422);
    const rows = (await get(`/projects/${p.id}`, adminToken)).body.data.contracts;
    expect(rows.find((x) => x.contract_id === c2.id).ticket_progress.total).toBe(1);
    expect(rows.find((x) => x.contract_id === c1.id).ticket_progress.total).toBe(0);
  });

  test('unlinking keeps the tickets (untagged) and the contract can be linked elsewhere', async () => {
    const p = await project(); const p2 = await project({ name: 'Second' });
    const c = await contract();
    await post(`/projects/${p.id}/contracts`, adminToken, { contract_id: c.id });
    const t = (await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Tagged', contract_id: c.id })).body.data;
    const un = await del(`/projects/${p.id}/contracts/${c.id}`, adminToken);
    expect(un.status).toBe(200);
    expect(un.body.data.contracts).toEqual([]);
    expect((await get(`/tickets/${t.id}`, adminToken)).body.data.contract_id).toBeNull();
    expect((await post(`/projects/${p2.id}/contracts`, adminToken, { contract_id: c.id })).status).toBe(201);
  });
});

describe('my tickets', () => {
  test('lists the open tickets assigned to the caller across projects', async () => {
    const p = await project(); const p2 = await project({ name: 'Second', member_ids: [annM.id] });
    await post(`/projects/${p.id}/tickets`, adminToken, { title: 'One', assignee_membership_id: annM.id });
    await post(`/projects/${p2.id}/tickets`, adminToken, { title: 'Two', assignee_membership_id: annM.id });
    const done = (await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Finished', assignee_membership_id: annM.id })).body.data;
    await patch(`/tickets/${done.id}`, adminToken, { status_key: 'closed', resolution: 'ok' });
    const mine = (await get('/my-tickets', annToken)).body.data;
    expect(mine.map((t) => t.title).sort()).toEqual(['One', 'Two']);
    expect(mine[0].project.code).toMatch(/^PRJ-/);
    expect((await get('/my-tickets', bobToken)).body.data).toEqual([]);
  });
});

describe('notifications', () => {
  const notes = (userId, type) => prisma.notification.findMany({ where: { user_id: userId, ...(type ? { type } : {}) } });

  test('assigning, moving and commenting tell the people on the ticket, never the actor, and do not copy every admin', async () => {
    const p = await project({ member_ids: [annM.id, bobM.id] });
    const annUser = (await prisma.orgMembership.findUnique({ where: { id: annM.id } })).person_id;
    const bobUser = (await prisma.orgMembership.findUnique({ where: { id: bobM.id } })).person_id;
    const second = await mkUser(org, 'admin'); // another admin must NOT get a copy
    const t = (await post(`/projects/${p.id}/tickets`, bobToken, { title: 'Bob raised this', assignee_membership_id: annM.id })).body.data;
    expect((await notes(annUser, 'pm_ticket_assigned')).map((n) => n.entity_id)).toEqual([t.id]);
    expect(await notes(bobUser, 'pm_ticket_assigned')).toHaveLength(0); // the actor
    await patch(`/tickets/${t.id}`, annToken, { status_key: 'in_progress' });
    const moved = await notes(bobUser, 'pm_ticket_status_changed');
    expect(moved).toHaveLength(1);
    expect(moved[0].body).toContain('In progress');
    expect(moved[0].metadata).toMatchObject({ project_id: p.id });
    await post(`/tickets/${t.id}/comments`, bobToken, { body: 'Any update?' });
    expect(await notes(annUser, 'pm_ticket_commented')).toHaveLength(1);
    expect(await notes(second.u.id)).toHaveLength(0);
  });

  test('the nightly reminder tells the assignee of open tickets due today or tomorrow, once a day, and skips done ones', async () => {
    const pm = require('../src/modules/pm/pm.service');
    const p = await project();
    const annUser = (await prisma.orgMembership.findUnique({ where: { id: annM.id } })).person_id;
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const day = (add) => new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + add)).toISOString().slice(0, 10);
    const soon = (await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Due tomorrow', assignee_membership_id: annM.id, due_date: day(1) })).body.data;
    await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Due next month', assignee_membership_id: annM.id, due_date: day(30) });
    const finished = (await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Due today but done', assignee_membership_id: annM.id, due_date: day(0) })).body.data;
    await patch(`/tickets/${finished.id}`, adminToken, { status_key: 'closed', resolution: 'done' });
    expect((await pm.notifyDueSoon()).sent).toBe(1);
    expect((await pm.notifyDueSoon()).sent).toBe(0); // idempotent within the day
    const rows = await prisma.notification.findMany({ where: { user_id: annUser, type: 'pm_ticket_due_soon' } });
    expect(rows.map((n) => n.entity_id)).toEqual([soon.id]);
    expect(rows[0].body).toContain('tomorrow');
  });
});

describe('attachments', () => {
  const up = (id, t, name = 'spec.pdf', body = 'hello') => authed(request(app).post(`${P}/tickets/${id}/attachments`), t).attach('file', Buffer.from(body), name);

  test('a project member attaches a file and downloads it; outsiders cannot; the uploader or an admin removes it', async () => {
    const p = await project({ member_ids: [annM.id] });
    const t = (await post(`/projects/${p.id}/tickets`, adminToken, { title: 'With a file' })).body.data;
    const made = await up(t.id, annToken, 'spec.pdf', 'pdf-bytes');
    expect(made.status).toBe(201);
    const listed = (await get(`/tickets/${t.id}`, annToken)).body.data.attachments;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ filename: 'spec.pdf', can_delete: true });
    const dl = await get(`/attachments/${made.body.data.id}/download`, annToken);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain('spec.pdf');
    expect((await get(`/attachments/${made.body.data.id}/download`, bobToken)).status).toBe(404); // not in the project
    expect((await up(t.id, bobToken)).status).toBe(404);
    expect((await up(t.id, annToken, 'virus.exe')).status).toBe(400);
    expect((await del(`/attachments/${made.body.data.id}`, bobToken)).status).toBe(404);
    expect((await del(`/attachments/${made.body.data.id}`, adminToken)).status).toBe(200);
    expect(await prisma.pmTicketAttachment.count()).toBe(0);
  });
});

describe('clearing fields', () => {
  test('a project owner, dates and description can be cleared', async () => {
    const p = await project({ owner_membership_id: annM.id, start_date: '2026-01-01', end_date: '2026-06-30', description: 'x'.repeat(5) });
    const r = await patch(`/projects/${p.id}`, adminToken, { owner_membership_id: null, start_date: null, end_date: null, description: null });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ owner: null, start_date: null, end_date: null, description: null });
  });
});

describe('custom fields of a project', () => {
  test('a manager defines fields; ticket values are validated by type; required fields are enforced; switched-off fields are refused', async () => {
    const p = await project();
    expect((await post(`/projects/${p.id}/fields`, annToken, { label: 'Sprint', type: 'text' })).status).toBe(403);
    expect((await post(`/projects/${p.id}/fields`, adminToken, { label: 'Env', type: 'select' })).status).toBe(422); // needs options
    const points = await post(`/projects/${p.id}/fields`, adminToken, { label: 'Story points', type: 'number' });
    expect(points.body.data.key).toBe('story_points');
    await post(`/projects/${p.id}/fields`, adminToken, { label: 'Environment', type: 'select', options: ['dev', 'staging', 'prod'], required: true });
    await post(`/projects/${p.id}/fields`, adminToken, { label: 'Go live', type: 'date' });
    expect((await post(`/projects/${p.id}/fields`, adminToken, { label: 'Story points', type: 'text' })).status).toBe(409);

    const mk = (custom_values) => post(`/projects/${p.id}/tickets`, adminToken, { title: 'Field ticket', custom_values });
    expect((await mk({ story_points: 5 })).status).toBe(422); // Environment is required
    expect((await mk({ environment: 'moon' })).status).toBe(422);
    expect((await mk({ environment: 'dev', story_points: 'many' })).status).toBe(422);
    expect((await mk({ environment: 'dev', nope: 1 })).status).toBe(422);
    const made = await mk({ environment: 'prod', story_points: '8', go_live: '2026-12-01' });
    expect(made.status).toBe(201);
    expect(made.body.data.custom_values).toEqual({ environment: 'prod', story_points: 8, go_live: '2026-12-01' });

    const upd = await patch(`/tickets/${made.body.data.id}`, adminToken, { custom_values: { story_points: null, environment: 'staging' } });
    expect(upd.body.data.custom_values).toEqual({ environment: 'staging', go_live: '2026-12-01' });
    expect((await patch(`/tickets/${made.body.data.id}`, adminToken, { custom_values: { environment: '' } })).status).toBe(422); // required cannot be blanked

    const field = (await get(`/projects/${p.id}`, adminToken)).body.data.fields.find((f) => f.key === 'environment');
    await authed(request(app).patch(`${P}/projects/${p.id}/fields/${field.id}`), adminToken).send({ is_active: false });
    expect((await mk({ environment: 'dev' })).status).toBe(422); // switched off
    expect((await mk({ story_points: 1 })).status).toBe(201); // and no longer required
  });
});

describe('sharing a project with a client or vendor', () => {
  const guest = (token, url = '', method = 'get', body) => request(app)[method](`/api/v1/pm-guest${url}`).set('Authorization', `Bearer ${token}`).send(body);
  const soon = () => new Date(Date.now() + 7 * 86400000).toISOString();
  const share = async (p, over = {}) => (await post(`/projects/${p.id}/shares`, adminToken, { email: 'client@acme.test', label: 'Acme Corp', expires_at: soon(), ...over })).body.data;

  test('only a manager shares; the guest sees non-internal tickets without assignees or internal comments; revoking cuts the link', async () => {
    const p = await project({ member_ids: [annM.id] });
    const open = (await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Visible ticket', assignee_membership_id: annM.id, description: 'what we do' })).body.data;
    await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Secret ticket', internal_only: true });
    await post(`/tickets/${open.id}/comments`, adminToken, { body: 'internal note' });
    await post(`/tickets/${open.id}/comments`, adminToken, { body: 'Update for the client', is_public: true });

    expect((await post(`/projects/${p.id}/shares`, annToken, { email: 'x@y.test', label: 'X', expires_at: soon() })).status).toBe(403);
    expect((await post(`/projects/${p.id}/shares`, adminToken, { email: 'x@y.test', label: 'X', expires_at: '2020-01-01' })).status).toBe(422);
    const made = await share(p);
    expect(made.token).toMatch(/^ext_/);
    expect(made.share).toMatchObject({ label: 'Acme Corp', can_comment: false, active: true });

    const view = (await guest(made.token)).body.data;
    expect(view.project).toMatchObject({ name: 'Website revamp' });
    expect(view.tickets.map((t) => t.title)).toEqual(['Visible ticket']);
    expect(view.progress.total).toBe(1);
    expect(JSON.stringify(view)).not.toMatch(/assignee|internal note|Secret ticket|Ann|tester/);
    expect(view.tickets[0].comments[0].author).toBe('Delphic team');
    expect(view.tickets[0].comments.map((c) => c.body)).toEqual(['Update for the client']);
    expect((await guest(made.token, `/tickets/${open.id}/comments`, 'post', { body: 'hi' })).status).toBe(403); // view-only

    const list = (await get(`/projects/${p.id}/shares`, adminToken)).body.data;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(made.token);
    expect((await get(`/projects/${p.id}/shares`, annToken)).status).toBe(403);
    expect((await del(`/projects/${p.id}/shares/${made.share.id}`, annToken)).status).toBe(403);
    expect((await del(`/projects/${p.id}/shares/${made.share.id}`, adminToken)).status).toBe(200);
    expect((await guest(made.token)).status).toBe(401);
  });

  test('a comment-enabled share lets the guest comment (tagged, public, tells the team); a share covers only its own project; a normal login token is no use', async () => {
    const p = await project({ member_ids: [annM.id] });
    const other = await project({ name: 'Other project' });
    const t = (await post(`/projects/${p.id}/tickets`, adminToken, { title: 'Needs the client', assignee_membership_id: annM.id })).body.data;
    const made = await share(p, { can_comment: true });
    expect((await guest(made.token, `/tickets/${t.id}/comments`, 'post', { body: 'Please use the new logo' })).status).toBe(201);
    const seen = (await guest(made.token)).body.data.tickets[0].comments;
    expect(seen).toEqual([expect.objectContaining({ author: 'Acme Corp', mine: true, body: 'Please use the new logo' })]);
    const inside = (await get(`/tickets/${t.id}`, annToken)).body.data.comments[0];
    expect(inside).toMatchObject({ external: true, is_public: true });
    expect(inside.author).toContain('Acme Corp');
    const annUser = (await prisma.orgMembership.findUnique({ where: { id: annM.id } })).person_id;
    expect(await prisma.notification.count({ where: { user_id: annUser, type: 'pm_ticket_commented' } })).toBe(1);
    const otherTicket = (await post(`/projects/${other.id}/tickets`, adminToken, { title: 'Not shared' })).body.data;
    expect((await guest(made.token, `/tickets/${otherTicket.id}/comments`, 'post', { body: 'sneaky' })).status).toBe(404);
    expect((await guest(adminToken)).status).toBe(401);
    expect((await guest('ext_nope')).status).toBe(401);
  });
});
