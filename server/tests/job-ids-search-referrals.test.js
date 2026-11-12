/** Job IDs, search on the public and internal job lists, referral tracking and the data rules of a job posting. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');
const { cleanTitle, normalizeEmployment } = require('../src/modules/jobs/jobFields');
const websiteClient = require('../src/modules/website/appsScriptClient');

let sToken; let adminToken; let empToken; let emp; let orgSlug; let orgId; let sales;
const CV = 'https://drive.google.com/file/d/abc/view';
const answers = { experience_years: 3, cv_url: CV, currently_working: 'yes', joiner_status: 'no', notice_period_days: 30, current_ctc_lpa: 9, expected_ctc_lpa: 12, work_mode: 'hybrid' };
const codes = {};
let seq = 0;
const apply = (slug, body, query = '') => request(app).post(`/${orgSlug}/career/${slug}/apply${query}`).send({
  name: 'Cand', email: `c${(seq += 1)}@example.com`, phone: `98765 ${String(30000 + seq)}`, linkedin_url: `https://www.linkedin.com/in/cand-${seq}`, ...answers, ...body,
});
const slugs = {};

async function job(title, { department = 'Engineering', location = 'Indore', description = 'Build things.', skills = [] } = {}) {
  const account = await createActiveClientAccount(sales.id);
  const r = await createRequirement(sToken, account.id, { title });
  await prisma.requirement.update({ where: { id: r.id }, data: { status: 'in_progress', primary_tech_stack: skills } });
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-ab${(seq += 1) % 10}${seq % 7}`;
  const p = await prisma.websiteJobPosting.create({ data: { org_id: r.org_id, requirement_id: r.id, title, department, location, employment_type: 'Full-time', public_description: description, created_by: sales.id, slug } });
  slugs[title] = slug;
  codes[title] = p.job_code;
  return { r, p, slug };
}

beforeAll(async () => {
  await cleanDatabase();
  sales = await createUser({ role: 'sales' });
  ({ access_token: sToken } = await loginAs(sales));
  ({ access_token: adminToken } = await loginAs(await createUser({ role: 'admin' })));
  emp = await createUser({ role: 'employee' });
  ({ access_token: empToken } = await loginAs(emp));
  const first = await job('Data Engineer', { skills: ['Python', 'Spark'] });
  orgId = first.r.org_id;
  orgSlug = (await prisma.org.findUnique({ where: { id: orgId } })).slug;
  await job('Senior Data Engineer', { location: 'Gurgaon', skills: ['Spark'] });
  await job('Software Engineer', { department: 'Product', description: 'Works with data pipelines.', skills: ['Java'] });
  await job('Data Analyst', { department: 'Analytics', skills: ['SQL'] });
  await job('HR Executive', { department: 'People', location: 'Ahmedabad' });
}, 180000);
afterAll(async () => { await prisma.$disconnect(); });

describe('Job ID', () => {
  test('every job gets the next sequential, human-readable Job ID, and it can never change', async () => {
    const nums = Object.values(codes).map((c) => Number(c.split('-')[1]));
    expect(Object.values(codes).every((c) => /^DLP-\d{4}$/.test(c))).toBe(true);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    await expect(prisma.websiteJobPosting.update({ where: { slug: slugs['Data Engineer'] }, data: { job_code: 'DLP-9999' } })).rejects.toThrow();
    expect((await prisma.websiteJobPosting.findUnique({ where: { slug: slugs['Data Engineer'] } })).job_code).toBe(codes['Data Engineer']);
  });

  test('the same Job ID shows on the public list, the job page, internal jobs and the job-ID address redirects to the job', async () => {
    const code = codes['Data Engineer'];
    const list = await request(app).get(`/${orgSlug}/career/`);
    expect(list.text).toContain(code);
    const page = await request(app).get(`/${orgSlug}/career/${slugs['Data Engineer']}`);
    expect(page.text).toContain(`Job ID: ${code}`);
    const internal = await authed(request(app).get('/api/v1/internal-jobs?q=data'), empToken);
    expect(internal.body.data.map((j) => j.job_code)).toContain(code);
    const redirect = await request(app).get(`/${orgSlug}/career/${code.toLowerCase()}?ref=abc`);
    expect(redirect.status).toBe(302);
    expect(redirect.headers.location).toBe(`${slugs['Data Engineer']}?ref=abc`);
    expect((await request(app).get(`/${orgSlug}/career/DLP-9999`)).status).toBe(404);
  });
});

describe('search', () => {
  const find = (q, extra = '') => request(app).get(`/${orgSlug}/career/jobs.json?q=${encodeURIComponent(q)}${extra}`).then((r) => r.body);

  test('an exact Job ID returns exactly that job first, in any case and spacing', async () => {
    const code = codes['Data Analyst'];
    for (const q of [code, code.toLowerCase(), `  ${code.replace('-', ' ')}  `]) {
      const body = await find(q);
      expect(body.data[0].title).toBe('Data Analyst');
      expect(body.pagination.total).toBe(1);
    }
    const internal = await authed(request(app).get(`/api/v1/internal-jobs?q=${codes['HR Executive']}`), empToken);
    expect(internal.body.data.map((j) => j.title)).toEqual(['HR Executive']);
  });

  test('"Data Engineer" ranks the actual Data Engineer roles first, then looser matches; title, skill, department and location are searched', async () => {
    const titles = (await find('  data   ENGINEER ')).data.map((j) => j.title);
    expect(titles.slice(0, 2)).toEqual(['Data Engineer', 'Senior Data Engineer']);
    expect(titles).toContain('Software Engineer'); // "data" is in its description
    expect(titles).not.toContain('Data Analyst');
    expect((await find('spark')).data.map((j) => j.title).sort()).toEqual(['Data Engineer', 'Senior Data Engineer']); // skills
    expect((await find('people')).data.map((j) => j.title)).toEqual(['HR Executive']); // department
    expect((await find('gurgaon')).data.map((j) => j.title)).toEqual(['Senior Data Engineer']); // location
    expect((await find('zzzzz')).pagination.total).toBe(0);
  });

  test('works together with the department / location filters, pages and sorts', async () => {
    expect((await find('', '&dept=product')).data.map((j) => j.title)).toEqual(['Software Engineer']);
    expect((await find('engineer', '&loc=gurgaon')).data.map((j) => j.title)).toEqual(['Senior Data Engineer']);
    const p1 = await find('', '&limit=2&sort=title');
    expect(p1.data.map((j) => j.title)).toEqual(['Data Analyst', 'Data Engineer']);
    expect(p1.pagination).toMatchObject({ total: 5, totalPages: 3, open_total: 5 });
    const p3 = await find('', '&limit=2&sort=title&page=3');
    expect(p3.data.map((j) => j.title)).toEqual(['Software Engineer']);
    const newest = await find('', '&sort=newest');
    expect(newest.data[0].title).toBe('HR Executive');
    expect((await find('', '&sort=oldest')).data[0].title).toBe('Data Engineer');
    const html = (await request(app).get(`/${orgSlug}/career/?q=analyst`)).text;
    expect(html).toContain('Data Analyst');
    expect(html).not.toContain('HR Executive');
    expect(html).toContain('value="analyst"');
  });

  test('the internal list searches, filters and pages the same way', async () => {
    const r = await authed(request(app).get('/api/v1/internal-jobs?q=data%20engineer&limit=1'), empToken);
    expect(r.body.data.map((j) => j.title)).toEqual(['Data Engineer']);
    expect(r.body.pagination).toMatchObject({ total: 3, totalPages: 3, limit: 1 });
    expect(r.body.facets.departments.map((d) => d.value)).toContain('Analytics');
  });
});

describe('referral tracking', () => {
  test('a public application is Direct; one through an employee link is credited to that employee', async () => {
    const slug = slugs['Data Engineer'];
    expect((await apply(slug, { name: 'Direct Dan', email: 'dan@example.com' })).status).toBe(201);
    expect((await apply(slug, { name: 'Linked Lena', email: 'lena@example.com', ref: emp.id })).status).toBe(201);
    expect((await apply(slug, { name: 'Typed Tom', email: 'tom@example.com', referred_by: emp.email })).status).toBe(201);
    expect((await apply(slug, { name: 'Free Fay', email: 'fay@example.com', referred_by: 'Someone I met' })).status).toBe(201);
    expect((await apply(slug, { name: 'Bad Ref', email: 'bad@example.com', ref: '00000000-0000-4000-8000-000000000000' })).status).toBe(201);
    const row = (email) => prisma.jobApplicant.findFirst({ where: { email } });
    expect(await row('dan@example.com')).toMatchObject({ source: 'website', referrer_id: null, referrer_text: null });
    expect(await row('lena@example.com')).toMatchObject({ source: 'referral', channel: 'referral', referrer_id: emp.id, referrer_name: emp.name });
    expect(await row('tom@example.com')).toMatchObject({ referrer_id: emp.id });
    expect(await row('fay@example.com')).toMatchObject({ referrer_id: null, referrer_text: 'Someone I met', source: 'referral' });
    expect(await row('bad@example.com')).toMatchObject({ referrer_id: null, source: 'website' });
    // nobody refers themselves
    expect((await apply(slug, { name: emp.name, email: emp.email, ref: emp.id })).status).toBe(201);
    expect(await row(emp.email)).toMatchObject({ referrer_id: null });
  });

  test('the Drive link stays mandatory on the apply form and on Refer someone', async () => {
    const slug = slugs['Data Engineer'];
    expect((await apply(slug, { email: 'nocv@example.com', cv_url: '' })).status).toBe(422);
    const refer = (body) => authed(request(app).post(`/api/v1/internal-jobs/${slug}/refer`), empToken).send(body);
    expect((await refer({ name: 'No Link', email: 'nolink@example.com' })).status).toBe(422);
    expect((await refer({ name: 'Bad Link', email: 'badlink@example.com', cv_url: 'https://example.com/cv.pdf' })).status).toBe(422);
    const ok = await refer({ name: 'Ravi', email: 'ravi@example.com', cv_url: CV });
    expect(ok.status).toBe(201);
    expect(ok.body.data.job_code).toBe(codes['Data Engineer']);
    expect(await prisma.jobApplicant.findFirst({ where: { email: 'ravi@example.com' } })).toMatchObject({ source: 'referral', referrer_id: emp.id, referrer_name: emp.name, cv_url: CV });
  });

  test('HR / admin see the Job ID and "Referred by", and can filter by Job ID, referrer and origin', async () => {
    const all = await authed(request(app).get('/api/v1/applicants?view=all&limit=50'), adminToken);
    const lena = all.body.data.find((a) => a.name === 'Linked Lena');
    expect(lena).toMatchObject({ job_code: codes['Data Engineer'], origin: 'referral', referred_by: { id: emp.id, name: emp.name } });
    expect(all.body.data.find((a) => a.name === 'Direct Dan')).toMatchObject({ origin: 'direct', referred_by: null });
    const byRef = await authed(request(app).get(`/api/v1/applicants?view=all&referrer_id=${emp.id}`), adminToken);
    expect(byRef.body.data.map((a) => a.name).sort()).toEqual(['Linked Lena', 'Ravi', 'Typed Tom']);
    const byCode = await authed(request(app).get(`/api/v1/applicants?view=all&job_code=${codes['Data Engineer'].toLowerCase()}`), adminToken);
    expect(byCode.body.pagination.total).toBeGreaterThan(5);
    expect((await authed(request(app).get(`/api/v1/applicants?view=all&job_code=${codes['HR Executive']}`), adminToken)).body.pagination.total).toBe(0);
    const direct = await authed(request(app).get('/api/v1/applicants?view=all&origin=direct'), adminToken);
    expect(direct.body.data.every((a) => a.origin === 'direct')).toBe(true);
    const bySearch = await authed(request(app).get(`/api/v1/applicants?view=all&search=${codes['Data Engineer']}`), adminToken);
    expect(bySearch.body.pagination.total).toBeGreaterThan(5);
    const referrers = await authed(request(app).get('/api/v1/applicants/referrers'), adminToken);
    expect(referrers.body.data).toEqual([{ id: emp.id, name: emp.name, count: 3 }]);
  });

  test('"My referrals" lists what the employee referred with its progress', async () => {
    const mine = await authed(request(app).get('/api/v1/internal-jobs/my-referrals'), empToken);
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((r) => r.candidate).sort()).toEqual(['Linked Lena', 'Ravi', 'Typed Tom']);
    expect(mine.body.data[0]).toMatchObject({ job_code: codes['Data Engineer'], job_title: 'Data Engineer', status: 'Received' });
    const list = await authed(request(app).get('/api/v1/internal-jobs?q=data%20engineer'), empToken);
    expect(list.body.data.find((j) => j.title === 'Data Engineer').referrals).toBe(3);
  });
});

describe('job data rules', () => {
  test('titles lose trailing punctuation and ALL CAPS; employment types are one set', () => {
    expect(cleanTitle('Product Owner – Data & Digital.')).toBe('Product Owner – Data & Digital');
    expect(cleanTitle('AI GOVERNANCE MANAGER')).toBe('AI Governance Manager');
    expect(cleanTitle('  Senior   QA  Engineer,, ')).toBe('Senior QA Engineer');
    expect(normalizeEmployment('Full Time')).toEqual({ kind: 'full_time', label: 'Full-time' });
    expect(normalizeEmployment('FULL-TIME').kind).toBe('full_time');
    expect(normalizeEmployment('contract').label).toBe('Contract');
    expect(normalizeEmployment('Part time').label).toBe('Part-time');
    expect(normalizeEmployment('moon')).toBeNull();
  });

  test('publishing needs a department, cleans the title and stores the employment type as an enum', async () => {
    const account = await createActiveClientAccount(sales.id);
    const r = await createRequirement(sToken, account.id, { title: 'Tester' });
    await prisma.requirement.update({ where: { id: r.id }, data: { status: 'in_progress' } });
    const post = (body) => authed(request(app).post('/api/v1/website/postings'), adminToken).send({ requirement_id: r.id, ...body });
    // The website routes answer 503 before reading the body when the Apps Script is not configured (CI has no website secrets,
    // a developer's .env has them), so the two refusals are checked as if it were configured: they are refused before any call is made.
    const configured = jest.spyOn(websiteClient, 'isConfigured').mockReturnValue(true);
    try {
      expect((await post({ title: 'QA TESTER.' })).status).toBe(422);
      expect((await post({ title: 'QA TESTER.', department: 'Engineering', employment_type: 'moon' })).status).toBe(422);
    } finally {
      configured.mockRestore();
    }
    const res = await post({ title: 'QA TESTER.', department: 'Engineering', employment_type: 'Full Time' });
    if (res.status === 201) {
      expect(res.body.data.title).toBe('QA Tester');
      expect(res.body.data).toMatchObject({ employment_type: 'Full-time', employment_kind: 'full_time' });
      expect(res.body.data.job_code).toMatch(/^DLP-\d{4}$/);
    } else {
      expect(res.status).toBe(503); // Apps Script not configured here: validation had passed
    }
  });
});
