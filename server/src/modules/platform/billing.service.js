const crypto = require('crypto');
const prisma = require('../../config/db');
const logger = require('../../config/logger');
const platform = require('./platform.service');
const credits = require('./credits.service');
const audit = require('./audit.service');

// SaaS billing foundations (docs/features/SAAS-LAUNCH-BUILD-PLAN.md, phase 4). An order buys credit days of modules for slots, priced from the
// dated price book in force today (never a constant), plus GST at the platform setting `gst_rate_pct`. When an order is fully paid its credit days are
// added to the slots, the customer becomes active, and a GST invoice is raised in the Delphic One workspace using the existing invoice code.
// Payments arrive by hand (bank transfer, recorded by a platform admin) or by a signed webhook. Every payment and webhook event carries an
// idempotency key, so a repeated delivery changes nothing. There is NO payment gateway and no gateway key in this code.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const day = () => credits.dayStr();

// Price an order without saving it: { error } or { book, lines, subtotal, gst_rate, gst_amount, total }.
// input.lines = [{ slot_id, code, days? }]. Prerequisites the slot does not already hold are added as separate lines, and so is Basic View.
async function quote(customerId, input) {
  const customer = await prisma.saasCustomer.findUnique({ where: { id: customerId }, include: { slots: { include: { credits: true } } } });
  if (!customer) return { error: 'customer_not_found' };
  const book = await platform.bookFor(new Date(`${day()}T00:00:00Z`));
  if (!book) return { error: 'no_price_book' };
  const price = new Map(book.prices.map((p) => [p.module_code, Number(p.price_30d)]));
  const modules = new Map((await prisma.saasModule.findMany()).map((m) => [m.code, m]));
  const defaultDays = await platform.settingNumber('order_days_default', 30);
  const gstRate = await platform.settingNumber('gst_rate_pct', 18);

  const bySlot = new Map();
  for (const l of input.lines || []) {
    const slot = customer.slots.find((s) => s.id === l.slot_id);
    if (!slot) return { error: 'slot_not_found' };
    const m = modules.get(l.code);
    if (!m || !m.active) return { error: 'module_not_found', code: l.code };
    if (m.coming_soon) return { error: 'coming_soon', code: l.code };
    const days = l.days ?? defaultDays;
    if (!Number.isInteger(days) || days <= 0 || days > 3650) return { error: 'bad_days' };
    const entry = bySlot.get(slot.id) || { slot, wanted: new Map() };
    entry.wanted.set(l.code, Math.max(days, entry.wanted.get(l.code) || 0));
    bySlot.set(slot.id, entry);
  }
  if (!bySlot.size) return { error: 'no_lines' };

  const lines = [];
  for (const { slot, wanted } of bySlot.values()) {
    const held = new Set(slot.credits.filter((c) => c.days_left > 0).map((c) => c.module_code));
    const chosen = [...wanted.keys()];
    const { all } = await platform.withPrerequisites(['BASC', ...chosen]);
    const orderDays = Math.max(...wanted.values());
    for (const code of all) {
      const isChosen = wanted.has(code);
      if (!isChosen && held.has(code)) continue; // a prerequisite the slot already has needs no new line
      const m = modules.get(code);
      if (m?.coming_soon) return { error: 'coming_soon', code };
      if (!price.has(code)) return { error: 'no_price', code };
      const days = isChosen ? wanted.get(code) : orderDays;
      lines.push({ slot_id: slot.id, module_code: code, days, unit_price_30d: price.get(code), line_amount: round2((price.get(code) * days) / 30), is_prerequisite: !isChosen });
    }
    if (slot.is_admin) lines.push({ slot_id: slot.id, module_code: 'ADMIN', days: orderDays, unit_price_30d: Number(book.admin_price), line_amount: round2((Number(book.admin_price) * orderDays) / 30), is_prerequisite: false });
  }
  const subtotal = round2(lines.reduce((a, l) => a + l.line_amount, 0));
  const gst_amount = round2((subtotal * gstRate) / 100);
  return { book: { id: book.id, name: book.name }, lines, subtotal, gst_rate: gstRate, gst_amount, total: round2(subtotal + gst_amount) };
}

async function createOrder(customerId, input, actorId = null) {
  const q = await quote(customerId, input);
  if (q.error) return q;
  const order = await prisma.saasOrder.create({
    data: {
      customer_id: customerId, price_book_id: q.book.id, subtotal: q.subtotal, gst_rate: q.gst_rate, gst_amount: q.gst_amount, total: q.total, note: input.note || null, created_by: actorId,
      lines: { create: q.lines },
    },
    include: { lines: true },
  });
  await audit.record(actorId, 'order_created', 'order', order.order_no, null, { customer_id: customerId, total: q.total, lines: q.lines.length });
  return { order: view(order) };
}

const view = (o) => ({
  id: o.id, order_no: o.order_no, customer_id: o.customer_id, status: o.status, subtotal: Number(o.subtotal), gst_rate: Number(o.gst_rate), gst_amount: Number(o.gst_amount), total: Number(o.total),
  note: o.note, dox_invoice_id: o.dox_invoice_id, created_at: o.created_at, paid_at: o.paid_at,
  lines: (o.lines || []).map((l) => ({ slot_id: l.slot_id, module_code: l.module_code, days: l.days, unit_price_30d: Number(l.unit_price_30d), line_amount: Number(l.line_amount), is_prerequisite: l.is_prerequisite })),
  payments: (o.payments || []).map((p) => ({ amount: Number(p.amount), method: p.method, provider_ref: p.provider_ref, at: p.created_at })),
});

async function listOrders({ customerId } = {}) {
  const rows = await prisma.saasOrder.findMany({ where: customerId ? { customer_id: customerId } : {}, orderBy: { created_at: 'desc' }, include: { lines: true, payments: true }, take: 200 });
  return rows.map(view);
}

async function getOrder(id) {
  const o = await prisma.saasOrder.findUnique({ where: { id }, include: { lines: true, payments: true } });
  return o ? view(o) : null;
}

async function cancelOrder(id, actorId = null) {
  const o = await prisma.saasOrder.findUnique({ where: { id } });
  if (!o) return { error: 'order_not_found' };
  if (o.status !== 'pending') return { error: 'not_pending' };
  if (await prisma.saasPayment.count({ where: { order_id: id } })) return { error: 'has_payments' };
  await prisma.saasOrder.update({ where: { id }, data: { status: 'cancelled' } });
  await audit.record(actorId, 'order_cancelled', 'order', o.order_no, { status: 'pending' }, { status: 'cancelled' });
  return { ok: true };
}

// Record a payment against an order. Exactly once per idempotency key. When the order is fully paid: the order is marked paid, credit days are added
// to the slots, the customer becomes active, all in ONE transaction; the GST invoice is raised right after (and can be retried).
async function applyPayment({ orderId, amount, method, providerRef = null, idempotencyKey, actorId = null }) {
  amount = round2(amount);
  if (!(amount > 0)) return { error: 'bad_amount' };
  if (!idempotencyKey) return { error: 'no_key' };
  const outcome = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRawUnsafe('SELECT id FROM saas_orders WHERE id = $1::uuid FOR UPDATE', orderId);
    if (!locked.length) return { error: 'order_not_found' };
    const order = await tx.saasOrder.findUnique({ where: { id: orderId }, include: { lines: true, payments: true } });
    if (await tx.saasPayment.findUnique({ where: { idempotency_key: idempotencyKey } })) return { duplicate: true, order: view(order) };
    if (order.status === 'cancelled') return { error: 'cancelled' };
    const paidBefore = round2(order.payments.reduce((a, p) => a + Number(p.amount), 0));
    if (order.status === 'paid' || paidBefore + amount > Number(order.total) + 0.005) return { error: 'over_payment', balance: round2(Number(order.total) - paidBefore) };
    await tx.saasPayment.create({ data: { order_id: orderId, amount, method, provider_ref: providerRef, idempotency_key: idempotencyKey, created_by: actorId } });
    let fullyPaid = false;
    if (round2(paidBefore + amount) >= Number(order.total) - 0.005) {
      fullyPaid = true;
      await tx.saasOrder.update({ where: { id: orderId }, data: { status: 'paid', paid_at: new Date() } });
      for (const l of order.lines) {
        if (l.module_code === 'ADMIN') continue; // the admin slot fee buys no credit days of its own
        const r = await credits.addCredit({ slotId: l.slot_id, code: l.module_code, days: l.days, reason: `order ${order.order_no}`, actorId, tx });
        if (r.error) throw new Error(`credit failed: ${r.error}`);
      }
      const customer = await tx.saasCustomer.findUnique({ where: { id: order.customer_id } });
      if (customer && ['trial', 'read_only'].includes(customer.status)) {
        await tx.saasCustomer.update({ where: { id: customer.id }, data: { status: 'active' } });
        await tx.saasAudit.create({ data: { actor_id: actorId, action: 'customer_activated', entity: 'customer', entity_id: customer.id, before: { status: customer.status }, after: { status: 'active', order: order.order_no } } });
      }
    }
    return { fullyPaid, order_no: order.order_no };
  }, { timeout: 30000 });
  if (outcome.error || outcome.duplicate) return outcome;
  if (outcome.fullyPaid) await ensureInvoice(orderId).catch((err) => logger.error('saas_invoice_failed', { err, order: outcome.order_no }));
  return { ok: true, fully_paid: outcome.fullyPaid, order: await getOrder(orderId) };
}

// Raise the GST invoice in the Delphic One workspace with the existing invoice code, once. The total equals the order total because both use the same rounding.
async function ensureInvoice(orderId) {
  const order = await prisma.saasOrder.findUnique({ where: { id: orderId }, include: { customer: true, payments: true } });
  if (!order || order.status !== 'paid') return { error: 'not_paid' };
  if (order.dox_invoice_id) return { invoice_id: order.dox_invoice_id };
  if (!order.customer.dox_customer_id) return { error: 'no_dox_customer' };
  const dox = require('../delphicone/delphicone.service');
  const doxOrg = (await prisma.org.findMany({ where: { enabled_modules: { has: 'delphic_one' }, status: 'active' }, select: { id: true }, take: 1 }))[0];
  if (!doxOrg) return { error: 'no_delphic_one' };
  const made = await dox.createInvoice(doxOrg.id, { id: null }, {
    customer_id: order.customer.dox_customer_id, amount: Number(order.subtotal), gst_rate: Number(order.gst_rate), status: 'sent', description: `Delphic One subscription ${order.order_no}`, notes: `SaaS order ${order.order_no}`,
  });
  if (made.error) return { error: made.error };
  const paid = round2(order.payments.reduce((a, p) => a + Number(p.amount), 0));
  const mode = dox.PAY_MODES.includes(order.payments[0]?.method) ? order.payments[0].method : dox.PAY_MODES[0];
  const pay = await dox.addPayment(doxOrg.id, { id: null }, made.invoice.id, { amount: paid, mode, reference: order.order_no, date: day() });
  if (pay.error) logger.error('saas_invoice_payment_failed', { order: order.order_no, error: pay.error });
  await prisma.saasOrder.update({ where: { id: orderId }, data: { dox_invoice_id: made.invoice.id } });
  return { invoice_id: made.invoice.id, number: made.invoice.number };
}

// ---- webhook (stub) ----------------------------------------------------------------------------------------------------------
// A gateway would call this when a payment succeeds. The stub checks an HMAC-SHA256 of the JSON body with the shared secret in env SAAS_WEBHOOK_SECRET
// (no secret set = the endpoint is closed). Body: { event_id, type: 'payment.succeeded' | 'payment.failed', order_no, amount, provider_ref }.
const sign = (body, secret) => crypto.createHmac('sha256', secret).update(typeof body === 'string' ? body : JSON.stringify(body)).digest('hex');

function signatureOk(body, signature, secret) {
  if (!secret || !signature) return false;
  const a = Buffer.from(sign(body, secret));
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function handleWebhook(provider, body, signature) {
  const secret = process.env.SAAS_WEBHOOK_SECRET;
  if (!secret) return { error: 'not_configured' };
  if (!signatureOk(body, signature, secret)) return { error: 'bad_signature' };
  const { event_id: eventId, type, order_no: orderNo, amount, provider_ref: ref } = body || {};
  if (!eventId || !type) return { error: 'bad_event' };
  try {
    await prisma.saasWebhookEvent.create({ data: { provider, event_id: String(eventId), type: String(type), payload: body } });
  } catch (err) {
    if (err.code === 'P2002') return { ok: true, duplicate: true }; // already received: change nothing
    throw err;
  }
  let result = 'ignored';
  if (type === 'payment.succeeded') {
    const order = await prisma.saasOrder.findUnique({ where: { order_no: String(orderNo) } });
    if (!order) result = 'order_not_found';
    else {
      const r = await applyPayment({ orderId: order.id, amount: Number(amount), method: 'gateway', providerRef: ref || null, idempotencyKey: `${provider}:${eventId}` });
      result = r.error || (r.duplicate ? 'duplicate_payment' : (r.fully_paid ? 'paid' : 'part_paid'));
    }
  } else if (type === 'payment.failed') result = 'failed_noted';
  await prisma.saasWebhookEvent.update({ where: { provider_event_id: { provider, event_id: String(eventId) } }, data: { result } });
  return { ok: true, result };
}

module.exports = { quote, createOrder, listOrders, getOrder, cancelOrder, applyPayment, ensureInvoice, handleWebhook, sign, round2 };
