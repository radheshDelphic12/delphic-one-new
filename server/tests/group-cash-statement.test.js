// Group Book Keeping > Statements: one statement for a bank account, a wallet, a company or a legal entity, as JSON, CSV or PDF.
// INR and USD are never added together, so a company / entity holding both needs a currency.
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

const base = '/api/v1/group-cash';
let a; let b; let token; let entity; let accINR; let accUSD; let w1; let w2; let w3;
beforeEach(async () => {
  await cleanDatabase();
  a = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
  b = await createOrg({ name: 'Other Co', slug: 'other', org_group_id: a.org_group_id });
  const su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: a.org_group_id } });
  await createOrgMembership(su.id, a.id, { role: 'admin' });
  ({ access_token: token } = await loginAs(su));

  const post = (p, body) => authed(request(app).post(`${base}${p}`), token).send(body);
  entity = (await post('/entities', { name: 'Statement Ltd' })).body.data.entity;
  const mk = async (name, currency, opening) => {
    const r = await post('/accounts', { legal_entity_id: entity.id, name, type: 'current', bank_name: 'HDFC', account_last4: '1234', currency, declared_opening_balance: String(opening), opening_date: '2026-04-01' });
    expect(r.status).toBe(201);
    return r.body.data.account;
  };
  accINR = await mk('INR Current', 'INR', 1500);
  accUSD = await mk('USD Current', 'USD', 200);
  const wallet = (acc, currency, owner, name, opening) => prisma.wallet.create({ data: { org_group_id: acc.org_group_id, bank_account_id: acc.id, currency, purpose: 'general', name, opening_balance: String(opening), ...owner } });
  w1 = await wallet(accINR, 'INR', { owner_org_id: a.id }, 'Delphic wallet', 1000);
  w2 = await wallet(accINR, 'INR', { owner_org_id: b.id }, 'Other wallet', 500);
  w3 = await wallet(accUSD, 'USD', { owner_org_id: a.id }, 'Delphic USD wallet', 200);
  await post(`/wallets/${w1.id}/transactions`, { date: '2026-05-01', direction: 'in', amount: '300', mode: 'upi', party: 'Client A' });
  await post(`/wallets/${w1.id}/transactions`, { date: '2026-06-10', direction: 'out', amount: '100', mode: 'neft', party: 'Vendor B' });
  await post(`/wallets/${w2.id}/transactions`, { date: '2026-05-15', direction: 'in', amount: '50', mode: 'cash' });
  await post(`/wallets/${w3.id}/transactions`, { date: '2026-05-20', direction: 'in', amount: '25', mode: 'swift' });
});
afterAll(async () => { await prisma.$disconnect(); });

const stmt = (q) => authed(request(app).get(`${base}/statement`).query(q), token);

describe('group cash statements', () => {
  test('a wallet and a bank account', async () => {
    const w = (await stmt({ scope: 'wallet', id: w1.id })).body.data;
    expect(w).toMatchObject({ opening_balance: '1000.00', total_in: '300.00', total_out: '100.00', closing_balance: '1200.00' });
    expect(w.rows.map((r) => r.balance_after)).toEqual(['1300.00', '1200.00']);

    const acc = (await stmt({ scope: 'account', id: accINR.id })).body.data;
    expect(acc).toMatchObject({ opening_balance: '1500.00', total_in: '350.00', total_out: '100.00', closing_balance: '1750.00' });
    expect(acc.rows).toHaveLength(3);
  });

  test('a company is the wallets it owns; the date range moves the opening balance', async () => {
    const all = (await stmt({ scope: 'company', id: a.id, currency: 'INR' })).body.data;
    expect(all.wallet.name).toBe('Delphic Global');
    expect(all).toMatchObject({ opening_balance: '1000.00', closing_balance: '1200.00' });
    expect(all.wallet.currency).toBe('INR');
    expect(all.rows).toHaveLength(2);

    const june = (await stmt({ scope: 'company', id: a.id, currency: 'INR', from: '2026-06-01' })).body.data;
    expect(june).toMatchObject({ opening_balance: '1300.00', total_in: '0.00', total_out: '100.00', closing_balance: '1200.00' });
    expect(june.rows).toHaveLength(1);
  });

  test('a company or entity holding INR and USD needs a currency; each is its own statement', async () => {
    const need = await stmt({ scope: 'company', id: a.id });
    expect(need.status).toBe(422);
    const usd = (await stmt({ scope: 'company', id: a.id, currency: 'USD' })).body.data;
    expect(usd).toMatchObject({ opening_balance: '200.00', closing_balance: '225.00' });

    const ent = await stmt({ scope: 'entity', id: entity.id });
    expect(ent.status).toBe(422);
    const entInr = (await stmt({ scope: 'entity', id: entity.id, currency: 'INR' })).body.data;
    expect(entInr).toMatchObject({ opening_balance: '1500.00', total_in: '350.00', total_out: '100.00', closing_balance: '1750.00' });
    expect(entInr.rows).toHaveLength(3);
  });

  test('CSV and PDF downloads; unknown or foreign ids are 404; a bad scope is refused', async () => {
    const csv = await stmt({ scope: 'company', id: a.id, currency: 'INR', format: 'csv' });
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Delphic Global');
    expect(csv.text).toContain('Closing balance,1200.00');
    expect(csv.text).not.toContain('()');

    const pdf = await stmt({ scope: 'entity', id: entity.id, currency: 'INR', format: 'pdf' });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/pdf/);

    expect((await stmt({ scope: 'company', id: '00000000-0000-4000-8000-000000000001' })).status).toBe(404);
    expect((await stmt({ scope: 'nonsense', id: a.id })).status).toBe(422);
  });
});
