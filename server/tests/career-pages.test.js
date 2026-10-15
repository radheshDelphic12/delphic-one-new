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

  test('apply form rules: 10-digit phone, LinkedIn profile only, CV file, one application per person', async () => {
    const url = `/${orgSlug}/career/${slug}/apply`;
    const base = { name: 'Rule Tester', email: 'rules@example.com', ...answers, phone: '9876544444', linkedin_url: 'https://www.linkedin.com/in/rule-tester' };
    const post = (body) => request(app).post(url).send({ ...base, ...body });
    for (const phone of ['98765', '12345678901', '5876544444', 'abcdefghij']) expect((await post({ phone })).status).toBe(422);
    for (const linkedin_url of ['https://example.com/in/rule-tester', 'https://www.linkedin.com/company/acme', 'https://notlinkedin.com/in/x']) expect((await post({ linkedin_url })).status).toBe(422);
    expect(await prisma.jobApplicant.count({ where: { email: 'rules@example.com' } })).toBe(0);

    // multipart with a real PDF: stored, 10-digit phone saved, downloadable by recruiters only
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n');
    const sent = await request(app).post(url).field('name', 'Rule Tester').field('email', 'rules@example.com').field('phone', '+91 98765 44444')
      .field('linkedin_url', 'linkedin.com/in/Rule-Tester').field('currently_working', 'yes').field('joiner_status', 'no').field('notice_period_days', '30')
      .field('current_ctc_lpa', '9').field('expected_ctc_lpa', '12').field('work_mode', 'hybrid')
      .field('message', 'I fit because...')
      .attach('cv', pdf, 'my cv.pdf');
    expect(sent.status).toBe(201);
    const row = await prisma.jobApplicant.findFirst({ where: { email: 'rules@example.com' } });
    expect(row).toMatchObject({ phone: '9876544444', cv_file_name: 'my cv.pdf', notes: 'I fit because...' });
    expect(row.cv_file).toMatch(/^cv-.*\.pdf$/);
    const dl = await authed(request(app).get(`/api/v1/applicants/${row.id}/cv`), rToken);
    expect(dl.status).toBe(200);
    expect((await request(app).get(`/api/v1/applicants/${row.id}/cv`)).status).toBe(401);

    // the same person again - by phone only, or by LinkedIn only - is refused, and no stray file is left behind
    const fs = require('fs');
    const before = fs.readdirSync(env.uploadDir).length;
    expect((await post({ email: 'other@example.com', linkedin_url: 'https://www.linkedin.com/in/someone-else' })).status).toBe(409);
    expect((await post({ email: 'other@example.com', phone: '9123456789' })).status).toBe(409);
    const again = await request(app).post(url).field('name', 'Rule Tester').field('email', 'rules@example.com').field('phone', '9876544444')
      .field('linkedin_url', 'https://www.linkedin.com/in/rule-tester').field('currently_working', 'yes').field('joiner_status', 'no').field('notice_period_days', '30')
      .field('current_ctc_lpa', '9').field('expected_ctc_lpa', '12').field('work_mode', 'hybrid').attach('cv', pdf, 'cv.pdf');
    expect(again.status).toBe(409);
    expect(fs.readdirSync(env.uploadDir).length).toBe(before);
    // a script renamed to .pdf, and a wrong type, are refused
    expect((await request(app).post(url).field('name', 'X').field('email', 'x2@example.com').attach('cv', Buffer.from('#!/bin/sh'), 'evil.pdf')).status).toBe(422);
    expect((await request(app).post(url).field('name', 'X').field('email', 'x3@example.com').attach('cv', Buffer.from('MZ'), 'evil.exe')).status).toBe(422);
    // two clicks at once make one applicant
    const twin = { ...base, email: 'twin@example.com', phone: '9000000001', linkedin_url: 'https://www.linkedin.com/in/twin' };
    const both = await Promise.all([request(app).post(url).send(twin), request(app).post(url).send(twin)]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
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

  test('a CV can be at most 2.5 MB: a bigger file is refused with a clear message and leaves nothing on disk', async () => {
    const fs = require('fs');
    const url = `/${orgSlug}/career/${slug}/apply`;
    const form = (n) => request(app).post(url).field('name', `Size Tester ${n}`).field('email', `size${n}@example.com`).field('phone', `99999${n}0000`.slice(0, 10))
      .field('linkedin_url', `https://www.linkedin.com/in/size-tester-${n}`).field('currently_working', 'yes').field('joiner_status', 'no').field('notice_period_days', '30')
      .field('current_ctc_lpa', '9').field('expected_ctc_lpa', '12').field('work_mode', 'hybrid');
    const pdfOfSize = (bytes) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes - 9, 0x20)]);
    const before = fs.readdirSync(env.uploadDir).length;
    const tooBig = await form(1).attach('cv', pdfOfSize(2.6 * 1024 * 1024), 'big.pdf');
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.message).toBe('Your CV is larger than 2.5 MB');
    expect(await prisma.jobApplicant.count({ where: { email: 'size1@example.com' } })).toBe(0);
    expect(fs.readdirSync(env.uploadDir).length).toBe(before);
    const fits = await form(2).attach('cv', pdfOfSize(2.4 * 1024 * 1024), 'fits.pdf');
    expect(fits.status).toBe(201);
    expect((await prisma.jobApplicant.findFirst({ where: { email: 'size2@example.com' } })).cv_file_name).toBe('fits.pdf');
  });

  test('the phone and LinkedIn pattern attributes compile in current browsers (the v flag) and accept / reject the right values', async () => {
    const html = (await page(`/${slug}`)).text;
    const attr = (name) => {
      const tag = html.match(new RegExp(`<input name="${name}"[^>]*>`))[0];
      return tag.match(/pattern="([^"]*)"/)[1].replace(/&amp;/g, '&');
    };
    const matcher = (name) => new RegExp(`^(?:${attr(name)})$`, 'v'); // browsers compile pattern with the v flag: a bare "-" in a class is an error there
    const linkedin = matcher('linkedin_url');
    ['https://www.linkedin.com/in/asha-rao', 'https://in.linkedin.com/in/asha-rao/', 'http://linkedin.com/pub/asha/1/2/3'].forEach((u) => expect(linkedin.test(u)).toBe(true));
    ['https://www.linkedin.com/company/acme', 'https://example.com/in/someone', 'https://linkedin.com.evil.com/in/x', 'linkedin.com/in/asha'].forEach((u) => expect(linkedin.test(u)).toBe(false));
    const phone = matcher('phone');
    expect(phone.test('9876543210')).toBe(true);
    ['5876543210', '98765', '98765432101'].forEach((n) => expect(phone.test(n)).toBe(false));
  });

  test('behind the website proxy the visitor is the first X-Forwarded-For address, so applicants are not limited as one', () => {
    const ip = careerRoutes.visitorIp;
    expect(ip({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, ip: '10.0.0.1' })).toBe('203.0.113.5');
    expect(ip({ headers: { 'x-forwarded-for': '2001:db8::1' }, ip: '10.0.0.1' })).toBe('2001:db8::1');
    expect(ip({ headers: { 'x-forwarded-for': 'garbage value' }, ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(ip({ headers: {}, ip: '10.0.0.9' })).toBe('10.0.0.9');
  });
});
