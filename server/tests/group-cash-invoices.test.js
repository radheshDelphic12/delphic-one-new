jest.setTimeout(120000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const calc = require('../src/modules/groupInvoices/invoices.calc');

// Group cash, Phase 3: invoices issued by a legal entity (GST, non-GST, USD export), numbering, payments into a wallet.

const G = '/api/v1/group-cash';
let org; let superToken; let adminToken; let entity; let other; let inrWallet; let usdWallet; let otherWallet;
const post = (path, body, t = superToken) => authed(request(app).post(`${G}${path}`), t).send(body);
const get = (path, t = superToken) => authed(request(app).get(`${G}${path}`), t);
const d = (r) => r.body.data;

beforeEach(async () => {
  await cleanDatabase();
  org = await createOrg({ name: 'Delphic Global', slug: 'delphic' });
  const su = await createUser({ role: 'admin', withOrg: false });
  await prisma.user.update({ where: { id: su.id }, data: { is_group_superadmin: true } });
  await prisma.orgGroupMembership.create({ data: { user_id: su.id, org_group_id: org.org_group_id } });
  await createOrgMembership(su.id, org.id, { role: 'admin' });
  ({ access_token: superToken } = await loginAs(su));
  const admin = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(admin.id, org.id, { role: 'admin' });
  ({ access_token: adminToken } = await loginAs(admin));

  entity = d(await post('/entities', { name: 'Delphic Global', workspace_id: org.id, invoice_prefix: 'dg', gstin: '23AABCD1234E1Z5', pan: 'AABCD1234E', state_code: '23', address: 'Indore, MP' })).entity;
  other = d(await post('/entities', { name: 'Gulati Industries', invoice_prefix: 'GI', gstin: '23AABCG1234E1Z5', state_code: '23' })).entity;
  const inr = d(await post('/accounts', { legal_entity_id: entity.id, name: 'HDFC', type: 'current', currency: 'INR', opening_date: '2026-04-01' })).account;
  const usd = d(await post('/accounts', { legal_entity_id: entity.id, name: 'USD A/C', type: 'current', currency: 'USD', opening_date: '2026-04-01', payment_instructions: 'Bank: HDFC, SWIFT: HDFCINBB, A/C 1234' })).account;
  const otherAcc = d(await post('/accounts', { legal_entity_id: other.id, name: 'GI Current', type: 'current', currency: 'INR', opening_date: '2026-04-01' })).account;
  inrWallet = d(await post('/wallets', { bank_account_id: inr.id, owner_org_id: org.id, name: 'Delphic INR' })).wallet;
  usdWallet = d(await post('/wallets', { bank_account_id: usd.id, owner_org_id: org.id, name: 'Delphic USD' })).wallet;
  otherWallet = d(await post('/wallets', { bank_account_id: otherAcc.id, owner_org_id: org.id, name: 'GI wallet' })).wallet;
});
afterAll(async () => { await prisma.$disconnect(); });

const line = (over = {}) => ({ description: 'Recruitment services', hsn_sac: '998313', qty: '1', rate: '10000', gst_rate: 18, ...over });
const invoice = (over = {}) => post('/invoices', { legal_entity_id: entity.id, type: 'gst', invoice_date: '2026-05-10', buyer_name: 'Acme Pvt Ltd', buyer_gstin: '23AAACA1234A1Z5', buyer_state_code: '23', lines: [line()], receiving_wallet_id: inrWallet.id, ...over });

describe('invoice maths', () => {
  test('financial year, number format, CGST+SGST or IGST, rounding', () => {
    expect(calc.financialYear('2026-04-01')).toBe('2026-27');
    expect(calc.financialYear('2027-03-31')).toBe('2026-27');
    expect(calc.financialYear('2027-04-01')).toBe('2027-28');
    expect(calc.invoiceNumber('DG', '2026-27', 7)).toBe('DG/2026-27/0007');
    const lines = [{ description: 'a', qty: '3', rate: '33.33', gst_rate: 18 }, { description: 'b', qty: '1', rate: '100', gst_rate: 5 }];
    const intra = calc.computeTotals({ type: 'gst', lines, intraState: true });
    expect(intra).toMatchObject({ subtotal: '199.99', cgst: '11.50', sgst: '11.50', igst: '0.00' });
    expect(intra.total).toBe('222.99');
    expect(calc.computeTotals({ type: 'gst', lines, intraState: false })).toMatchObject({ cgst: '0.00', sgst: '0.00', igst: '23.00', total: '222.99' });
    expect(calc.computeTotals({ type: 'non_gst', lines, intraState: true })).toMatchObject({ igst: '0.00', cgst: '0.00', total: '199.99' });
    // an odd rupee of tax splits without losing a paisa
    const odd = calc.computeTotals({ type: 'gst', lines: [{ qty: '1', rate: '0.05', gst_rate: 18 }], intraState: true });
    expect(odd.total).toBe('0.06');
  });
});

describe('group cash: invoices', () => {
  test('only the group superadmin may issue invoices', async () => {
    expect((await invoice({}).then((r) => r.status))).toBe(201);
    expect((await authed(request(app).get(`${G}/invoices`), adminToken)).status).toBe(403);
    expect((await post('/invoices', {}, adminToken)).status).toBe(403);
  });

  test('a GST invoice inside the state splits CGST + SGST, between states it is IGST; seller details are frozen on it', async () => {
    const same = d(await invoice()).invoice;
    expect(same).toMatchObject({ number: 'DG/2026-27/0001', type: 'gst', currency: 'INR', subtotal: '10000.00', cgst: '900.00', sgst: '900.00', igst: '0.00', total: '11800.00', payment_status: 'unpaid' });
    expect(same.seller).toMatchObject({ name: 'Delphic Global', gstin: '23AABCD1234E1Z5', state_code: '23' });
    const across = d(await invoice({ buyer_state_code: '27', buyer_gstin: '27AAACB1234A1Z5' })).invoice;
    expect(across).toMatchObject({ cgst: '0.00', sgst: '0.00', igst: '1800.00', total: '11800.00' });
    // changing the entity later does not touch an issued invoice
    await prisma.legalEntity.update({ where: { id: entity.id }, data: { name: 'Renamed Co', gstin: '23ZZZZZ9999Z1Z5' } });
    expect(d(await get(`/invoices/${same.id}`)).seller).toMatchObject({ name: 'Delphic Global', gstin: '23AABCD1234E1Z5' });
  });

  test('GST invoice rules: seller GSTIN + state, HSN on every line, valid buyer GSTIN, place of supply', async () => {
    expect((await invoice({ lines: [line({ hsn_sac: '' })] })).status).toBe(422);
    expect((await invoice({ buyer_gstin: 'NOT-A-GSTIN' })).status).toBe(422);
    expect((await invoice({ buyer_state_code: undefined })).status).toBe(422); // no place of supply
    expect((await invoice({ lines: [line({ gst_rate: 7 })] })).status).toBe(422);
    expect((await invoice({ lines: [line({ qty: '0' })] })).status).toBe(422);
    expect((await invoice({ lines: [] })).status).toBe(422);
    await prisma.legalEntity.update({ where: { id: entity.id }, data: { gstin: null } });
    expect((await invoice()).status).toBe(422);
    await prisma.legalEntity.update({ where: { id: entity.id }, data: { gstin: '23AABCD1234E1Z5', invoice_prefix: null } });
    expect((await invoice()).status).toBe(422); // no prefix, no number series
    expect(await prisma.groupInvoice.count()).toBe(0);
  });

  test('non-GST has no tax and no HSN; a USD export needs a USD wallet and bank details and carries the LUT note', async () => {
    const plain = d(await invoice({ type: 'non_gst', lines: [line({ hsn_sac: undefined, gst_rate: 18 })], buyer_gstin: undefined })).invoice;
    expect(plain).toMatchObject({ total: '10000.00', cgst: '0.00', igst: '0.00' });
    expect((await invoice({ type: 'usd_export', receiving_wallet_id: inrWallet.id })).status).toBe(422); // INR wallet for a USD invoice
    const exp = d(await invoice({ type: 'usd_export', receiving_wallet_id: usdWallet.id, buyer_gstin: undefined, buyer_state_code: undefined, lines: [line({ qty: '2', rate: '500.50', gst_rate: 0, hsn_sac: '998313' })] })).invoice;
    expect(exp).toMatchObject({ currency: 'USD', total: '1001.00', igst: '0.00' });
    expect(exp.payment_instructions).toMatch(/SWIFT/);
    expect(exp.lut_note).toMatch(/LUT/);
    // no bank details anywhere -> refused
    await prisma.bankAccount.updateMany({ where: { currency: 'USD' }, data: { payment_instructions: null } });
    expect((await invoice({ type: 'usd_export', receiving_wallet_id: usdWallet.id, buyer_gstin: undefined })).status).toBe(422);
  });

  test('the receiving wallet must sit in the issuing entity\'s own bank account', async () => {
    expect((await invoice({ receiving_wallet_id: otherWallet.id })).status).toBe(422);
    expect((await invoice({ receiving_wallet_id: '11111111-1111-4111-8111-111111111111' })).status).toBe(422);
  });

  test('every entity has its own series per financial year; numbers are gap-safe and never reused, even when issued together or cancelled', async () => {
    const [a, b, c] = await Promise.all([invoice(), invoice(), invoice()]);
    expect([a, b, c].map((r) => d(r).invoice.number).sort()).toEqual(['DG/2026-27/0001', 'DG/2026-27/0002', 'DG/2026-27/0003']);
    const second = d(await post('/invoices', { legal_entity_id: other.id, type: 'non_gst', invoice_date: '2026-05-11', buyer_name: 'X', lines: [line()], receiving_wallet_id: otherWallet.id })).invoice;
    expect(second.number).toBe('GI/2026-27/0001'); // another entity, its own series
    const next = d(await invoice({ invoice_date: '2027-04-02' })).invoice;
    expect(next.number).toBe('DG/2027-28/0001'); // a new financial year starts again
    // a failed invoice does not burn a number
    expect((await invoice({ buyer_gstin: 'bad' })).status).toBe(422);
    const afterFail = d(await invoice()).invoice;
    expect(afterFail.number).toBe('DG/2026-27/0004');
    // cancelling keeps the number; the next one carries on
    expect((await post(`/invoices/${afterFail.id}/cancel`, { reason: 'Wrong buyer' })).status).toBe(200);
    expect(d(await invoice()).invoice.number).toBe('DG/2026-27/0005');
    expect((await post(`/invoices/${afterFail.id}/cancel`, { reason: 'again' })).status).toBe(409);
    await expect(prisma.groupInvoice.create({ data: { ...(await prisma.groupInvoice.findFirst()), id: undefined } })).rejects.toThrow(); // the database refuses a repeated number
  });

  test('payments (part or full) post to the receiving wallet; removing one takes the receipt back; no overpayment, no cancel with payments', async () => {
    const inv = d(await invoice()).invoice;
    const walletBalance = async () => {
      const pos = d(await get('/position'));
      return pos.entities.flatMap((e) => e.accounts).flatMap((a) => a.wallets).find((w) => w.id === inrWallet.id).balance;
    };
    expect((await post(`/invoices/${inv.id}/payments`, { date: '2026-05-15', amount: '20000', mode: 'neft' })).status).toBe(422); // more than the total
    const part = await post(`/invoices/${inv.id}/payments`, { date: '2026-05-15', amount: '5000', mode: 'upi' });
    expect(part.status).toBe(201);
    expect(d(part).invoice).toMatchObject({ paid: '5000.00', balance: '6800.00', payment_status: 'partially_paid' });
    expect(await walletBalance()).toBe('5000.00');
    expect((await post(`/invoices/${inv.id}/payments`, { date: '2026-05-16', amount: '6800.01', mode: 'neft' })).status).toBe(422);
    expect((await post(`/invoices/${inv.id}/cancel`, { reason: 'mistake' })).status).toBe(409);
    const rest = await post(`/invoices/${inv.id}/payments`, { date: '2026-05-20', amount: '6800', mode: 'cheque' });
    expect(d(rest).invoice).toMatchObject({ balance: '0.00', payment_status: 'paid' });
    expect(await walletBalance()).toBe('11800.00');
    const entry = await prisma.walletTransaction.findFirst({ where: { reference_type: 'invoice', amount: 5000 } });
    expect(entry).toMatchObject({ direction: 'in', mode: 'upi', party: 'Acme Pvt Ltd', category: `Invoice ${inv.number}` });
    // un-marking the first payment removes its receipt from the wallet
    const removed = await authed(request(app).delete(`${G}/invoices/${inv.id}/payments/${d(part).invoice.payments[0].id}`), superToken);
    expect(removed.status).toBe(200);
    expect(d(removed).invoice).toMatchObject({ paid: '6800.00', payment_status: 'partially_paid' });
    expect(await walletBalance()).toBe('6800.00');
    // two payments at the same moment cannot both fit the same balance
    const left = d(removed).invoice.balance;
    const both = await Promise.all([post(`/invoices/${inv.id}/payments`, { date: '2026-05-21', amount: left, mode: 'neft' }), post(`/invoices/${inv.id}/payments`, { date: '2026-05-21', amount: left, mode: 'neft' })]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(d(await get(`/invoices/${inv.id}`))).toMatchObject({ balance: '0.00', payment_status: 'paid' });
  });

  test('list filters and totals (per currency), overdue, and the PDF', async () => {
    const a = d(await invoice({ due_date: '2020-01-01' })).invoice;
    await invoice({ type: 'usd_export', receiving_wallet_id: usdWallet.id, buyer_gstin: undefined, buyer_state_code: undefined, lines: [line({ rate: '100', gst_rate: 0 })], workspace_id: org.id });
    const all = d(await get('/invoices'));
    expect(all.rows).toHaveLength(2);
    expect(all.totals).toEqual({ INR: '11800.00', USD: '100.00' });
    expect(all.outstanding).toEqual({ INR: '11800.00', USD: '100.00' });
    expect(d(await get('/invoices?status=overdue')).rows.map((r) => r.id)).toEqual([a.id]);
    expect(d(await get(`/invoices?workspace_id=${org.id}`)).rows).toHaveLength(1);
    expect(d(await get('/invoices?search=acme')).rows).toHaveLength(2);
    const pdf = await authed(request(app).get(`${G}/invoices/${a.id}/pdf`), superToken).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.headers['content-disposition']).toContain('DG-2026-27-0001.pdf');
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
    expect((await get('/invoices/11111111-1111-4111-8111-111111111111')).status).toBe(404);
  });

  test('an issued invoice can be edited: totals follow, the number and seller stay; once paid, the total cannot fall below what came in', async () => {
    const inv = d(await invoice()).invoice;
    const patch = (id, body) => authed(request(app).patch(`${G}/invoices/${id}`), superToken).send(body);
    const body = { type: 'gst', invoice_date: '2026-05-10', buyer_name: 'Acme Renamed', buyer_gstin: '23AAACA1234A1Z5', buyer_state_code: '27', lines: [line({ rate: '20000' })], receiving_wallet_id: inrWallet.id };
    const edited = await patch(inv.id, body);
    expect(edited.status).toBe(200);
    expect(d(edited).invoice).toMatchObject({ number: inv.number, buyer_name: 'Acme Renamed', subtotal: '20000.00', igst: '3600.00', cgst: '0.00', total: '23600.00' });
    expect(d(edited).invoice.seller.name).toBe('Delphic Global');
    expect((await patch(inv.id, { ...body, invoice_date: '2027-05-10' })).status).toBe(422); // another financial year would break the number
    await post(`/invoices/${inv.id}/payments`, { date: '2026-05-15', amount: '20000', mode: 'neft' });
    expect((await patch(inv.id, { ...body, lines: [line({ rate: '1000' })] })).status).toBe(422); // total below what was received
    expect((await patch(inv.id, { ...body, type: 'usd_export', receiving_wallet_id: usdWallet.id })).status).toBe(409); // currency / wallet locked by payments
    expect((await patch(inv.id, { ...body, notes: 'still editable' })).status).toBe(200);
    const live = d(await get(`/invoices/${inv.id}`)).payments[0];
    await authed(request(app).delete(`${G}/invoices/${inv.id}/payments/${live.id}`), superToken);
    expect((await post(`/invoices/${inv.id}/cancel`, { reason: 'x' })).status).toBe(200);
    expect((await patch(inv.id, body)).status).toBe(409); // cancelled stays cancelled
  });

  test('a recorded payment can be corrected; the wallet entry follows; never above what is due', async () => {
    const inv = d(await invoice()).invoice;
    const pay = d(await post(`/invoices/${inv.id}/payments`, { date: '2026-05-15', amount: '5000', mode: 'upi' })).invoice.payments[0];
    const patchPay = (body) => authed(request(app).patch(`${G}/invoices/${inv.id}/payments/${pay.id}`), superToken).send(body);
    const r = await patchPay({ date: '2026-05-16', amount: '11800', mode: 'neft', notes: 'whole amount' });
    expect(r.status).toBe(200);
    expect(d(r).invoice).toMatchObject({ paid: '11800.00', payment_status: 'paid' });
    const entry = await prisma.walletTransaction.findFirst({ where: { reference_type: 'invoice', reference_id: pay.id } });
    expect(entry).toMatchObject({ mode: 'neft', notes: 'whole amount' });
    expect(entry.amount.toFixed(2)).toBe('11800.00');
    expect((await patchPay({ date: '2026-05-16', amount: '11800.01', mode: 'neft' })).status).toBe(422);
    expect((await authed(request(app).patch(`${G}/invoices/${inv.id}/payments/11111111-1111-4111-8111-111111111111`), superToken).send({ date: '2026-05-16', amount: '1', mode: 'neft' })).status).toBe(404);
  });
});

