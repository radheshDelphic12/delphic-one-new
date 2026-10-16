/** Screening answers on applications: required on the public form, stored, copied to the Profile on claim, and filterable. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');
const websitePostings = require('../src/modules/website/postings.service');

let sToken; let r1Token; let req; let slug;
const api = '/api/v1/applicants';
const full = { phone: '98765 43210', linkedin_url: 'linkedin.com/in/asha', currently_working: 'yes', joiner_status: 'serving_notice', last_working_day: '2026-11-15', notice_period_days: 30, current_ctc_lpa: 10, expected_ctc_lpa: 14, work_mode: 'hybrid', extra_skills: 'React, Node.js', cv_url: 'https://drive.google.com/file/d/abc123/view' };
let seq = 0;
// every applicant gets their own phone number: the same phone on one job counts as the same person
const apply = (body) => request(app).post(`/api/v1/public/jobs/${slug}/apply`).send({ name: 'Asha Rao', email: 'asha@example.com', ...full, phone: `98765 ${String(10000 + (seq += 1))}`, ...(seq > 1 && body?.email ? { linkedin_url: `https://www.linkedin.com/in/asha-${seq}` } : {}), ...body });

beforeAll(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  ({ access_token: sToken } = await loginAs(sales));
  ({ access_token: r1Token } = await loginAs(await createUser({ role: 'recruiter' })));
  const account = await createActiveClientAccount(sales.id);
  req = await createRequirement(sToken, account.id, { title: 'Node Developer' });
  await prisma.requirement.update({ where: { id: req.id }, data: { status: 'in_progress' } });
  slug = await websitePostings.newSlug('Node Developer');
  await prisma.websiteJobPosting.create({ data: { org_id: req.org_id, requirement_id: req.id, title: 'Node Developer', created_by: sales.id, slug } });
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

describe('applicant screening', () => {
  test('the public form requires the screening answers, with the last working day while serving notice', async () => {
    const missing = await request(app).post(`/api/v1/public/jobs/${slug}/apply`).send({ name: 'No Answers', email: 'n@example.com', phone: '9999999999' });
    expect(missing.status).toBe(422);
    expect(JSON.stringify(missing.body)).toMatch(/LinkedIn|CTC|notice/i);
    expect((await apply({ email: 'lwd@example.com', last_working_day: '' })).status).toBe(422);
    expect((await apply({ email: 'bad@example.com', linkedin_url: 'not a link' })).status).toBe(422);
    expect((await apply({ email: 'mode@example.com', work_mode: 'moon' })).status).toBe(422);
    // the public form takes the CV as a Google Drive / Docs link only
    expect((await apply({ email: 'cv@example.com', cv_url: 'https://example.com/cv.pdf' })).status).toBe(422);
  });

  test('answers are stored; CTC is lakh per annum; skills lower-case; an immediate joiner needs no last working day', async () => {
    expect((await apply({})).status).toBe(201);
    const a = await prisma.jobApplicant.findFirst({ where: { email: 'asha@example.com' } });
    expect(a).toMatchObject({ currently_working: true, joiner_status: 'serving_notice', notice_period_days: 30, work_mode: 'hybrid', linkedin_url: 'https://linkedin.com/in/asha', cv_url: 'https://drive.google.com/file/d/abc123/view', extra_skills: ['react', 'node.js'] });
    expect(Number(a.current_ctc_lpa)).toBe(10);
    expect(Number(a.expected_ctc_lpa)).toBe(14);
    expect(a.last_working_day.toISOString().slice(0, 10)).toBe('2026-11-15');

    expect((await apply({ name: 'Imran', email: 'imran@example.com', joiner_status: 'yes', currently_working: 'no', notice_period_days: 0, last_working_day: '', current_ctc_lpa: 0, expected_ctc_lpa: 8, work_mode: 'remote', extra_skills: '', cv_url: '' })).status).toBe(201);
    expect((await apply({ name: 'Kiran', email: 'kiran@example.com', joiner_status: 'no', currently_working: 'yes', notice_period_days: 90, last_working_day: '', current_ctc_lpa: 20, expected_ctc_lpa: 30, work_mode: 'onsite', extra_skills: 'Java' })).status).toBe(201);
    const imran = await prisma.jobApplicant.findFirst({ where: { email: 'imran@example.com' } });
    expect(imran).toMatchObject({ currently_working: false, joiner_status: 'yes', notice_period_days: 0, last_working_day: null });
  });

  test('recruiters filter the pool by the screening answers; people who did not answer never match a filtered question', async () => {
    // an old-style applicant with no answers at all
    expect((await authed(request(app).post(api), r1Token).send({ requirement_id: req.id, name: 'Old Style', email: 'old@example.com' })).status).toBe(201);
    const q = async (params) => (await authed(request(app).get(api).query({ view: 'pool', ...params }), r1Token)).body.data.map((r) => r.name).sort();
    expect(await q({})).toEqual(['Asha Rao', 'Imran', 'Kiran', 'Old Style']);
    expect(await q({ joiner: 'yes' })).toEqual(['Imran']);
    expect(await q({ joiner: 'serving_notice' })).toEqual(['Asha Rao']);
    expect(await q({ notice_max: 30 })).toEqual(['Asha Rao', 'Imran']);
    expect(await q({ expected_ctc_max: 14 })).toEqual(['Asha Rao', 'Imran']);
    expect(await q({ expected_ctc_min: 10, expected_ctc_max: 20 })).toEqual(['Asha Rao']);
    expect(await q({ work_mode: 'onsite' })).toEqual(['Kiran']);
    expect(await q({ working: 'no' })).toEqual(['Imran']);
    expect(await q({ lwd_before: '2026-11-30' })).toEqual(['Asha Rao']);
    expect(await q({ skill: 'REACT' })).toEqual(['Asha Rao']);
    expect(await q({ joiner: 'no', work_mode: 'onsite', skill: 'java' })).toEqual(['Kiran']);
    const row = (await authed(request(app).get(api).query({ view: 'pool', joiner: 'serving_notice' }), r1Token)).body.data[0];
    expect(row).toMatchObject({ joiner_status: 'serving_notice', notice_period_days: 30, current_ctc_lpa: 10, expected_ctc_lpa: 14, work_mode: 'hybrid', extra_skills: ['react', 'node.js'] });
  });

  test('claiming creates the Profile with the answers (CTC in rupees)', async () => {
    const asha = await prisma.jobApplicant.findFirst({ where: { email: 'asha@example.com' } });
    expect((await authed(request(app).post(`${api}/${asha.id}/assign`), r1Token).send({})).status).toBe(200);
    const profile = await prisma.profile.findFirst({ where: { email: 'asha@example.com' } });
    expect(profile).toMatchObject({ linkedin_url: 'https://linkedin.com/in/asha', resume_url: 'https://drive.google.com/file/d/abc123/view', notice_period_days: 30, is_serving_notice: true, preferred_work_mode: 'hybrid', secondary_skills: ['react', 'node.js'] });
    expect(Number(profile.current_ctc)).toBe(1000000);
    expect(Number(profile.expected_ctc)).toBe(1400000);
  });
});
