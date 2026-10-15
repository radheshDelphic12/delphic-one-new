/** The public careers pages (/<org>/career/): server-rendered HTML that works unchanged behind the website's rewrite. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');
const env = require('../src/config/env');
const websitePostings = require('../src/modules/website/postings.service');
const careerRoutes = require('../src/modules/careerPages/careerPages.routes');

let sToken; let rToken; let req; let slug; let orgSlug;
const answers = { phone: '98765 11111', linkedin_url: 'https://www.linkedin.com/in/pages', currently_working: 'yes', joiner_status: 'no', notice_period_days: 30, current_ctc_lpa: 9, expected_ctc_lpa: 12, work_mode: 'hybrid' };

beforeAll(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  ({ access_token: sToken } = await loginAs(sales));
  ({ access_token: rToken } = await loginAs(await createUser({ role: 'recruiter' })));
  const account = await createActiveClientAccount(sales.id);
  req = await createRequirement(sToken, account.id, { title: 'Node Developer' });
  await prisma.requirement.update({ where: { id: req.id }, data: { status: 'in_progress' } });
  const org = await prisma.org.findUnique({ where: { id: req.org_id } });
  // the pages are scoped by the company slug in the address; the test company has its own slug
  orgSlug = org.slug;
  slug = await websitePostings.newSlug('Node Developer <b>');
  await prisma.websiteJobPosting.create({
    data: { org_id: org.id, requirement_id: req.id, title: 'Node Developer <b>', department: 'Engineering', location: 'Indore', employment_type: 'Full-time', public_description: 'Build <script>alert(1)</script> things & more.', created_by: sales.id, slug },
  });
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

const page = (path) => request(app).get(`/${orgSlug}/career${path}`);

describe('careers pages', () => {
  test('the list page shows open jobs with relative links, and everything from the database is escaped', async () => {
    const r = await page('/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.text).toContain(`href="${slug}"`);
    expect(r.text).toContain('Node Developer &lt;b&gt;');
    expect(r.text).not.toContain('<b>');
    const job = await page(`/${slug}`);
    expect(job.status).toBe(200);
    expect(job.text).toContain('Build &lt;script&gt;alert(1)&lt;/script&gt; things &amp; more.');
    expect(job.text).not.toContain('<script>alert(1)');
  });

  test('every URL in the pages is relative, so the website rewrite (/career -> /<org>/career) works without changes', async () => {
    for (const html of [(await page('/')).text, (await page(`/${slug}`)).text]) {
      expect(html).not.toMatch(/(href|src|action)="\//);
      expect(html).not.toMatch(/https?:\/\/(one\.)?delphic/);
    }
    const job = (await page(`/${slug}`)).text;
    expect(job).toContain('data-action="' + slug + '/apply"');
    expect(job).toContain('href="assets/career.css"');
    expect(job).toContain('src="assets/career.js"');
  });

  test('the list always lives at the trailing slash and a job page never does (relative redirects keep the visitor on their own domain)', async () => {
    const noSlash = await request(app).get(`/${orgSlug}/career?src=linkedin`);
    expect(noSlash.status).toBe(301);
    expect(noSlash.headers.location).toBe('career/?src=linkedin');
    const stray = await request(app).get(`/${orgSlug}/career/${slug}/?src=whatsapp`);
    expect(stray.status).toBe(301);
    expect(stray.headers.location).toBe(`../${slug}?src=whatsapp`);
    // the source of the link travels to the job links of the list
    expect((await page('/?src=linkedin')).text).toContain(`href="${slug}?src=linkedin"`);
  });

  test('assets are served from the same prefix, and nothing else can be read from there', async () => {
    const css = await page('/assets/career.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
    expect((await page('/assets/career.js')).headers['content-type']).toMatch(/javascript/);
    expect((await page('/assets/logo.svg')).headers['content-type']).toMatch(/svg/);
    expect((await page('/assets/secret.txt')).status).toBe(404);
    expect((await page('/assets/..%2f..%2fcareerPages.routes.js')).status).toBe(404);
  });

  test('an unknown job, another company and a closed job all say the job is no longer open', async () => {
    const unknown = await page('/nope-0000');
    expect(unknown.status).toBe(404);
    expect(unknown.text).toContain('no longer open');
    expect((await request(app).get(`/another-company/career/${slug}`)).status).toBe(404);
    expect((await request(app).get('/another-company/career/')).text).toContain('There are no open positions');
    await prisma.websiteJobPosting.update({ where: { requirement_id: req.id }, data: { status: 'closed' } });
    expect((await page(`/${slug}`)).status).toBe(404);
    expect((await page('/')).text).toContain('There are no open positions');
    await prisma.websiteJobPosting.update({ where: { requirement_id: req.id }, data: { status: 'published' } });
  });

  test('the application posts to the same prefix and lands in the applicant pool with its source', async () => {
    const apply = (body, path = `/${orgSlug}/career/${slug}/apply`) => request(app).post(path).send({ name: 'Page Tester', email: 'page@example.com', ...answers, ...body });
    expect((await apply({ phone: '' })).status).toBe(422);
    const ok = await apply({ channel: 'linkedin' });
    expect(ok.status).toBe(201);
    expect(await prisma.jobApplicant.findFirst({ where: { email: 'page@example.com' } })).toMatchObject({ source: 'website', channel: 'linkedin', joiner_status: 'no', work_mode: 'hybrid', status: 'new' });
    expect((await apply({ phone: '98765 22222' })).status).toBe(409);
    expect((await apply({ email: 'x@example.com', phone: '98765 33333' }, `/another-company/career/${slug}/apply`)).status).toBe(404);
    // the older JSON API keeps working for anyone who already uses it
    expect((await request(app).get('/api/v1/public/jobs')).body.data.map((j) => j.slug)).toContain(slug);
  });

  test('the canonical link points at the website address once PUBLIC_CAREERS_BASE is set, and the Copy link button learns it', async () => {
    expect((await page(`/${slug}`)).text).not.toContain('rel="canonical"');
    env.publicCareersBase = 'https://delphic.in/career';
    try {
      expect((await page(`/${slug}`)).text).toContain(`<link rel="canonical" href="https://delphic.in/career/${slug}">`);
      expect((await page('/')).text).toContain('<link rel="canonical" href="https://delphic.in/career/">');
      expect((await authed(request(app).get('/api/v1/applicants/career-base'), rToken)).body.data).toEqual({ base: 'https://delphic.in/career' });
    } finally {
      env.publicCareersBase = '';
    }
    expect((await authed(request(app).get('/api/v1/applicants/career-base'), rToken)).body.data).toEqual({ base: null });
    expect((await request(app).get('/api/v1/applicants/career-base')).status).toBe(401);
  });

  test('behind the website proxy the visitor is the first X-Forwarded-For address, so applicants are not limited as one', () => {
    const ip = careerRoutes.visitorIp;
    expect(ip({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, ip: '10.0.0.1' })).toBe('203.0.113.5');
    expect(ip({ headers: { 'x-forwarded-for': '2001:db8::1' }, ip: '10.0.0.1' })).toBe('2001:db8::1');
    expect(ip({ headers: { 'x-forwarded-for': 'garbage value' }, ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(ip({ headers: {}, ip: '10.0.0.9' })).toBe('10.0.0.9');
  });
});
