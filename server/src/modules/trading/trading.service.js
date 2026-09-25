const prisma = require('../../config/db');
const { num, round2, pageArgs, pagination, userNames } = require('../../lib/vertical');
const { CHECKLIST_KEYS } = require('./trading.validation');

const DAY_MS = 24 * 60 * 60 * 1000;

function serializePartner(row, owners) {
  return { ...row, owner: row.owner_id ? owners?.get(row.owner_id) || null : null };
}

function checklistComplete(checklist) {
  return CHECKLIST_KEYS.every((key) => checklist?.[key] === true);
}

function serializeTxn(row) {
  return { ...row, quantity: num(row.quantity), rate: num(row.rate), amount: num(row.amount) };
}

// --- Partners (supplier / consumer: lead -> onboarding -> active) ---

async function createPartner(orgId, userId, body) {
  const row = await prisma.tradingPartner.create({
    data: { ...body, org_id: orgId, owner_id: body.owner_id || userId, onboarding_checklist: {} },
  });
  return { partner: row };
}

async function listPartners(orgId, { kind, status, trading_status, search, page, limit }) {
  const where = {
    org_id: orgId,
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
    ...(trading_status ? { trading_status } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.tradingPartner.findMany({ where, orderBy: { created_at: 'desc' }, ...pageArgs({ page, limit }) }),
    prisma.tradingPartner.count({ where }),
  ]);
  const owners = await userNames(rows.map((r) => r.owner_id));
  return { data: rows.map((r) => serializePartner(r, owners)), pagination: pagination(page, limit, total) };
}

async function getPartner(orgId, id) {
  const row = await prisma.tradingPartner.findFirst({ where: { id, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  const owners = await userNames([row.owner_id]);
  const [rates, recent] = await Promise.all([
    prisma.partnerItemRate.findMany({
      where: { org_id: orgId, partner_id: id },
      include: { item: { select: { id: true, name: true, unit: true } } },
      orderBy: [{ effective_from: 'desc' }],
    }),
    prisma.tradeTransaction.findMany({
      where: { org_id: orgId, partner_id: id },
      include: { item: { select: { id: true, name: true, unit: true } } },
      orderBy: { txn_date: 'desc' },
      take: 20,
    }),
  ]);
  return {
    partner: serializePartner(row, owners),
    rate_card: rates.map((r) => ({ ...r, rate: num(r.rate) })),
    recent_transactions: recent.map(serializeTxn),
  };
}

async function updatePartner(orgId, id, patch) {
  const existing = await prisma.tradingPartner.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };

  const data = { ...patch };
  if (patch.onboarding_checklist) {
    data.onboarding_checklist = { ...(existing.onboarding_checklist || {}), ...patch.onboarding_checklist };
  }
  const checklist = data.onboarding_checklist || existing.onboarding_checklist;
  const nextStatus = patch.status || existing.status;

  // Onboarding gate: a partner only becomes active once every step is ticked.
  if (patch.status === 'active' && existing.status !== 'active' && !checklistComplete(checklist)) {
    return { error: 'onboarding_incomplete' };
  }
  if (patch.status === 'active' && existing.status !== 'active') data.onboarded_at = new Date();

  // Only an active partner can be trading; leaving active stops trading.
  if (nextStatus !== 'active') {
    if (patch.trading_status === 'trading' || patch.trading_status === 'paused') return { error: 'partner_not_active' };
    data.trading_status = 'not_trading';
  }

  const row = await prisma.tradingPartner.update({ where: { id }, data });
  return { partner: row };
}

// --- Items ---

async function createItem(orgId, body) {
  const dupe = await prisma.tradeItem.findFirst({
    where: { org_id: orgId, name: { equals: body.name, mode: 'insensitive' } },
  });
  if (dupe) return { error: 'item_exists' };
  return { item: await prisma.tradeItem.create({ data: { ...body, org_id: orgId } }) };
}

async function listItems(orgId, { include_inactive } = {}) {
  return prisma.tradeItem.findMany({
    where: { org_id: orgId, ...(include_inactive ? {} : { is_active: true }) },
    orderBy: { name: 'asc' },
  });
}

async function updateItem(orgId, id, patch) {
  const existing = await prisma.tradeItem.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  return { item: await prisma.tradeItem.update({ where: { id }, data: patch }) };
}

// --- Rate cards ---

async function createRate(orgId, userId, body) {
  const [partner, item] = await Promise.all([
    prisma.tradingPartner.findFirst({ where: { id: body.partner_id, org_id: orgId } }),
    prisma.tradeItem.findFirst({ where: { id: body.item_id, org_id: orgId } }),
  ]);
  if (!partner) return { error: 'partner_not_found' };
  if (!item) return { error: 'item_not_found' };

  return prisma.$transaction(async (tx) => {
    const sameDay = await tx.partnerItemRate.findFirst({
      where: { org_id: orgId, partner_id: body.partner_id, item_id: body.item_id, effective_from: body.effective_from },
    });
    if (sameDay) return { error: 'rate_exists_for_date' };

    // Close the predecessor so exactly one rate applies on any given day.
    await tx.partnerItemRate.updateMany({
      where: {
        org_id: orgId,
        partner_id: body.partner_id,
        item_id: body.item_id,
        effective_from: { lt: body.effective_from },
        OR: [{ effective_to: null }, { effective_to: { gte: body.effective_from } }],
      },
      data: { effective_to: new Date(new Date(body.effective_from).getTime() - DAY_MS) },
    });
    const row = await tx.partnerItemRate.create({ data: { ...body, org_id: orgId, created_by: userId } });
    return { rate: { ...row, rate: num(row.rate) } };
  });
}

async function listRates(orgId, { partner_id, item_id, as_of }) {
  const where = {
    org_id: orgId,
    ...(partner_id ? { partner_id } : {}),
    ...(item_id ? { item_id } : {}),
    ...(as_of ? { effective_from: { lte: as_of }, OR: [{ effective_to: null }, { effective_to: { gte: as_of } }] } : {}),
  };
  const rows = await prisma.partnerItemRate.findMany({
    where,
    include: {
      item: { select: { id: true, name: true, unit: true } },
      partner: { select: { id: true, name: true, kind: true } },
    },
    orderBy: [{ partner_id: 'asc' }, { effective_from: 'desc' }],
  });
  return rows.map((r) => ({ ...r, rate: num(r.rate) }));
}

function rateFor(client, orgId, partnerId, itemId, date) {
  return client.partnerItemRate.findFirst({
    where: {
      org_id: orgId,
      partner_id: partnerId,
      item_id: itemId,
      effective_from: { lte: date },
      OR: [{ effective_to: null }, { effective_to: { gte: date } }],
    },
    orderBy: { effective_from: 'desc' },
  });
}

// --- Transactions ---

async function createTransaction(orgId, userId, body) {
  const [partner, item] = await Promise.all([
    prisma.tradingPartner.findFirst({ where: { id: body.partner_id, org_id: orgId } }),
    prisma.tradeItem.findFirst({ where: { id: body.item_id, org_id: orgId } }),
  ]);
  if (!partner) return { error: 'partner_not_found' };
  if (!item) return { error: 'item_not_found' };
  if (partner.status !== 'active') return { error: 'partner_not_active' };
  if (!item.is_active) return { error: 'item_inactive' };

  let rate = body.rate;
  let currency = body.currency;
  if (rate === undefined) {
    const card = await rateFor(prisma, orgId, partner.id, item.id, body.txn_date);
    if (!card) return { error: 'no_rate' };
    rate = Number(card.rate);
    currency = currency || card.currency;
  }

  return prisma.$transaction(async (tx) => {
    const row = await tx.tradeTransaction.create({
      data: {
        org_id: orgId,
        partner_id: partner.id,
        item_id: item.id,
        txn_type: partner.kind === 'supplier' ? 'purchase' : 'sale',
        quantity: body.quantity,
        rate,
        amount: round2(body.quantity * rate),
        currency: currency || 'INR',
        status: body.status,
        txn_date: body.txn_date,
        reference: body.reference || null,
        created_by: userId,
      },
    });
    if (partner.trading_status === 'not_trading') {
      await tx.tradingPartner.update({ where: { id: partner.id }, data: { trading_status: 'trading' } });
    }
    return { transaction: serializeTxn(row) };
  });
}

async function listTransactions(orgId, { partner_id, item_id, txn_type, status, from, to, page, limit }) {
  const where = {
    org_id: orgId,
    ...(partner_id ? { partner_id } : {}),
    ...(item_id ? { item_id } : {}),
    ...(txn_type ? { txn_type } : {}),
    ...(status ? { status } : {}),
    ...(from || to ? { txn_date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.tradeTransaction.findMany({
      where,
      include: {
        partner: { select: { id: true, name: true, kind: true } },
        item: { select: { id: true, name: true, unit: true } },
      },
      orderBy: [{ txn_date: 'desc' }, { created_at: 'desc' }],
      ...pageArgs({ page, limit }),
    }),
    prisma.tradeTransaction.count({ where }),
  ]);
  return { data: rows.map(serializeTxn), pagination: pagination(page, limit, total) };
}

async function updateTransaction(orgId, id, { status }) {
  const existing = await prisma.tradeTransaction.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (existing.status === 'cancelled' || existing.status === 'completed') return { error: 'already_final' };
  const row = await prisma.tradeTransaction.update({ where: { id }, data: { status } });
  return { transaction: serializeTxn(row) };
}

// --- Dashboard summary ---

async function summary(orgId, now = new Date()) {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [partners, agg, openAgg, topRows] = await Promise.all([
    prisma.tradingPartner.groupBy({ by: ['kind', 'status', 'trading_status'], where: { org_id: orgId }, _count: { _all: true } }),
    prisma.tradeTransaction.groupBy({
      by: ['txn_type'],
      where: { org_id: orgId, status: 'completed', txn_date: { gte: since } },
      _sum: { amount: true },
    }),
    prisma.tradeTransaction.aggregate({ where: { org_id: orgId, status: 'open' }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.tradeTransaction.groupBy({
      by: ['partner_id'],
      where: { org_id: orgId, status: 'completed', txn_date: { gte: since } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    }),
  ]);

  const byKind = { supplier: { total: 0, active: 0, trading: 0 }, consumer: { total: 0, active: 0, trading: 0 } };
  const funnel = { lead: 0, onboarding: 0, active: 0, inactive: 0 };
  for (const g of partners) {
    const n = g._count._all;
    byKind[g.kind].total += n;
    if (g.status === 'active') byKind[g.kind].active += n;
    if (g.trading_status === 'trading') byKind[g.kind].trading += n;
    funnel[g.status] += n;
  }

  const totals = { purchase: 0, sale: 0 };
  for (const g of agg) totals[g.txn_type] = round2(num(g._sum.amount) || 0);

  const names = await prisma.tradingPartner.findMany({
    where: { id: { in: topRows.map((t) => t.partner_id) } },
    select: { id: true, name: true, kind: true },
  });
  const nameById = new Map(names.map((n) => [n.id, n]));

  return {
    partners: byKind,
    onboarding_funnel: funnel,
    trailing_30d: { purchases: totals.purchase, sales: totals.sale, gross_margin: round2(totals.sale - totals.purchase) },
    open_transactions: { count: openAgg._count._all, amount: round2(num(openAgg._sum.amount) || 0) },
    top_partners: topRows.map((t) => ({
      partner: nameById.get(t.partner_id) || { id: t.partner_id },
      amount: round2(num(t._sum.amount) || 0),
    })),
  };
}

module.exports = {
  createPartner,
  listPartners,
  getPartner,
  updatePartner,
  createItem,
  listItems,
  updateItem,
  createRate,
  listRates,
  createTransaction,
  listTransactions,
  updateTransaction,
  summary,
};
