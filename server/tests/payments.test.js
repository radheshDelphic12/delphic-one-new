jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');

// Payments against a record: part payments, the rate typed at payment time, bank charges / deductions, an optional wallet (default no),
// and undo (the group admin only, with a reason).

let org; let superToken; let adminToken; let adminUser; let membershipId; let wallet; let usdWallet; let client; let location; let su;
const G = '/api/v1/group-cash';
const B = '/api/v1/billing';

beforeEach(async () => {
  await cleanDatabase();
  org = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
  su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: org.org_group_id } });
  await createOrgMembership(su.id, org.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(su));
  adminUser = await createUser({ role: 'admin', withOrg: false });
  membershipId = (await createOrgMembership(adminUser.id, org.id, { role: 'admin' })).id;
  ({ access_token: adminToken } = await loginAs(adminUser));
  const entity = (await authed(request(app).post(`${G}/entities`), superToken).send({ name: 'Delphic Global', workspace_id: org.id })).body.data.entity;
  const mk = async (name, currency) => (await authed(request(app).post(`${G}/accounts`), superToken).send({ legal_entity_id: entity.id, name, type: 'current', currency, opening_date: '2026-04-01' })).body.data.account;
  const inr = await mk('HDFC', 'INR');
  const usd = await mk('USD', 'USD');
  wallet = (await authed(request(app).post(`${G}/wallets`), superToken).send({ bank_account_id: inr.id, owner_org_id: org.id, name: 'Delphic INR' })).body.data.wallet;
  usdWallet = (await authed(request(app).post(`${G}/wallets`), superToken).send({ bank_account_id: usd.id, owner_org_id: org.id, name: 'Delphic USD' })).body.data.wallet;
  client = await prisma.account.create({ data: { type: 'client', name: 'Acme Client', stage: 'active', owner_id: su.id, origin_owner_id: su.id, org_id: org.id } });
  location = await prisma.location.create({ data: { org_id: org.id, name: 'HQ' } });
});
afterAll(async () => { await prisma.$disconnect(); });

let seq = 0;
const invoice = (over = {}) => prisma.clientInvoice.create({ data: { org_id: org.id, client_account_id: client.id, period_month: 5, period_year: 2026, amount: 1000, currency: 'INR', status: 'sent', line_items: [], invoice_number: `INV-${++seq}`, created_by: su.id, ...over } });
const claim = (over = {}) => prisma.expenseClaim.create({ data: { org_id: org.id, org_membership_id: membershipId, location_id: location.id, category: 'Travel', amount: 250, currency: 'INR', status: 'approved', ...over } });
const vendorPayment = (over = {}) => prisma.vendorPayment.create({ data: { org_id: org.id, vendor_name: 'Pixel Studio', vendor_type: 'third_party', amount: 500, currency: 'INR', period_month: 5, period_year: 2026, status: 'approved', created_by: su.id, ...over } });
const pay = (id, body, t = adminToken) => authed(request(app).post(`${B}/invoices/${id}/payments`), t).send(body);
const undoPay = (id, pid, body, t = superToken) => authed(request(app).delete(`${B}/invoices/${id}/payments/${pid}`), t).send(body);
const list = async () => (await authed(request(app).get(`${B}/invoices`), adminToken)).body.data;
const wp = (over = {}) => ({ wallet_id: wallet.id, mode: 'neft', ...over });
const walletTx = (where = {}) => prisma.walletTransaction.findMany({ where: { deleted_at: null, ...where } });

describe('part payments on a client invoice', () => {
  test('part payments leave the rest pending; the invoice is paid when it is all in', async () => {
    const inv = await invoice();
    expect((await pay(inv.id, { amount: '400' })).status).toBe(201);
    let row = (await list()).find((r) => r.id === inv.id);
    expect(row).toMatchObject({ status: 'sent', paid_amount: '400.00', pending_amount: '600.00', payment_status: 'partly_paid', payments_count: 1 });
    const second = await pay(inv.id, { amount: '600' });
    expect(second.status).toBe(201);
    row = (await list()).find((r) => r.id === inv.id);
    expect(row).toMatchObject({ status: 'paid', paid_amount: '1000.00', pending_amount: '0.00', payment_status: 'paid' });
    expect((await prisma.clientInvoice.findUnique({ where: { id: inv.id } })).paid_at).not.toBeNull();
    expect((await pay(inv.id, { amount: '1' })).status).toBe(409); // nothing left to pay
  });

  test('more than is pending is refused; with no amount the whole pending amount is paid', async () => {
    const inv = await invoice();
    expect((await pay(inv.id, { amount: '1500' })).status).toBe(422);
    expect((await pay(inv.id, { amount: '250' })).status).toBe(201);
    expect((await pay(inv.id, {})).status).toBe(201);
    expect((await list()).find((r) => r.id === inv.id)).toMatchObject({ status: 'paid', paid_amount: '1000.00' });
  });

  test('an invoice marked paid before payments were recorded counts as fully paid, not as pending', async () => {
    const legacy = await invoice({ status: 'paid', paid_at: new Date() });
    const row = (await list()).find((r) => r.id === legacy.id);
    expect(row).toMatchObject({ status: 'paid', paid_amount: '1000.00', pending_amount: '0.00', payment_status: 'paid', payments_count: 0 });
    expect((await pay(legacy.id, { amount: '1' })).status).toBe(409);
  });

  test('a draft invoice cannot take a payment', async () => {
    const inv = await invoice({ status: 'draft' });
    expect((await pay(inv.id, { amount: '100' })).status).toBe(409);
  });

  test('the payment list names each payment, with the wallet it was tracked in', async () => {
    const inv = await invoice();
    await pay(inv.id, { amount: '300', notes: 'first half' });
    await pay(inv.id, { amount: '200', wallet_payment: wp() });
    const rows = (await authed(request(app).get(`${B}/invoices/${inv.id}/payments`), adminToken)).body.data;
    expect(rows.map((r) => [r.amount, r.wallet?.name || null, r.notes])).toEqual([['300.00', null, 'first half'], ['200.00', 'Delphic INR', null]]);
  });
});

describe('rate, bank charges, deductions and the wallet', () => {
  test('bank charges and deductions are noted and only the net reaches the wallet', async () => {
    const inv = await invoice();
    expect((await pay(inv.id, { amount: '1000', bank_charges: '20', other_deductions: '30', deduction_notes: 'TDS', wallet_payment: wp() })).status).toBe(201);
    const [tx] = await walletTx({ reference_type: 'payment' });
    expect(tx.amount.toFixed(2)).toBe('950.00');
    expect(tx.notes).toMatch(/bank charges 20\.00/);
    expect(tx.notes).toMatch(/deductions 30\.00 \(TDS\)/);
    const p = await prisma.paymentRecord.findFirst({ where: { reference_id: inv.id } });
    expect(p).toMatchObject({ currency: 'INR', exchange_rate: null });
    expect(p.inr_amount.toFixed(2)).toBe('1000.00'); // the invoice is settled in full; the charges are only noted
    expect((await pay((await invoice()).id, { amount: '100', bank_charges: '80', other_deductions: '30' })).status).toBe(422); // more than the amount
  });

  test('no wallet is the default; nothing reaches any wallet', async () => {
    await pay((await invoice()).id, { amount: '1000' });
    expect(await walletTx()).toHaveLength(0);
  });

  test('a foreign currency needs the rate typed at payment time; the INR value is kept', async () => {
    const inv = await invoice({ currency: 'USD', amount: 100 });
    expect((await pay(inv.id, { amount: '100' })).status).toBe(422); // no rate, none saved
    expect((await pay(inv.id, { amount: '100', exchange_rate: '83.5' })).status).toBe(201);
    const p = await prisma.paymentRecord.findFirst({ where: { reference_id: inv.id } });
    expect(p).toMatchObject({ currency: 'USD' });
    expect(p.inr_amount.toFixed(2)).toBe('8350.00');
    expect(p.exchange_rate.toString()).toBe('83.5');
  });

  test('a USD payment goes into a USD wallet as dollars, into an INR wallet as rupees at the rate', async () => {
    const a = await invoice({ currency: 'USD', amount: 100 });
    expect((await pay(a.id, { amount: '40', bank_charges: '5', exchange_rate: '80', wallet_payment: wp({ wallet_id: usdWallet.id, mode: 'swift' }) })).status).toBe(201);
    const b = await invoice({ currency: 'USD', amount: 100 });
    expect((await pay(b.id, { amount: '40', bank_charges: '5', exchange_rate: '80', wallet_payment: wp() })).status).toBe(201);
    const [inUsd] = await walletTx({ wallet_id: usdWallet.id });
    const [inInr] = await walletTx({ wallet_id: wallet.id });
    expect(inUsd.amount.toFixed(2)).toBe('35.00'); // 40 - 5 bank charges
    expect(inInr.amount.toFixed(2)).toBe('2800.00'); // 35 x 80
  });

  test('Dirham is for invoices and reporting only: no wallet holds it, but the INR value is kept', async () => {
    const inv = await invoice({ currency: 'AED', amount: 100 });
    expect((await pay(inv.id, { amount: '100', exchange_rate: '22.7', wallet_payment: wp({ wallet_id: usdWallet.id }) })).status).toBe(422); // AED into a USD wallet
    expect((await pay(inv.id, { amount: '100', exchange_rate: '22.7' })).status).toBe(201);
    expect((await prisma.paymentRecord.findFirst({ where: { reference_id: inv.id } })).inr_amount.toFixed(2)).toBe('2270.00');
  });

  test('the wallet must belong to this company; an unknown wallet is refused', async () => {
    const inv = await invoice();
    expect((await pay(inv.id, { amount: '100', wallet_payment: wp({ wallet_id: '11111111-1111-4111-8111-111111111111' }) })).status).toBe(403);
    expect(await walletTx()).toHaveLength(0);
  });
});

describe('undo', () => {
  test('only the group admin can undo a payment, with a reason; it removes the wallet entry and can reopen the invoice', async () => {
    const inv = await invoice();
    const made = await pay(inv.id, { amount: '1000', wallet_payment: wp() });
    const pid = made.body.data.payment.id;
    expect((await undoPay(inv.id, pid, { reason: 'wrong invoice' }, adminToken)).status).toBe(403); // a company admin cannot
    expect((await undoPay(inv.id, pid, {})).status).toBe(422); // a reason is needed
    expect((await undoPay(inv.id, pid, { reason: 'wrong invoice' })).status).toBe(200);
    expect((await prisma.clientInvoice.findUnique({ where: { id: inv.id } })).status).toBe('sent');
    expect(await walletTx()).toHaveLength(0);
    const rows = (await authed(request(app).get(`${B}/invoices/${inv.id}/payments`), adminToken)).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ undone: true, undone_reason: 'wrong invoice' });
    expect((await list()).find((r) => r.id === inv.id)).toMatchObject({ payment_status: 'unpaid', paid_amount: '0.00' });
    expect((await undoPay(inv.id, pid, { reason: 'again' })).status).toBe(409); // already undone
    expect((await pay(inv.id, { amount: '1000' })).status).toBe(201); // and it can be paid properly
  });

  test('a reimbursement marked by mistake: the group admin undoes it and the claim is approved again', async () => {
    const c = await claim();
    const reimburse = (t = adminToken, body = {}) => authed(request(app).post(`/api/v1/expenses/claims/${c.id}/reimburse`), t).send(body);
    const undo = (t, body) => authed(request(app).post(`/api/v1/expenses/claims/${c.id}/undo-reimbursement`), t).send(body);
    expect((await undo(superToken, { reason: 'too early' })).status).toBe(409); // not reimbursed yet
    expect((await reimburse(adminToken, { wallet_payment: wp({ mode: 'upi' }) })).status).toBe(200);
    expect(await walletTx()).toHaveLength(1);
    expect((await undo(adminToken, { reason: 'mistake' })).status).toBe(403);
    expect((await undo(superToken, {})).status).toBe(422);
    const done = await undo(superToken, { reason: 'mistake' });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('approved');
    expect(await walletTx()).toHaveLength(0);
    expect((await reimburse()).status).toBe(200); // reimbursed again, this time with no wallet
    expect(await walletTx()).toHaveLength(0);
    expect(await prisma.paymentRecord.count({ where: { kind: 'expense', deleted_at: null } })).toBe(1);
  });

  test('a vendor payment marked paid by mistake: the group admin undoes it', async () => {
    const vp = await vendorPayment();
    const payVp = (body = {}) => authed(request(app).post(`/api/v1/expenses/vendor-payments/${vp.id}/pay`), adminToken).send(body);
    const undo = (t, body) => authed(request(app).post(`/api/v1/expenses/vendor-payments/${vp.id}/undo-paid`), t).send(body);
    expect((await payVp({ wallet_payment: wp({ mode: 'cheque' }) })).status).toBe(200);
    expect((await undo(adminToken, { reason: 'mistake' })).status).toBe(403);
    expect((await undo(superToken, { reason: 'mistake' })).status).toBe(200);
    expect((await prisma.vendorPayment.findUnique({ where: { id: vp.id } })).status).toBe('approved');
    expect(await walletTx()).toHaveLength(0);
  });
});

describe('tracking any company payment in a wallet (POST /payments/track)', () => {
  const P = '/api/v1/payments/track';
  const REF = '22222222-2222-4222-8222-222222222222';
  const track = (body, t = adminToken) => authed(request(app).post(P), t).send({ reference_id: REF, ...body });

  test('money in adds to the wallet, money out takes from it; the kind decides the direction', async () => {
    expect((await track({ kind: 'rent_payment', amount: '500', party: 'Tenant A', wallet_payment: wp() })).status).toBe(201);
    expect((await track({ kind: 'salary', amount: '200', wallet_payment: wp({ mode: 'upi' }) })).status).toBe(201);
    const rows = await walletTx({ reference_type: 'payment' });
    expect(rows.map((r) => [r.direction, r.amount.toFixed(2)]).sort()).toEqual([['in', '500.00'], ['out', '200.00']]);
    expect(rows.find((r) => r.direction === 'in').party).toBe('Tenant A');
  });

  test('"no wallet" still records the payment with its charges, but no wallet is touched', async () => {
    const made = await track({ kind: 'deal_vendor_payment', amount: '1000', bank_charges: '15', other_deductions: '5', deduction_notes: 'short' });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ amount: '1000.00', bank_charges: '15.00', net_amount: '980.00', wallet: null });
    expect(await walletTx()).toHaveLength(0);
  });

  test('a foreign amount needs a rate; an unknown kind is refused; the list shows what was tracked', async () => {
    expect((await track({ kind: 'invoice_payment', amount: '100', currency: 'USD' })).status).toBe(422);
    expect((await track({ kind: 'invoice_payment', amount: '100', currency: 'USD', exchange_rate: '80', wallet_payment: wp() })).status).toBe(201);
    expect((await track({ kind: 'nonsense', amount: '1' })).status).toBe(422);
    const rows = (await authed(request(app).get(P).query({ kind: 'invoice_payment', reference_id: REF }), adminToken)).body.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ currency: 'USD', inr_amount: '8000.00', wallet: { name: 'Delphic INR' } });
  });

  test('only the group admin can undo it; the wallet entry goes', async () => {
    const id = (await track({ kind: 'debt_emi', amount: '300', wallet_payment: wp() })).body.data.id;
    expect(await walletTx()).toHaveLength(1);
    expect((await authed(request(app).delete(`${P}/${id}`), adminToken).send({ reason: 'mistake' })).status).toBe(403);
    expect((await authed(request(app).delete(`${P}/${id}`), superToken).send({})).status).toBe(422);
    expect((await authed(request(app).delete(`${P}/${id}`), superToken).send({ reason: 'mistake' })).status).toBe(200);
    expect(await walletTx()).toHaveLength(0);
    expect((await authed(request(app).delete(`${P}/${id}`), superToken).send({ reason: 'again' })).status).toBe(409);
  });
});

describe('the group payments report (Group Dashboard > Book Keeping > Payments)', () => {
  const R = '/api/v1/group-cash/payments';
  test('lists every company\'s payments with INR value, charges and deductions; filters; CSV; group admin only', async () => {
    const inv = await invoice({ currency: 'USD', amount: 100 });
    expect((await pay(inv.id, { amount: '100', bank_charges: '4', other_deductions: '6', deduction_notes: 'TDS', exchange_rate: '80', wallet_payment: wp() })).status).toBe(201);
    expect((await authed(request(app).post('/api/v1/payments/track'), adminToken).send({ kind: 'salary', reference_id: '33333333-3333-4333-8333-333333333333', amount: '500' })).status).toBe(201);
    const all = (await authed(request(app).get(R), superToken)).body.data;
    expect(all.rows).toHaveLength(2);
    expect(all.inr).toEqual({ in: '8000.00', out: '500.00' });
    expect(all.totals.USD).toMatchObject({ in: '100.00', bank_charges: '4.00', deductions: '6.00' });
    const usd = all.rows.find((r) => r.currency === 'USD');
    expect(usd).toMatchObject({ company: 'Delphic Global', label: 'Client invoice', inr_amount: '8000.00', net_amount: '90.00', deduction_notes: 'TDS', wallet: 'Delphic INR' });
    expect((await authed(request(app).get(R).query({ kind: 'salary' }), superToken)).body.data.rows).toHaveLength(1);
    expect((await authed(request(app).get(R).query({ direction: 'in' }), superToken)).body.data.rows).toHaveLength(1);
    expect((await authed(request(app).get(R).query({ from: '2999-01-01' }), superToken)).body.data.rows).toHaveLength(0);
    const csv = await authed(request(app).get(R).query({ format: 'csv' }), superToken);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Bank charges');
    expect(csv.text).toContain('Total in (INR),8000.00');
    expect((await authed(request(app).get(R), adminToken)).status).toBe(403);
  });
});

describe('editing a payment (group admin): the old one stays as undone, the corrected one replaces it', () => {
  const edit = (id, pid, body, t = superToken) => authed(request(app).patch(`${B}/invoices/${id}/payments/${pid}`), t).send(body);

  test('invoice payment: amount, charges and wallet entry are replaced; the invoice follows the new total', async () => {
    const inv = await invoice();
    const made = await pay(inv.id, { amount: '400', wallet_payment: wp() });
    const pid = made.body.data.payment.id;
    expect((await edit(inv.id, pid, { amount: '700', bank_charges: '10' }, adminToken)).status).toBe(403); // a company admin cannot
    expect((await edit(inv.id, pid, { amount: '1500' })).status).toBe(422); // more than the invoice
    const ok = await edit(inv.id, pid, { amount: '700', bank_charges: '10', wallet_payment: wp(), reason: 'client sent more' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.invoice).toMatchObject({ status: 'sent', paid_amount: '700.00', pending_amount: '300.00', payment_status: 'partly_paid' });
    const rows = await walletTx({ reference_type: 'payment' });
    expect(rows).toHaveLength(1); // replaced, never doubled
    expect(rows[0].amount.toFixed(2)).toBe('690.00'); // 700 - 10 charges
    const history = (await authed(request(app).get(`${B}/invoices/${inv.id}/payments`), adminToken)).body.data;
    expect(history.map((r) => [r.amount, r.undone])).toEqual([['400.00', true], ['700.00', false]]);
    expect(history[0].undone_reason).toBe('client sent more');
    // to the full amount: paid; back down: sent again
    expect((await edit(inv.id, ok.body.data.payment.id, { amount: '1000' })).body.data.invoice.status).toBe('paid');
    const down = await edit(inv.id, (await prisma.paymentRecord.findFirst({ where: { reference_id: inv.id, deleted_at: null } })).id, { amount: '600' });
    expect(down.body.data.invoice).toMatchObject({ status: 'sent', pending_amount: '400.00' });
    expect((await prisma.clientInvoice.findUnique({ where: { id: inv.id } })).paid_at).toBeNull();
  });

  test('a payment tracked from any company can be edited the same way', async () => {
    const ref = '55555555-5555-4555-8555-555555555555';
    const made = await authed(request(app).post('/api/v1/payments/track'), adminToken).send({ kind: 'rent_payment', reference_id: ref, amount: '500', party: 'Tenant', wallet_payment: wp() });
    const id = made.body.data.id;
    const url = `/api/v1/payments/track/${id}`;
    expect((await authed(request(app).patch(url), adminToken).send({ amount: '650' })).status).toBe(403);
    const ok = await authed(request(app).patch(url), superToken).send({ amount: '650', bank_charges: '5', wallet_payment: wp(), reason: 'typo' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ amount: '650.00', bank_charges: '5.00' });
    const rows = await walletTx({ reference_type: 'payment' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: 'in', party: 'Tenant' });
    expect(rows[0].amount.toFixed(2)).toBe('645.00');
    expect((await authed(request(app).patch(url), superToken).send({ amount: '1' })).status).toBe(409); // the old one is already replaced
  });
});

describe('who may record a payment from a company screen', () => {
  const { canTrack } = require('../src/modules/payments/payments.access');
  const track = (t) => authed(request(app).post('/api/v1/payments/track'), t).send({ kind: 'ledger_expense', reference_id: '66666666-6666-4666-8666-666666666666', amount: '10' });

  test('a plain employee is refused; the company admin is let in', async () => {
    const emp = await createUser({ role: 'employee', withOrg: false });
    await createOrgMembership(emp.id, org.id, { role: 'employee' });
    const { access_token: empToken } = await loginAs(emp);
    expect((await track(empToken)).status).toBe(403);
    expect((await track(adminToken)).status).toBe(201);
  });

  test('on the permission model a finance / billing / payroll permission is enough, nothing else', async () => {
    const user = { id: adminUser.id, org_id: org.id, role: 'employee' };
    const access = (permissions) => ({ mode: 'permissions', level: 'employee', permissions, basic: [] });
    expect(await canTrack({ ...user, access: access({ 'finance.update': true }) })).toBe(true);
    expect(await canTrack({ ...user, access: access({ 'payroll.create': true }) })).toBe(true);
    expect(await canTrack({ ...user, access: access({ 'accounts.update': true }) })).toBe(false);
    expect(await canTrack({ ...user, access: { mode: 'permissions', level: 'admin', permissions: {}, basic: [] } })).toBe(true);
  });

  test('in a company workspace its manager and finance roles are let in, staff are not', async () => {
    const make = async (role) => {
      const u = await createUser({ role: 'employee', withOrg: false });
      await createOrgMembership(u.id, org.id, { role: 'employee' });
      await prisma.zxPerson.create({ data: { org_id: org.id, name: `${role} person`, user_id: u.id, access_role: role } });
      return { id: u.id, org_id: org.id, role: 'employee' };
    };
    expect(await canTrack(await make('finance'))).toBe(true);
    expect(await canTrack(await make('manager'))).toBe(true);
    expect(await canTrack(await make('staff'))).toBe(false);
  });
});

describe('Financials: the month\'s payments in INR beside the profit figures', () => {
  test('received, paid, bank charges and deductions, whether or not a wallet was used; undone payments leave', async () => {
    const { computeFinancialMonth } = require('../src/modules/calculations/engines/financials.engine');
    const inv = await invoice({ currency: 'USD', amount: 100 });
    const made = await pay(inv.id, { amount: '100', bank_charges: '4', other_deductions: '6', exchange_rate: '80', wallet_payment: wp() });
    await authed(request(app).post('/api/v1/payments/track'), adminToken).send({ kind: 'salary', reference_id: '77777777-7777-4777-8777-777777777777', amount: '500' });
    const now = new Date();
    const period = { period_month: now.getMonth() + 1, period_year: now.getFullYear() };
    // the engine takes the month's components from a resolver (locked or live); empty ones are enough here
    const resolve = async (kind) => ({ locked: false, version: null, raw: kind === 'billing' ? { supported: false } : { lines: [] } });
    const m = await computeFinancialMonth(org.id, period, resolve);
    expect(m.payments).toEqual({ count: 2, received: 8000, paid: 500, bank_charges: 320, deductions: 480, net: 7500 });
    expect(m.totals).toHaveProperty('profit'); // the profit figures are untouched
    await undoPay(inv.id, made.body.data.payment.id, { reason: 'test' });
    expect((await computeFinancialMonth(org.id, period, resolve)).payments).toMatchObject({ count: 1, received: 0, paid: 500 });
  });
});

describe('Financials (records): payments count once the month is locked', () => {
  test('locked by default only after the financial lock of the month; unlocked / all show the rest; undone payments leave', async () => {
    const { financialRecords } = require('../src/modules/calculations/records.service');
    const inv = await invoice({ currency: 'USD', amount: 100 });
    const made = await pay(inv.id, { amount: '100', bank_charges: '4', exchange_rate: '80' });
    await authed(request(app).post('/api/v1/payments/track'), adminToken).send({ kind: 'salary', reference_id: '88888888-8888-4888-8888-888888888888', amount: '500' });
    const now = new Date();
    const range = { period_year: now.getFullYear(), from_month: 1, to_month: 12 };
    const locked0 = (await financialRecords(org.id, { ...range, state: 'locked' })).payments;
    expect(locked0).toMatchObject({ count: 0, received: 0, paid: 0 }); // the month is not locked yet: nothing counts
    expect((await financialRecords(org.id, { ...range, state: 'unlocked' })).payments).toMatchObject({ count: 2, received: 8000, paid: 500, bank_charges: 320, net: 7500 });
    await prisma.financialCalculation.create({ data: { org_id: org.id, kind: 'financials', scope_key: 'org', period_month: now.getMonth() + 1, period_year: now.getFullYear(), status: 'locked', created_by: su.id } });
    const locked1 = (await financialRecords(org.id, { ...range, state: 'locked' })).payments;
    expect(locked1).toMatchObject({ count: 2, received: 8000, paid: 500, bank_charges: 320, net: 7500 });
    expect((await financialRecords(org.id, { ...range, state: 'unlocked' })).payments.count).toBe(0);
    const all = (await financialRecords(org.id, { ...range, state: 'all' })).payments;
    expect(all).toMatchObject({ count: 2, received: 8000 });
    expect(all.locked.received).toBe(8000);
    // a locked month freezes its invoices' payments (undo needs the lock reopened first); the test invoice belongs to May 2026
    await prisma.financialCalculation.create({ data: { org_id: org.id, kind: 'financials', scope_key: 'org', period_month: 5, period_year: 2026, status: 'locked', created_by: su.id } });
    expect((await undoPay(inv.id, made.body.data.payment.id, { reason: 'test' })).status).toBe(423);
  });
});

