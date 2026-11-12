jest.setTimeout(120000);
/** An admin / recruiter can correct an applicant after the fact; the same rules as adding apply. */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed } = require('./helpers');

let sToken; let adminToken; let empToken; let req;
const api = (method, path, t, body) => authed(request(app)[method](`/api/v1/applicants${path}`), t).send(body);

beforeAll(async () => {
  await cleanDatabase();
  const sales = await createUser({ role: 'sales' });
  ({ access_token: sToken } = await loginAs(sales));
  ({ access_token: adminToken } = await loginAs(await createUser({ role: 'admin' })));
  ({ access_token: empToken } = await loginAs(await createUser({ role: 'employee' })));
  const account = await createActiveClientAccount(sales.id);
  req = await createRequirement(sToken, account.id, { title: 'Node Developer' });
  await prisma.requirement.update({ where: { id: req.id }, data: { status: 'in_progress' } });
});
afterAll(async () => { await prisma.$disconnect(); });

const add = async (over = {}) => (await api('post', '', adminToken, { requirement_id: req.id, name: 'Asha Rao', email: 'asha@example.com', phone: '9876500001', linkedin_url: 'https://www.linkedin.com/in/asha', current_ctc_lpa: 8, expected_ctc_lpa: 12, notice_period_days: 30, joiner_status: 'no', work_mode: 'hybrid', extra_skills: 'React, Node', ...over })).body.data;

describe('editing an applicant', () => {
  test('any field sent is changed, a blank one is cleared, the rest stays; it is audited', async () => {
    const a = await add();
    const r = await api('patch', `/${a.id}`, adminToken, { name: 'Asha R', expected_ctc_lpa: 15, extra_skills: '', work_mode: '' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ name: 'Asha R', email: 'asha@example.com', current_ctc_lpa: 8, expected_ctc_lpa: 15, work_mode: null, extra_skills: [], notice_period_days: 30 });
    const log = await prisma.auditLog.findFirst({ where: { entity_id: a.id, action: 'applicant_update' } });
    expect(log.snapshot.before.name).toBe('Asha Rao');
    expect(log.snapshot.after.name).toBe('Asha R');
  });

  test('LinkedIn must stay a profile link; the rules of adding hold when editing', async () => {
    const a = await add({ email: 'b@example.com', phone: '9876500002', linkedin_url: 'https://www.linkedin.com/in/b' });
    expect((await api('patch', `/${a.id}`, adminToken, { linkedin_url: 'https://example.com/in/b' })).status).toBe(422);
    expect((await api('patch', `/${a.id}`, adminToken, { linkedin_url: 'linkedin.com/in/b-new' })).body.data.linkedin_url).toBe('https://linkedin.com/in/b-new');
    expect((await api('patch', `/${a.id}`, adminToken, { joiner_status: 'serving_notice' })).status).toBe(422); // needs a last working day
    expect((await api('patch', `/${a.id}`, adminToken, { joiner_status: 'serving_notice', last_working_day: '2026-12-01' })).status).toBe(200);
  });

  test('an edit cannot make one person two: same email, phone or LinkedIn as another applicant is refused', async () => {
    const a = await add({ email: 'c@example.com', phone: '9876500003', linkedin_url: 'https://www.linkedin.com/in/c' });
    const b = await add({ email: 'd@example.com', phone: '9876500004', linkedin_url: 'https://www.linkedin.com/in/d' });
    expect((await api('patch', `/${b.id}`, adminToken, { email: 'C@example.com' })).status).toBe(409);
    expect((await api('patch', `/${b.id}`, adminToken, { phone: '98765 00003' })).status).toBe(409);
    expect((await api('patch', `/${b.id}`, adminToken, { linkedin_url: 'https://in.linkedin.com/in/c/' })).status).toBe(409);
    expect((await api('patch', `/${a.id}`, adminToken, { notes: 'same person, saved again' })).status).toBe(200); // not a duplicate of itself
  });

  test('only admin, sales and recruiters may edit; an unknown applicant is a 404', async () => {
    const a = await add({ email: 'e@example.com', phone: '9876500005', linkedin_url: 'https://www.linkedin.com/in/e' });
    expect((await api('patch', `/${a.id}`, empToken, { name: 'X' })).status).toBe(403);
    expect((await api('patch', `/${a.id}`, sToken, { name: 'Sales edit' })).status).toBe(200);
    expect((await api('patch', '/11111111-1111-4111-8111-111111111111', adminToken, { name: 'X' })).status).toBe(404);
  });
});
