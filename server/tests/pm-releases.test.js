jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const releasesService = require('../src/modules/pm/pmReleases.service');

// Project Management > Releases and commit tracking.

const P = '/api/v1/pm';
let org; let adminToken; let annToken; let annM;

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
  adminToken = (await mkUser(org, 'admin')).token;
  const an = await mkUser(org); annToken = an.token; annM = an.m;
});
afterAll(async () => { await prisma.$disconnect(); });

const post = (url, t, body) => authed(request(app).post(`${P}${url}`), t).send(body || {});
const patch = (url, t, body) => authed(request(app).patch(`${P}${url}`), t).send(body || {});
const get = (url, t) => authed(request(app).get(`${P}${url}`), t);
const del = (url, t) => authed(request(app).delete(`${P}${url}`), t);
const sha = (n) => String(n).padStart(40, 'a');
const at = (d) => `2026-11-${String(d).padStart(2, '0')}T10:00:00.000Z`;

async function setup() {
  const project = (await post('/projects', adminToken, { name: 'Delphic One', member_ids: [annM.id] })).body.data;
  const t1 = (await post(`/projects/${project.id}/tickets`, adminToken, { title: 'Invoice PDF fix', type: 'bug' })).body.data;
  const t2 = (await post(`/projects/${project.id}/tickets`, adminToken, { title: 'FnF in any month', type: 'task' })).body.data;
  return { project, t1, t2 };
}

describe('commits', () => {
  test('ticket references in a message link the commit; a repeat push adds nothing', async () => {
    const { project, t1 } = await setup();
    expect(releasesService.ticketNumbersIn('fix PRJ-001#4 and PRJ-001-7, not XPRJ-001#9 or PRJ-002#1', 'PRJ-001').sort()).toEqual([4, 7]);
    const body = { commits: [
      { sha: sha(1), message: `fix: invoice pdf (${project.code}#${t1.number})`, author_name: 'Ayush', committed_at: at(1) },
      { sha: sha(2), message: 'chore: bump deps', author_name: 'Ayush', committed_at: at(2) },
    ] };
    const first = await post(`/projects/${project.id}/commits`, adminToken, body);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ added: 2, already_known: 0, ticket_links: 1 });
    expect((await post(`/projects/${project.id}/commits`, adminToken, body)).body.data).toMatchObject({ added: 0, already_known: 2 });
    const list = (await get(`/projects/${project.id}/commits`, adminToken)).body.data.commits;
    expect(list).toHaveLength(2);
    expect(list.find((c) => c.sha === sha(1)).tickets.map((t) => t.number)).toEqual([t1.number]);
    const ticket = (await get(`/tickets/${t1.id}`, adminToken)).body.data;
    expect(ticket.tracking.commits).toHaveLength(1);
  });

  test('only a manager records commits; a member only reads', async () => {
    const { project } = await setup();
    const body = { commits: [{ sha: sha(1), message: 'x', committed_at: at(1) }] };
    expect((await post(`/projects/${project.id}/commits`, annToken, body)).status).toBe(403);
    await post(`/projects/${project.id}/commits`, adminToken, body);
    expect((await get(`/projects/${project.id}/commits`, annToken)).status).toBe(200);
    expect((await post(`/projects/${project.id}/commits`, adminToken, { commits: [{ sha: 'not-a-sha', message: 'x', committed_at: at(1) }] })).status).toBe(422);
  });

  test('a branch name that could be an option is refused', async () => {
    const { project } = await setup();
    expect((await post(`/projects/${project.id}/commits/sync`, adminToken, { branch: '--output=/tmp/x' })).status).toBe(422);
  });
});

describe('releases', () => {
  test('create, a duplicate version is refused, members cannot create', async () => {
    const { project } = await setup();
    expect((await post(`/projects/${project.id}/releases`, annToken, { version: '1.0.0' })).status).toBe(403);
    const r = await post(`/projects/${project.id}/releases`, adminToken, { version: '1.0.0', name: 'First', planned_date: '2026-12-01' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ version: '1.0.0', status: 'planned', planned_date: '2026-12-01' });
    expect((await post(`/projects/${project.id}/releases`, adminToken, { version: '1.0.0' })).status).toBe(409);
    expect((await post(`/projects/${project.id}/releases`, adminToken, { version: 'bad version!' })).status).toBe(422);
  });

  test('tickets and commits go into a release; releasing takes in the unreleased commits, closes the version and writes notes', async () => {
    const { project, t1, t2 } = await setup();
    await post(`/projects/${project.id}/commits`, adminToken, { commits: [
      { sha: sha(1), message: `fix ${project.code}#${t1.number}`, author_name: 'Ayush', committed_at: at(1) },
      { sha: sha(2), message: 'later work', author_name: 'Ayush', committed_at: at(9) },
    ] });
    const rel = (await post(`/projects/${project.id}/releases`, adminToken, { version: '1.1.0' })).body.data;
    await post(`/releases/${rel.id}/tickets`, adminToken, { add: [t1.id, t2.id] });
    let list = (await get(`/projects/${project.id}/releases`, annToken)).body.data;
    expect(list.releases[0]).toMatchObject({ tickets: 2, commits: 0 });
    expect(list.waiting.commits).toBe(2);

    // release point = the first commit: the later one stays unreleased
    const done = await patch(`/releases/${rel.id}`, adminToken, { status: 'released', commit_sha: sha(1).slice(0, 12), git_tag: 'v1.1.0' });
    expect(done.status).toBe(200);
    expect(done.body.data.commits_taken).toBe(1);
    expect(done.body.data.release).toMatchObject({ status: 'released', git_tag: 'v1.1.0' });
    expect(done.body.data.release.released_at).toBeTruthy();
    list = (await get(`/projects/${project.id}/releases`, adminToken)).body.data;
    expect(list.waiting.commits).toBe(1);

    // closed: no ticket changes, no going back, no delete
    expect((await post(`/releases/${rel.id}/tickets`, adminToken, { remove: [t1.id] })).status).toBe(409);
    expect((await patch(`/releases/${rel.id}`, adminToken, { status: 'planned' })).status).toBe(409);
    expect((await del(`/releases/${rel.id}`, adminToken)).status).toBe(409);

    const notes = (await get(`/releases/${rel.id}/notes`, annToken)).body.data.markdown;
    expect(notes).toContain('# Delphic One 1.1.0');
    expect(notes).toContain('## Bug fixes');
    expect(notes).toContain(`${project.code}#${t1.number} Invoice PDF fix`);
    expect(notes).toContain('## Commits (1)');
    const ticket = (await get(`/tickets/${t1.id}`, adminToken)).body.data;
    expect(ticket.tracking.release).toMatchObject({ version: '1.1.0', status: 'released' });
  });

  test('a planned release can be deleted and its tickets and commits are freed', async () => {
    const { project, t1 } = await setup();
    await post(`/projects/${project.id}/commits`, adminToken, { commits: [{ sha: sha(1), message: 'a', committed_at: at(1) }] });
    const rel = (await post(`/projects/${project.id}/releases`, adminToken, { version: '2.0.0' })).body.data;
    await post(`/releases/${rel.id}/tickets`, adminToken, { add: [t1.id] });
    const commit = (await get(`/projects/${project.id}/commits`, adminToken)).body.data.commits[0];
    await post(`/releases/${rel.id}/commits`, adminToken, { add: [commit.id] });
    expect((await del(`/releases/${rel.id}`, adminToken)).status).toBe(200);
    expect((await get(`/projects/${project.id}/commits?release=none`, adminToken)).body.data.commits).toHaveLength(1);
    expect((await get(`/tickets/${t1.id}`, adminToken)).body.data.tracking.release).toBeNull();
  });

  test('a commit can be linked to a ticket by hand', async () => {
    const { project, t2 } = await setup();
    await post(`/projects/${project.id}/commits`, adminToken, { commits: [{ sha: sha(1), message: 'no reference here', committed_at: at(1) }] });
    const commit = (await get(`/projects/${project.id}/commits`, adminToken)).body.data.commits[0];
    const linked = await post(`/commits/${commit.id}/tickets`, adminToken, { add: [t2.id] });
    expect(linked.body.data.tickets.map((t) => t.number)).toEqual([t2.number]);
    expect((await post(`/commits/${commit.id}/tickets`, adminToken, { remove: [t2.id] })).body.data.tickets).toHaveLength(0);
  });
});

describe('environments (dev / beta / prod)', () => {
  test('a release is put on dev, beta and prod; each environment shows what runs there and which tickets went live', async () => {
    const { project, t1, t2 } = await setup();
    const r1 = (await post(`/projects/${project.id}/releases`, adminToken, { version: '1.0.0' })).body.data;
    const r2 = (await post(`/projects/${project.id}/releases`, adminToken, { version: '1.1.0' })).body.data;
    await post(`/releases/${r1.id}/tickets`, adminToken, { add: [t1.id] });
    await post(`/releases/${r2.id}/tickets`, adminToken, { add: [t2.id] });

    // nothing deployed yet
    let ov = (await get(`/projects/${project.id}/environments`, annToken)).body.data;
    expect(ov.environments.map((e) => [e.key, e.live])).toEqual([['dev', null], ['beta', null], ['prod', null]]);

    // 1.0.0 everywhere, then 1.1.0 on dev and beta only
    for (const environment of ['dev', 'beta', 'prod']) expect((await post(`/releases/${r1.id}/deployments`, adminToken, { environment, deployed_at: '2026-11-01T10:00:00.000Z' })).status).toBe(201);
    for (const environment of ['dev', 'beta']) await post(`/releases/${r2.id}/deployments`, adminToken, { environment, deployed_at: '2026-11-05T10:00:00.000Z' });
    // a failed attempt does not change what runs
    await post(`/releases/${r2.id}/deployments`, adminToken, { environment: 'prod', status: 'failed', note: 'migration error', deployed_at: '2026-11-06T10:00:00.000Z' });

    ov = (await get(`/projects/${project.id}/environments`, annToken)).body.data;
    const by = Object.fromEntries(ov.environments.map((e) => [e.key, e]));
    expect(by.dev.live.release.version).toBe('1.1.0');
    expect(by.beta.live.release.version).toBe('1.1.0');
    expect(by.prod.live.release.version).toBe('1.0.0');
    expect(by.prod.last_failed).toMatchObject({ status: 'failed', note: 'migration error' });
    expect(by.prod.releases.map((x) => x.release.version)).toEqual(['1.0.0']);
    expect(by.prod.releases[0].tickets.map((t) => t.number)).toEqual([t1.number]);
    expect(by.beta.releases.map((x) => [x.release.version, x.live])).toEqual([['1.1.0', true], ['1.0.0', false]]);

    // the release and the ticket both say where it is live
    const list = (await get(`/projects/${project.id}/releases`, annToken)).body.data.releases;
    expect(list.find((x) => x.version === '1.1.0').environments).toMatchObject({ dev: expect.any(Object), beta: expect.any(Object), prod: null });
    const tracking = (await get(`/tickets/${t2.id}`, annToken)).body.data.tracking;
    expect(tracking.release.environments.dev).not.toBeNull();
    expect(tracking.release.environments.prod).toBeNull();
    expect((await get(`/tickets/${t1.id}`, annToken)).body.data.tracking.release.environments.prod).not.toBeNull();
  });

  test('a deploy script names the version; unknown version, unknown environment, member and cancelled release are refused', async () => {
    const { project } = await setup();
    const rel = (await post(`/projects/${project.id}/releases`, adminToken, { version: '2.0.0' })).body.data;
    expect((await post(`/projects/${project.id}/deployments`, adminToken, { version: '2.0.0', environment: 'beta', commit_sha: 'abc1234' })).status).toBe(201);
    expect((await post(`/projects/${project.id}/deployments`, adminToken, { version: '9.9.9', environment: 'beta' })).status).toBe(404);
    expect((await post(`/projects/${project.id}/deployments`, adminToken, { version: '2.0.0', environment: 'staging' })).status).toBe(422);
    expect((await post(`/releases/${rel.id}/deployments`, annToken, { environment: 'dev' })).status).toBe(403);
    const detail = (await get(`/releases/${rel.id}`, adminToken)).body.data;
    expect(detail.deployments).toHaveLength(1);
    expect(detail.environments.beta.commit_sha).toBe('abc1234');
    // a deployment entered by mistake can be removed
    expect((await del(`/deployments/${detail.deployments[0].id}`, adminToken)).status).toBe(200);
    expect((await get(`/releases/${rel.id}`, adminToken)).body.data.environments.beta).toBeNull();
    await patch(`/releases/${rel.id}`, adminToken, { status: 'cancelled' });
    expect((await post(`/releases/${rel.id}/deployments`, adminToken, { environment: 'dev' })).status).toBe(409);
  });
});
