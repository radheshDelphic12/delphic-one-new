/**
 * Accounts > AI suggestions: the AI suggests new companies that could become clients, the service each could take and who to approach; the
 * companies we already know are never suggested again; a suggestion becomes a lead account; no phone numbers or emails.
 */
const { app, prisma, request, cleanDatabase, createUser, loginAs, createActiveClientAccount, authed } = require('./helpers');
const env = require('../src/config/env');
const { setProvider, AiUnavailableError } = require('../src/modules/aiInterviews/aiClient');

let adminToken;
let recruiterToken;
let existingName;
const seenPrompts = [];
let answer;

const company = (name, over = {}) => ({
  name, industry: 'Fintech', company_size: 'mid', location: 'Bengaluru, India', why_fit: `${name} hires many backend engineers.`,
  services: [{ key: 'managed_services', pitch: 'Dedicated Java engineers' }, { key: 'recruitment', pitch: 'Hire a tech lead' }],
  decision_makers: ['Head of Engineering', 'VP Technology'], approach: 'Start with the engineering head.', ...over,
});

beforeAll(() => { env.aiInterview.apiKey = 'test-key'; });
beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE ai_client_suggestions');
  seenPrompts.length = 0;
  answer = { companies: [] };
  setProvider(async ({ messages }) => { seenPrompts.push(messages[0].content); return { text: JSON.stringify(answer), usage: { input: 10, output: 10 } }; });
  const sales = await createUser({ role: 'sales' });
  const admin = await createUser({ role: 'admin' });
  const recruiter = await createUser({ role: 'recruiter' });
  adminToken = (await loginAs(admin)).access_token;
  recruiterToken = (await loginAs(recruiter)).access_token;
  const account = await createActiveClientAccount(sales.id);
  existingName = account.name;
  const membership = await prisma.orgMembership.findFirst({ where: { person_id: admin.id } });
  await prisma.account.update({ where: { id: account.id }, data: { org_id: membership.org_id, industry: 'Healthcare IT', location_city: 'Pune', location_country: 'India' } });
});
afterAll(async () => {
  setProvider(null);
  await prisma.$disconnect();
});

const L = '/api/v1/lead-suggestions';
const get = (query = {}, token = adminToken) => authed(request(app).get(L), token).query(query);
const post = (path, body, token = adminToken) => authed(request(app).post(`${L}${path}`), token).send(body || {});

describe('AI client suggestions', () => {
  test('the AI gets what we already have, its answer is cleaned (known companies, unknown services, contact details dropped) and saved', async () => {
    answer = {
      companies: [
        company('Acme Payments', { phone: '+91 9999999999', email: 'ceo@acme.test', website: 'https://acme.test' }),
        company(existingName), // already our account
        company('NoService Ltd', { services: [{ key: 'made_up', pitch: 'x' }] }), // no real service to offer
        company('Beta Bank', { services: [{ key: 'project', pitch: 'Build their loan app' }], decision_makers: ['CTO'] }),
      ],
    };
    const res = await post('/generate', { count: 5, focus: 'banks in Bengaluru' });
    expect(res.status).toBe(201);
    expect(res.body.data.items.map((i) => i.name)).toEqual(['Acme Payments', 'Beta Bank']);
    const acme = res.body.data.items[0];
    expect(acme).toMatchObject({ industry: 'Fintech', company_size: 'mid', status: 'new', decision_makers: ['Head of Engineering', 'VP Technology'] });
    expect(acme.services).toEqual([{ key: 'managed_services', service: 'Managed services', pitch: 'Dedicated Java engineers' }, { key: 'recruitment', service: 'Recruitment', pitch: 'Hire a tech lead' }]);
    expect(JSON.stringify(res.body)).not.toMatch(/9999999999|ceo@acme|acme\.test/); // no phone, email or web address is kept
    const prompt = seenPrompts[0];
    expect(prompt).toContain(existingName); // told which companies we already know
    expect(prompt).toContain('Healthcare IT');
    expect(prompt).toContain('banks in Bengaluru');

    // the same company is not suggested twice, even by a later request
    answer = { companies: [company('acme payments'), company('Gamma Retail')] };
    const again = await post('/generate', { count: 5 });
    expect(again.body.data.items.map((i) => i.name)).toEqual(['Gamma Retail']);
    expect((await get()).body.data.items).toHaveLength(3);
    expect((await get({ status: 'dismissed' })).body.data.items).toHaveLength(0);
  });

  test('add as a lead creates a client account at stage Lead with the AI notes; twice is refused; dismiss and restore', async () => {
    answer = { companies: [company('Acme Payments')] };
    const id = (await post('/generate', {})).body.data.items[0].id;
    expect((await post(`/${id}/dismiss`)).status).toBe(200);
    expect((await get({ status: 'dismissed' })).body.data.items.map((i) => i.name)).toEqual(['Acme Payments']);
    expect((await post(`/${id}/restore`)).status).toBe(200);

    const added = await post(`/${id}/add`);
    expect(added.status).toBe(200);
    const account = await prisma.account.findUnique({ where: { id: added.body.data.account_id } });
    expect(account).toMatchObject({ name: 'Acme Payments', type: 'client', stage: 'lead', industry: 'Fintech', company_size: 'mid', location_city: 'Bengaluru', location_country: 'India', source: 'AI suggestion' });
    expect(account.meeting_notes).toMatch(/Why it fits: Acme Payments hires many backend engineers/);
    expect(account.meeting_notes).toMatch(/Managed services: Dedicated Java engineers/);
    expect(account.meeting_notes).toMatch(/Roles to approach: Head of Engineering, VP Technology/);
    expect((await get({ status: 'added' })).body.data.items[0]).toMatchObject({ status: 'added', account_id: account.id });
    expect((await post(`/${id}/add`)).status).toBe(409);
    expect((await post(`/${id}/dismiss`)).status).toBe(409);
  });

  test('when the AI is not available the request says so and nothing is saved; only people who may create accounts can ask', async () => {
    setProvider(async () => { throw new AiUnavailableError('down'); });
    const res = await post('/generate', {});
    expect(res.status).toBe(503);
    expect((await get()).body.data.items).toEqual([]);
    expect((await post('/generate', {}, recruiterToken)).status).toBe(403);
    expect((await post('/generate', { count: 99 })).status).toBe(422); // at most 15 at a time
  });
});
