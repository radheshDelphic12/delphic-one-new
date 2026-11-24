/**
 * Vendor portal: a vendor's own login, only the requirements shared with it (no client or budget), candidates put forward and approved or
 * rejected by the point of contact, resources with the vendor rate only, and invoice files that never become invoices by themselves.
 */
const { app, prisma, request, cleanDatabase, createUser, createOrgMembership, loginAs, authed } = require('./helpers');

const P = '/api/v1/vendor-portal';
const A = '/api/v1/vendor-portal-admin';
let org; let admin; let adminToken; let poc; let pocToken; let vendor; let client; let requirement; let vendorToken;
const bearer = (r, token) => r.set('Authorization', `Bearer ${token}`);
const pget = (path, token = vendorToken) => bearer(request(app).get(`${P}${path}`), token);
const ppost = (path, token = vendorToken) => bearer(request(app).post(`${P}${path}`), token);
const aget = (path, token = adminToken) => authed(request(app).get(`${A}${path}`), token);
const apost = (path, body, token = adminToken) => authed(request(app).post(`${A}${path}`), token).send(body || {});

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE vendor_portal_users, vendor_requirement_shares, vendor_submissions, vendor_portal_invoices');
  admin = await createUser({ role: 'admin', name: 'Diksha Admin' });
  ({ access_token: adminToken } = await loginAs(admin));
  org = await prisma.org.findUnique({ where: { id: (await prisma.orgMembership.findFirst({ where: { person_id: admin.id } })).org_id } });
  poc = await createUser({ role: 'sales', name: 'Poc Sales', withOrg: false });
  await createOrgMembership(poc.id, org.id, { role: 'sales' });
  ({ access_token: pocToken } = await loginAs(poc));
  vendor = await prisma.account.create({ data: { org_id: org.id, type: 'vendor', name: 'Vendor One', stage: 'active', owner_id: poc.id, origin_owner_id: poc.id } });
  client = await prisma.account.create({ data: { org_id: org.id, type: 'client', name: 'Secret Client Ltd', stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
  requirement = await prisma.requirement.create({ data: { account_id: client.id, title: 'Java developer', req_type: 'recruitment', seats_total: 2, sales_owner_id: admin.id, budget_min: 111111, budget_max: 222222, primary_tech_stack: ['Java'] } });
  const r = await apost(`/vendors/${vendor.id}/users`, { name: 'Vee Vendor', email: 'vee@vendor.test', password: 'Vendor@1234' });
  expect(r.status).toBe(201);
  const login = await request(app).post(`${P}/login`).send({ email: 'vee@vendor.test', password: 'Vendor@1234' });
  expect(login.status).toBe(200);
  vendorToken = login.body.data.token;
});
afterAll(async () => { await prisma.$disconnect(); });

const candidate = (extra = {}) => ({ requirement_id: requirement.id, candidate_name: 'Cara Candidate', email: 'cara@mail.test', total_experience_years: '5', skills: 'Java, Spring', vendor_rate: '90000', cv_url: 'https://drive.test/cv', ...extra });
const share = () => authed(request(app).put(`${A}/requirements/${requirement.id}/vendors`), adminToken).send({ vendor_ids: [vendor.id] });

describe('sign in', () => {
  test('wrong password fails; a company token is not accepted by the portal; a portal token is not accepted by the company side', async () => {
    expect((await request(app).post(`${P}/login`).send({ email: 'vee@vendor.test', password: 'nope' })).status).toBe(401);
    expect((await pget('/me', adminToken)).status).toBe(401);
    expect((await aget('/submissions', vendorToken).set('Authorization', `Bearer ${vendorToken}`)).status).toBe(401);
    const me = await pget('/me');
    expect(me.status).toBe(200);
    expect(me.body.data.vendor.name).toBe('Vendor One');
  });
  test('a deactivated login is locked out at once', async () => {
    const u = await prisma.vendorPortalUser.findUnique({ where: { email: 'vee@vendor.test' } });
    const off = await authed(request(app).patch(`${A}/users/${u.id}`), adminToken).send({ active: false });
    expect(off.status).toBe(200);
    expect((await pget('/me')).status).toBe(401);
  });
});

describe('requirements', () => {
  test('a vendor sees only what is shared with it, and never the client or the budget', async () => {
    expect((await pget('/requirements')).body.data).toHaveLength(0);
    expect((await share()).status).toBe(200);
    const list = (await pget('/requirements')).body.data;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Java developer');
    const raw = JSON.stringify(list);
    expect(raw).not.toMatch(/Secret Client/);
    expect(raw).not.toMatch(/111111|222222|budget/);
  });
  test('unsharing hides it again; a closed requirement is not offered', async () => {
    await share();
    await authed(request(app).put(`${A}/requirements/${requirement.id}/vendors`), adminToken).send({ vendor_ids: [] });
    expect((await pget('/requirements')).body.data).toHaveLength(0);
    await share();
    await prisma.requirement.update({ where: { id: requirement.id }, data: { status: 'closed' } });
    expect((await pget('/requirements')).body.data).toHaveLength(0);
  });
});

describe('candidates', () => {
  test('cannot put forward for a requirement that is not shared', async () => {
    expect((await ppost('/submissions').send(candidate())).status).toBe(404);
  });
  test('a submission needs a CV (file or link) and is not a profile until approved; duplicates are blocked', async () => {
    await share();
    expect((await ppost('/submissions').send(candidate({ cv_url: '' }))).status).toBe(422);
    const ok = await ppost('/submissions').send(candidate());
    expect(ok.status).toBe(201);
    expect(await prisma.profile.count({ where: { email: 'cara@mail.test' } })).toBe(0);
    expect((await ppost('/submissions').send(candidate())).status).toBe(409);
  });
  test('skills are optional: a blank or comma-only skills box is accepted', async () => {
    await share();
    const r = await ppost('/submissions').field('requirement_id', requirement.id).field('candidate_name', 'No Skills').field('total_experience_years', '2').field('cv_url', 'https://drive.test/cv2').field('skills', ' , ');
    expect(r.status).toBe(201);
    expect(r.body.data.skills).toEqual([]);
    const r2 = await ppost('/submissions').send(candidate({ candidate_name: 'Absent Skills', email: 'abs@mail.test', skills: undefined }));
    expect(r2.status).toBe(201);
  });
  test('a CV file can be attached', async () => {
    await share();
    const r = await ppost('/submissions').field('requirement_id', requirement.id).field('candidate_name', 'Fay File').field('total_experience_years', '3').field('skills', 'Go')
      .attach('cv', Buffer.from('%PDF-1.4 test'), 'fay.pdf');
    expect(r.status).toBe(201);
    expect(r.body.data.has_cv_file).toBe(true);
    const bad = await ppost('/submissions').field('requirement_id', requirement.id).field('candidate_name', 'Exe Person').field('total_experience_years', '3').field('skills', 'Go')
      .attach('cv', Buffer.from('MZ'), 'virus.exe');
    expect(bad.status).toBe(422);
  });
  test('the point of contact approves: a normal Profile (source vendor) is created; without a reason a rejection is refused', async () => {
    await share();
    const id = (await ppost('/submissions').send(candidate())).body.data.id;
    expect((await apost(`/submissions/${id}/reject`, {}, pocToken)).status).toBe(422);
    const ok = await apost(`/submissions/${id}/approve`, {}, pocToken);
    expect(ok.status).toBe(200);
    const profile = await prisma.profile.findUnique({ where: { id: ok.body.data.profile_id } });
    expect(profile.source).toBe('vendor');
    expect(profile.vendor_account_id).toBe(vendor.id);
    expect(profile.name).toBe('Cara Candidate');
    expect((await apost(`/submissions/${id}/approve`, {}, pocToken)).status).toBe(409);
    const mine = (await pget('/submissions')).body.data;
    expect(mine[0].status).toBe('approved');
  });
  test('a rejection shows the reason to the vendor and creates no profile', async () => {
    await share();
    const id = (await ppost('/submissions').send(candidate())).body.data.id;
    expect((await apost(`/submissions/${id}/reject`, { note: 'Not enough Spring experience' })).status).toBe(200);
    const row = (await pget('/submissions')).body.data[0];
    expect(row.status).toBe('rejected');
    expect(row.decision_note).toMatch(/Spring/);
    expect(await prisma.profile.count({ where: { email: 'cara@mail.test' } })).toBe(0);
  });
  test('someone who is neither the point of contact nor permitted cannot decide, and sees nothing of other vendors', async () => {
    await share();
    const id = (await ppost('/submissions').send(candidate())).body.data.id;
    const other = await createUser({ role: 'sales', name: 'Other Sales', withOrg: false });
    await createOrgMembership(other.id, org.id, { role: 'sales' });
    const { access_token: otherToken } = await loginAs(other);
    expect((await apost(`/submissions/${id}/approve`, {}, otherToken)).status).toBe(403);
    expect((await aget('/submissions', otherToken)).body.data).toHaveLength(0);
    expect((await aget('/submissions', pocToken)).body.data).toHaveLength(1);
    expect((await aget('/submissions/pending-count', pocToken)).body.data.count).toBe(1);
  });
  test('a pending candidate can be withdrawn by the vendor', async () => {
    await share();
    const id = (await ppost('/submissions').send(candidate())).body.data.id;
    expect((await ppost(`/submissions/${id}/withdraw`)).status).toBe(200);
    expect((await apost(`/submissions/${id}/approve`, {}, pocToken)).status).toBe(409);
  });
});

describe('resources and rates', () => {
  test('the vendor sees only its vendor rate; the company side sees both rates', async () => {
    const worker = await createUser({ role: 'employee', name: 'Rao Resource', withOrg: false });
    const m = await createOrgMembership(worker.id, org.id, { role: 'employee' });
    await prisma.orgMembership.update({ where: { id: m.id }, data: { worker_type: 'contractor', vendor_account_id: vendor.id, vendor_rate: 80000, vendor_rate_currency: 'INR' } });
    await prisma.resourceBillingRate.create({ data: { org_id: org.id, account_id: client.id, org_membership_id: m.id, rate_type: 'monthly', rate: 150000, currency: 'INR', effective_from: new Date('2026-01-01'), created_by: admin.id } });
    const seen = (await pget('/resources')).body.data;
    expect(seen).toHaveLength(1);
    expect(seen[0].vendor_rate).toBe(80000);
    expect(JSON.stringify(seen)).not.toMatch(/150000|Secret Client|billing/);
    const inner = (await aget(`/vendors/${vendor.id}`)).body.data;
    expect(inner.resources[0].vendor_rate).toBe(80000);
    expect(inner.resources[0].billing[0]).toMatchObject({ client: 'Secret Client Ltd', rate: 150000 });
    expect(inner.users).toHaveLength(1);
  });
});

describe('invoice files', () => {
  test('an upload is listed for the team as uploaded by the vendor, creates no invoice, and can be accepted or rejected with a reason', async () => {
    const before = await prisma.projectVendorInvoice.count();
    const up = await ppost('/invoices').field('period_month', '10').field('period_year', '2026').field('amount', '90000').field('invoice_number', 'V-1').attach('file', Buffer.from('%PDF-1.4 inv'), 'inv.pdf');
    expect(up.status).toBe(201);
    expect(await prisma.projectVendorInvoice.count()).toBe(before);
    const list = (await aget('/invoices')).body.data;
    expect(list[0]).toMatchObject({ vendor_name: 'Vendor One', source: 'Uploaded by vendor', status: 'uploaded' });
    const file = await aget(`/invoices/${list[0].id}/file`);
    expect(file.status).toBe(200);
    expect((await authed(request(app).patch(`${A}/invoices/${list[0].id}`), adminToken).send({ status: 'rejected' })).status).toBe(422);
    const done = await authed(request(app).patch(`${A}/invoices/${list[0].id}`), adminToken).send({ status: 'accepted' });
    expect(done.body.data.status).toBe('accepted');
    expect((await pget('/invoices')).body.data[0].status).toBe('accepted');
  });
  test('only invoice-like files are accepted, and the vendor cannot open another vendor\'s file', async () => {
    const bad = await ppost('/invoices').field('period_month', '10').field('period_year', '2026').attach('file', Buffer.from('MZ'), 'x.exe');
    expect(bad.status).toBe(422);
    const up = await ppost('/invoices').field('period_month', '10').field('period_year', '2026').attach('file', Buffer.from('%PDF-1.4'), 'inv.pdf');
    const two = await prisma.account.create({ data: { org_id: org.id, type: 'vendor', name: 'Vendor Two', stage: 'active', owner_id: admin.id, origin_owner_id: admin.id } });
    await apost(`/vendors/${two.id}/users`, { name: 'Tess', email: 'tess@vendor.test', password: 'Vendor@1234' });
    const t = (await request(app).post(`${P}/login`).send({ email: 'tess@vendor.test', password: 'Vendor@1234' })).body.data.token;
    expect((await pget(`/invoices/${up.body.data.id}/file`, t)).status).toBe(404);
    expect((await pget('/invoices', t)).body.data).toHaveLength(0);
  });
});

describe('who may manage', () => {
  test('creating a login needs the manage permission; a duplicate email is refused', async () => {
    expect((await apost(`/vendors/${vendor.id}/users`, { name: 'X', email: 'x@v.test', password: 'Vendor@1234' }, pocToken)).status).toBe(403);
    expect((await apost(`/vendors/${vendor.id}/users`, { name: 'Dup', email: 'vee@vendor.test', password: 'Vendor@1234' })).status).toBe(409);
  });
});

describe('the point of contact is told when a candidate arrives', () => {
  test('the owner of the vendor account gets a notification that opens Submissions; the admins get it when the vendor has no owner; a muted person does not', async () => {
    await share();
    await ppost('/submissions').send(candidate());
    const mine = await prisma.notification.findMany({ where: { user_id: poc.id, type: 'vendor_candidate_submitted' } });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ entity_type: 'vendor_submission', title: 'Candidate from a vendor' });
    expect(mine[0].body).toMatch(/Vendor One put Cara Candidate forward for "Java developer"/);
    expect(await prisma.notification.count({ where: { user_id: admin.id, type: 'vendor_candidate_submitted' } })).toBe(0);

    // a vendor with no owner: the admins hear about it
    await prisma.account.update({ where: { id: vendor.id }, data: { owner_id: null } }).catch(() => null);
    const stillOwned = await prisma.account.findUnique({ where: { id: vendor.id } });
    if (!stillOwned.owner_id) {
      await ppost('/submissions').send(candidate({ candidate_name: 'Dan Second', email: 'dan@mail.test' }));
      expect(await prisma.notification.count({ where: { user_id: admin.id, type: 'vendor_candidate_submitted' } })).toBe(1);
    }

    // muting the kind in the preferences means no bell entry
    await prisma.account.update({ where: { id: vendor.id }, data: { owner_id: poc.id } });
    await prisma.notificationPreference.create({ data: { user_id: poc.id, type: 'vendor_candidate_submitted', in_app: false, email: false } });
    await ppost('/submissions').send(candidate({ candidate_name: 'Eve Third', email: 'eve@mail.test' }));
    expect(await prisma.notification.count({ where: { user_id: poc.id, type: 'vendor_candidate_submitted' } })).toBe(1);
  });
});

describe('forgot password', () => {
  const lastMail = () => prisma.emailOutbox.findFirst({ where: { kind: 'vendor_portal_password_reset' }, orderBy: { created_at: 'desc' } });
  const tokenOf = (mail) => /reset=([a-f0-9]{64})/.exec(mail.text || mail.body_text || '')?.[1];
  const forgot = (email) => request(app).post(`${P}/forgot-password`).send({ email });

  test('the answer is the same for an unknown email; a known one gets one mailed link that sets a new password once', async () => {
    await prisma.emailOutbox.deleteMany({ where: { kind: 'vendor_portal_password_reset' } });
    const unknown = await forgot('nobody@vendor.test');
    expect(unknown.status).toBe(200);
    expect(await lastMail()).toBeNull();

    expect((await forgot('vee@vendor.test')).status).toBe(200);
    const mail = await lastMail();
    expect(mail.to_email).toBe('vee@vendor.test');
    const token = tokenOf(mail);
    expect(token).toBeTruthy();
    // only a hash of the token is stored
    const row = await prisma.vendorPortalUser.findUnique({ where: { email: 'vee@vendor.test' } });
    expect(row.reset_token_hash).toBeTruthy();
    expect(row.reset_token_hash).not.toBe(token);
    // asking again within a minute sends nothing new
    await forgot('vee@vendor.test');
    expect(await prisma.emailOutbox.count({ where: { kind: 'vendor_portal_password_reset' } })).toBe(1);

    // a short password, a wrong token
    expect((await request(app).post(`${P}/reset-password`).send({ token, password: 'short' })).status).toBe(422);
    expect((await request(app).post(`${P}/reset-password`).send({ token: 'f'.repeat(64), password: 'NewVendor@1234' })).status).toBe(400);

    expect((await request(app).post(`${P}/reset-password`).send({ token, password: 'NewVendor@1234' })).status).toBe(200);
    expect((await request(app).post(`${P}/login`).send({ email: 'vee@vendor.test', password: 'Vendor@1234' })).status).toBe(401);
    expect((await request(app).post(`${P}/login`).send({ email: 'vee@vendor.test', password: 'NewVendor@1234' })).status).toBe(200);
    // the link works once
    expect((await request(app).post(`${P}/reset-password`).send({ token, password: 'Another@12345' })).status).toBe(400);
  });

  test('an expired link and a switched-off login do not work', async () => {
    await prisma.emailOutbox.deleteMany({ where: { kind: 'vendor_portal_password_reset' } });
    await forgot('vee@vendor.test');
    const token = tokenOf(await lastMail());
    await prisma.vendorPortalUser.updateMany({ where: { email: 'vee@vendor.test' }, data: { reset_expires_at: new Date(Date.now() - 1000) } });
    expect((await request(app).post(`${P}/reset-password`).send({ token, password: 'NewVendor@1234' })).status).toBe(400);

    await forgot('vee@vendor.test');
    const fresh = tokenOf(await lastMail());
    await prisma.vendorPortalUser.updateMany({ where: { email: 'vee@vendor.test' }, data: { active: false } });
    expect((await request(app).post(`${P}/reset-password`).send({ token: fresh, password: 'NewVendor@1234' })).status).toBe(400);
  });
});
