const fs = require('fs');
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const env = require('../src/config/env');
const calc = require('../src/modules/cashPosition/cash.calc');

const base = '/api/v1/group-cash';
let a; let b; let group; let superToken; let adminAToken; let adminBToken; let salesToken;

beforeEach(async () => {
  await cleanDatabase();
  a = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
  group = { id: a.org_group_id };
  b = await createOrg({ name: 'Gulati Industries', slug: 'gulati', org_group_id: group.id });
  const su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: group.id } });
  await createOrgMembership(su.id, a.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(su));
  const adminA = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(adminA.id, a.id, { role: 'admin' });
  ({ access_token: adminAToken } = await loginAs(adminA));
  const adminB = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(adminB.id, b.id, { role: 'admin' });
  ({ access_token: adminBToken } = await loginAs(adminB));
  const sales = await createUser({ role: 'sales', withOrg: false });
  await createOrgMembership(sales.id, a.id, { role: 'sales' });
  ({ access_token: salesToken } = await loginAs(sales));
});
afterAll(async () => { await prisma.$disconnect(); });

const post = (path, body, t = superToken) => authed(request(app).post(`${base}${path}`), t).send(body);
const patch = (path, body, t = superToken) => authed(request(app).patch(`${base}${path}`), t).send(body);
const get = (path, t = superToken) => authed(request(app).get(`${base}${path}`), t);
const del = (path, t = superToken) => authed(request(app).delete(`${base}${path}`), t);
const data = (r) => r.body.data;

async function entity(name = 'Delphic Global', workspace_id = a.id) {
  return data(await post('/entities', { name, workspace_id })).entity;
}
// An account no longer gets a wallet on its own. Most of these tests still want one that holds the declared opening
// balance, so this helper adds it (the way Setup used to), unless `bare` is passed.
async function account(legal_entity_id, { bare = false, ...over } = {}) {
  const r = await post('/accounts', { legal_entity_id, name: 'Current A/C', type: 'current', bank_name: 'HDFC', account_last4: '1234', currency: 'INR', declared_opening_balance: '1000', opening_date: '2026-04-01', ...over });
  const out = data(r);
  if (bare || !r.status || r.status >= 300) return out;
  const w = await prisma.wallet.create({ data: { org_group_id: out.account.org_group_id, bank_account_id: out.account.id, currency: out.account.currency, owner_legal_entity_id: legal_entity_id, purpose: 'unallocated', name: 'Unallocated', opening_balance: out.account.declared_opening_balance } });
  return { ...out, wallet: { ...w, opening_balance: Number(w.opening_balance).toFixed(2) } };
}
async function wallet(bank_account_id, over = {}) {
  const r = await post('/wallets', { bank_account_id, owner_org_id: b.id, name: 'Gulati wallet', opening_balance: '0', ...over });
  return data(r).wallet;
}
const tx = (walletId, body, t = superToken) => post(`/wallets/${walletId}/transactions`, { date: '2026-05-10', direction: 'in', amount: '100', mode: 'upi', ...body }, t);
const balanceOf = async (walletId) => {
  const pos = data(await get('/position'));
  return pos.entities.flatMap((e) => e.accounts).flatMap((x) => x.wallets).find((w) => w.id === walletId)?.balance;
};

describe('group cash: money rules', () => {
  test('derived balances use exact decimals and never drift', () => {
    expect(calc.walletBalance('0', [{ direction: 'in', amount: '0.10' }, { direction: 'in', amount: '0.20' }]).toFixed(2)).toBe('0.30');
    expect(calc.walletBalance('10.00', [{ direction: 'out', amount: '2.50' }, { direction: 'in', amount: '0.05' }]).toFixed(2)).toBe('7.55');
    expect(calc.transferKind({ bank_account_id: 'x' }, { bank_account_id: 'x' })).toBe('reallocation');
    expect(calc.transferKind({ bank_account_id: 'x' }, { bank_account_id: 'y' })).toBe('bank_transfer');
  });
});

describe('group cash: legal entities, accounts, wallets', () => {
  test('only the group superadmin may use the group API', async () => {
    for (const t of [adminAToken, adminBToken, salesToken]) {
      expect((await get('/position', t)).status).toBe(403);
      expect((await post('/entities', { name: 'X' }, t)).status).toBe(403);
    }
    expect((await get('/position')).status).toBe(200);
  });

  test('default entities are created once for Delphic Global and Gulati Industries, linked to their workspaces', async () => {
    const first = await post('/entities/seed-defaults', {});
    expect(first.status).toBe(201);
    expect(data(first).created.map((e) => e.name).sort()).toEqual(['Delphic Global', 'Gulati Industries']);
    expect(data(await post('/entities/seed-defaults', {})).created).toHaveLength(0);
    const list = data(await get('/entities'));
    expect(list.find((e) => e.name === 'Gulati Industries').workspace_id).toBe(b.id);
    // an entity needs no workspace at all, and a duplicate name is refused
    expect((await post('/entities', { name: 'Delphic' })).status).toBe(201);
    expect((await post('/entities', { name: 'Delphic' })).status).toBe(409);
    expect((await post('/entities', { name: 'Elsewhere', workspace_id: '11111111-1111-4111-8111-111111111111' })).status).toBe(422);
  });

  test('legal entity, bank account and wallet are all optional and independent; cash accounts have no bank details; only INR and USD', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { bare: true });
    // no wallet appears by itself
    expect(data(await get('/setup')).wallets.filter((w) => w.bank_account_id === acc.id)).toHaveLength(0);
    // an account without a legal entity, and a wallet without an account or an owner
    const loose = await post('/accounts', { name: 'Standalone', type: 'current', currency: 'INR', opening_date: '2026-04-01' });
    expect(loose.status).toBe(201);
    expect(data(loose).account.legal_entity_id).toBeNull();
    const free = await post('/wallets', { name: 'Free wallet', currency: 'USD', opening_balance: '5' });
    expect(free.status).toBe(201);
    expect(data(free).wallet).toMatchObject({ bank_account_id: null, owner_org_id: null, owner_legal_entity_id: null, currency: 'USD', owner_name: 'No owner' });
    const cash = (await account(e.id, { name: 'Cash in hand', type: 'cash', bank_name: 'HDFC', account_last4: '9999' })).account;
    expect(cash.bank_name).toBeNull();
    expect(cash.account_last4).toBeNull();
    expect((await post('/accounts', { legal_entity_id: e.id, name: 'Dirham', type: 'current', currency: 'AED', opening_date: '2026-04-01' })).status).toBe(422);
    expect((await post('/accounts', { legal_entity_id: e.id, name: 'Odd', type: 'wallet', currency: 'INR', opening_date: '2026-04-01' })).status).toBe(422);
    expect(acc.id).toBeTruthy();
  });

  test('a wallet has at most one owner, in the database as well (none is fine)', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id);
    expect((await post('/wallets', { bank_account_id: acc.id, name: 'No owner' })).status).toBe(201);
    expect((await post('/wallets', { bank_account_id: acc.id, name: 'Two owners', owner_org_id: b.id, owner_legal_entity_id: e.id })).status).toBe(422);
    const w = await wallet(acc.id, { owner_org_id: undefined, owner_legal_entity_id: e.id, name: 'Entity wallet' });
    expect(w.owner_legal_entity_id).toBe(e.id);
    await expect(prisma.wallet.create({ data: { org_group_id: acc.org_group_id, bank_account_id: acc.id, name: 'Bad', purpose: 'general', owner_org_id: b.id, owner_legal_entity_id: e.id } })).rejects.toThrow();
  });

  test('the opening balances of the wallets should add up to the declared one: a warning, never a block', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '1000' });
    const r = await post('/wallets', { bank_account_id: acc.id, owner_org_id: b.id, name: 'Gulati', opening_balance: '400' });
    expect(r.status).toBe(201);
    expect(data(r).warnings[0]).toMatch(/1400\.00.*1000\.00.*-400\.00/);
    // fixing the Unallocated wallet clears it
    const un = data(await get('/position')).entities[0].accounts[0].wallets.find((w) => w.purpose === 'unallocated');
    const fixed = await patch(`/wallets/${un.id}`, { opening_balance: '600' });
    expect(data(fixed).warnings).toEqual([]);
  });

  test('a wallet with money in it cannot be switched off; an empty one can', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '0' });
    const w = await wallet(acc.id);
    await tx(w.id, { amount: '50' });
    expect((await patch(`/wallets/${w.id}`, { active: false })).status).toBe(409);
    await tx(w.id, { direction: 'out', amount: '50' });
    expect((await patch(`/wallets/${w.id}`, { active: false })).status).toBe(200);
    const un = data(await get('/position')).entities[0].accounts[0].wallets.find((x) => x.purpose === 'unallocated');
    expect((await patch(`/wallets/${un.id}`, { active: false })).status).toBe(409);
  });
});

describe('group cash: transactions', () => {
  test('balance = opening + entries; the account is the sum of its wallets; going negative only warns', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '100' });
    const w = await wallet(acc.id, { opening_balance: '0' });
    expect(data(await tx(w.id, { amount: '250.50' })).warnings).toEqual([]);
    const out = await tx(w.id, { direction: 'out', amount: '300.75', mode: 'cheque' });
    expect(out.status).toBe(201);
    expect(data(out).warnings[0]).toMatch(/negative \(-50\.25\)/);
    expect(await balanceOf(w.id)).toBe('-50.25');
    const pos = data(await get('/position'));
    expect(pos.entities[0].accounts[0].balance).toBe('49.75'); // 100 (Unallocated) - 50.25
    expect(pos.totals).toEqual({ INR: '49.75', USD: '0.00' });
    expect((await tx(w.id, { amount: '0' })).status).toBe(422);
    expect((await tx(w.id, { amount: '10.123' })).status).toBe(422);
    expect((await tx(w.id, { amount: '-5' })).status).toBe(422);
    expect((await tx(w.id, { mode: 'barter' })).status).toBe(422);
  });

  test('editing and deleting an entry is audited with before and after; a delete is soft and the balance follows', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '0' });
    const w = await wallet(acc.id);
    const t = data(await tx(w.id, { amount: '100' })).transaction;
    expect((await patch(`/transactions/${t.id}`, { amount: '175.00', notes: 'corrected' })).status).toBe(200);
    expect(await balanceOf(w.id)).toBe('175.00');
    const edit = await prisma.walletAudit.findFirst({ where: { entity_id: t.id, action: 'update' } });
    expect(edit.before.amount).toBe('100');
    expect(edit.after.amount).toBe('175');
    expect((await del(`/transactions/${t.id}`)).status).toBe(200);
    expect(await balanceOf(w.id)).toBe('0.00');
    const row = await prisma.walletTransaction.findUnique({ where: { id: t.id } });
    expect(row.deleted_at).not.toBeNull();
    const removed = await prisma.walletAudit.findFirst({ where: { entity_id: t.id, action: 'delete' } });
    expect(removed.before.amount).toBe('175');
    expect((await del(`/transactions/${t.id}`)).status).toBe(404);
    expect((await patch(`/transactions/${t.id}`, { amount: '1' })).status).toBe(404);
    expect(data(await get(`/audit?entity_id=${t.id}`))).toHaveLength(3);
  });

  test('an attachment is stored and only the superadmin (or the owning workspace admin) can fetch it', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '0' });
    const w = await wallet(acc.id); // owned by Gulati (b)
    const sent = await authed(request(app).post(`${base}/wallets/${w.id}/transactions`), superToken)
      .field('date', '2026-05-10').field('direction', 'in').field('amount', '10').field('mode', 'neft').attach('file', Buffer.from('%PDF-1.4 receipt'), 'receipt.pdf');
    expect(sent.status).toBe(201);
    const url = data(sent).transaction.attachment_url;
    expect(url).toMatch(/^\/uploads\/wallet-.*\.pdf$/);
    expect((await authed(request(app).get(url), superToken)).status).toBe(200);
    expect((await authed(request(app).get(url), adminBToken)).status).toBe(200);
    expect((await authed(request(app).get(url), adminAToken)).status).toBe(403);
    const bad = await authed(request(app).post(`${base}/wallets/${w.id}/transactions`), superToken)
      .field('date', '2026-05-10').field('direction', 'in').field('amount', '10').field('mode', 'neft').attach('file', Buffer.from('x'), 'run.exe');
    expect(bad.status).toBe(422);
    fs.rmSync(`${env.uploadDir}/${url.replace('/uploads/', '')}`, { force: true });
  });
});

describe('group cash: transfers', () => {
  async function setup() {
    const e1 = await entity('Delphic Global', a.id);
    const e2 = await entity('Gulati Industries', b.id);
    const a1 = (await account(e1.id, { name: 'DG Current', declared_opening_balance: '1000' })).account;
    const a2 = (await account(e2.id, { name: 'GI Current', declared_opening_balance: '0' })).account;
    const wa = await wallet(a1.id, { owner_org_id: a.id, name: 'DG wallet', opening_balance: '0' });
    const wb = await wallet(a1.id, { owner_org_id: b.id, name: 'GI wallet in DG account', opening_balance: '0' });
    const wc = await wallet(a2.id, { owner_org_id: b.id, name: 'GI wallet' });
    const usd = (await account(e1.id, { name: 'USD', currency: 'USD', declared_opening_balance: '0' })).account;
    const wu = await wallet(usd.id, { owner_org_id: a.id, name: 'DG USD' });
    return { a1, a2, wa, wb, wc, wu };
  }

  test('a reallocation inside one account moves ownership only; a bank transfer moves real money; both are two entries and flagged when intercompany', async () => {
    const { a1, wa, wb, wc } = await setup();
    await tx(wa.id, { amount: '500' });
    const total = async () => data(await get('/position')).totals.INR;
    expect(await total()).toBe('1500.00');
    const re = await post('/transfers', { from_wallet_id: wa.id, to_wallet_id: wb.id, date: '2026-05-11', amount: '200' });
    expect(re.status).toBe(201);
    expect(data(re).transfer).toMatchObject({ kind: 'reallocation', is_intercompany: true, amount: '200.00' });
    expect(data(re).transfer.transactions).toHaveLength(2);
    expect(await balanceOf(wa.id)).toBe('300.00');
    expect(await balanceOf(wb.id)).toBe('200.00');
    expect(await total()).toBe('1500.00'); // the bank balance did not change
    const accountBalance = data(await get('/position')).entities.flatMap((e) => e.accounts).find((x) => x.id === a1.id).balance;
    expect(accountBalance).toBe('1500.00');
    // wb (Gulati) -> wc (Gulati, another account): a real bank transfer, same company, not intercompany
    const bt = await post('/transfers', { from_wallet_id: wb.id, to_wallet_id: wc.id, date: '2026-05-12', amount: '50' });
    expect(data(bt).transfer).toMatchObject({ kind: 'bank_transfer', is_intercompany: false });
    expect(await total()).toBe('1500.00'); // moved between two of our own accounts
    // the Unallocated money of Delphic Global is still Delphic Global's: not intercompany
    const un = data(await get('/position')).entities[0].accounts[0].wallets.find((w) => w.purpose === 'unallocated');
    expect(data(await post('/transfers', { from_wallet_id: un.id, to_wallet_id: wa.id, date: '2026-05-12', amount: '10' })).transfer.is_intercompany).toBe(false);
  });

  test('transfers are not receipts or income, and are never counted twice', async () => {
    const { wa, wb } = await setup();
    await tx(wa.id, { amount: '500', party: 'Acme Ltd' });
    await post('/transfers', { from_wallet_id: wa.id, to_wallet_id: wb.id, date: '2026-05-11', amount: '200' });
    const rec = data(await get('/receipts'));
    expect(rec.rows).toHaveLength(1);
    expect(rec.totals.INR).toBe('500.00');
    expect(rec.summary[0]).toMatchObject({ owner_name: 'Delphic Global', count: 1 });
    expect(rec.summary[0].by_currency.INR.by_mode.upi).toBe('500.00');
    const csvRes = await get('/receipts?format=csv');
    expect(csvRes.headers['content-type']).toMatch(/text\/csv/);
    expect(csvRes.text).toContain('Acme Ltd');
  });

  test('different currencies, the same wallet and inactive wallets are refused', async () => {
    const { wa, wu, wb } = await setup();
    expect((await post('/transfers', { from_wallet_id: wa.id, to_wallet_id: wu.id, date: '2026-05-11', amount: '1' })).status).toBe(422);
    expect((await post('/transfers', { from_wallet_id: wa.id, to_wallet_id: wa.id, date: '2026-05-11', amount: '1' })).status).toBe(422);
    await patch(`/wallets/${wb.id}`, { active: false });
    expect((await post('/transfers', { from_wallet_id: wa.id, to_wallet_id: wb.id, date: '2026-05-11', amount: '1' })).status).toBe(409);
  });

  test('both entries are written together or not at all', async () => {
    const { wa, wb } = await setup();
    const real = prisma.$transaction.bind(prisma);
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce((fn) => real(async (client) => {
      let n = 0;
      const wrapped = new Proxy(client, {
        get: (t, k) => (k === 'walletTransaction' ? { create: (args) => (++n === 2 ? Promise.reject(new Error('boom')) : t.walletTransaction.create(args)) } : t[k]),
      });
      return fn(wrapped);
    }));
    const r = await post('/transfers', { from_wallet_id: wa.id, to_wallet_id: wb.id, date: '2026-05-11', amount: '10' });
    spy.mockRestore();
    expect(r.status).toBe(500);
    expect(await prisma.walletTransfer.count()).toBe(0);
    expect(await prisma.walletTransaction.count()).toBe(0);
  });

  test('deleting one side deletes the whole transfer; editing one side updates both', async () => {
    const { wa, wb } = await setup();
    await tx(wa.id, { amount: '500' });
    const t = data(await post('/transfers', { from_wallet_id: wa.id, to_wallet_id: wb.id, date: '2026-05-11', amount: '200' })).transfer;
    const leg = t.transactions.find((x) => x.direction === 'in');
    expect((await patch(`/transactions/${leg.id}`, { amount: '150' })).status).toBe(200);
    expect(await balanceOf(wa.id)).toBe('350.00');
    expect(await balanceOf(wb.id)).toBe('150.00');
    expect((await del(`/transactions/${leg.id}`)).status).toBe(200);
    expect(await balanceOf(wa.id)).toBe('500.00');
    expect(await balanceOf(wb.id)).toBe('0.00');
    expect((await prisma.walletTransfer.findUnique({ where: { id: t.id } })).deleted_at).not.toBeNull();
    expect(await prisma.walletTransaction.count({ where: { transfer_id: t.id, deleted_at: null } })).toBe(0);
    expect(await prisma.walletAudit.count({ where: { entity_id: t.id, entity_type: 'transfer' } })).toBe(3);
  });
});

describe('group cash: the Cash Position views, reports and reconciliation', () => {
  test('bank view and fund view, INR and USD never added, filters, and a ticked account plus its wallet is counted once', async () => {
    const e = await entity();
    const inr = (await account(e.id, { declared_opening_balance: '100' })).account;
    const usd = (await account(e.id, { name: 'USD A/C', currency: 'USD', declared_opening_balance: '40' })).account;
    const w1 = await wallet(inr.id, { owner_org_id: b.id });
    await wallet(usd.id, { owner_org_id: b.id, name: 'GI USD' });
    await tx(w1.id, { amount: '25' });
    const pos = data(await get('/position'));
    expect(pos.totals).toEqual({ INR: '125.00', USD: '40.00' });
    const fundNames = pos.funds.map((f) => f.name);
    expect(fundNames).toContain('Gulati Industries');
    expect(fundNames).toContain('Delphic Global (entity)'); // the Unallocated wallets
    expect(pos.funds.find((f) => f.name === 'Gulati Industries').totals).toEqual({ INR: '25.00', USD: '0.00' });
    expect(data(await get('/position?currency=USD')).totals).toEqual({ INR: '0.00', USD: '40.00' });
    expect(data(await get(`/position?workspace_id=${b.id}`)).totals).toEqual({ INR: '25.00', USD: '0.00' });
    expect(data(await get('/position?type=cash')).entities).toHaveLength(0);
    // the account balance is always the whole account, even when only one company's wallet is shown
    const filtered = data(await get(`/position?workspace_id=${b.id}`)).entities[0].accounts.find((x) => x.id === inr.id);
    expect(filtered.balance).toBe('125.00');
    expect(filtered.shown_balance).toBe('25.00');
  });

  test('wallet entries have a running balance, a mode breakdown and CSV / PDF files', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '0' });
    const w = await wallet(acc.id, { opening_balance: '100' });
    await tx(w.id, { date: '2026-05-01', amount: '50', mode: 'upi' });
    await tx(w.id, { date: '2026-05-05', direction: 'out', amount: '30', mode: 'cash' });
    await tx(w.id, { date: '2026-06-01', amount: '10', mode: 'upi' });
    const all = data(await get(`/wallets/${w.id}/entries`));
    expect(all.rows.map((r) => r.balance_after)).toEqual(['150.00', '120.00', '130.00']);
    expect(all.by_mode.upi).toEqual({ in: '60.00', out: '0.00', count: 2 });
    expect(all.by_mode.cash.out).toBe('30.00');
    const may = data(await get(`/wallets/${w.id}/entries?from=2026-05-05&to=2026-05-31`));
    expect(may.opening_balance).toBe('150.00');
    expect(may.closing_balance).toBe('120.00');
    const csv = await get(`/wallets/${w.id}/entries?format=csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('150.00');
    const pdf = await authed(request(app).get(`${base}/wallets/${w.id}/entries?format=pdf`), superToken).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    // spreadsheet formulas typed into a note are neutralised
    await tx(w.id, { notes: '=HYPERLINK("http://x")' });
    expect((await get(`/wallets/${w.id}/entries?format=csv`)).text).not.toMatch(/,=HYPERLINK/);
  });

  test('a reconciliation freezes the system balance of that day and keeps a history', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '1000' });
    const w = await wallet(acc.id, { opening_balance: '0' });
    await tx(w.id, { date: '2026-05-10', amount: '200' });
    await tx(w.id, { date: '2026-06-10', amount: '300' });
    const preview = data(await post('/reconciliations/preview', { bank_account_id: acc.id, statement_date: '2026-05-31', statement_balance: '1190.00' }));
    expect(preview).toMatchObject({ system_balance: '1200.00', difference: '-10.00' });
    const saved = await post('/reconciliations', { bank_account_id: acc.id, statement_date: '2026-05-31', statement_balance: '1190.00', notes: 'May' });
    expect(saved.status).toBe(201);
    expect(data(saved).reconciliation).toMatchObject({ system_balance: '1200.00', statement_balance: '1190.00', difference: '-10.00' });
    await tx(w.id, { date: '2026-05-20', amount: '5' }); // a late entry changes tomorrow's balance, not the saved snapshot
    const history = data(await get(`/reconciliations?bank_account_id=${acc.id}`));
    expect(history).toHaveLength(1);
    expect(history[0].system_balance).toBe('1200.00');
    expect((await post('/reconciliations', { bank_account_id: '11111111-1111-4111-8111-111111111111', statement_date: '2026-05-31', statement_balance: '1' })).status).toBe(404);
  });
});

describe('group cash: a workspace admin sees only their own wallets', () => {
  test('/wallets/mine lists the wallets owned by the caller\'s workspace and never the account total or other owners\' wallets', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '1000' });
    const wa = await wallet(acc.id, { owner_org_id: a.id, name: 'Delphic wallet', opening_balance: '30' });
    const wb = await wallet(acc.id, { owner_org_id: b.id, name: 'Gulati wallet', opening_balance: '70' });
    await tx(wa.id, { amount: '5' });
    const mineA = (await authed(request(app).get('/api/v1/wallets/mine'), adminAToken));
    expect(mineA.status).toBe(200);
    expect(mineA.body.data.map((w) => w.name)).toEqual(['Delphic wallet']);
    expect(mineA.body.data[0]).toMatchObject({ balance: '35.00', bank_account_name: 'Current A/C', legal_entity_name: 'Delphic Global' });
    expect(JSON.stringify(mineA.body)).not.toMatch(/Gulati wallet|1000\.00/);
    expect((await authed(request(app).get('/api/v1/wallets/mine'), adminBToken)).body.data.map((w) => w.name)).toEqual(['Gulati wallet']);
    expect((await authed(request(app).get(`/api/v1/wallets/mine/${wa.id}/entries`), adminAToken)).status).toBe(200);
    expect((await authed(request(app).get(`/api/v1/wallets/mine/${wb.id}/entries`), adminAToken)).status).toBe(404);
    expect((await authed(request(app).get('/api/v1/wallets/mine'), salesToken)).status).toBe(403);
    // and a workspace admin can change nothing
    expect((await post(`/wallets/${wa.id}/transactions`, { date: '2026-05-10', direction: 'in', amount: '1', mode: 'cash' }, adminAToken)).status).toBe(403);
  });
});

describe('group cash: everything can be corrected by the admin', () => {
  test('a saved reconciliation can be edited (system balance worked out again) and deleted (soft, audited)', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '1000' });
    const w = await wallet(acc.id, { opening_balance: '0' });
    await tx(w.id, { date: '2026-05-10', amount: '200' });
    await tx(w.id, { date: '2026-06-10', amount: '300' });
    const saved = data(await post('/reconciliations', { bank_account_id: acc.id, statement_date: '2026-05-31', statement_balance: '1190' })).reconciliation;
    expect(saved.system_balance).toBe('1200.00');
    const edited = await patch(`/reconciliations/${saved.id}`, { statement_date: '2026-06-30', statement_balance: '1500', notes: 'June' });
    expect(edited.status).toBe(200);
    expect(data(edited).reconciliation).toMatchObject({ statement_date: '2026-06-30', system_balance: '1500.00', difference: '0.00', notes: 'June' });
    expect((await del(`/reconciliations/${saved.id}`)).status).toBe(200);
    expect(data(await get('/reconciliations'))).toHaveLength(0);
    expect((await prisma.bankReconciliation.findUnique({ where: { id: saved.id } })).deleted_at).not.toBeNull();
    expect(await prisma.walletAudit.count({ where: { entity_id: saved.id } })).toBe(3);
    expect((await patch(`/reconciliations/${saved.id}`, { notes: 'x' })).status).toBe(404);
    expect((await del(`/reconciliations/${saved.id}`)).status).toBe(404);
  });

  test('a wallet can change owner (still exactly one owner) and a switched-off wallet can be switched on again', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '0' });
    const w = await wallet(acc.id);
    const moved = await patch(`/wallets/${w.id}`, { owner_org_id: a.id, owner_legal_entity_id: null });
    expect(moved.status).toBe(200);
    expect(data(moved).wallet).toMatchObject({ owner_org_id: a.id, owner_legal_entity_id: null });
    expect((await patch(`/wallets/${w.id}`, { owner_org_id: a.id, owner_legal_entity_id: e.id })).status).toBe(422);
    expect((await patch(`/wallets/${w.id}`, { owner_org_id: null, owner_legal_entity_id: null })).status).toBe(200); // no owner is allowed now
    expect((await patch(`/wallets/${w.id}`, { owner_org_id: a.id, owner_legal_entity_id: null })).status).toBe(200);
    expect((await patch(`/wallets/${w.id}`, { owner_org_id: '11111111-1111-4111-8111-111111111111' })).status).toBe(422);
    expect((await patch(`/wallets/${w.id}`, { active: false })).status).toBe(200);
    const listed = data(await get('/setup'));
    expect(listed.wallets.find((x) => x.id === w.id)).toMatchObject({ active: false });
    expect(listed.accounts.map((x) => x.id)).toContain(acc.id);
    expect((await patch(`/wallets/${w.id}`, { active: true })).status).toBe(200);
    expect((await get('/setup', adminAToken)).status).toBe(403);
  });

  test('the bank account opening balance, date and payment lines can be changed, and it can be switched off and on again once empty', async () => {
    const e = await entity();
    const { account: acc } = await account(e.id, { declared_opening_balance: '0' });
    const r = await patch(`/accounts/${acc.id}`, { declared_opening_balance: '250.50', opening_date: '2026-04-05', payment_instructions: 'IFSC X', active: false });
    expect(r.status).toBe(200);
    const row = data(await get('/setup')).accounts.find((x) => x.id === acc.id);
    expect(row).toMatchObject({ declared_opening_balance: '250.50', opening_date: '2026-04-05', payment_instructions: 'IFSC X', active: false });
    expect((await patch(`/accounts/${acc.id}`, { active: true })).status).toBe(200);
  });
});

describe('group cash: manual wallet to bank account mapping, statements and deletes', () => {
  test('wallets are mapped to a bank account by hand; the account balance and statement follow the mapping', async () => {
    const acc = data(await post('/accounts', { name: 'ICICI', type: 'current', currency: 'INR', opening_date: '2026-04-01' })).account;
    const usd = data(await post('/accounts', { name: 'USD A/C', type: 'current', currency: 'USD', opening_date: '2026-04-01' })).account;
    const w1 = data(await post('/wallets', { name: 'Wallet A', currency: 'INR', opening_balance: '100' })).wallet;
    const w2 = data(await post('/wallets', { name: 'Wallet B', currency: 'INR', opening_balance: '50' })).wallet;
    let pos = data(await get('/position'));
    expect(pos.unmapped_wallets.map((w) => w.name).sort()).toEqual(['Wallet A', 'Wallet B']);
    expect(pos.unmapped_totals.INR).toBe('150.00');
    expect(pos.entities.find((e) => e.id === null).accounts[0].balance).toBe('0.00');

    expect((await patch(`/wallets/${w1.id}`, { bank_account_id: acc.id })).status).toBe(200);
    expect((await patch(`/wallets/${w2.id}`, { bank_account_id: acc.id })).status).toBe(200);
    expect((await patch(`/wallets/${w1.id}`, { bank_account_id: usd.id })).status).toBe(422); // currencies must match
    await tx(w1.id, { amount: '20', date: '2026-05-10' });
    await tx(w2.id, { direction: 'out', amount: '5', date: '2026-05-11' });
    pos = data(await get('/position'));
    expect(pos.unmapped_wallets).toHaveLength(0);
    expect(pos.entities.find((e) => e.id === null).accounts.find((x) => x.id === acc.id).balance).toBe('165.00');

    const stmt = data(await get(`/accounts/${acc.id}/entries`));
    expect(stmt.rows.map((r) => [r.date, r.wallet, r.direction, r.balance_after])).toEqual([['2026-05-10', 'Wallet A', 'in', '170.00'], ['2026-05-11', 'Wallet B', 'out', '165.00']]);
    expect(stmt.closing_balance).toBe('165.00');
    expect((await get(`/accounts/${acc.id}/entries?format=csv`)).status).toBe(200);

    // un-mapping moves the wallet (and its entries) out of the account; nothing is lost
    expect((await patch(`/wallets/${w2.id}`, { bank_account_id: null })).status).toBe(200);
    expect(data(await get(`/accounts/${acc.id}/entries`)).closing_balance).toBe('120.00');
    expect(data(await get('/position')).unmapped_wallets.map((w) => w.name)).toEqual(['Wallet B']);
  });

  test('entities, accounts and wallets can be deleted while nothing hangs on them; otherwise they are refused', async () => {
    const e = await entity('Temp Co');
    const { account: acc } = await account(e.id, { bare: true });
    const w = data(await post('/wallets', { bank_account_id: acc.id, name: 'Used', currency: 'INR' })).wallet;
    const empty = data(await post('/wallets', { name: 'Empty', currency: 'INR' })).wallet;
    await tx(w.id, { amount: '10' });
    expect((await del(`/entities/${e.id}`)).status).toBe(409); // has an account
    expect((await del(`/accounts/${acc.id}`)).status).toBe(409); // has a wallet mapped
    expect((await del(`/wallets/${w.id}`)).status).toBe(409); // has entries
    expect((await del(`/wallets/${empty.id}`)).status).toBe(200);
    expect(data(await get('/setup')).wallets.map((x) => x.id)).not.toContain(empty.id);
    // free the account, then everything can go
    await tx(w.id, { direction: 'out', amount: '10' });
    expect((await patch(`/wallets/${w.id}`, { bank_account_id: null })).status).toBe(200);
    expect((await del(`/accounts/${acc.id}`)).status).toBe(200);
    expect((await del(`/entities/${e.id}`)).status).toBe(200);
    const audit = data(await get('/audit?limit=200'));
    expect(audit.filter((x) => x.action === 'delete').map((x) => x.entity_type)).toEqual(expect.arrayContaining(['wallet', 'bank_account', 'legal_entity']));
  });
});
