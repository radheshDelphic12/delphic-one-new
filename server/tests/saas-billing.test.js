jest.setTimeout(180000);
const { app, prisma, request, cleanDatabase, createUser, createOrg, createOrgMembership, loginAs, authed } = require('./helpers');
const switches = require('../src/modules/platform/switches.service');
const billing = require('../src/modules/platform/billing.service');
const platform = require('../src/modules/platform/platform.service');
const credits = require('../src/modules/platform/credits.service');

// SaaS phase 4 foundations: quotes from the dated price book and the GST setting, orders, manual payments and a signed webhook stub with idempotency,
// credit days added on payment, the customer made active, a GST invoice raised in Delphic One. No gateway, no keys.
let dox; let pTok; let customerId; let adminSlot; let userSlot; let platformUser;
const api = (method, path, body) => { const r = authed(request(app)[method](`/api/v1/platform${path}`), pTok); return body ? r.send(body) : r; };
const days = async (slotId, code) => (await prisma.saasSlotCredit.findUnique({ where: { slot_id_module_code: { slot_id: slotId, module_code: code } } }))?.days_left ?? 0;

beforeEach(async () => {
  await cleanDatabase();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE dox_customers, dox_leads, dox_lead_notes, dox_invoices, dox_invoice_payments, invoice_followups, saas_customers, saas_webhook_events CASCADE');
  delete process.env.SAAS_WEBHOOK_SECRET;
  dox = await createOrg({ name: 'Delphic One', slug: 'delphic-one' });
  await prisma.org.update({ where: { id: dox.id }, data: { enabled_modules: ['delphic_one'] } });
  platformUser = await createUser({ role: 'admin', withOrg: false });
  await createOrgMembership(platformUser.id, dox.id, { role: 'admin' });
  await prisma.platformAdmin.create({ data: { user_id: platformUser.id } });
  pTok = (await loginAs(platformUser)).access_token;
  // a trial customer made the normal way
  await switches.setSwitch('provisioning', true, null);
  const c = await prisma.doxCustomer.create({ data: { org_id: dox.id, name: 'Acme Trading', contact_name: 'Asha', contact_email: `asha${Date.now()}@acme.example`, status: 'trial' } });
  const prov = await authed(request(app).post(`/api/v1/delphic-one/customers/${c.id}/provision`), pTok).send({});
  expect(prov.status).toBe(201);
  customerId = prov.body.data.customer_id;
  adminSlot = (await prisma.saasSlot.findFirst({ where: { customer_id: customerId, is_admin: true } })).id;
  userSlot = (await credits.createSlot(customerId, { email: 'worker@acme.example' })).slot.id;
});
afterEach(async () => {
  await prisma.saasSetting.deleteMany({ where: { key: { startsWith: 'switch.' } } });
  await prisma.saasSetting.update({ where: { key: 'gst_rate_pct' }, data: { value: 18 } });
  await prisma.saasModulePrice.updateMany({ where: { module_code: 'BASC' }, data: { price_30d: 50 } });
  switches.clearCache();
  delete process.env.SAAS_WEBHOOK_SECRET;
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE saas_customers CASCADE');
  require('../src/config/tenantGuard').clearCache();
  await prisma.$disconnect();
});

describe('quote', () => {
  test('prices come from the price book and GST from the setting: payroll for the admin slot adds prerequisites, Basic View and the admin fee', async () => {
    const res = await api('post', `/customers/${customerId}/quote`, { lines: [{ slot_id: adminSlot, code: 'PAYR' }] });
    expect(res.status).toBe(200);
    const q = res.body.data;
    const by = Object.fromEntries(q.lines.map((l) => [l.module_code, l]));
    expect(by.PAYR).toMatchObject({ days: 30, unit_price_30d: 15, line_amount: 15, is_prerequisite: false });
    expect(by.EMPM.is_prerequisite).toBe(true);
    expect(by.ATLV.is_prerequisite).toBe(true);
    expect(by.BASC).toMatchObject({ unit_price_30d: 50, is_prerequisite: true });
    expect(by.ADMIN).toMatchObject({ unit_price_30d: 500, line_amount: 500 });
    expect(q.subtotal).toBe(585);
    expect(q.gst_rate).toBe(18);
    expect(q.gst_amount).toBe(105.3);
    expect(q.total).toBe(690.3);
  });

  test('change a price or the GST rate and the quote follows, with no code change; days are priced pro rata', async () => {
    await prisma.saasModulePrice.updateMany({ where: { module_code: 'BASC' }, data: { price_30d: 60 } });
    await platform.updateSetting('gst_rate_pct', 5, null);
    const q = (await api('post', `/customers/${customerId}/quote`, { lines: [{ slot_id: userSlot, code: 'CLVN', days: 15 }] })).body.data;
    expect(q.lines.find((l) => l.module_code === 'BASC').unit_price_30d).toBe(60);
    expect(q.lines.find((l) => l.module_code === 'CLVN')).toMatchObject({ days: 15, line_amount: 4 }); // 8 per 30 days x 15/30
    expect(q.lines.find((l) => l.module_code === 'BASC').line_amount).toBe(30);
    expect(q.gst_rate).toBe(5);
    expect(q.total).toBe(Math.round(q.subtotal * 1.05 * 100) / 100);
    expect(q.lines.some((l) => l.module_code === 'ADMIN')).toBe(false); // not the admin slot
  });

  test('a module that is not for sale, an unknown slot, and a prerequisite the slot already has', async () => {
    expect((await api('post', `/customers/${customerId}/quote`, { lines: [{ slot_id: userSlot, code: 'GSTD' }] })).status).toBe(422); // coming soon
    expect((await api('post', `/customers/${customerId}/quote`, { lines: [{ slot_id: '00000000-0000-4000-8000-000000000000', code: 'CLVN' }] })).status).toBe(404);
    await credits.addCredit({ slotId: userSlot, code: 'BASC', days: 20 });
    await credits.addCredit({ slotId: userSlot, code: 'EMPM', days: 20 });
    const q = (await api('post', `/customers/${customerId}/quote`, { lines: [{ slot_id: userSlot, code: 'ATLV' }] })).body.data;
    expect(q.lines.map((l) => l.module_code)).toEqual(['ATLV']); // BASC and EMPM already held
  });
});

describe('orders and payments', () => {
  const order = async (lines) => (await api('post', `/customers/${customerId}/orders`, { lines })).body.data;

  test('a partial payment changes nothing; the full payment adds the credit days, activates the customer and raises the GST invoice', async () => {
    const o = await order([{ slot_id: adminSlot, code: 'PAYR' }]);
    expect(o.order_no).toMatch(/^SO-\d{5}$/);
    expect(o.status).toBe('pending');
    const part = await api('post', `/orders/${o.id}/payments`, { amount: 200, method: 'bank_transfer', idempotency_key: 'bank-ref-0001' });
    expect(part.status).toBe(200);
    expect(part.body.data.fully_paid).toBe(false);
    expect(await days(adminSlot, 'PAYR')).toBe(0);
    expect((await prisma.saasCustomer.findUnique({ where: { id: customerId } })).status).toBe('trial');

    const rest = await api('post', `/orders/${o.id}/payments`, { amount: o.total - 200, method: 'bank_transfer', idempotency_key: 'bank-ref-0002' });
    expect(rest.body.data.fully_paid).toBe(true);
    for (const code of ['PAYR', 'EMPM', 'ATLV', 'BASC']) expect(await days(adminSlot, code)).toBe(30);
    expect((await prisma.saasCustomer.findUnique({ where: { id: customerId } })).status).toBe('active');
    const done = (await api('get', `/orders/${o.id}`)).body.data;
    expect(done.status).toBe('paid');
    expect(done.dox_invoice_id).toBeTruthy();
    const inv = await prisma.doxInvoice.findUnique({ where: { id: done.dox_invoice_id } });
    expect(Number(inv.amount)).toBe(o.subtotal);
    expect(Number(inv.gst_amount)).toBe(o.gst_amount);
    expect(Number(inv.total)).toBe(o.total);
    expect(inv.number).toMatch(/^DO\//);
    const paid = await prisma.doxInvoicePayment.findMany({ where: { invoice_id: inv.id } });
    expect(paid.reduce((a, p) => a + Number(p.amount), 0)).toBeCloseTo(o.total, 2);
    expect(await prisma.saasCreditLedger.count({ where: { slot_id: adminSlot, reason: `order ${o.order_no}` } })).toBe(4);
  });

  test('the same payment key twice adds nothing; too much, a cancelled order and a paid order are refused', async () => {
    const o = await order([{ slot_id: userSlot, code: 'CLVN' }]);
    const key = { amount: o.total, method: 'upi', idempotency_key: 'upi-ref-123456' };
    expect((await api('post', `/orders/${o.id}/payments`, key)).body.data.fully_paid).toBe(true);
    const again = await api('post', `/orders/${o.id}/payments`, key);
    expect(again.status).toBe(200);
    expect(again.body.data.duplicate).toBe(true);
    expect(await days(userSlot, 'CLVN')).toBe(30); // not 60
    expect(await prisma.saasPayment.count({ where: { order_id: o.id } })).toBe(1);
    expect((await api('post', `/orders/${o.id}/payments`, { ...key, idempotency_key: 'upi-ref-654321' })).status).toBe(422); // already paid
    const o2 = await order([{ slot_id: userSlot, code: 'PRJM' }]);
    expect((await api('post', `/orders/${o2.id}/payments`, { amount: o2.total + 50, idempotency_key: 'too-much-0001' })).status).toBe(422);
    expect((await api('post', `/orders/${o2.id}/cancel`)).status).toBe(200);
    expect((await api('post', `/orders/${o2.id}/payments`, { amount: 10, idempotency_key: 'cancelled-0001' })).status).toBe(409);
  });

  test('an order keeps the price of the day it was made even if the book changes later; two orders get different numbers', async () => {
    const a = await order([{ slot_id: userSlot, code: 'CLVN' }]);
    await prisma.saasModulePrice.updateMany({ where: { module_code: 'CLVN' }, data: { price_30d: 99 } });
    try {
      const b = await order([{ slot_id: userSlot, code: 'CLVN' }]);
      expect((await api('get', `/orders/${a.id}`)).body.data.lines.find((l) => l.module_code === 'CLVN').unit_price_30d).toBe(8);
      expect(b.lines.find((l) => l.module_code === 'CLVN').unit_price_30d).toBe(99);
      expect(a.order_no).not.toBe(b.order_no);
    } finally {
      await prisma.saasModulePrice.updateMany({ where: { module_code: 'CLVN' }, data: { price_30d: 8 } });
    }
  });

  test('only platform admins can order or take payments', async () => {
    const other = await createUser({ role: 'admin', withOrg: false });
    await createOrgMembership(other.id, dox.id, { role: 'admin' });
    const tok = (await loginAs(other)).access_token;
    expect((await authed(request(app).post(`/api/v1/platform/customers/${customerId}/orders`), tok).send({ lines: [{ slot_id: userSlot, code: 'CLVN' }] })).status).toBe(403);
    expect((await authed(request(app).get('/api/v1/platform/orders'), tok)).status).toBe(403);
  });
});

describe('webhook stub', () => {
  const hook = (body, sig, provider = 'stub') => { const r = request(app).post(`/api/v1/public/saas-webhook/${provider}`); if (sig !== undefined) r.set('x-signature', sig); return r.send(body); };

  test('closed without a secret, refuses a wrong signature', async () => {
    const body = { event_id: 'evt_1', type: 'payment.succeeded', order_no: 'SO-00001', amount: 10 };
    expect((await hook(body, 'x')).status).toBe(404);
    process.env.SAAS_WEBHOOK_SECRET = 'test-secret-not-a-real-key';
    expect((await hook(body, 'deadbeef')).status).toBe(401);
    expect((await hook(body)).status).toBe(401);
    expect(await prisma.saasWebhookEvent.count()).toBe(0);
  });

  test('a signed success pays the order once; the same event again, or a new event for a paid order, changes nothing', async () => {
    process.env.SAAS_WEBHOOK_SECRET = 'test-secret-not-a-real-key';
    const o = (await api('post', `/customers/${customerId}/orders`, { lines: [{ slot_id: userSlot, code: 'CLVN' }] })).body.data;
    const body = { event_id: 'evt_100', type: 'payment.succeeded', order_no: o.order_no, amount: o.total, provider_ref: 'pay_abc' };
    const sig = billing.sign(body, process.env.SAAS_WEBHOOK_SECRET);
    const first = await hook(body, sig);
    expect(first.status).toBe(200);
    expect(first.body.data.duplicate).toBe(false);
    expect(await days(userSlot, 'CLVN')).toBe(30);
    const dup = await hook(body, sig);
    expect(dup.status).toBe(200);
    expect(dup.body.data.duplicate).toBe(true);
    expect(await days(userSlot, 'CLVN')).toBe(30);
    const again = { ...body, event_id: 'evt_101' }; // a different event for an order that is already paid
    await hook(again, billing.sign(again, process.env.SAAS_WEBHOOK_SECRET));
    expect(await days(userSlot, 'CLVN')).toBe(30);
    expect(await prisma.saasPayment.count({ where: { order_id: o.id } })).toBe(1);
    const events = await prisma.saasWebhookEvent.findMany({ orderBy: { received_at: 'asc' } });
    expect(events.map((e) => e.result)).toEqual(['paid', 'over_payment']);
    expect((await prisma.saasPayment.findFirst({ where: { order_id: o.id } })).idempotency_key).toBe('stub:evt_100');
  });

  test('an unknown order and a failed payment are recorded, not applied', async () => {
    process.env.SAAS_WEBHOOK_SECRET = 'test-secret-not-a-real-key';
    const secret = process.env.SAAS_WEBHOOK_SECRET;
    const unknown = { event_id: 'evt_200', type: 'payment.succeeded', order_no: 'SO-99999', amount: 10 };
    const failed = { event_id: 'evt_201', type: 'payment.failed', order_no: 'SO-99999', amount: 10 };
    expect((await hook(unknown, billing.sign(unknown, secret))).status).toBe(200);
    expect((await hook(failed, billing.sign(failed, secret))).status).toBe(200);
    const events = await prisma.saasWebhookEvent.findMany({ orderBy: { received_at: 'asc' } });
    expect(events.map((e) => e.result)).toEqual(['order_not_found', 'failed_noted']);
    expect(await prisma.saasPayment.count()).toBe(0);
  });

  test('paid credit days then open the modules for an active customer once the checks are on', async () => {
    const o = (await api('post', `/customers/${customerId}/orders`, { lines: [{ slot_id: adminSlot, code: 'CLVN' }] })).body.data;
    await api('post', `/orders/${o.id}/payments`, { amount: o.total, idempotency_key: 'bank-final-0001' });
    const ent = await require('../src/modules/platform/entitlements.service').entitlementsFor({ id: (await prisma.saasSlot.findUnique({ where: { id: adminSlot } })).user_id, email: '' }, (await prisma.saasCustomer.findUnique({ where: { id: customerId } })).org_id);
    expect(ent.status).toBe('active');
    expect(ent.modules.sort()).toEqual(['BASC', 'CLVN']);
  });
});
