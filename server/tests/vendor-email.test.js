// Phase 8: emailing requirements to vendors: pick vendors by specialization, preview, CC the owner, log every send.
const { app, prisma, request, cleanDatabase, createUser, loginAs, createRequirement, createActiveClientAccount, authed, unique } = require('./helpers');
const outbox = require('../src/lib/email/outbox');

let sales; let sToken; let owner; let req1; let req2; let clientName;

const vendor = (data) => prisma.account.create({ data: { type: 'vendor', stage: 'active', owner_id: owner.id, origin_owner_id: owner.id, org_id: req1.org_id, ...data } });

beforeAll(async () => {
  await cleanDatabase();
  sales = await createUser({ role: 'sales', name: 'Chahak Sales' });
  ({ access_token: sToken } = await loginAs(sales));
  owner = await createUser({ role: 'bda', name: 'Vendor Owner' });
  const account = await createActiveClientAccount(sales.id);
  clientName = account.name;
  req1 = await createRequirement(sToken, account.id, { title: 'Java Developer', seats_total: 2, primary_tech_stack: ['Java', 'Spring'], experience_min: 3, experience_max: 6 });
  req2 = await createRequirement(sToken, account.id, { title: 'QA Engineer' });
  await vendor({ name: 'Alpha Staffing', poc_name: 'Asha', poc_email: 'asha@alpha.test', vendor_specializations: ['java', 'qa'] });
  await vendor({ name: 'Beta Resources', poc_name: 'Bala', poc_email: 'bala@beta.test', vendor_specializations: ['data'] });
  await vendor({ name: 'No Email Vendor', vendor_specializations: ['java'] });
  await vendor({ name: 'Dropped Vendor', poc_email: 'd@drop.test', stage: 'dropped', vendor_specializations: ['java'] });
}, 120000);
afterAll(async () => { await prisma.$disconnect(); });

const get = (p, t = sToken) => authed(request(app).get(`/api/v1/vendor-email${p}`), t);
const post = (p, b, t = sToken) => authed(request(app).post(`/api/v1/vendor-email${p}`), t).send(b);

describe('vendor email', () => {
  test('lists active vendors only, filterable by specialization or name, with the owner and whether they can be emailed', async () => {
    const all = (await get('/vendors')).body.data;
    expect(all.vendors.map((v) => v.name)).toEqual(['Alpha Staffing', 'Beta Resources', 'No Email Vendor']);
    expect(all.specializations).toEqual(['data', 'java', 'qa']);
    expect(all.vendors.find((v) => v.name === 'No Email Vendor').can_email).toBe(false);
    expect(all.vendors[0].owner).toMatchObject({ name: 'Vendor Owner' });
    expect((await get('/vendors?specialization=java')).body.data.vendors.map((v) => v.name)).toEqual(['Alpha Staffing', 'No Email Vendor']);
    expect((await get('/vendors?search=beta')).body.data.vendors.map((v) => v.name)).toEqual(['Beta Resources']);
  });

  test('preview shows the exact text and recipients (with the CC) and sends nothing; the client is never named', async () => {
    const vendors = (await get('/vendors')).body.data.vendors;
    const ids = vendors.map((v) => v.id);
    const res = await post('/preview', { requirement_ids: [req1.id, req2.id], vendor_ids: ids, message: 'Urgent hiring.' });
    expect(res.status).toBe(200);
    expect(res.body.data.subject).toBe('2 open requirements from Delphic');
    expect(res.body.data.body_text).toContain('Java Developer (2 openings)');
    expect(res.body.data.body_text).toContain('Experience: 3-6 years');
    expect(res.body.data.body_text).toContain('Urgent hiring.');
    expect(res.body.data.body_text).not.toContain(clientName);
    expect(res.body.data.recipients.map((r) => [r.vendor, r.to, r.cc])).toEqual([['Alpha Staffing', 'asha@alpha.test', owner.email], ['Beta Resources', 'bala@beta.test', owner.email]]);
    expect(res.body.data.skipped).toEqual([expect.objectContaining({ vendor: 'No Email Vendor' })]);
    expect(await prisma.emailOutbox.count({ where: { kind: 'vendor_requirements' } })).toBe(0);
    expect(await prisma.vendorEmailLog.count()).toBe(0);
  });

  test('sending queues one email per vendor with the owner CC\'d, logs it, and the log shows delivery status', async () => {
    const ids = (await get('/vendors?specialization=java')).body.data.vendors.map((v) => v.id);
    const sent = await post('/send', { requirement_ids: [req1.id], vendor_ids: ids });
    expect(sent.status).toBe(201);
    expect(sent.body.data.queued).toBe(1);
    expect(sent.body.data.skipped).toHaveLength(1);
    const row = await prisma.emailOutbox.findFirst({ where: { kind: 'vendor_requirements' } });
    expect(row).toMatchObject({ to_email: 'asha@alpha.test', cc_email: owner.email, subject: 'Requirement: Java Developer' });
    expect(row.body_text).toContain('Chahak Sales');
    // delivery: the CC header goes on the real message
    const sentMail = [];
    await outbox.processQueue({ transport: { sendMail: async (m) => { sentMail.push(m); } } });
    expect(sentMail[0].cc).toBe(owner.email);
    const log = (await get('/log')).body.data;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ sent_by: 'Chahak Sales', subject: 'Requirement: Java Developer' });
    expect(log[0].recipients[0]).toMatchObject({ vendor: 'Alpha Staffing', status: 'sent' });
  });

  test('a send with nobody to email is refused and logs nothing; other roles and missing requirements are refused', async () => {
    const noEmail = (await get('/vendors?search=no email')).body.data.vendors.map((v) => v.id);
    const before = await prisma.vendorEmailLog.count();
    expect((await post('/send', { requirement_ids: [req1.id], vendor_ids: noEmail })).status).toBe(422);
    expect(await prisma.vendorEmailLog.count()).toBe(before);
    expect((await post('/preview', { requirement_ids: ['00000000-0000-4000-8000-000000000000'], vendor_ids: noEmail })).status).toBe(404);
    const recruiter = await createUser({ role: 'recruiter' });
    const rToken = (await loginAs(recruiter)).access_token;
    expect((await get('/vendors', rToken)).status).toBe(403);
    expect((await post('/send', { requirement_ids: [req1.id], vendor_ids: noEmail }, rToken)).status).toBe(403);
    expect(unique('x')).toBeTruthy();
  });
});
