// Flaw #1 — ex-members (no active OrgMembership) and other workspaces must
// not reach recruitment/CV data, including via documents/comments.
// Flaw #2 — /uploads is no longer a static mount: each file is served only
// through the Document / ProjectDocument row that owns it.
const fs = require('fs');
const path = require('path');
const env = require('../src/config/env');
const {
  app,
  prisma,
  request,
  cleanDatabase,
  createUser,
  loginAs,
  createOrg,
  createOrgMembership,
  authed,
  unique,
} = require('./helpers');

const uploadRoot = path.resolve(env.uploadDir);

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function memberOf(org, role = 'admin', employment_status = 'active') {
  const user = await createUser({ role });
  await createOrgMembership(user.id, org.id, { role, employment_status });
  return user;
}

async function tokenFor(user) {
  return (await loginAs(user)).access_token;
}

// A master-workspace recruiter uploads a CV against a profile, as the UI does.
async function seedCv() {
  const master = await createOrg({ name: 'Delphic Global' });
  const recruiter = await memberOf(master, 'recruiter');
  const recruiterToken = await tokenFor(recruiter);
  const profile = await prisma.profile.create({
    data: { name: unique('Candidate '), total_experience_years: 3, primary_skills: ['Node.js'], source: 'direct', added_by: recruiter.id },
  });
  const upload = await authed(request(app).post('/api/v1/documents'), recruiterToken)
    .field('entity_type', 'profile')
    .field('entity_id', profile.id)
    .field('label', 'Candidate CV')
    .attach('file', Buffer.from('%PDF-1.4 secret cv'), 'cv.pdf');
  expect(upload.status).toBe(201);
  return { master, recruiter, recruiterToken, profile, document: upload.body.data };
}

describe('Flaw #1 — recruitment data needs an active master-workspace membership', () => {
  const RECRUITMENT_ROUTES = [
    '/api/v1/accounts',
    '/api/v1/requirements',
    '/api/v1/profiles',
    '/api/v1/submissions',
    '/api/v1/pipeline/board',
    '/api/v1/interviews',
    '/api/v1/dashboard/summary',
  ];

  test('an ex-member (membership terminated, user still active) can log in but gets 403 on every recruitment route', async () => {
    const master = await createOrg();
    const exMember = await memberOf(master, 'admin', 'terminated');
    const login = await loginAs(exMember);
    expect(login.active_org).toBeNull();

    for (const route of RECRUITMENT_ROUTES) {
      const res = await authed(request(app).get(route), login.access_token);
      expect({ route, status: res.status }).toEqual({ route, status: 403 });
    }
  });

  test('an active master-workspace member still gets 200', async () => {
    const master = await createOrg();
    const token = await tokenFor(await memberOf(master, 'admin'));
    for (const route of RECRUITMENT_ROUTES) {
      const res = await authed(request(app).get(route), token);
      expect({ route, status: res.status }).toEqual({ route, status: 200 });
    }
  });

  test('a token issued while employed stops working once the membership is terminated', async () => {
    const master = await createOrg();
    const user = await memberOf(master, 'recruiter');
    const token = await tokenFor(user);
    expect((await authed(request(app).get('/api/v1/profiles'), token)).status).toBe(200);

    await prisma.orgMembership.updateMany({ where: { person_id: user.id }, data: { employment_status: 'terminated' } });
    expect((await authed(request(app).get('/api/v1/profiles'), token)).status).toBe(403);
  });

  test('an ex-member cannot list or add CV documents / comments on a profile', async () => {
    const { master, profile } = await seedCv();
    const exMember = await memberOf(master, 'recruiter', 'terminated');
    const token = await tokenFor(exMember);

    const docs = await authed(request(app).get('/api/v1/documents'), token).query({ entity_type: 'profile', entity_id: profile.id });
    expect(docs.status).toBe(403);
    const comments = await authed(request(app).get('/api/v1/comments'), token).query({ entity_type: 'profile', entity_id: profile.id });
    expect(comments.status).toBe(403);
    const post = await authed(request(app).post('/api/v1/comments'), token).send({ entity_type: 'profile', entity_id: profile.id, body: 'hi' });
    expect(post.status).toBe(403);
  });

  test('a member of a non-master workspace cannot list CV documents', async () => {
    const { profile } = await seedCv();
    const subsidiary = await createOrg({ is_master_workspace: false });
    const token = await tokenFor(await memberOf(subsidiary, 'admin'));
    const res = await authed(request(app).get('/api/v1/documents'), token).query({ entity_type: 'profile', entity_id: profile.id });
    expect(res.status).toBe(403);
  });

  test('an active master member can still list the CV documents', async () => {
    const { recruiterToken, profile } = await seedCv();
    const res = await authed(request(app).get('/api/v1/documents'), recruiterToken).query({ entity_type: 'profile', entity_id: profile.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('the unfiltered document listing is refused to a global-role admin with no membership', async () => {
    await seedCv();
    const token = await tokenFor(await createUser({ role: 'admin', withOrg: false }));
    expect((await authed(request(app).get('/api/v1/documents'), token)).status).toBe(403);
  });
});

describe('Flaw #2 — /uploads is authorized per file', () => {
  test('without a token: 401', async () => {
    const { document } = await seedCv();
    expect((await request(app).get(document.file_url)).status).toBe(401);
  });

  test('an active master member downloads the file as an attachment', async () => {
    const { document, recruiterToken } = await seedCv();
    const res = await authed(request(app).get(document.file_url), recruiterToken).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="Candidate CV\.pdf"/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(res.body).toString()).toContain('secret cv');
  });

  test('an ex-member gets 403 for the same file', async () => {
    const { master, document } = await seedCv();
    const token = await tokenFor(await memberOf(master, 'recruiter', 'terminated'));
    expect((await authed(request(app).get(document.file_url), token)).status).toBe(403);
  });

  test('a member of another (non-master) workspace gets 403', async () => {
    const { document } = await seedCv();
    const subsidiary = await createOrg({ is_master_workspace: false });
    const token = await tokenFor(await memberOf(subsidiary, 'admin'));
    expect((await authed(request(app).get(document.file_url), token)).status).toBe(403);
  });

  test('a file on disk with no owning record is never served (404)', async () => {
    const { recruiterToken } = await seedCv();
    fs.mkdirSync(uploadRoot, { recursive: true });
    const orphan = `${Date.now()}-orphan.pdf`;
    fs.writeFileSync(path.join(uploadRoot, orphan), 'orphan');
    try {
      expect((await authed(request(app).get(`/uploads/${orphan}`), recruiterToken)).status).toBe(404);
    } finally {
      fs.unlinkSync(path.join(uploadRoot, orphan));
    }
  });

  test('path traversal attempts are rejected (404)', async () => {
    const { recruiterToken } = await seedCv();
    for (const attempt of ['/uploads/..%2F..%2Fpackage.json', '/uploads/%2E%2E%2Fsrc%2Fapp.js', '/uploads/.env']) {
      const res = await authed(request(app).get(attempt), recruiterToken);
      expect({ attempt, status: res.status }).toEqual({ attempt, status: 404 });
    }
  });

  test('project documents: only an admin of the owning org with the projects module can download', async () => {
    const org = await createOrg({ is_master_workspace: false });
    await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['projects'] } });
    const admin = await memberOf(org, 'admin');
    const employee = await memberOf(org, 'employee');
    const otherOrgAdmin = await memberOf(await createOrg({ is_master_workspace: false }), 'admin');

    const project = await prisma.selfProject.create({ data: { org_id: org.id, name: 'Site A', created_by: admin.id } });
    const filename = `${Date.now()}-permit.pdf`;
    fs.mkdirSync(uploadRoot, { recursive: true });
    fs.writeFileSync(path.join(uploadRoot, filename), 'permit');
    await prisma.projectDocument.create({
      data: { org_id: org.id, project_id: project.id, category: 'permit', title: 'Permit', file_url: `/uploads/${filename}`, uploaded_by: admin.id },
    });

    try {
      expect((await authed(request(app).get(`/uploads/${filename}`), await tokenFor(admin))).status).toBe(200);
      expect((await authed(request(app).get(`/uploads/${filename}`), await tokenFor(employee))).status).toBe(403);
      expect((await authed(request(app).get(`/uploads/${filename}`), await tokenFor(otherOrgAdmin))).status).toBe(403);

      await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: [] } });
      expect((await authed(request(app).get(`/uploads/${filename}`), await tokenFor(admin))).status).toBe(403);
    } finally {
      fs.unlinkSync(path.join(uploadRoot, filename));
    }
  });
});
