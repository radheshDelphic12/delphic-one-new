const prisma = require('../../config/db');
const env = require('../../config/env');
const calc = require('../cashPosition/cash.calc');
const invCalc = require('./invoices.calc');

const { D, money } = calc;

// Invoices issued by a legal entity (not by a workspace). Each entity has its own number series per financial year, taken from
// a locked counter row inside the same transaction as the invoice, so numbers are gap-safe and never reused: a cancelled
// invoice keeps its number. The receipt of a payment is posted to the invoice's receiving wallet in the same transaction.

const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const plain = (o) => JSON.parse(JSON.stringify(o));
const DEFAULT_LUT = 'Supply meant for export under Letter of Undertaking (LUT) without payment of IGST.';

async function audit(client, groupId, entityId, action, before, after, actorId) {
  await client.walletAudit.create({ data: { org_group_id: groupId, entity_type: 'invoice', entity_id: entityId, action, before: before ? plain(before) : undefined, after: after ? plain(after) : undefined, actor_id: actorId || null } });
}

function view(inv, payments = []) {
  const live = payments.filter((p) => !p.deleted_at);
  return {
    id: inv.id, number: inv.number, series: inv.series, type: inv.type, status: inv.status, currency: inv.currency,
    invoice_date: ymd(inv.invoice_date), due_date: ymd(inv.due_date), legal_entity_id: inv.legal_entity_id, workspace_id: inv.workspace_id,
    seller: inv.seller, buyer_name: inv.buyer_name, buyer_gstin: inv.buyer_gstin, buyer_address: inv.buyer_address, buyer_state_code: inv.buyer_state_code, place_of_supply: inv.place_of_supply,
    lines: inv.lines, subtotal: money(inv.subtotal), cgst: money(inv.cgst), sgst: money(inv.sgst), igst: money(inv.igst), total: money(inv.total),
    receiving_wallet_id: inv.receiving_wallet_id, notes: inv.notes, payment_instructions: inv.payment_instructions, lut_note: inv.lut_note, cancelled_reason: inv.cancelled_reason,
    created_at: inv.created_at,
    ...invCalc.paymentState(inv, live),
    payments: live.map((p) => ({ id: p.id, date: ymd(p.date), amount: money(p.amount), mode: p.mode, notes: p.notes })),
  };
}

const scope = (groupIds) => ({ org_group_id: { in: groupIds } });

/** Checks a body against the legal entity and works the totals out. Shared by issuing an invoice and by editing one. */
async function build(entity, body, issuedSeller = null) {
  if (body.workspace_id && !(await prisma.org.findFirst({ where: { id: body.workspace_id, org_group_id: entity.org_group_id }, select: { id: true } }))) return { error: 'workspace_not_found' };
  const currency = body.type === 'usd_export' ? 'USD' : 'INR';
  const wallet = await prisma.wallet.findFirst({ where: {
      id: body.receiving_wallet_id,
      org_group_id: entity.org_group_id,
      // links are optional, but a wallet tied to another legal entity (by its bank account or as its owner) is not this entity's
      AND: [
        { OR: [{ bank_account_id: null }, { bank_account: { legal_entity_id: null } }, { bank_account: { legal_entity_id: entity.id } }] },
        { OR: [{ owner_legal_entity_id: null }, { owner_legal_entity_id: entity.id }] },
      ],
    },
    include: { bank_account: true },
  });
  if (!wallet) return { error: 'wallet_not_in_entity' };
  if (!wallet.active || (wallet.bank_account && !wallet.bank_account.active)) return { error: 'wallet_inactive' };
  if (wallet.currency !== currency) return { error: 'wallet_currency' };

  // an invoice that is being edited keeps the seller details it was issued with
  const seller = issuedSeller || { name: entity.name, gstin: entity.gstin, pan: entity.pan, address: entity.address, state_code: entity.state_code, logo_url: entity.logo_url };
  let intraState = false;
  let placeOfSupply = body.place_of_supply || body.buyer_state_code || null;
  if (body.type === 'gst') {
    if (!seller.gstin) return { error: 'entity_gstin_required' };
    if (!seller.state_code) return { error: 'entity_state_required' };
    if (!placeOfSupply) return { error: 'place_of_supply_required' };
    if (body.lines.some((l) => !l.hsn_sac)) return { error: 'hsn_required' };
    intraState = seller.state_code === placeOfSupply;
  } else if (body.type !== 'usd_export') placeOfSupply = null;
  const instructions = body.payment_instructions || wallet.bank_account?.payment_instructions || null;
  if (body.type === 'usd_export' && !instructions) return { error: 'bank_details_required' };

  const totals = invCalc.computeTotals({ type: body.type, lines: body.lines, intraState });
  return {
    wallet,
    currency,
    data: {
      workspace_id: body.workspace_id ?? null, type: body.type, invoice_date: toDate(body.invoice_date), due_date: body.due_date ? toDate(body.due_date) : null, currency, seller,
      buyer_name: body.buyer_name, buyer_gstin: body.buyer_gstin ?? null, buyer_address: body.buyer_address ?? null, buyer_state_code: body.buyer_state_code ?? null, place_of_supply: placeOfSupply,
      lines: totals.lines, subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, total: totals.total,
      receiving_wallet_id: wallet.id, notes: body.notes ?? null, payment_instructions: instructions,
      lut_note: body.type === 'usd_export' ? body.lut_note || entity.lut_note || DEFAULT_LUT : null,
    },
  };
}

async function create(groupIds, userId, body) {
  const entity = await prisma.legalEntity.findFirst({ where: { id: body.legal_entity_id, ...scope(groupIds) } });
  if (!entity) return { error: 'entity_not_found' };
  if (!entity.active) return { error: 'entity_inactive' };
  if (!entity.invoice_prefix) return { error: 'prefix_required' };
  const built = await build(entity, body);
  if (built.error) return built;
  const series = invCalc.financialYear(body.invoice_date);

  const row = await prisma.$transaction(async (tx) => {
    // taking the next number locks the counter row until this transaction ends, so two invoices can never get the same one
    const [{ last_number: seq }] = await tx.$queryRaw`INSERT INTO invoice_counters (legal_entity_id, series, last_number) VALUES (${entity.id}::uuid, ${series}, 1) ON CONFLICT (legal_entity_id, series) DO UPDATE SET last_number = invoice_counters.last_number + 1 RETURNING last_number`;
    const inv = await tx.groupInvoice.create({
      data: { org_group_id: entity.org_group_id, legal_entity_id: entity.id, series, seq, number: invCalc.invoiceNumber(entity.invoice_prefix, series, seq), ...built.data, created_by: userId },
    });
    await audit(tx, entity.org_group_id, inv.id, 'create', null, inv, userId);
    return inv;
  });
  return { invoice: view(row) };
}

/**
 * Editing an issued invoice (the number, the issuing entity and the financial year stay). Once payments are recorded the total
 * may not fall below what was received, and the currency / receiving wallet stay put.
 */
async function update(groupIds, userId, id, body) {
  const inv = await load(groupIds, id);
  if (!inv) return { error: 'not_found' };
  if (inv.status === 'cancelled') return { error: 'cancelled' };
  const entity = await prisma.legalEntity.findFirst({ where: { id: inv.legal_entity_id, ...scope(groupIds) } });
  if (invCalc.financialYear(body.invoice_date) !== inv.series) return { error: 'date_outside_series' };
  const livePayments = inv.payments.filter((p) => !p.deleted_at);
  const built = await build(entity, { ...body, legal_entity_id: inv.legal_entity_id }, inv.seller);
  if (built.error) return built;
  if (livePayments.length && (built.currency !== inv.currency || built.wallet.id !== inv.receiving_wallet_id)) return { error: 'has_payments_locked' };
  const paid = livePayments.reduce((acc, p) => acc.plus(D(p.amount)), calc.ZERO);
  if (D(built.data.total).lt(paid)) return { error: 'total_below_paid' };
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.groupInvoice.update({ where: { id }, data: built.data, include: { payments: true } });
    await audit(tx, inv.org_group_id, id, 'update', { ...inv, payments: undefined }, { ...u, payments: undefined }, userId);
    return u;
  });
  return { invoice: view(row, row.payments) };
}

async function load(groupIds, id, client = prisma) {
  return client.groupInvoice.findFirst({ where: { id, ...scope(groupIds) }, include: { payments: { orderBy: [{ date: 'asc' }, { created_at: 'asc' }] } } });
}

async function get(groupIds, id) {
  const inv = await load(groupIds, id);
  return inv ? view(inv, inv.payments) : null;
}

async function list(groupIds, q = {}) {
  const date = {};
  if (q.from) date.gte = toDate(q.from);
  if (q.to) date.lte = toDate(q.to);
  const rows = await prisma.groupInvoice.findMany({
    where: {
      ...scope(groupIds), ...(q.legal_entity_id ? { legal_entity_id: q.legal_entity_id } : {}), ...(q.workspace_id ? { workspace_id: q.workspace_id } : {}),
      ...(q.from || q.to ? { invoice_date: date } : {}),
      ...(q.search ? { OR: [{ number: { contains: q.search, mode: 'insensitive' } }, { buyer_name: { contains: q.search, mode: 'insensitive' } }] } : {}),
    },
    include: { payments: true, legal_entity: { select: { name: true } } },
    orderBy: [{ invoice_date: 'desc' }, { seq: 'desc' }],
    take: 500,
  });
  const out = rows.map((r) => ({ ...view(r, r.payments), legal_entity_name: r.legal_entity.name, payments: undefined }));
  const filtered = q.status ? out.filter((r) => r.payment_status === q.status) : out;
  const open = filtered.filter((r) => r.payment_status !== 'cancelled');
  return { rows: filtered, totals: calc.totalsByCurrency(open, (r) => r.total), outstanding: calc.totalsByCurrency(open, (r) => r.balance) };
}

async function cancel(groupIds, userId, id, { reason }) {
  const inv = await load(groupIds, id);
  if (!inv) return { error: 'not_found' };
  if (inv.status === 'cancelled') return { error: 'already_cancelled' };
  if (inv.payments.some((p) => !p.deleted_at)) return { error: 'has_payments' };
  const row = await prisma.$transaction(async (tx) => {
    const u = await tx.groupInvoice.update({ where: { id }, data: { status: 'cancelled', cancelled_reason: reason }, include: { payments: true } });
    await audit(tx, inv.org_group_id, id, 'update', { status: inv.status }, { status: 'cancelled', reason }, userId);
    return u;
  });
  return { invoice: view(row, row.payments) };
}

/** A payment received against the invoice (part or all of it); it is entered in the receiving wallet at the same time. */
async function addPayment(groupIds, userId, id, body) {
  const inv = await load(groupIds, id);
  if (!inv) return { error: 'not_found' };
  if (inv.status === 'cancelled') return { error: 'cancelled' };
  const wallet = await prisma.wallet.findUnique({ where: { id: inv.receiving_wallet_id } });
  if (!wallet || !wallet.active) return { error: 'wallet_inactive' };
  const result = await prisma.$transaction(async (tx) => {
    // re-read inside the transaction so two payments saved together cannot both fit the same balance
    await tx.$queryRaw`SELECT id FROM group_invoices WHERE id = ${inv.id}::uuid FOR UPDATE`;
    const fresh = await load(groupIds, id, tx);
    const state = invCalc.paymentState(fresh, fresh.payments.filter((p) => !p.deleted_at));
    if (D(body.amount).gt(D(state.balance))) return { error: 'overpayment', balance: state.balance };
    const payment = await tx.groupInvoicePayment.create({ data: { invoice_id: id, date: toDate(body.date), amount: body.amount, mode: body.mode, notes: body.notes ?? null, created_by: userId } });
    const entry = await tx.walletTransaction.create({
      data: { wallet_id: wallet.id, date: payment.date, direction: 'in', amount: payment.amount, mode: body.mode, category: `Invoice ${inv.number}`, party: inv.buyer_name, reference_type: 'invoice', reference_id: payment.id, notes: body.notes ?? null, created_by: userId },
    });
    await tx.groupInvoicePayment.update({ where: { id: payment.id }, data: { wallet_transaction_id: entry.id } });
    await audit(tx, inv.org_group_id, id, 'update', null, { payment: payment.id, amount: money(payment.amount), wallet_transaction: entry.id }, userId);
    return { ok: true };
  });
  if (result.error) return result;
  return { invoice: await get(groupIds, id) };
}

/** Correcting a recorded payment (date, amount, mode, note); the receipt in the wallet follows. */
async function updatePayment(groupIds, userId, id, paymentId, body) {
  const inv = await load(groupIds, id);
  const payment = inv?.payments.find((p) => p.id === paymentId && !p.deleted_at);
  if (!payment) return { error: 'not_found' };
  if (inv.status === 'cancelled') return { error: 'cancelled' };
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM group_invoices WHERE id = ${inv.id}::uuid FOR UPDATE`;
    const fresh = await load(groupIds, id, tx);
    const others = fresh.payments.filter((p) => !p.deleted_at && p.id !== paymentId);
    const state = invCalc.paymentState(fresh, others);
    if (D(body.amount).gt(D(state.balance))) return { error: 'overpayment', balance: state.balance };
    const row = await tx.groupInvoicePayment.update({ where: { id: paymentId }, data: { date: toDate(body.date), amount: body.amount, mode: body.mode, notes: body.notes ?? null } });
    if (payment.wallet_transaction_id) await tx.walletTransaction.update({ where: { id: payment.wallet_transaction_id }, data: { date: row.date, amount: row.amount, mode: row.mode, notes: row.notes } });
    await audit(tx, inv.org_group_id, id, 'update', { payment: paymentId, amount: money(payment.amount), date: ymd(payment.date), mode: payment.mode }, { payment: paymentId, amount: money(row.amount), date: ymd(row.date), mode: row.mode }, userId);
    return { ok: true };
  });
  if (result.error) return result;
  return { invoice: await get(groupIds, id) };
}

/** Un-marking a payment: the receipt in the wallet goes with it (soft delete, audited). */
async function removePayment(groupIds, userId, id, paymentId) {
  const inv = await load(groupIds, id);
  const payment = inv?.payments.find((p) => p.id === paymentId && !p.deleted_at);
  if (!payment) return { error: 'not_found' };
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.groupInvoicePayment.update({ where: { id: paymentId }, data: { deleted_at: now, deleted_by: userId } });
    if (payment.wallet_transaction_id) await tx.walletTransaction.updateMany({ where: { id: payment.wallet_transaction_id, deleted_at: null }, data: { deleted_at: now, deleted_by: userId } });
    await audit(tx, inv.org_group_id, id, 'update', { payment: paymentId, amount: money(payment.amount) }, { payment_removed: paymentId }, userId);
  });
  return { invoice: await get(groupIds, id) };
}

module.exports = { create, update, get, list, cancel, addPayment, updatePayment, removePayment, view, uploadDir: () => env.uploadDir };
