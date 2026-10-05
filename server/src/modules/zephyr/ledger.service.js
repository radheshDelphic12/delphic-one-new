const { z } = require('zod');
const prisma = require('../../config/db');
const { pageArgs, pagination } = require('../../lib/vertical');
const { writeAudit } = require('./audit');
const { markStale } = require('./periods');
const money = require('./money.service');
const { ensureCategories } = require('./core.service');

const TYPES = ['revenue', 'expense'];
const STATUSES = ['planned', 'actual'];
const MODES = ['cash', 'bank', 'upi', 'cheque', 'card', 'other'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());

const entryFields = {
  entry_date: dateStr,
  type: z.enum(TYPES),
  category_id: z.string().uuid(),
  project_id: uuidOrNull,
  party_id: uuidOrNull,
  work_order_id: uuidOrNull,
  milestone_id: uuidOrNull,
  amount: z.coerce.number().positive().max(1e13),
  tax: z.preprocess((v) => (v === '' || v === null ? 0 : v), z.coerce.number().min(0).max(1e13)),
  status: z.enum(STATUSES),
  payment_mode: z.preprocess((v) => (v === '' ? null : v), z.enum(MODES).nullable().optional()),
  reference: text(120),
  description: text(500),
};
const createEntrySchema = z.object({ ...entryFields, tax: entryFields.tax.default(0), status: entryFields.status.default('actual') });
const updateEntrySchema = z.object(entryFields).partial();
const importSchema = z.object({ rows: z.array(z.record(z.any())).min(1).max(500) });
const listQuerySchema = z.object({
  type: z.enum(TYPES).optional(),
  status: z.enum(STATUSES).optional(),
  project_id: z.string().uuid().optional(),
  party_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const num = money.num;
const todayStr = () => new Date().toISOString().slice(0, 10);
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);

function out(e) {
  return {
    id: e.id,
    entry_date: dayOf(e.entry_date),
    type: e.type,
    status: e.status,
    amount: num(e.amount),
    tax: num(e.tax),
    category: e.category ? { id: e.category.id, name: e.category.name } : null,
    project: e.project ? { id: e.project.id, code: e.project.code, name: e.project.name } : null,
    party: e.party ? { id: e.party.id, name: e.party.name } : null,
    work_order: e.work_order ? { id: e.work_order.id, wo_number: e.work_order.wo_number } : null,
    milestone: e.milestone ? { id: e.milestone.id, name: e.milestone.name } : null,
    category_id: e.category_id,
    project_id: e.project_id,
    party_id: e.party_id,
    work_order_id: e.work_order_id,
    milestone_id: e.milestone_id,
    payment_mode: e.payment_mode,
    reference: e.reference,
    description: e.description,
    created_at: e.created_at,
  };
}
const INCLUDE = {
  category: { select: { id: true, name: true } },
  project: { select: { id: true, code: true, name: true } },
  party: { select: { id: true, name: true } },
  work_order: { select: { id: true, wo_number: true } },
  milestone: { select: { id: true, name: true } },
};
const snapshot = (e) => ({ date: dayOf(e.entry_date), type: e.type, status: e.status, amount: num(e.amount), tax: num(e.tax), project_id: e.project_id, party_id: e.party_id });

// Resolve links and enforce the rules; returns { data } with derived project / party, or { error }.
async function resolveLinks(orgId, m, { categoryChanged }) {
  const data = { ...m };
  if (m.status === 'actual' && m.entry_date > todayStr()) return { error: 'future_actual' };
  if (categoryChanged) {
    const cat = await prisma.zxCategory.findFirst({ where: { id: m.category_id, org_id: orgId, deleted_at: null } });
    if (!cat || cat.kind !== m.type || !cat.active) return { error: 'category_invalid' };
  }
  if (m.work_order_id) {
    if (m.type !== 'expense') return { error: 'wo_expense_only' };
    const wo = await prisma.zxWorkOrder.findFirst({ where: { id: m.work_order_id, org_id: orgId, deleted_at: null } });
    if (!wo) return { error: 'link_not_found' };
    if (m.project_id && m.project_id !== wo.project_id) return { error: 'link_mismatch' };
    if (m.party_id && m.party_id !== wo.vendor_id) return { error: 'link_mismatch' };
    data.project_id = wo.project_id;
    data.party_id = wo.vendor_id;
  }
  if (m.milestone_id) {
    if (m.type !== 'revenue') return { error: 'milestone_revenue_only' };
    const ms = await prisma.zxMilestone.findFirst({ where: { id: m.milestone_id, org_id: orgId, deleted_at: null } });
    if (!ms) return { error: 'link_not_found' };
    if (m.project_id && m.project_id !== ms.project_id) return { error: 'link_mismatch' };
    data.project_id = ms.project_id;
  }
  if (data.project_id && !(await prisma.zxProject.findFirst({ where: { id: data.project_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'link_not_found' };
  if (data.party_id) {
    const party = await prisma.zxParty.findFirst({ where: { id: data.party_id, org_id: orgId, deleted_at: null }, select: { kind: true } });
    if (!party) return { error: 'link_not_found' };
    if (m.type === 'revenue' && party.kind === 'vendor') return { error: 'party_kind' };
    if (m.type === 'expense' && party.kind === 'client') return { error: 'party_kind' };
  }
  return { data };
}

// A manager keeps project expenses only; revenue and company-level entries are admin work.
const managerAllowed = (e) => e.type === 'expense' && Boolean(e.project_id);

async function list(orgId, ctx, query) {
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(!ctx.isAdmin ? { type: 'expense', project_id: { not: null } } : {}),
    ...(query.type && ctx.isAdmin ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.project_id ? { project_id: query.project_id } : {}),
    ...(query.party_id ? { party_id: query.party_id } : {}),
    ...(query.category_id ? { category_id: query.category_id } : {}),
    ...(query.from || query.to ? { entry_date: { ...(query.from ? { gte: money.toDate(query.from) } : {}), ...(query.to ? { lte: money.toDate(query.to) } : {}) } } : {}),
    ...(query.q ? { OR: [{ reference: { contains: query.q, mode: 'insensitive' } }, { description: { contains: query.q, mode: 'insensitive' } }] } : {}),
  };
  const [rows, total, sums] = await Promise.all([
    prisma.zxLedgerEntry.findMany({ where, include: INCLUDE, orderBy: [{ entry_date: 'desc' }, { created_at: 'desc' }], ...pageArgs(query) }),
    prisma.zxLedgerEntry.count({ where }),
    prisma.zxLedgerEntry.groupBy({ by: ['type', 'status'], where, _sum: { amount: true, tax: true } }),
  ]);
  const totals = { revenue: 0, expense: 0, planned_revenue: 0, planned_expense: 0 };
  for (const s of sums) {
    const key = s.status === 'actual' ? s.type : `planned_${s.type}`;
    totals[key] += num(s._sum.amount);
  }
  return { data: rows.map(out), pagination: pagination(query.page, query.limit, total), totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, money.round2(v)])) };
}

async function get(orgId, ctx, id) {
  const e = await prisma.zxLedgerEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: INCLUDE });
  if (!e || (!ctx.isAdmin && !managerAllowed(e))) return { error: 'not_found' };
  return { entry: out(e) };
}

async function create(orgId, actorId, ctx, input) {
  const resolved = await resolveLinks(orgId, input, { categoryChanged: true });
  if (resolved.error) return resolved;
  if (!ctx.isAdmin && !managerAllowed(resolved.data)) return { error: 'manager_scope' };
  const e = await prisma.zxLedgerEntry.create({ data: { org_id: orgId, created_by: actorId, ...resolved.data, entry_date: money.toDate(resolved.data.entry_date) }, include: INCLUDE });
  await writeAudit(null, { orgId, actorId, entity: 'ledger', entityId: e.id, action: 'create', after: snapshot(e) });
  if (e.status === 'actual') await markStale(orgId, e.entry_date);
  return { entry: out(e) };
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.zxLedgerEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before || (!ctx.isAdmin && !managerAllowed(before))) return { error: 'not_found' };
  const merged = {
    entry_date: dayOf(before.entry_date), type: before.type, category_id: before.category_id, project_id: before.project_id, party_id: before.party_id,
    work_order_id: before.work_order_id, milestone_id: before.milestone_id, amount: num(before.amount), tax: num(before.tax), status: before.status,
    payment_mode: before.payment_mode, reference: before.reference, description: before.description, ...input,
  };
  // Changing the project drops links that belong to the old one unless they are re-sent.
  if (input.project_id !== undefined && input.project_id !== before.project_id) {
    if (input.work_order_id === undefined) merged.work_order_id = null;
    if (input.milestone_id === undefined) merged.milestone_id = null;
  }
  if (input.type && input.type !== before.type) {
    if (input.work_order_id === undefined) merged.work_order_id = null;
    if (input.milestone_id === undefined) merged.milestone_id = null;
  }
  const resolved = await resolveLinks(orgId, merged, { categoryChanged: input.category_id !== undefined || (input.type && input.type !== before.type) });
  if (resolved.error) return resolved;
  if (!ctx.isAdmin && !managerAllowed(resolved.data)) return { error: 'manager_scope' };
  const e = await prisma.zxLedgerEntry.update({ where: { id }, data: { ...resolved.data, entry_date: money.toDate(resolved.data.entry_date) }, include: INCLUDE });
  await writeAudit(null, { orgId, actorId, entity: 'ledger', entityId: id, action: 'update', before: snapshot(before), after: snapshot(e) });
  if (before.status === 'actual') await markStale(orgId, before.entry_date);
  if (e.status === 'actual') await markStale(orgId, e.entry_date);
  return { entry: out(e) };
}

async function remove(orgId, actorId, id) {
  const before = await prisma.zxLedgerEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.zxLedgerEntry.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'ledger', entityId: id, action: 'delete', before: snapshot(before) });
  if (before.status === 'actual') await markStale(orgId, before.entry_date);
  return { ok: true };
}

// CSV rows from the client: date, type, category, amount, tax, status, project (code), party (name), reference, description, payment_mode.
async function importRows(orgId, actorId, rows) {
  await ensureCategories(orgId);
  const [cats, projects, parties] = await Promise.all([
    prisma.zxCategory.findMany({ where: { org_id: orgId, deleted_at: null, active: true } }),
    prisma.zxProject.findMany({ where: { org_id: orgId, deleted_at: null }, select: { id: true, code: true } }),
    prisma.zxParty.findMany({ where: { org_id: orgId, deleted_at: null }, select: { id: true, name: true } }),
  ]);
  const key = (s) => String(s || '').trim().toLowerCase();
  const skipped = [];
  let created = 0;
  for (const [index, raw] of rows.entries()) {
    const row = index + 1;
    const type = key(raw.type);
    const cat = cats.find((c) => c.kind === type && key(c.name) === key(raw.category));
    const project = raw.project ? projects.find((p) => key(p.code) === key(raw.project)) : null;
    const party = raw.party ? parties.find((p) => key(p.name) === key(raw.party)) : null;
    const fail = (reason) => skipped.push({ row, reason });
    if (!TYPES.includes(type)) { fail('type must be revenue or expense'); continue; }
    if (!cat) { fail(`no active ${type} category named "${raw.category || ''}"`); continue; }
    if (raw.project && !project) { fail(`unknown project code "${raw.project}"`); continue; }
    if (raw.party && !party) { fail(`unknown client / vendor "${raw.party}"`); continue; }
    const parsed = createEntrySchema.safeParse({
      entry_date: String(raw.date || raw.entry_date || '').trim(), type, category_id: cat.id, project_id: project?.id ?? null, party_id: party?.id ?? null,
      amount: raw.amount, tax: raw.tax === '' || raw.tax === undefined ? 0 : raw.tax, status: key(raw.status) || 'actual',
      payment_mode: key(raw.payment_mode) || null, reference: raw.reference, description: raw.description,
    });
    if (!parsed.success) { const i = parsed.error.issues[0]; fail(`${i.path.join('.') || 'row'}: ${i.message}`); continue; }
    const resolved = await resolveLinks(orgId, parsed.data, { categoryChanged: false });
    if (resolved.error) { fail(resolved.error.replace(/_/g, ' ')); continue; }
    await prisma.zxLedgerEntry.create({ data: { org_id: orgId, created_by: actorId, ...resolved.data, entry_date: money.toDate(resolved.data.entry_date) } });
    if (resolved.data.status === 'actual') await markStale(orgId, resolved.data.entry_date);
    created += 1;
  }
  if (created > 0) await writeAudit(null, { orgId, actorId, entity: 'ledger', action: 'import', after: { created, skipped: skipped.length } });
  return { created, skipped };
}

async function projectMoney(orgId, ctx, projectId) {
  const project = await prisma.zxProject.findFirst({ where: { id: projectId, org_id: orgId, deleted_at: null } });
  if (!project) return { error: 'not_found' };
  const entries = await prisma.zxLedgerEntry.findMany({ where: { org_id: orgId, project_id: projectId, deleted_at: null }, include: { category: { select: { name: true } } } });
  const acc = { revenue: 0, expense: 0, planned_revenue: 0, planned_expense: 0, tax_collected: 0, tax_paid: 0 };
  const cats = new Map();
  for (const e of entries) {
    const amount = num(e.amount);
    if (e.status === 'actual') {
      acc[e.type] += amount;
      acc[e.type === 'revenue' ? 'tax_collected' : 'tax_paid'] += num(e.tax);
      const k = `${e.type}:${e.category.name}`;
      cats.set(k, (cats.get(k) || 0) + amount);
    } else acc[`planned_${e.type}`] += amount;
  }
  let salaries = null;
  if (ctx.isAdmin) {
    const slipRows = await prisma.zxSalaryRecord.findMany({ where: { org_id: orgId, status: { in: ['approved', 'paid'] } }, select: { project_split: true } });
    salaries = slipRows.reduce((a, s) => a + (Array.isArray(s.project_split) ? s.project_split.filter((p) => p.project_id === projectId).reduce((x, p) => x + num(p.amount), 0) : 0), 0);
  }
  const profit = acc.revenue - acc.expense - (salaries || 0);
  const cost = project.budget == null ? null : num(project.budget);
  return {
    money: {
      revenue: money.round2(acc.revenue),
      expense: money.round2(acc.expense),
      salaries: salaries === null ? null : money.round2(salaries),
      profit: money.round2(profit),
      planned_revenue: money.round2(acc.planned_revenue),
      planned_expense: money.round2(acc.planned_expense),
      tax_collected: money.round2(acc.tax_collected),
      tax_paid: money.round2(acc.tax_paid),
      contract_value: project.contract_value == null ? null : num(project.contract_value),
      budget: cost,
      budget_used_pct: cost ? Math.round(((acc.expense + (salaries || 0)) / cost) * 100) : null,
      by_category: [...cats.entries()].map(([k, amount]) => ({ type: k.split(':')[0], category: k.slice(k.indexOf(':') + 1), amount: money.round2(amount) })).sort((a, b) => b.amount - a.amount),
    },
  };
}

async function partyStatement(orgId, partyId) {
  const party = await prisma.zxParty.findFirst({ where: { id: partyId, org_id: orgId, deleted_at: null }, select: { id: true, name: true, kind: true } });
  if (!party) return { error: 'not_found' };
  const [entries, workOrders] = await Promise.all([
    prisma.zxLedgerEntry.findMany({ where: { org_id: orgId, party_id: partyId, deleted_at: null }, include: INCLUDE, orderBy: { entry_date: 'desc' } }),
    prisma.zxWorkOrder.findMany({ where: { org_id: orgId, vendor_id: partyId, deleted_at: null, status: { not: 'cancelled' } }, include: { project: { select: { code: true, name: true } } } }),
  ]);
  const sum = (type, status) => money.round2(entries.filter((e) => e.type === type && e.status === status).reduce((a, e) => a + num(e.amount), 0));
  return {
    statement: {
      party,
      received: sum('revenue', 'actual'),
      paid: sum('expense', 'actual'),
      expected_in: sum('revenue', 'planned'),
      expected_out: sum('expense', 'planned'),
      work_order_value: money.round2(workOrders.reduce((a, w) => a + num(w.value), 0)),
      work_order_billed: money.round2(workOrders.reduce((a, w) => a + num(w.billed_to_date), 0)),
      work_orders: workOrders.map((w) => ({ id: w.id, wo_number: w.wo_number, project: w.project, value: num(w.value), billed_to_date: num(w.billed_to_date), status: w.status })),
      entries: entries.map(out),
    },
  };
}

module.exports = { createEntrySchema, updateEntrySchema, importSchema, listQuerySchema, list, get, create, update, remove, importRows, projectMoney, partyStatement };
