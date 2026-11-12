jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

// SaaS phase 3: the website "Request a trial" form becomes a lead in Delphic One. Closed until a platform admin opens it.
let org; let adminToken;
const send = (body) => request(app).post('/api/v1/public/trial-request').send(body);
const good = (over = {}) => ({ company_name: 'Sharma Traders', contact_name: 'Ravi Sharma', email: 'Ravi@Sharma-Traders.example', phone: '9876543210', users_expected: 12, message: 'We want to try payroll', ...over });
const openForm = (v) => prisma.saasSetting.update({ where: { key: 'trial_form_open' }, data: { value: v } });

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dox_customers, dox_leads, dox_lead_notes, dox_invoices, dox_invoice_payments, invoice_followups');
  org = await createOrg({ name: 'Delphic One', slug: 'delphic-one' });
  await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: ['delphic_one'] } });
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  adminToken = (await loginAs(admin)).access_token;
  await openForm(0);
});
afterAll(async () => { await openForm(0); await prisma.$disconnect(); });

describe('website trial request', () => {
  test('is closed by default: nothing is created', async () => {
    expect((await send(good())).status).toBe(404);
    expect(await prisma.doxLead.count()).toBe(0);
  });

  test('when opened, it makes an unassigned website lead with a note that Sales sees in Delphic One', async () => {
    await openForm(1);
    const res = await send(good());
    expect(res.status).toBe(201);
    const lead = await prisma.doxLead.findFirst();
    expect(lead).toMatchObject({ company_name: 'Sharma Traders', contact_email: 'ravi@sharma-traders.example', source: 'website', stage: 'new', users_expected: 12, owner_user_id: null });
    const notes = await prisma.doxLeadNote.findMany({ where: { lead_id: lead.id } });
    expect(notes[0].note).toContain('Trial request from the website');
    const list = await authed(request(app).get('/api/v1/delphic-one/leads'), adminToken);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).toContain('Sharma Traders');
  });

  test('asking twice adds a note to the open lead instead of a second lead', async () => {
    await openForm(1);
    await send(good());
    await send(good({ message: 'Any news?' }));
    expect(await prisma.doxLead.count()).toBe(1);
    expect(await prisma.doxLeadNote.count()).toBe(2);
  });

  test('a bad request is refused, and a bot filling the hidden field gets a success but no lead', async () => {
    await openForm(1);
    expect((await send(good({ email: 'not-an-email' }))).status).toBe(422);
    expect((await send(good({ company_name: '' }))).status).toBe(422);
    const bot = await send(good({ website: 'http://spam.example' }));
    expect(bot.status).toBe(201);
    expect(await prisma.doxLead.count()).toBe(0);
  });

  test('with no Delphic One workspace there is nowhere to put it: closed', async () => {
    await openForm(1);
    await prisma.org.update({ where: { id: org.id }, data: { enabled_modules: [] } });
    expect((await send(good())).status).toBe(404);
  });
});
