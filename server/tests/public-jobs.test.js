/** The public job link (/careers/<slug>): open without login, tracks where the applicant came from, closes with the job. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');
const websitePostings = require('../src/modules/website/postings.service');

let sToken;
let rToken;
let req;
let slug;

beforeAll(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  ({ access_token: sToken } = await loginAs(sales));
  ({ access_token: rToken } = await loginAs(await createUser({ role: 'recruiter' })));
  const account = await createActiveClientAccount(sales.id);
  req = await createRequirement(sToken, account.id, { title: 'Senior React Developer' });
  await prisma.requirement.update({ where: { id: req.id }, data: { status: 'in_progress' } });
  slug = await websitePostings.newSlug('Senior React Developer');
  await prisma.websiteJobPosting.create({
    data: { org_id: req.org_id, requirement_id: req.id, title: 'Senior React Developer', department: 'Engineering', location: 'Indore', employment_type: 'Full-time', public_description: 'Build things.', created_by: sales.id, slug },
  });
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

let seq = 0;
const screening = { phone: '98765 43210', linkedin_url: 'https://www.linkedin.com/in/asha', currently_working: 'yes', joiner_status: 'no', notice_period_days: 30, current_ctc_lpa: 10, expected_ctc_lpa: 14, work_mode: 'hybrid' };
const apply = (body) => request(app).post(`/api/v1/public/jobs/${slug}/apply`).send({ name: 'Asha Rao', email: 'asha@example.com', ...screening, phone: `98765 ${String(20000 + (seq += 1))}`, ...(seq > 1 && body?.email ? { linkedin_url: `https://www.linkedin.com/in/asha-${seq}` } : {}), ...body });

describe('public job link', () => {
  test('slug is the readable title plus 4 characters, and the page is open without login and shows only the public copy', async () => {
    expect(slug).toMatch(/^senior-react-developer-[0-9a-f]{4}$/);
    const r = await request(app).get(`/api/v1/public/jobs/${slug}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ slug, title: 'Senior React Developer', location: 'Indore', description: 'Build things.' });
    expect(Object.keys(r.body.data).sort()).toEqual(['department', 'description', 'employment_type', 'location', 'posted_at', 'slug', 'title']);
    expect((await request(app).get('/api/v1/public/jobs')).body.data.map((j) => j.slug)).toEqual([slug]);
    expect((await request(app).get('/api/v1/public/jobs/nope-0000')).status).toBe(404);
  });

  test('an application lands in the applicant pool with the channel from the link; the same person cannot apply twice', async () => {
    const r = await apply({ channel: 'LinkedIn', phone: '98765 43210', experience_years: 3, message: 'Hi' });
    expect(r.status).toBe(201);
    const row = await prisma.jobApplicant.findFirst({ where: { requirement_id: req.id } });
    expect(row).toMatchObject({ name: 'Asha Rao', email: 'asha@example.com', source: 'website', channel: 'linkedin', status: 'new' });
    expect(Number(row.experience_years)).toBe(3); // stored, so the Applicants list can show it
    expect((await apply({ channel: 'linkedin' })).status).toBe(409);
    const other = await apply({ name: 'Bhavna', email: 'b@example.com', channel: 'mystery' });
    expect(other.status).toBe(201);
    expect((await prisma.jobApplicant.findFirst({ where: { email: 'b@example.com' } })).channel).toBe('other');
    expect((await apply({ name: 'C', email: 'c@example.com' })).status).toBe(201);
    expect((await prisma.jobApplicant.findFirst({ where: { email: 'c@example.com' } })).channel).toBe('website');
  });

  test('bad input is rejected, a filled honeypot stores nothing, and recruiters see the source counts', async () => {
    expect((await apply({ email: 'not-an-email' })).status).toBe(422);
    const before = await prisma.jobApplicant.count();
    expect((await apply({ name: 'Bot', email: 'bot@example.com', company_website: 'http://spam' })).status).toBe(201);
    expect(await prisma.jobApplicant.count()).toBe(before);
    const reqs = (await authed(request(app).get('/api/v1/applicants/requirements'), rToken)).body.data;
    expect(reqs.find((x) => x.id === req.id)).toMatchObject({ website: { slug }, channels: { linkedin: 1, other: 1, website: 1 } });
  });

  test('the link stops working when the posting is closed or the requirement leaves in-progress', async () => {
    await prisma.websiteJobPosting.update({ where: { requirement_id: req.id }, data: { status: 'closed' } });
    expect((await request(app).get(`/api/v1/public/jobs/${slug}`)).status).toBe(404);
    expect((await apply({ name: 'D', email: 'd@example.com' })).status).toBe(404);
    await prisma.websiteJobPosting.update({ where: { requirement_id: req.id }, data: { status: 'published' } });
    await prisma.requirement.update({ where: { id: req.id }, data: { status: 'closed' } });
    expect((await request(app).get(`/api/v1/public/jobs/${slug}`)).status).toBe(404);
  });
});
