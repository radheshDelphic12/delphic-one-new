const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const people = require('./people.service');
const parties = require('./parties.service');
const lock = require('./lock');
const calc = require('./deal.calc');

const STATUSES = ['planned', 'sourcing', 'purchase_pending', 'material_sourced', 'ready_for_supply', 'supplied', 'completed', 'cancelled', 'on_hold'];
const DONE = ['completed', 'cancelled'];
const ACTIVE = STATUSES.filter((s) => !DONE.includes(s));

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const reqDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const money = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e13).nullable().optional());
const qty = z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e12).nullable().optional());
const reasonField = z.string().trim().max(500).optional();

const dealFields = {
  name: z.string().trim().min(1).max(200),
  trading_type: z.string().trim().min(1).max(40),
  party_id: uuidOrNull,
  vendor_id: uuidOrNull,
  start_date: dateOnly.optional(),
  expected_end: dateOnly.optional(),
  actual_end: dateOnly.optional(),
  location: text(200),
  assignee_id: uuidOrNull,
  contractor_id: uuidOrNull,
  product: text(200),
  material_type: text(200),
  ordered_quantity: qty,
  unit: text(40),
  expected_purchase_amount: money,
  expected_sale_amount: money,
  description: text(20000),
  notes: text(4000),
};
const createDealSchema = z.object({ ...dealFields, status: z.enum(ACTIVE).default('planned') });
const updateDealSchema = z.object({ ...dealFields, reason: reasonField }).partial();
const statusSchema = z.object({ status: z.enum(STATUSES), reason: text(500), actual_end: dateOnly.optional() });
const convertSchema = z.object({ name: z.string().trim().min(1).max(200).optional(), start_date: dateOnly.optional() });
const listQuerySchema = z.object({
  status: z.enum([...STATUSES, 'active', 'done', 'all']).optional(),
  trading_type: z.string().trim().max(40).optional(),
  party_id: z.string().uuid().optional(),
  vendor_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
  location: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  flag: z.enum(['delayed', 'pending_sourcing', 'pending_supply', 'vendor_due', 'client_due']).optional(),
  q: z.string().trim().max(100).optional(),
});

const lineFields = {
  quantity: qty,
  rate: money,
  amount: money,
  tax: z.preprocess((v) => (v === '' || v == null ? 0 : v), z.coerce.number().min(0).max(1e13)),
  reference: text(200),
  notes: text(2000),
  reason: reasonField,
};
const purchaseCreateSchema = z.object({ vendor_id: uuidOrNull, purchase_date: reqDate, ...lineFields });
const purchaseUpdateSchema = purchaseCreateSchema.partial();
const saleCreateSchema = z.object({ client_id: uuidOrNull, sale_date: reqDate, ...lineFields });
const saleUpdateSchema = saleCreateSchema.partial();
const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(1e13),
  paid_date: reqDate,
  mode: text(60),
  reference: text(200),
  notes: text(1000),
  reason: reasonField,
});
const paymentUpdateSchema = paymentSchema.partial();

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = calc.dayOf;
const today = () => dayOf(new Date());
const num = (v) => (v === null || v === undefined ? null : Number(v));
const dealSnap = (d) => ({ code: d.code, name: d.name, status: d.status, trading_type: d.trading_type, party_id: d.party_id, vendor_id: d.vendor_id, ordered_quantity: num(d.ordered_quantity), start_date: dayOf(d.start_date), expected_end: dayOf(d.expected_end), actual_end: dayOf(d.actual_end) });
const lineSnap = (r) => ({ date: dayOf(r.purchase_date || r.sale_date), quantity: num(r.quantity), rate: num(r.rate), amount: num(r.amount), tax: num(r.tax), party: r.vendor_id || r.client_id });

async function nextCode(tx, orgId) {
  await tx.gxSetting.upsert({ where: { org_id: orgId }, update: {}, create: { org_id: orgId } });
  const s = await tx.gxSetting.update({ where: { org_id: orgId }, data: { deal_seq: { increment: 1 } } });
  return `${s.deal_prefix}-${String(s.deal_seq).padStart(4, '0')}`;
}

const dateProblem = (start, end) => (start && end && end < start ? 'The completion date cannot be before the start date' : null);

async function checkRefs(orgId, input, before) {
  if (input.trading_type && input.trading_type !== before?.trading_type && !(await core.typeKeys(orgId)).includes(input.trading_type)) return { error: 'invalid', message: 'Unknown trading type' };
  if (input.party_id && input.party_id !== before?.party_id && !(await parties.partyOk(orgId, input.party_id, 'client'))) return { error: 'party_not_found' };
  if (input.vendor_id && input.vendor_id !== before?.vendor_id && !(await parties.partyOk(orgId, input.vendor_id, 'vendor'))) return { error: 'vendor_not_found' };
  if (input.assignee_id && input.assignee_id !== before?.assignee_id && !(await people.personOk(orgId, input.assignee_id, 'employee'))) return { error: 'invalid', message: 'The assigned employee must be an active employee on the roster' };
  if (input.contractor_id && input.contractor_id !== before?.contractor_id && !(await people.personOk(orgId, input.contractor_id, 'contractor'))) return { error: 'invalid', message: 'The assigned contractor must be an active contractor on the roster' };
  return null;
}

// Live rows for a set of deals, grouped by deal id.
async function loadMoney(orgId, dealIds) {
  const where = { org_id: orgId, deal_id: { in: dealIds }, deleted_at: null };
  const [purchases, sales, expenses, payments] = await Promise.all([
    prisma.gxPurchase.findMany({ where }),
    prisma.gxSale.findMany({ where }),
    prisma.gxLedgerEntry.findMany({ where: { ...where, type: 'expense' } }),
    prisma.gxPayment.findMany({ where }),
  ]);
  const by = (rows) => {
    const m = new Map();
    for (const r of rows) (m.get(r.deal_id) || m.set(r.deal_id, []).get(r.deal_id)).push(r);
    return m;
  };
  return { purchases: by(purchases), sales: by(sales), expenses: by(expenses), payments: by(payments) };
}

async function decorate(orgId, deals) {
  if (!deals.length) return [];
  const { people: pm, parties: am } = await people.nameMap(orgId, deals.flatMap((d) => [d.assignee_id, d.contractor_id]), deals.flatMap((d) => [d.party_id, d.vendor_id]));
  const m = await loadMoney(orgId, deals.map((d) => d.id));
  const types = new Map((await core.listTypes(orgId)).map((t) => [t.key, t.label]));
  return deals.map((d) => ({
    ...d,
    ordered_quantity: num(d.ordered_quantity),
    expected_purchase_amount: num(d.expected_purchase_amount),
    expected_sale_amount: num(d.expected_sale_amount),
    trading_type_label: types.get(d.trading_type) || d.trading_type,
    party: am.get(d.party_id) || null,
    vendor: am.get(d.vendor_id) || null,
    assignee: pm.get(d.assignee_id) || null,
    contractor: pm.get(d.contractor_id) || null,
    summary: calc.summarize(d, { purchases: m.purchases.get(d.id) || [], sales: m.sales.get(d.id) || [], expenses: m.expenses.get(d.id) || [], payments: m.payments.get(d.id) || [] }),
  }));
}

// scope = { personId } restricts to deals assigned to that person.
async function list(orgId, query, scope = {}) {
  const start = {};
  if (query.from) start.gte = toDate(query.from);
  if (query.to) start.lte = toDate(query.to);
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(query.status === 'active' ? { status: { in: ACTIVE } } : {}),
    ...(query.status === 'done' ? { status: { in: DONE } } : {}),
    ...(query.status && !['active', 'done', 'all'].includes(query.status) ? { status: query.status } : {}),
    ...(query.trading_type ? { trading_type: query.trading_type } : {}),
    ...(query.party_id ? { party_id: query.party_id } : {}),
    ...(query.vendor_id ? { vendor_id: query.vendor_id } : {}),
    ...(query.assignee_id ? { assignee_id: query.assignee_id } : {}),
    ...(scope.personId ? { OR: [{ assignee_id: scope.personId }, { contractor_id: scope.personId }] } : {}),
    ...(Object.keys(start).length ? { start_date: start } : {}),
    AND: [
      ...(query.location ? [{ location: { contains: query.location, mode: 'insensitive' } }] : []),
      ...(query.q ? [{ OR: ['name', 'code', 'product', 'location'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) }] : []),
    ],
  };
  let rows = await decorate(orgId, await prisma.gxDeal.findMany({ where, orderBy: [{ updated_at: 'desc' }], take: 500 }));
  const active = (d) => ACTIVE.includes(d.status);
  if (query.flag === 'delayed') rows = rows.filter((d) => d.summary.delayed);
  if (query.flag === 'pending_sourcing') rows = rows.filter((d) => active(d) && (d.summary.quantities.remaining_to_source ?? 0) > 0);
  if (query.flag === 'pending_supply') rows = rows.filter((d) => active(d) && (d.summary.quantities.remaining_to_supply ?? 0) > 0);
  if (query.flag === 'vendor_due') rows = rows.filter((d) => d.summary.vendor_outstanding > 0.005);
  if (query.flag === 'client_due') rows = rows.filter((d) => d.summary.client_outstanding > 0.005);
  return rows;
}

function withState(rows, payments, idKey) {
  return rows.map((r) => {
    const mine = payments.filter((p) => p[idKey] === r.id);
    const paid = calc.round2(calc.sum(mine, (p) => p.amount));
    const amount = Number(r.amount);
    return { ...r, quantity: num(r.quantity), rate: num(r.rate), amount, tax: num(r.tax), paid, outstanding: calc.round2(amount - paid), payment_status: calc.paymentState(amount, paid) };
  });
}

async function get(orgId, id) {
  const deal = await prisma.gxDeal.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!deal) return { error: 'not_found' };
  const where = { org_id: orgId, deal_id: id, deleted_at: null };
  const [purchases, sales, payments, expenses, lead, taskCount] = await Promise.all([
    prisma.gxPurchase.findMany({ where, orderBy: { purchase_date: 'asc' } }),
    prisma.gxSale.findMany({ where, orderBy: { sale_date: 'asc' } }),
    prisma.gxPayment.findMany({ where, orderBy: { paid_date: 'asc' } }),
    prisma.gxLedgerEntry.findMany({ where: { ...where, type: 'expense' }, include: { category: { select: { name: true } } }, orderBy: { entry_date: 'asc' } }),
    deal.lead_id ? prisma.gxLead.findFirst({ where: { id: deal.lead_id, org_id: orgId }, select: { id: true, code: true, name: true, stage: true } }) : null,
    prisma.gxTask.count({ where: { org_id: orgId, deal_id: id, deleted_at: null, status: { in: ['pending', 'in_progress'] } } }),
  ]);
  const [decorated] = await decorate(orgId, [deal]);
  const { parties: am } = await people.nameMap(orgId, [], [...purchases.map((p) => p.vendor_id), ...sales.map((s) => s.client_id)]);
  const named = (rows, key) => rows.map((r) => ({ ...r, party: am.get(r[key]) || null }));
  return {
    deal: {
      ...decorated,
      lead,
      open_tasks: taskCount,
      purchases: named(withState(purchases, payments.filter((p) => p.side === 'vendor'), 'purchase_id'), 'vendor_id'),
      sales: named(withState(sales, payments.filter((p) => p.side === 'client'), 'sale_id'), 'client_id'),
      payments: payments.map((p) => ({ ...p, amount: Number(p.amount) })),
      expenses: expenses.map((e) => ({ ...e, amount: Number(e.amount), tax: Number(e.tax), category_name: e.category?.name || null })),
    },
  };
}

async function create(orgId, actorId, input) {
  const problem = dateProblem(input.start_date, input.expected_end) || dateProblem(input.start_date, input.actual_end);
  if (problem) return { error: 'invalid', message: problem };
  const refs = await checkRefs(orgId, input, null);
  if (refs) return refs;
  const { start_date, expected_end, actual_end, ...rest } = input;
  const deal = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    return tx.gxDeal.create({ data: { org_id: orgId, created_by: actorId, code, ...rest, start_date: toDate(start_date), expected_end: toDate(expected_end), actual_end: toDate(actual_end) } });
  });
  await writeAudit(null, { orgId, actorId, entity: 'deal', entityId: deal.id, action: 'create', after: dealSnap(deal) });
  return get(orgId, deal.id);
}

const locked = (deal, ctx) => DONE.includes(deal.status) && !ctx.isAdmin;

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.gxDeal.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (locked(before, ctx)) return { error: 'deal_closed' };
  const { reason, ...fields } = input;
  const s = fields.start_date !== undefined ? fields.start_date : dayOf(before.start_date);
  const problem = dateProblem(s, fields.expected_end !== undefined ? fields.expected_end : dayOf(before.expected_end)) || dateProblem(s, fields.actual_end !== undefined ? fields.actual_end : dayOf(before.actual_end));
  if (problem) return { error: 'invalid', message: problem };
  const refs = await checkRefs(orgId, fields, before);
  if (refs) return refs;
  const { start_date, expected_end, actual_end, ...rest } = fields;
  await prisma.gxDeal.update({
    where: { id },
    data: { ...rest, ...(start_date !== undefined ? { start_date: toDate(start_date) } : {}), ...(expected_end !== undefined ? { expected_end: toDate(expected_end) } : {}), ...(actual_end !== undefined ? { actual_end: toDate(actual_end) } : {}) },
  });
  const after = await prisma.gxDeal.findUnique({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'deal', entityId: id, action: 'update', before: dealSnap(before), after: dealSnap(after), reason });
  return get(orgId, id);
}

async function changeStatus(orgId, actorId, ctx, id, input) {
  const before = await prisma.gxDeal.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (locked(before, ctx)) return { error: 'deal_closed' };
  if (input.status === before.status) return { error: 'same_status' };
  if (input.status === 'cancelled' && !input.reason) return { error: 'reason_required' };
  if (DONE.includes(before.status) && !input.reason) return { error: 'reason_required' };
  const data = { status: input.status, cancel_reason: input.status === 'cancelled' ? input.reason : null };
  if (input.status === 'completed') data.actual_end = toDate(input.actual_end || today());
  else if (DONE.includes(before.status)) data.actual_end = null;
  await prisma.gxDeal.update({ where: { id }, data });
  await writeAudit(null, { orgId, actorId, entity: 'deal', entityId: id, action: 'status', before: { status: before.status }, after: { status: input.status }, reason: input.reason });
  return get(orgId, id);
}

async function remove(orgId, actorId, id) {
  const before = await prisma.gxDeal.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.gxDeal.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'deal', entityId: id, action: 'delete', before: dealSnap(before) });
  return { ok: true };
}

// A won lead becomes a trading deal. Everything carries forward and the lead stays for history.
async function convertLead(orgId, actorId, leadId, input) {
  const lead = await prisma.gxLead.findFirst({ where: { id: leadId, org_id: orgId, deleted_at: null } });
  if (!lead) return { error: 'not_found' };
  if (lead.stage !== 'won') return { error: 'lead_not_won' };
  if (lead.deal_id) return { error: 'already_converted' };
  const deal = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    const created = await tx.gxDeal.create({
      data: {
        org_id: orgId,
        created_by: actorId,
        code,
        name: input.name || lead.name,
        lead_id: lead.id,
        trading_type: lead.trading_type,
        party_id: lead.party_id,
        vendor_id: lead.vendor_id,
        status: 'planned',
        start_date: input.start_date !== undefined ? toDate(input.start_date) : lead.expected_start,
        expected_end: lead.expected_end,
        location: lead.location,
        assignee_id: lead.assignee_id,
        contractor_id: lead.contractor_id,
        product: lead.product,
        material_type: lead.material_type,
        ordered_quantity: lead.quantity,
        unit: lead.unit,
        expected_purchase_amount: lead.expected_purchase_amount,
        expected_sale_amount: lead.expected_sale_amount,
        description: lead.description,
        notes: lead.notes,
      },
    });
    await tx.gxLead.update({ where: { id: lead.id }, data: { deal_id: created.id } });
    await tx.gxLeadActivity.create({ data: { org_id: orgId, lead_id: lead.id, kind: 'note', created_by: actorId, summary: `Converted to trading deal ${code}` } });
    return created;
  });
  await writeAudit(null, { orgId, actorId, entity: 'deal', entityId: deal.id, action: 'convert', after: { lead_id: lead.id, code: deal.code } });
  return get(orgId, deal.id);
}

// ---- purchases and sales ----
const LINE = {
  purchase: { model: 'gxPurchase', dateKey: 'purchase_date', partyKey: 'vendor_id', role: 'vendor', entity: 'purchase', payKey: 'purchase_id', side: 'vendor' },
  sale: { model: 'gxSale', dateKey: 'sale_date', partyKey: 'client_id', role: 'client', entity: 'sale', payKey: 'sale_id', side: 'client' },
};

async function dealFor(orgId, dealId) {
  return prisma.gxDeal.findFirst({ where: { id: dealId, org_id: orgId, deleted_at: null } });
}

// Supplying more than the ordered quantity is blocked unless an admin overrides with a reason.
async function oversupply(orgId, deal, add, ctx, excludeId) {
  if (deal.ordered_quantity == null || add == null) return null;
  const rows = await prisma.gxSale.findMany({ where: { org_id: orgId, deal_id: deal.id, deleted_at: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) }, select: { quantity: true } });
  const total = calc.sum(rows, (r) => r.quantity) + Number(add);
  if (total <= Number(deal.ordered_quantity) + 0.0005) return null;
  if (!ctx.isAdmin) return { error: 'over_supplied' };
  return ctx.reason ? null : { error: 'override_reason_required' };
}

async function createLine(kind, orgId, actorId, ctx, dealId, input) {
  const L = LINE[kind];
  const deal = await dealFor(orgId, dealId);
  if (!deal) return { error: 'not_found' };
  if (locked(deal, ctx)) return { error: 'deal_closed' };
  if (input[L.partyKey] && !(await parties.partyOk(orgId, input[L.partyKey], L.role))) return { error: L.role === 'vendor' ? 'vendor_not_found' : 'party_not_found' };
  const amount = calc.lineAmount(input);
  if (amount === null) return { error: 'invalid', message: 'Enter an amount, or both quantity and rate' };
  const blocked = await lock.guard(orgId, [input[L.dateKey]], ctx);
  if (blocked) return blocked;
  if (kind === 'sale') {
    const over = await oversupply(orgId, deal, input.quantity, ctx);
    if (over) return over;
  }
  const { reason, [L.dateKey]: date, ...rest } = input;
  const row = await prisma[L.model].create({ data: { org_id: orgId, deal_id: dealId, created_by: actorId, ...rest, amount, [L.dateKey]: toDate(date) } });
  await lock.touch(orgId, [date]);
  await writeAudit(null, { orgId, actorId, entity: L.entity, entityId: row.id, action: 'create', after: lineSnap(row), reason });
  return { id: row.id };
}

async function updateLine(kind, orgId, actorId, ctx, dealId, id, input) {
  const L = LINE[kind];
  const deal = await dealFor(orgId, dealId);
  const before = deal && (await prisma[L.model].findFirst({ where: { id, deal_id: dealId, org_id: orgId, deleted_at: null } }));
  if (!before) return { error: 'not_found' };
  if (locked(deal, ctx)) return { error: 'deal_closed' };
  if (input[L.partyKey] && input[L.partyKey] !== before[L.partyKey] && !(await parties.partyOk(orgId, input[L.partyKey], L.role))) return { error: L.role === 'vendor' ? 'vendor_not_found' : 'party_not_found' };
  const merged = { quantity: input.quantity !== undefined ? input.quantity : before.quantity, rate: input.rate !== undefined ? input.rate : before.rate, amount: input.amount };
  // amount is recomputed from qty x rate unless supplied; keep the stored amount when nothing relevant changed
  const touchedAmount = ['quantity', 'rate', 'amount'].some((k) => input[k] !== undefined);
  const amount = touchedAmount ? calc.lineAmount(merged) : Number(before.amount);
  if (amount === null) return { error: 'invalid', message: 'Enter an amount, or both quantity and rate' };
  const newDate = input[L.dateKey] || dayOf(before[L.dateKey]);
  const blocked = (await lock.guard(orgId, [dayOf(before[L.dateKey])], ctx)) || (await lock.guard(orgId, [newDate], ctx));
  if (blocked) return blocked;
  if (kind === 'sale' && input.quantity !== undefined) {
    const over = await oversupply(orgId, deal, input.quantity, ctx, id);
    if (over) return over;
  }
  const { reason, [L.dateKey]: date, ...withAmount } = input;
  const rest = { ...withAmount };
  delete rest.amount;
  const row = await prisma[L.model].update({ where: { id }, data: { ...rest, amount, ...(date ? { [L.dateKey]: toDate(date) } : {}) } });
  await lock.touch(orgId, [dayOf(before[L.dateKey]), newDate]);
  await writeAudit(null, { orgId, actorId, entity: L.entity, entityId: id, action: 'update', before: lineSnap(before), after: lineSnap(row), reason });
  return { id };
}

async function removeLine(kind, orgId, actorId, ctx, dealId, id) {
  const L = LINE[kind];
  const deal = await dealFor(orgId, dealId);
  const before = deal && (await prisma[L.model].findFirst({ where: { id, deal_id: dealId, org_id: orgId, deleted_at: null } }));
  if (!before) return { error: 'not_found' };
  if (locked(deal, ctx)) return { error: 'deal_closed' };
  const blocked = await lock.guard(orgId, [dayOf(before[L.dateKey])], ctx);
  if (blocked) return blocked;
  await prisma.$transaction([
    prisma[L.model].update({ where: { id }, data: { deleted_at: new Date() } }),
    prisma.gxPayment.updateMany({ where: { org_id: orgId, [L.payKey]: id, deleted_at: null }, data: { deleted_at: new Date() } }),
  ]);
  await lock.touch(orgId, [dayOf(before[L.dateKey])]);
  await writeAudit(null, { orgId, actorId, entity: L.entity, entityId: id, action: 'delete', before: lineSnap(before), reason: ctx.reason });
  return { ok: true };
}

// ---- payments (cash against a purchase or a sale; outside the P&L, so no month lock) ----
async function addPayment(kind, orgId, actorId, ctx, dealId, lineId, input) {
  const L = LINE[kind];
  const deal = await dealFor(orgId, dealId);
  const line = deal && (await prisma[L.model].findFirst({ where: { id: lineId, deal_id: dealId, org_id: orgId, deleted_at: null } }));
  if (!line) return { error: 'not_found' };
  if (locked(deal, ctx)) return { error: 'deal_closed' };
  if (input.paid_date > today() && !ctx.isAdmin) return { error: 'future_date' };
  const paid = calc.sum(await prisma.gxPayment.findMany({ where: { org_id: orgId, [L.payKey]: lineId, deleted_at: null }, select: { amount: true } }), (p) => p.amount);
  if (paid + input.amount > Number(line.amount) + 0.005 && !(ctx.isAdmin && ctx.reason)) return { error: ctx.isAdmin ? 'override_reason_required' : 'over_paid' };
  const { reason, paid_date, ...rest } = input;
  const pay = await prisma.gxPayment.create({ data: { org_id: orgId, deal_id: dealId, side: L.side, [L.payKey]: lineId, created_by: actorId, ...rest, paid_date: toDate(paid_date) } });
  await writeAudit(null, { orgId, actorId, entity: 'payment', entityId: pay.id, action: 'create', after: { side: L.side, line: lineId, amount: input.amount, date: paid_date }, reason });
  return { id: pay.id };
}

async function updatePayment(orgId, actorId, ctx, dealId, id, input) {
  const before = await prisma.gxPayment.findFirst({ where: { id, deal_id: dealId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const deal = await dealFor(orgId, dealId);
  if (locked(deal, ctx)) return { error: 'deal_closed' };
  const L = before.side === 'vendor' ? LINE.purchase : LINE.sale;
  const line = await prisma[L.model].findFirst({ where: { id: before[L.payKey], org_id: orgId } });
  const others = calc.sum(await prisma.gxPayment.findMany({ where: { org_id: orgId, [L.payKey]: before[L.payKey], deleted_at: null, NOT: { id } }, select: { amount: true } }), (p) => p.amount);
  const amount = input.amount !== undefined ? input.amount : Number(before.amount);
  if (line && others + amount > Number(line.amount) + 0.005 && !(ctx.isAdmin && ctx.reason)) return { error: ctx.isAdmin ? 'override_reason_required' : 'over_paid' };
  const { reason, paid_date, ...rest } = input;
  const pay = await prisma.gxPayment.update({ where: { id }, data: { ...rest, ...(paid_date ? { paid_date: toDate(paid_date) } : {}) } });
  await writeAudit(null, { orgId, actorId, entity: 'payment', entityId: id, action: 'update', before: { amount: Number(before.amount), date: dayOf(before.paid_date) }, after: { amount: Number(pay.amount), date: dayOf(pay.paid_date) }, reason });
  return { id };
}

async function removePayment(orgId, actorId, ctx, dealId, id) {
  const before = await prisma.gxPayment.findFirst({ where: { id, deal_id: dealId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const deal = await dealFor(orgId, dealId);
  if (locked(deal, ctx)) return { error: 'deal_closed' };
  await prisma.gxPayment.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'payment', entityId: id, action: 'delete', before: { side: before.side, amount: Number(before.amount) }, reason: ctx.reason });
  return { ok: true };
}

module.exports = {
  STATUSES, ACTIVE, DONE,
  createDealSchema, updateDealSchema, statusSchema, convertSchema, listQuerySchema,
  purchaseCreateSchema, purchaseUpdateSchema, saleCreateSchema, saleUpdateSchema, paymentSchema, paymentUpdateSchema,
  list, get, create, update, changeStatus, remove, convertLead, decorate, loadMoney,
  createPurchase: (...a) => createLine('purchase', ...a), updatePurchase: (...a) => updateLine('purchase', ...a), removePurchase: (...a) => removeLine('purchase', ...a),
  createSale: (...a) => createLine('sale', ...a), updateSale: (...a) => updateLine('sale', ...a), removeSale: (...a) => removeLine('sale', ...a),
  addVendorPayment: (...a) => addPayment('purchase', ...a), addClientPayment: (...a) => addPayment('sale', ...a),
  updatePayment, removePayment,
};
