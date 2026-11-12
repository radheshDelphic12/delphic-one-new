const { z } = require('zod');
const prisma = require('../../config/db');
const { pageArgs, pagination } = require('../../lib/vertical');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const lock = require('./lock');
const calc = require('./campaign.calc');
const campaigns = require('./campaigns.service');

const { round2, dayOf } = calc;
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());

const KINDS = ['expense', 'funding', 'transfer'];
const STATUS_BY_KIND = {
  expense: ['pending', 'approved', 'paid', 'rejected', 'cancelled', 'reversed'],
  funding: ['pledged', 'received', 'cancelled'],
  transfer: ['recorded'],
};
// What a status can move to. 'approved' is an outstanding commitment; only 'paid' is spending; 'reversed' is a refund.
const TRANSITIONS = {
  expense: { pending: ['approved', 'rejected', 'cancelled'], approved: ['paid', 'rejected', 'cancelled'], paid: ['reversed'], rejected: [], cancelled: [], reversed: [] },
  funding: { pledged: ['received', 'cancelled'], received: ['cancelled'], cancelled: [] },
  transfer: { recorded: [] },
};
const COUNTED = { expense: ['approved', 'paid'], funding: ['received'] };

const fields = {
  campaign_id: uuidOrNull,
  category_id: uuidOrNull,
  expense_class: z.enum(['programme', 'operational']).nullable().optional(),
  entry_date: dateStr,
  amount: z.coerce.number().gt(0).max(1e12),
  payment_method: text(60),
  party_name: text(200),
  reference: text(120),
  description: text(2000),
  override_reason: text(500),
};
const createSchema = z.object({ kind: z.enum(KINDS), status: z.string().optional(), ...fields });
const updateSchema = z.object(fields).partial().extend({ reason: z.string().trim().max(500).optional() });
const statusSchema = z.object({ to: z.string(), reason: z.string().trim().max(500).optional(), override_reason: z.string().trim().max(500).optional(), entry_date: dateStr.optional() });
const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  campaign_id: z.string().uuid().optional(),
  kind: z.enum(KINDS).optional(),
  status: z.string().optional(),
  expense_class: z.enum(['programme', 'operational']).optional(),
  category_id: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  amount_min: z.coerce.number().min(0).optional(),
  amount_max: z.coerce.number().min(0).optional(),
  sort: z.enum(['date', 'amount', 'status', 'created']).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const out = (e) => ({ ...e, amount: Number(e.amount), entry_date: dayOf(e.entry_date) });
const snap = (e) => ({ kind: e.kind, status: e.status, campaign_id: e.campaign_id, expense_class: e.expense_class, category_id: e.category_id, entry_date: dayOf(e.entry_date), amount: Number(e.amount), party_name: e.party_name, reference: e.reference });

/** Would counting this expense push the campaign past its allocated budget? Excludes the entry itself, so re-checks are exact. */
async function overspendCheck(orgId, campaignId, amount, excludeId) {
  const c = await prisma.fxCampaign.findFirst({ where: { id: campaignId, org_id: orgId, deleted_at: null } });
  if (!c) return null;
  const es = (await campaigns.entriesOf(orgId, [campaignId])).get(campaignId).filter((e) => e.id !== excludeId);
  const m = calc.summarize(c, es);
  const after = round2(m.actual_expenditure + m.commitments + amount);
  const allocated = Number(c.allocated_budget);
  return after > allocated ? { overspend: round2(after - allocated), allocated, committed_or_spent: round2(m.actual_expenditure + m.commitments), remaining: Math.max(0, round2(allocated - m.actual_expenditure - m.commitments)) } : null;
}

// Runs the spend guard for an expense that is (or is becoming) counted. Returns an error code or a recorded override.
async function guardSpend(orgId, ctx, settings, campaignId, amount, excludeId, overrideReason) {
  if (!campaignId) return { ok: true };
  const over = await overspendCheck(orgId, campaignId, amount, excludeId);
  if (!over) return { ok: true };
  if (!settings.block_overspend) return { ok: true, warning: over };
  if (ctx.canOverride && overrideReason) return { ok: true, override: { reason: overrideReason, ...over } };
  return { error: ctx.canOverride ? 'override_reason_required' : 'over_budget', detail: over };
}

async function checkRefs(orgId, kind, data, { admin } = {}) {
  if (data.campaign_id) {
    const c = await prisma.fxCampaign.findFirst({ where: { id: data.campaign_id, org_id: orgId, deleted_at: null }, select: { status: true } });
    if (!c) return 'campaign_not_found';
    if (kind !== 'transfer' && c.status === 'cancelled') return 'campaign_closed';
    if (kind === 'expense' && c.status === 'draft') return 'campaign_not_open';
    if (kind === 'expense' && c.status === 'completed' && !admin) return 'campaign_closed';
  }
  if (data.category_id) {
    const cat = await prisma.fxCategory.findFirst({ where: { id: data.category_id, org_id: orgId, scope: kind === 'funding' ? 'funding' : 'expense', deleted_at: null }, select: { id: true } });
    if (!cat) return 'category_not_found';
  }
  return null;
}

async function create(orgId, actorId, ctx, input) {
  const kind = input.kind;
  const status = input.status || { expense: 'pending', funding: 'received', transfer: 'recorded' }[kind];
  if (!STATUS_BY_KIND[kind].includes(status)) return { error: 'bad_status' };
  // Not-yet-counted starting points: an expense is entered as pending (or approved/paid by finance); funding as pledged/received.
  if (kind === 'expense' && ['rejected', 'cancelled', 'reversed'].includes(status)) return { error: 'bad_status' };
  if (kind === 'funding' && status === 'cancelled') return { error: 'bad_status' };
  if (kind === 'expense' && ['approved', 'paid'].includes(status) && !ctx.canApprove) return { error: 'approval_required' };
  if (kind === 'transfer' && input.campaign_id) return { error: 'transfer_has_no_campaign' };
  const bad = await checkRefs(orgId, kind, input, { admin: ctx.isAdmin });
  if (bad) return { error: bad };
  const settings = await core.ensureSettings(orgId);
  const expense_class = kind === 'expense' ? input.expense_class || (input.campaign_id ? 'programme' : 'operational') : null;
  if (kind === 'expense' && expense_class === 'programme' && !input.campaign_id) return { error: 'programme_needs_campaign' };

  const locked = COUNTED[kind]?.includes(status) ? await lock.guard(orgId, [input.entry_date], ctx) : null;
  if (locked) return locked;
  let guard = { ok: true };
  if (kind === 'expense' && COUNTED.expense.includes(status)) {
    guard = await guardSpend(orgId, ctx, settings, input.campaign_id, input.amount, null, input.override_reason);
    if (guard.error) return guard;
  }
  const { override_reason, ...rest } = input;
  const row = await prisma.fxEntry.create({
    data: {
      org_id: orgId, ...rest, kind, status, expense_class, entry_date: toDate(input.entry_date),
      override_reason: guard.override ? guard.override.reason : null,
      ...(COUNTED.expense.includes(status) && kind === 'expense' ? { approved_by: actorId, approved_at: new Date() } : {}),
      created_by: actorId,
    },
  });
  await lock.touch(orgId, [input.entry_date]);
  await writeAudit(null, { orgId, actorId, entity: 'entry', entityId: row.id, action: 'create', after: snap(row), reason: guard.override?.reason });
  return { entry: out(row), ...(guard.warning ? { warning: guard.warning } : {}) };
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.fxEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const counted = (COUNTED[before.kind] || []).includes(before.status);
  const final = ['rejected', 'cancelled', 'reversed'].includes(before.status);
  if (final) return { error: 'entry_final' };
  // Editing money that already counts is for finance / admin, and it says why.
  if ((counted || before.status === 'paid') && !ctx.canEditCounted) return { error: 'counted_locked' };
  if (counted && !input.reason) return { error: 'reason_required' };
  const { reason, override_reason, ...rest } = input;
  const merged = { ...before, ...rest };
  const bad = await checkRefs(orgId, before.kind, { campaign_id: merged.campaign_id, category_id: merged.category_id }, { admin: ctx.isAdmin });
  if (bad) return { error: bad };
  if (before.kind === 'transfer' && merged.campaign_id) return { error: 'transfer_has_no_campaign' };
  if (before.kind === 'expense' && (rest.expense_class ?? before.expense_class) === 'programme' && !merged.campaign_id) return { error: 'programme_needs_campaign' };
  const dates = [dayOf(before.entry_date), rest.entry_date].filter(Boolean);
  if (counted) { const locked = await lock.guard(orgId, dates, ctx); if (locked) return locked; }
  let guard = { ok: true };
  if (before.kind === 'expense' && counted && (rest.amount !== undefined || rest.campaign_id !== undefined)) {
    const settings = await core.ensureSettings(orgId);
    guard = await guardSpend(orgId, ctx, settings, merged.campaign_id, Number(merged.amount), id, override_reason);
    if (guard.error) return guard;
  }
  const { entry_date, ...others } = rest;
  const row = await prisma.fxEntry.update({ where: { id }, data: { ...others, ...(entry_date ? { entry_date: toDate(entry_date) } : {}), ...(guard.override ? { override_reason: guard.override.reason } : {}) } });
  if (counted) await lock.touch(orgId, dates);
  await writeAudit(null, { orgId, actorId, entity: 'entry', entityId: id, action: 'update', before: snap(before), after: snap(row), reason: reason || guard.override?.reason });
  return { entry: out(row), ...(guard.warning ? { warning: guard.warning } : {}) };
}

/** Moves an entry along its status chain: approve a commitment, pay it, reject, cancel, or reverse a payment (a refund). */
async function setStatus(orgId, actorId, ctx, id, { to, reason, override_reason, entry_date }) {
  const before = await prisma.fxEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const allowed = TRANSITIONS[before.kind][before.status] || [];
  if (!allowed.includes(to)) return { error: 'bad_transition' };
  const needsFinance = before.kind === 'expense' && ['approved', 'paid', 'rejected', 'reversed'].includes(to);
  if (needsFinance && !ctx.canApprove) return { error: 'approval_required' };
  if (['reversed', 'cancelled'].includes(to) && (COUNTED[before.kind] || []).includes(before.status) && !reason) return { error: 'reason_required' };
  if (to === 'rejected' && !reason) return { error: 'reason_required' };
  const date = entry_date || dayOf(before.entry_date);
  const becomesCounted = (COUNTED[before.kind] || []).includes(to);
  const wasCounted = (COUNTED[before.kind] || []).includes(before.status);
  const locked = becomesCounted || wasCounted ? await lock.guard(orgId, [dayOf(before.entry_date), date], { ...ctx, reason: ctx.reason || reason }) : null;
  if (locked) return locked;
  let guard = { ok: true };
  if (before.kind === 'expense' && becomesCounted && !wasCounted) {
    const settings = await core.ensureSettings(orgId);
    guard = await guardSpend(orgId, ctx, settings, before.campaign_id, Number(before.amount), id, override_reason);
    if (guard.error) return guard;
  }
  const row = await prisma.fxEntry.update({
    where: { id },
    data: { status: to, ...(entry_date ? { entry_date: toDate(entry_date) } : {}), ...(guard.override ? { override_reason: guard.override.reason } : {}), ...(becomesCounted && before.kind === 'expense' ? { approved_by: actorId, approved_at: new Date() } : {}) },
  });
  if (becomesCounted || wasCounted) await lock.touch(orgId, [dayOf(before.entry_date), date]);
  await writeAudit(null, { orgId, actorId, entity: 'entry', entityId: id, action: 'status', before: { status: before.status }, after: { status: to }, reason: reason || guard.override?.reason });
  return { entry: out(row), ...(guard.warning ? { warning: guard.warning } : {}) };
}

async function remove(orgId, actorId, ctx, id) {
  const before = await prisma.fxEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if ((COUNTED[before.kind] || []).includes(before.status) && !ctx.isAdmin) return { error: 'counted_locked' };
  if ((COUNTED[before.kind] || []).includes(before.status)) { const locked = await lock.guard(orgId, [dayOf(before.entry_date)], ctx); if (locked) return locked; }
  await prisma.fxEntry.update({ where: { id }, data: { deleted_at: new Date() } });
  await lock.touch(orgId, [dayOf(before.entry_date)]);
  await writeAudit(null, { orgId, actorId, entity: 'entry', entityId: id, action: 'delete', before: snap(before), reason: ctx.reason });
  return { ok: true };
}

function whereOf(orgId, q) {
  const statuses = q.status ? q.status.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return {
    org_id: orgId, deleted_at: null,
    ...(q.campaign_id ? { campaign_id: q.campaign_id } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(q.expense_class ? { expense_class: q.expense_class } : {}),
    ...(q.category_id ? { category_id: q.category_id } : {}),
    ...(q.from || q.to ? { entry_date: { ...(q.from ? { gte: toDate(q.from) } : {}), ...(q.to ? { lte: toDate(q.to) } : {}) } } : {}),
    ...(q.amount_min !== undefined || q.amount_max !== undefined ? { amount: { ...(q.amount_min !== undefined ? { gte: q.amount_min } : {}), ...(q.amount_max !== undefined ? { lte: q.amount_max } : {}) } } : {}),
    ...(q.q ? { OR: ['party_name', 'reference', 'description'].map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) } : {}),
  };
}

async function list(orgId, rawQuery) {
  const q = listQuerySchema.parse(rawQuery);
  const where = whereOf(orgId, q);
  const orderBy = { date: { entry_date: q.dir }, amount: { amount: q.dir }, status: { status: q.dir }, created: { created_at: q.dir } }[q.sort];
  const [total, rows, groups] = await Promise.all([
    prisma.fxEntry.count({ where }),
    prisma.fxEntry.findMany({ where, orderBy: [orderBy, { created_at: 'desc' }], ...pageArgs(q), include: { campaign: { select: { id: true, code: true, name: true } }, category: { select: { id: true, name: true } } } }),
    prisma.fxEntry.groupBy({ by: ['kind', 'status', 'expense_class'], where, _sum: { amount: true } }),
  ]);
  // Totals follow the same rules as the campaigns: paid expense, approved commitments, received funding.
  const sum = (kind, status, cls) => round2(groups.filter((g) => g.kind === kind && g.status === status && (!cls || g.expense_class === cls)).reduce((a, g) => a + Number(g._sum.amount || 0), 0));
  return {
    data: rows.map((r) => ({ ...out(r), campaign: r.campaign, category: r.category })),
    pagination: pagination(q.page, q.limit, total),
    summary: { paid_expenditure: sum('expense', 'paid'), paid_investment: sum('expense', 'paid', 'programme'), commitments: sum('expense', 'approved'), pending: sum('expense', 'pending'), funds_received: sum('funding', 'received'), funds_pledged: sum('funding', 'pledged') },
  };
}

module.exports = { KINDS, STATUS_BY_KIND, TRANSITIONS, COUNTED, createSchema, updateSchema, statusSchema, listQuerySchema, create, update, setStatus, remove, list, overspendCheck };
