const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

// Career portals of the companies other than Delphic Global: an admin posts jobs, the company's own /<slug>/career/ page lists them,
// applications land in the company, and nothing leaks between companies.
jest.setTimeout(120000);
let zeph; let acc; let zAdmin; let aAdmin; let zStaff;
const answers = { phone: '98765 11111', experience_years: 3, cv_url: 'https://drive.google.com/file/d/abc/view', linkedin_url: 'https://www.linkedin.com/in/pages', currently_working: 'yes', joiner_status: 'no', notice_period_days: 0, current_ctc_lpa: 6, expected_ctc_lpa: 9, work_mode: 'hybrid' };

async function adminOf(org) {
  const u = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(u.id, org.id, { role: 'admin' });
  return (await loginAs(u)).access_token;
}

beforeAll(async () => {
  await cleanDatabase();
  zeph = await createOrg({ name: 'Zephyr Infrastructure', slug: 'zephyr', is_master_workspace: false });
  acc = await createOrg({ name: 'Acconcy Finance', slug: 'acconcy', is_master_workspace: false });
  zAdmin = await adminOf(zeph);
  aAdmin = await adminOf(acc);
  const staff = await createUser({ role: 'employee', withOrg: false });
  await createOrgMembership(staff.id, zeph.id, { role: 'employee' });
  zStaff = (await loginAs(staff)).access_token;
}, 180000);
afterAll(async () => { await prisma.$disconnect(); });

const api = (t) => ({
  get: (p) => authed(request(app).get(`/api/v1/hiring${p}`), t),
  post: (p, b) => authed(request(app).post(`/api/v1/hiring${p}`), t).send(b),
  patch: (p, b) => authed(request(app).patch(`/api/v1/hiring${p}`), t).send(b),
  del: (p) => authed(request(app).delete(`/api/v1/hiring${p}`), t),
});

describe('company career portals', () => {
  let job;
  test('an admin posts a job; a draft is not public until it is published, and the Job ID uses the company prefix', async () => {
    const z = api(zAdmin);
    const made = await z.post('/jobs', { title: 'Site Engineer <b>', department: 'Projects', location: 'Indore', employment_type: 'full time', description: 'Build roads & bridges.', openings: 2 });
    expect(made.status).toBe(201);
    job = made.body.data;
    expect(job).toMatchObject({ job_code: 'ZEP-0001', status: 'draft', employment_type: 'Full-time' });
    expect(job.slug).toMatch(/^zep-0001-site-engineer/);

    expect((await request(app).get('/zephyr/career/')).text).not.toContain('Site Engineer');
    expect((await request(app).get(`/zephyr/career/${job.slug}`)).status).toBe(404);

    const pub = await z.patch(`/jobs/${job.id}`, { status: 'published' });
    expect(pub.body.data.status).toBe('published');
    const list = await request(app).get('/zephyr/career/');
    expect(list.status).toBe(200);
    expect(list.text).toContain('Zephyr Infrastructure');
    expect(list.text).not.toContain('Careers at Delphic');
    expect(list.text).toContain('Site Engineer &lt;b&gt;');
    expect(list.text).not.toContain('<b>');
    expect(list.text).toContain('ZEP-0001');
    const page = await request(app).get(`/zephyr/career/${job.slug}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('Build roads &amp; bridges.');
    expect((await request(app).get('/zephyr/career/ZEP-0001').redirects(0)).status).toBe(302);
    const json = await request(app).get('/zephyr/career/jobs.json?q=bridges');
    expect(json.body.data.map((j) => j.job_code)).toEqual(['ZEP-0001']);
  });

  test('other companies see nothing of it; an unknown company is a 404; the second job gets the next number', async () => {
    expect((await request(app).get('/acconcy/career/')).text).not.toContain('Site Engineer');
    expect((await request(app).get(`/acconcy/career/${job.slug}`)).status).toBe(404);
    expect((await request(app).get('/no-such-company/career/')).status).toBe(404);
    const second = await api(zAdmin).post('/jobs', { title: 'Accountant', status: 'published' });
    expect(second.body.data.job_code).toBe('ZEP-0002');
    expect((await api(aAdmin).post('/jobs', { title: 'Analyst' })).body.data.job_code).toBe('ACC-0001');
    expect((await api(aAdmin).get('/jobs')).body.data.map((j) => j.title)).toEqual(['Analyst']);
  });

  test('applying: the same checks as the Delphic form, one application per person, saved in the company', async () => {
    const url = `/zephyr/career/${job.slug}/apply`;
    const apply = (b) => request(app).post(url).send({ name: 'Asha Patel', email: 'asha@example.com', ...answers, ...b });
    expect((await apply({ phone: '' })).status).toBe(422);
    expect((await apply({ cv_url: 'https://example.com/cv.pdf' })).status).toBe(422);
    const ok = await apply({ channel: 'linkedin', message: 'Keen to join' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ applied: true, job_code: 'ZEP-0001' });
    expect((await apply({ phone: '98765 22222' })).status).toBe(409);
    // closed jobs take no applications
    await api(zAdmin).patch(`/jobs/${job.id}`, { status: 'closed' });
    expect((await apply({ email: 'late@example.com', phone: '98765 33333' })).status).toBe(404);
    await api(zAdmin).patch(`/jobs/${job.id}`, { status: 'published' });

    const list = await api(zAdmin).get('/applications');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ name: 'Asha Patel', email: 'asha@example.com', status: 'new', channel: 'linkedin', job: { job_code: 'ZEP-0001' } });
    expect(list.body.data[0].answers).toMatchObject({ joiner_status: 'no', expected_ctc_lpa: 9, work_mode: 'hybrid' });
    expect(list.body.by_status).toEqual({ new: 1 });
    expect((await api(aAdmin).get('/applications')).body.data).toEqual([]);
    expect((await api(zAdmin).get('/jobs')).body.data.find((j) => j.id === job.id)).toMatchObject({ applications: 1, new_applications: 1 });
  });

  test('moving applications along, filtering, and the Excel export', async () => {
    const z = api(zAdmin);
    await request(app).post(`/zephyr/career/${job.slug}/apply`).send({ name: 'Bhavin Shah', email: 'bhavin@example.com', ...answers, phone: '98765 44444' });
    const all = (await z.get('/applications')).body.data;
    const asha = all.find((a) => a.name === 'Asha Patel');
    const moved = await z.patch(`/applications/${asha.id}`, { status: 'shortlisted', notes: 'Strong on site work' });
    expect(moved.body.data).toMatchObject({ status: 'shortlisted', notes: 'Strong on site work' });
    expect((await z.get('/applications?status=shortlisted')).body.data.map((a) => a.name)).toEqual(['Asha Patel']);
    expect((await z.get('/applications?q=bhavin')).body.data.map((a) => a.name)).toEqual(['Bhavin Shah']);
    expect((await z.get(`/applications?job_id=${job.id}&limit=1`)).body.pagination).toMatchObject({ total: 2, totalPages: 2 });
    expect((await z.patch(`/applications/${asha.id}`, { status: 'nonsense' })).status).toBe(422);
    const xlsx = await authed(request(app).get('/api/v1/hiring/applications/export'), zAdmin).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect(xlsx.body.length).toBeGreaterThan(500);
  });

  test('admins only, Delphic Global is left out, and a deleted job leaves the page', async () => {
    expect((await api(zStaff).get('/jobs')).status).toBe(403);
    const delphic = await createOrg({ name: 'Delphic Global', slug: 'delphic-test', is_master_workspace: true });
    expect((await api(await adminOf(delphic)).get('/jobs')).status).toBe(409);
    expect((await api(zAdmin).del(`/jobs/${job.id}`)).status).toBe(200);
    expect((await request(app).get(`/zephyr/career/${job.slug}`)).status).toBe(404);
    expect((await api(zAdmin).get('/jobs')).body.data.map((j) => j.job_code)).toEqual(['ZEP-0002']);
  });
});
