// People → Policies: admin writes rich-text policies; employees read only published ones.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed, unique } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seed() {
  const org = await createOrg({ name: 'Delphic', slug: unique('delphic-') });
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const employee = await createUser({ role: 'employee' });
  await createOrgMembership(employee.id, org.id, { role: 'employee' });
  return { adminToken: (await loginAs(admin)).access_token, employeeToken: (await loginAs(employee)).access_token };
}

describe('Policies', () => {
  test('admin creates, edits and deletes; employees see only published and cannot write', async () => {
    const { adminToken, employeeToken } = await seed();
    const draft = await authed(request(app).post('/api/v1/policies'), adminToken).send({ title: 'Leave policy', category: 'HR', content: '<p>Hello <strong>team</strong></p>' });
    expect(draft.status).toBe(201);
    expect(draft.body.data).toMatchObject({ title: 'Leave policy', is_published: false });

    expect((await authed(request(app).get('/api/v1/policies'), adminToken)).body.data).toHaveLength(1);
    expect((await authed(request(app).get('/api/v1/policies'), employeeToken)).body.data).toHaveLength(0);
    expect((await authed(request(app).post('/api/v1/policies'), employeeToken).send({ title: 'x' })).status).toBe(403);

    const id = draft.body.data.id;
    const pub = await authed(request(app).patch(`/api/v1/policies/${id}`), adminToken).send({ is_published: true, title: 'Leave policy v2' });
    expect(pub.status).toBe(200);
    const seen = (await authed(request(app).get('/api/v1/policies'), employeeToken)).body.data;
    expect(seen.map((p) => p.title)).toEqual(['Leave policy v2']);
    expect((await authed(request(app).patch(`/api/v1/policies/${id}`), employeeToken).send({ title: 'hack' })).status).toBe(403);

    expect((await authed(request(app).delete(`/api/v1/policies/${id}`), adminToken)).status).toBe(200);
    expect((await authed(request(app).delete(`/api/v1/policies/${id}`), adminToken)).status).toBe(404);
  });

  test('scripts, handlers and unsafe links are stripped before storing', async () => {
    const { adminToken } = await seed();
    const res = await authed(request(app).post('/api/v1/policies'), adminToken).send({
      title: 'XSS',
      content: '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://ok.com">good</a><img src=x onerror=alert(1)>',
    });
    expect(res.status).toBe(201);
    const html = res.body.data.content;
    expect(html).not.toMatch(/script|onclick|onerror|javascript:|<img/i);
    expect(html).toContain('https://ok.com');
  });
});
