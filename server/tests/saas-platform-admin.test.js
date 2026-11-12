const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const service = require('../src/modules/platform/platform.service');

// SaaS launch, phase 1: the platform-admin gate and the editable module catalogue / price books / settings.
let platform; let companyAdmin; let groupSuper; let pTok; let cTok; let gTok;

const api = (method, path, tok, body) => {
  const r = authed(request(app)[method](`/api/v1/platform${path}`), tok);
  return body ? r.send(body) : r;
};

beforeEach(async () => {
  await cleanDatabase();
  const org = await createOrg({ name: 'Our Company' });
  platform = await createUser({ role: 'admin' });
  await createOrgMembership(platform.id, org.id, { role: 'admin' });
  companyAdmin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(companyAdmin.id, org.id, { role: 'admin' });
  groupSuper = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: groupSuper.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: groupSuper.id, org_group_id: org.org_group_id } });
  await createOrgMembership(groupSuper.id, org.id, { role: 'admin' });
  await prisma.platformAdmin.create({ data: { user_id: platform.id } });
  ({ access_token: pTok } = await loginAs(platform));
  ({ access_token: cTok } = await loginAs(companyAdmin));
  ({ access_token: gTok } = await loginAs(groupSuper));
});
afterEach(async () => {
  // catalogue edits in a test must not leak into the next: put the seeded rows back as the migration made them
  await prisma.saasModule.deleteMany({ where: { code: { in: ['TSTX', 'TSTY'] } } });
  await prisma.saasModuleDependency.deleteMany({ where: { module_code: { in: ['BANK', 'CLVN'] } } });
  await prisma.saasModule.update({ where: { code: 'BANK' }, data: { name: 'Banking Management', coming_soon: true } });
  await prisma.saasPriceBook.deleteMany({ where: { name: 'Test book' } });
  await prisma.saasSetting.update({ where: { key: 'trial_days' }, data: { value: 15 } });
  delete process.env.PLATFORM_ADMIN_EMAILS;
});
afterAll(async () => { await prisma.$disconnect(); });

describe('platform-admin gate', () => {
  test('only the named platform admins get in; company admins and group super admins are refused', async () => {
    expect((await api('get', '/me', pTok)).status).toBe(200);
    expect((await api('get', '/modules', cTok)).status).toBe(403);
    expect((await api('get', '/modules', gTok)).status).toBe(403);
    expect((await request(app).get('/api/v1/platform/modules')).status).toBe(401);
  });

  test('the environment list names a first admin before any row exists', async () => {
    process.env.PLATFORM_ADMIN_EMAILS = `someone@else.com, ${companyAdmin.email.toUpperCase()}`;
    expect((await api('get', '/me', cTok)).status).toBe(200);
  });

  test('an admin can add another by email and remove them again', async () => {
    const add = await api('post', '/admins', pTok, { email: companyAdmin.email });
    expect(add.status).toBe(201);
    expect((await api('get', '/me', cTok)).status).toBe(200);
    expect((await api('post', '/admins', pTok, { email: companyAdmin.email })).status).toBe(409);
    expect((await api('post', '/admins', pTok, { email: 'nobody@nowhere.test' })).status).toBe(404);
    expect((await api('delete', `/admins/${add.body.data.id}`, pTok)).status).toBe(200);
    expect((await api('get', '/me', cTok)).status).toBe(403);
  });
});

describe('catalogue', () => {
  test('the seeded catalogue: 28 modules add up to Rs 215, Basic View Rs 50, admin Rs 500', async () => {
    const res = await api('get', '/modules', pTok);
    const { modules, price_book: book } = res.body.data;
    expect(modules).toHaveLength(29);
    expect(modules.filter((m) => !m.is_basic).reduce((a, m) => a + m.price_30d, 0)).toBe(215);
    expect(modules.find((m) => m.code === 'BASC').price_30d).toBe(50);
    expect(book.admin_price).toBe(500);
    expect(modules.find((m) => m.code === 'GSTD').coming_soon).toBe(true);
  });

  test('a module is edited and added by its code; the code never changes; bad codes are refused', async () => {
    expect((await api('patch', '/modules/BANK', pTok, { name: 'Banking', coming_soon: false })).status).toBe(200);
    expect((await api('post', '/modules', pTok, { code: 'bad', name: 'x1' })).status).toBe(422);
    expect((await api('post', '/modules', pTok, { code: 'BANK', name: 'Dup' })).status).toBe(409);
    const made = await api('post', '/modules', pTok, { code: 'TSTX', name: 'Test module', price_30d: 7 });
    expect(made.status).toBe(201);
    const list = (await api('get', '/modules', pTok)).body.data.modules;
    expect(list.find((m) => m.code === 'TSTX').price_30d).toBe(7);
    expect(list.find((m) => m.code === 'BANK').name).toBe('Banking');
  });

  test('dependencies can be edited, but a loop is refused', async () => {
    expect(await prisma.saasModuleDependency.count({ where: { module_code: 'PAYR' } })).toBe(2);
    expect((await api('put', '/modules/BANK/dependencies', pTok, { needs: [{ code: 'BILL' }] })).status).toBe(200);
    // BILL needs CLVN; making CLVN need BANK would close BANK -> BILL -> CLVN -> BANK
    expect((await api('put', '/modules/CLVN/dependencies', pTok, { needs: [{ code: 'BANK' }] })).status).toBe(422);
    expect((await api('put', '/modules/BANK/dependencies', pTok, { needs: [{ code: 'BANK' }] })).status).toBe(422);
    expect((await api('put', '/modules/BANK/dependencies', pTok, { needs: [{ code: 'ZZZZ' }] })).status).toBe(422);
  });

  test('prerequisites are added automatically; an any-of group is satisfied by what is already chosen', async () => {
    const payroll = await service.withPrerequisites(['PAYR']);
    expect(payroll.all.sort()).toEqual(['ATLV', 'BASC', 'EMPM', 'PAYR']);
    expect(payroll.added.sort()).toEqual(['ATLV', 'BASC', 'EMPM']);
    // Interviews need Client Hiring OR Internal Hiring: with Internal Hiring chosen, Client Hiring is not forced in
    const withInternal = await service.withPrerequisites(['INAS', 'INHR']);
    expect(withInternal.all).not.toContain('CLHR');
    // with neither chosen, the first alternative in catalogue order is added
    const alone = await service.withPrerequisites(['INAS']);
    expect(alone.all).toContain('CLHR');
    expect(alone.all).toContain('RQLD');
    expect(alone.all).toContain('CLVN');
  });
});

describe('price books and settings', () => {
  test('a new price book copies the latest, and the book in force for a date is the latest one effective by then', async () => {
    const made = await api('post', '/price-books', pTok, { name: 'Test book', effective_from: '2027-01-01' });
    expect(made.status).toBe(201);
    const id = made.body.data.id;
    expect((await api('patch', `/price-books/${id}`, pTok, { admin_price: 600, prices: { BILL: 12 } })).status).toBe(200);
    const books = (await api('get', '/price-books', pTok)).body.data;
    const mine = books.find((b) => b.id === id);
    expect(mine.prices.BILL).toBe(12);
    expect(mine.prices.CLVN).toBe(8); // copied
    expect((await service.bookFor(new Date('2026-12-31'))).name).toBe('Launch price book');
    expect((await service.bookFor(new Date('2027-01-01'))).name).toBe('Test book');
  });

  test('settings are numbers an admin can change', async () => {
    expect(await service.settingNumber('trial_days', 0)).toBe(15);
    expect((await api('patch', '/settings/trial_days', pTok, { value: 21 })).status).toBe(200);
    expect(await service.settingNumber('trial_days', 0)).toBe(21);
    expect((await api('patch', '/settings/nope', pTok, { value: 1 })).status).toBe(404);
    expect((await api('patch', '/settings/trial_days', pTok, { value: -3 })).status).toBe(422);
  });
});
