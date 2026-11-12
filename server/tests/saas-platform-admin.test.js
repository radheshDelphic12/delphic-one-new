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
  delete process.env.SAAS_ENFORCE_ENTITLEMENTS;
  await prisma.saasSetting.deleteMany({ where: { key: { startsWith: 'switch.' } } });
  await prisma.saasAudit.deleteMany({});
  require('../src/modules/platform/switches.service').clearCache();
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

describe('switches and audit trail', () => {
  test('the three switches default to off and are turned on and off from the platform screen, with a confirm step', async () => {
    const state = async () => Object.fromEntries((await api('get', '/switches', pTok)).body.data.map((x) => [x.name, x]));
    let st = await state();
    expect(Object.keys(st).sort()).toEqual(['counter', 'enforce', 'provisioning']);
    expect(Object.values(st).every((x) => x.on === false && x.source === 'default (off)')).toBe(true);
    expect((await api('put', '/switches/enforce', cTok, { on: true, confirm: true })).status).toBe(403);
    expect((await api('put', '/switches/enforce', pTok, { on: true })).status).toBe(422); // no confirm
    expect((await api('put', '/switches/nonsense', pTok, { on: true, confirm: true })).status).toBe(422);
    expect((await api('put', '/switches/enforce', pTok, { on: true, confirm: true })).status).toBe(200);
    st = await state();
    expect(st.enforce).toMatchObject({ on: true, source: 'platform screen' });
    expect(st.counter.on).toBe(false);
    // a value set on the screen wins over the server setting; the server setting is only the fallback
    process.env.SAAS_ENFORCE_ENTITLEMENTS = 'true';
    expect((await api('put', '/switches/enforce', pTok, { on: false, confirm: true })).status).toBe(200);
    expect((await state()).enforce.on).toBe(false);
    await prisma.saasSetting.deleteMany({ where: { key: 'switch.enforce' } });
    require('../src/modules/platform/switches.service').clearCache();
    expect((await state()).enforce).toMatchObject({ on: true, source: 'server setting (initial)' });
  });

  test('switches do not show among the numeric settings and cannot be edited as one', async () => {
    await api('put', '/switches/counter', pTok, { on: true, confirm: true });
    const keys = (await api('get', '/settings', pTok)).body.data.map((r) => r.key);
    expect(keys.some((k) => k.startsWith('switch.'))).toBe(false);
    expect((await api('patch', '/settings/switch.counter', pTok, { value: 0 })).status).toBe(404);
  });

  test('every platform edit leaves an audit row with who, before and after', async () => {
    await api('patch', '/modules/BANK', pTok, { name: 'Banking', coming_soon: false });
    await api('put', '/modules/BANK/dependencies', pTok, { needs: [{ code: 'BILL' }] });
    const book = (await api('post', '/price-books', pTok, { name: 'Test book', effective_from: '2027-03-01' })).body.data.id;
    await api('patch', `/price-books/${book}`, pTok, { admin_price: 650, prices: { BILL: 14 } });
    await api('patch', '/settings/trial_days', pTok, { value: 18 });
    await api('put', '/switches/provisioning', pTok, { on: true, confirm: true });
    const add = await api('post', '/admins', pTok, { email: companyAdmin.email });
    await api('delete', `/admins/${add.body.data.id}`, pTok);
    const rows = (await api('get', '/audit', pTok)).body.data;
    const by = (action) => rows.find((r) => r.action === action);
    expect(by('module_edited')).toMatchObject({ entity: 'module', entity_id: 'BANK', before: { name: 'Banking Management', coming_soon: true }, after: { name: 'Banking', coming_soon: false } });
    expect(by('module_edited').actor.email).toBe(platform.email);
    expect(by('dependencies_edited').after).toEqual([{ code: 'BILL', group: 1 }]);
    expect(by('price_book_created').after.name).toBe('Test book');
    expect(by('price_book_edited')).toMatchObject({ before: { admin_price: 500, prices: { BILL: 10 } }, after: { admin_price: 650, prices: { BILL: 14 } } });
    expect(by('setting_edited')).toMatchObject({ entity_id: 'trial_days', before: { value: 15 }, after: { value: 18 } });
    expect(by('switch_on')).toMatchObject({ entity_id: 'provisioning', after: { on: true } });
    expect(by('admin_added')).toBeTruthy();
    expect(by('admin_removed').before.email).toBe(companyAdmin.email);
    expect((await api('get', '/audit', cTok)).status).toBe(403);
  });
});
