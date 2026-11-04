// Finance > Projects: editing a project's rate must change the rate the project shows and bills, even when an older-dated
// rate already exists (a Billing Setup rate, or one added before the agreement start date was corrected).
const { app, prisma, request, cleanDatabase, createUser, loginAs, createOrg, createOrgMembership, authed } = require('./helpers');

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedOrgAdmin() {
  const org = await createOrg({ name: 'Delphic', slug: 'delphic' });
  const admin = await createUser({ role: 'admin' });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  const { access_token } = await loginAs(admin);
  return { org, token: access_token };
}

const addProject = (token, body) => authed(request(app).post('/api/v1/calendars/projects'), token).send(body);
const patch = (token, id, body) => authed(request(app).patch(`/api/v1/billing/projects/${id}`), token).send(body);
const profile = async (token, id) => (await authed(request(app).get(`/api/v1/billing/projects/${id}`), token)).body.data;

describe('editing a project rate', () => {
  test('a rate dated after the agreement start does not hide the rate the person just saved', async () => {
    const { org, token } = await seedOrgAdmin();
    await prisma.calendar.create({ data: { org_id: org.id, name: 'Calendar', kind: 'internal' } });
    const project = (await addProject(token, { name: 'SDC mobile app', service_category: 'project' })).body.data;

    // the agreement started on 14 Oct, but a rate was recorded from 20 Oct (Billing Setup)
    await patch(token, project.id, { agreement_start_date: '2026-10-14' });
    const setup = await authed(request(app).post('/api/v1/billing/rates'), token).send({ account_id: project.id, rate_type: 'monthly', rate: 100000, currency: 'INR', effective_from: '2026-10-20' });
    expect(setup.status).toBe(201);
    expect((await profile(token, project.id)).rate).toBe(100000);

    // Finance > Projects: the rate is changed with no date typed
    const edited = await patch(token, project.id, { billing: { rate_type: 'monthly', rate: 120000, currency: 'INR' } });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ billing_type: 'monthly', rate: 120000 });
    expect(await profile(token, project.id)).toMatchObject({ rate: 120000 });
    // the earlier rate stays in the history, never rewritten
    expect(await prisma.billingRate.count({ where: { account_id: project.id } })).toBe(2);
  });

  test('a later scheduled rate is left alone; the edit applies from the agreement start / today', async () => {
    const { org, token } = await seedOrgAdmin();
    await prisma.calendar.create({ data: { org_id: org.id, name: 'Calendar', kind: 'internal' } });
    const project = (await addProject(token, { name: 'Scheduled', service_category: 'project' })).body.data;
    await patch(token, project.id, { agreement_start_date: '2026-01-01' });
    await authed(request(app).post('/api/v1/billing/rates'), token).send({ account_id: project.id, rate_type: 'monthly', rate: 50000, currency: 'INR', effective_from: '2099-01-01' });

    const edited = await patch(token, project.id, { billing: { rate_type: 'monthly', rate: 60000, currency: 'INR' } });
    expect(edited.status).toBe(200);
    expect(edited.body.data.rate).toBe(60000);
  });
});
