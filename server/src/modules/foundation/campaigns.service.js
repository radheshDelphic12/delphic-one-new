const { z } = require('zod');
const prisma = require('../../config/db');
const { pageArgs, pagination } = require('../../lib/vertical');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const people = require('./people.service');
const calc = require('./campaign.calc');

const { round2, dayOf, monthOf, OPEN_STATUSES } = calc;
const STATUSES = ['draft', 'planned', 'active', 'on_hold', 'completed', 'cancelled'];
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const money = z.coerce.number().min(0).max(1e12);
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const campaignFields = {
  name: z.string().trim().min(1).max(200),
  description: text(4000),
  objective: text(4000),
  category_id: uuidOrNull,
  country: text(80),
  state: text(80),
  city: text(80),
  area: text(120),
  address: text(500),
  planned_start: dateOnly.optional(),
  planned_end: dateOnly.optional(),
  actual_start: dateOnly.optional(),
  actual_end: dateOnly.optional(),
  financial_notes: text(2000),
  manager_id: uuidOrNull,
};
// Money is set here once; after that it only changes through the audited budget revision.
const createSchema = z.object({
  ...campaignFields,
  status: z.enum(['draft', 'planned', 'active']).default('draft'),
  allocated_budget: money.default(0),
  planned_investment: money.default(0),
});
const updateSchema = z.object(campaignFields).partial();
const statusSchema = z.object({ to: z.enum(STATUSES), reason: z.string().trim().max(500).optional(), date: dateOnly.optional() });
const budgetSchema = z.object({
  allocated_budget: money.optional(),
  planned_investment: money.optional(),
  reason: z.string().trim().min(3, 'Give the reason for the change').max(500),
  effective_date: dateOnly.optional(),
});
const planSchema = z.object({ rows: z.array(z.object({ month: monthStr, planned_amount: money })).max(120) });
const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category_id: z.string().uuid().optional(),
  status: z.string().optional(), // one or several, comma separated
  state: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  manager_id: z.string().uuid().optional(),
  budget_min: z.coerce.number().min(0).optional(),
  budget_max: z.coerce.number().min(0).optional(),
  from: dateOnly.optional(), // campaigns whose planned window overlaps from..to
  to: dateOnly.optional(),
  attention: z.enum(['true', 'false']).optional(),
  sort: z.enum(['created', 'name', 'status', 'budget', 'spent', 'remaining', 'end']).default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const snapshot = (c) => ({ name: c.name, status: c.status, category_id: c.category_id, planned_start: dayOf(c.planned_start), planned_end: dayOf(c.planned_end), actual_start: dayOf(c.actual_start), actual_end: dayOf(c.actual_end), manager_id: c.manager_id, city: c.city, state: c.state });
const budgetSnap = (c) => ({ allocated_budget: Number(c.allocated_budget), planned_investment: Number(c.planned_investment) });

function campaignOut(c) {
  return {
    id: c.id, code: c.code, name: c.name, description: c.description, objective: c.objective, status: c.status,
    category_id: c.category_id, manager_id: c.manager_id,
    country: c.country, state: c.state, city: c.city, area: c.area, address: c.address,
    planned_start: dayOf(c.planned_start), planned_end: dayOf(c.planned_end), actual_start: dayOf(c.actual_start), actual_end: dayOf(c.actual_end),
    allocated_budget: Number(c.allocated_budget), planned_investment: Number(c.planned_investment), financial_notes: c.financial_notes,
    created_by: c.created_by, updated_by: c.updated_by, created_at: c.created_at, updated_at: c.updated_at,
  };
}

// Entries that can matter to a campaign's figures (everything else - pending, rejected, cancelled - never counts).
const ENTRY_SELECT = { id: true, campaign_id: true, kind: true, status: true, expense_class: true, entry_date: true, amount: true };
async function entriesOf(orgId, campaignIds, range = {}) {
  if (!campaignIds.length) return new Map();
  const rows = await prisma.fxEntry.findMany({
    where: {
      org_id: orgId, campaign_id: { in: campaignIds }, deleted_at: null, kind: { in: ['expense', 'funding'] },
      ...(range.from || range.to ? { entry_date: { ...(range.from ? { gte: toDate(range.from) } : {}), ...(range.to ? { lte: toDate(range.to) } : {}) } } : {}),
    },
    select: ENTRY_SELECT,
  });
  const by = new Map(campaignIds.map((id) => [id, []]));
  for (const r of rows) by.get(r.campaign_id).push(r);
  return by;
}
async function plansOf(orgId, campaignIds) {
  if (!campaignIds.length) return new Map();
  const rows = await prisma.fxCampaignPlan.findMany({ where: { org_id: orgId, campaign_id: { in: campaignIds } }, orderBy: { month: 'asc' } });
  const by = new Map(campaignIds.map((id) => [id, []]));
  for (const r of rows) by.get(r.campaign_id).push({ month: r.month, planned_amount: Number(r.planned_amount) });
  return by;
}

/** Campaigns with every computed figure: metrics, timeline, forecast headline and attention flags. */
async function decorate(orgId, rows, { settings, now = new Date(), range } = {}) {
  const s = settings || (await core.ensureSettings(orgId));
  const ids = rows.map((r) => r.id);
  const [entries, plans, cats, mgrs] = await Promise.all([
    entriesOf(orgId, ids, range),
    plansOf(orgId, ids),
    prisma.fxCategory.findMany({ where: { org_id: orgId, id: { in: rows.map((r) => r.category_id).filter(Boolean) } }, select: { id: true, name: true } }),
    prisma.fxPerson.findMany({ where: { org_id: orgId, id: { in: rows.map((r) => r.manager_id).filter(Boolean) } }, select: { id: true, name: true } }),
  ]);
  const catBy = new Map(cats.map((c) => [c.id, c]));
  const mgrBy = new Map(mgrs.map((m) => [m.id, m]));
  return rows.map((row) => {
    const c = campaignOut(row);
    const es = entries.get(row.id) || [];
    const ps = plans.get(row.id) || [];
    const f = calc.forecast(c, es, ps, s, now);
    return {
      ...c,
      category: catBy.get(row.category_id) || null,
      manager: mgrBy.get(row.manager_id) || null,
      metrics: calc.summarize(c, es),
      timeline: calc.timeline(c, dayOf(now)),
      flags: calc.flags(c, es, ps, s, now),
      forecast: { method: f.method, projected_final_expenditure: f.projected_final_expenditure, projected_remaining_budget: f.projected_remaining_budget, projected_overrun: f.projected_overrun, projected_underspend: f.projected_underspend, insufficient: Boolean(f.insufficient) },
      _entries: es,
      _plan: ps,
    };
  });
}
const strip = ({ _entries, _plan, ...rest }) => rest;

function whereOf(orgId, q) {
  const statuses = q.status ? q.status.split(',').map((x) => x.trim()).filter((x) => STATUSES.includes(x)) : [];
  return {
    org_id: orgId,
    deleted_at: null,
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(q.category_id ? { category_id: q.category_id } : {}),
    ...(q.manager_id ? { manager_id: q.manager_id } : {}),
    ...(q.state ? { state: { equals: q.state, mode: 'insensitive' } } : {}),
    ...(q.city ? { city: { equals: q.city, mode: 'insensitive' } } : {}),
    ...(q.budget_min !== undefined || q.budget_max !== undefined ? { allocated_budget: { ...(q.budget_min !== undefined ? { gte: q.budget_min } : {}), ...(q.budget_max !== undefined ? { lte: q.budget_max } : {}) } } : {}),
    // overlap of the planned window with from..to (a campaign with no dates is left out of a date filter)
    ...(q.from ? { planned_end: { gte: toDate(q.from) } } : {}),
    ...(q.to ? { planned_start: { lte: toDate(q.to) } } : {}),
    ...(q.q ? { OR: ['name', 'code', 'city', 'area', 'state', 'objective'].map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) } : {}),
  };
}

const SORTS = {
  created: (c) => c.created_at, name: (c) => c.name.toLowerCase(), status: (c) => c.status, budget: (c) => c.allocated_budget,
  spent: (c) => c.metrics.actual_expenditure, remaining: (c) => c.metrics.remaining_allocated, end: (c) => c.planned_end || '9999',
};

async function list(orgId, rawQuery) {
  const q = listQuerySchema.parse(rawQuery);
  const rows = await prisma.fxCampaign.findMany({ where: whereOf(orgId, q) });
  let items = await decorate(orgId, rows);
  if (q.attention === 'true') items = items.filter((c) => c.flags.some((f) => f.severity !== 'info'));
  const pick = SORTS[q.sort];
  items.sort((a, b) => (pick(a) > pick(b) ? 1 : pick(a) < pick(b) ? -1 : 0) * (q.dir === 'asc' ? 1 : -1));
  const total = items.length;
  const { skip, take } = pageArgs(q);
  return { data: items.slice(skip, skip + take).map(strip), pagination: pagination(q.page, q.limit, total) };
}

// ---- rules shared by create / update / status ----
function checkDates(c) {
  const ps = dayOf(c.planned_start);
  const pe = dayOf(c.planned_end);
  const as = dayOf(c.actual_start);
  const ae = dayOf(c.actual_end);
  if (ps && pe && pe < ps) return 'planned_dates_invalid';
  if (as && ae && ae < as) return 'actual_dates_invalid';
  return null;
}
function checkBudget(allocated, planned) {
  return Number(planned) > Number(allocated) ? 'planned_exceeds_budget' : null;
}

async function checkRefs(orgId, data) {
  if (data.category_id) {
    const cat = await prisma.fxCategory.findFirst({ where: { id: data.category_id, org_id: orgId, scope: 'initiative', deleted_at: null }, select: { id: true } });
    if (!cat) return 'category_not_found';
  }
  if (data.manager_id && !(await people.managerOk(orgId, data.manager_id))) return 'manager_invalid';
  return null;
}

async function nextCode(tx, orgId) {
  await core.ensureSettings(orgId);
  const s = await tx.fxSetting.update({ where: { org_id: orgId }, data: { campaign_seq: { increment: 1 } } });
  return `${s.campaign_prefix}-${String(s.campaign_seq).padStart(4, '0')}`;
}

async function create(orgId, actorId, input) {
  const today = dayOf(new Date());
  const data = { ...input };
  if (data.status === 'active' && !data.actual_start) data.actual_start = data.planned_start && data.planned_start <= today ? data.planned_start : today;
  if (data.status !== 'active') { data.actual_start = null; data.actual_end = null; }
  data.actual_end = null;
  const bad = checkDates(data) || checkBudget(data.allocated_budget, data.planned_investment) || (await checkRefs(orgId, data));
  if (bad) return { error: bad };
  const { planned_start, planned_end, actual_start, actual_end, ...rest } = data;
  const row = await prisma.$transaction(async (tx) => {
    const code = await nextCode(tx, orgId);
    const created = await tx.fxCampaign.create({ data: { org_id: orgId, code, ...rest, planned_start: toDate(planned_start), planned_end: toDate(planned_end), actual_start: toDate(actual_start), actual_end: toDate(actual_end), created_by: actorId, updated_by: actorId } });
    await tx.fxBudgetHistory.create({ data: { org_id: orgId, campaign_id: created.id, previous_allocated: 0, new_allocated: created.allocated_budget, previous_planned: 0, new_planned: created.planned_investment, reason: 'Initial budget', effective_date: toDate(today), changed_by: actorId } });
    await writeAudit(tx, { orgId, actorId, entity: 'campaign', entityId: created.id, action: 'create', after: { ...snapshot(created), ...budgetSnap(created), code } });
    return created;
  });
  return { campaign: (await getOne(orgId, row.id)).campaign };
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.fxCampaign.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const merged = { ...before, ...input };
  // Actual dates follow the status: an actual end only belongs to a completed campaign.
  if (input.actual_end && before.status !== 'completed') return { error: 'status_dates_conflict' };
  if (input.actual_start && ['draft', 'planned'].includes(before.status)) return { error: 'status_dates_conflict' };
  const bad = checkDates(merged) || (await checkRefs(orgId, input));
  if (bad) return { error: bad };
  const { planned_start, planned_end, actual_start, actual_end, ...rest } = input;
  const row = await prisma.fxCampaign.update({
    where: { id },
    data: {
      ...rest,
      ...(planned_start !== undefined ? { planned_start: toDate(planned_start) } : {}),
      ...(planned_end !== undefined ? { planned_end: toDate(planned_end) } : {}),
      ...(actual_start !== undefined ? { actual_start: toDate(actual_start) } : {}),
      ...(actual_end !== undefined ? { actual_end: toDate(actual_end) } : {}),
      updated_by: actorId,
    },
  });
  await writeAudit(null, { orgId, actorId, entity: 'campaign', entityId: id, action: 'update', before: snapshot(before), after: snapshot(row) });
  return { campaign: (await getOne(orgId, id)).campaign };
}

const TRANSITIONS = {
  draft: ['planned', 'active', 'cancelled'],
  planned: ['draft', 'active', 'on_hold', 'cancelled'],
  active: ['on_hold', 'completed', 'cancelled'],
  on_hold: ['active', 'completed', 'cancelled'],
  completed: ['active'],
  cancelled: ['draft', 'planned'],
};

/** Moves a campaign through its life cycle and keeps the actual dates consistent with it. */
async function setStatus(orgId, actorId, ctx, id, { to, reason, date }) {
  const before = await prisma.fxCampaign.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (before.status === to) return { error: 'same_status' };
  if (!TRANSITIONS[before.status].includes(to)) return { error: 'bad_transition' };
  // Reopening a finished campaign is an admin decision and is explained.
  if (['completed', 'cancelled'].includes(before.status)) {
    if (!ctx.isAdmin) return { error: 'admin_only_reopen' };
    if (!reason) return { error: 'reason_required' };
  }
  if (to === 'cancelled' && !reason) return { error: 'reason_required' };
  const today = dayOf(new Date());
  const patch = { status: to, updated_by: actorId };
  if (to === 'active') {
    patch.actual_end = null;
    if (!before.actual_start) patch.actual_start = toDate(date || today);
  } else if (to === 'completed') {
    const end = date || today;
    const start = dayOf(before.actual_start) || dayOf(before.planned_start) || end;
    if (end < start) return { error: 'actual_dates_invalid' };
    patch.actual_end = toDate(end);
    if (!before.actual_start) patch.actual_start = toDate(start);
  } else if (to === 'draft' || to === 'planned') {
    patch.actual_start = null;
    patch.actual_end = null;
  }
  const row = await prisma.fxCampaign.update({ where: { id }, data: patch });
  await writeAudit(null, { orgId, actorId, entity: 'campaign', entityId: id, action: 'status', before: { status: before.status, actual_start: dayOf(before.actual_start), actual_end: dayOf(before.actual_end) }, after: { status: row.status, actual_start: dayOf(row.actual_start), actual_end: dayOf(row.actual_end) }, reason });
  return { campaign: (await getOne(orgId, id)).campaign };
}

/** Budget revision: history is kept, who/when/why is recorded, and a budget cannot silently drop below what is spent. */
async function reviseBudget(orgId, actorId, ctx, id, input) {
  const before = await prisma.fxCampaign.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const allocated = input.allocated_budget ?? Number(before.allocated_budget);
  const planned = input.planned_investment ?? Number(before.planned_investment);
  const bad = checkBudget(allocated, planned);
  if (bad) return { error: bad };
  if (allocated === Number(before.allocated_budget) && planned === Number(before.planned_investment)) return { error: 'no_change' };
  const entries = (await entriesOf(orgId, [id])).get(id);
  const m = calc.summarize({ allocated_budget: allocated, planned_investment: planned }, entries);
  if (m.overspend > 0 && !ctx.canOverride) return { error: 'below_spent', detail: { overspend: m.overspend } };
  const today = dayOf(new Date());
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.fxCampaign.update({ where: { id }, data: { allocated_budget: allocated, planned_investment: planned, updated_by: actorId } });
    await tx.fxBudgetHistory.create({ data: { org_id: orgId, campaign_id: id, previous_allocated: before.allocated_budget, new_allocated: allocated, previous_planned: before.planned_investment, new_planned: planned, reason: input.reason, effective_date: toDate(input.effective_date || today), changed_by: actorId } });
    await writeAudit(tx, { orgId, actorId, entity: 'budget', entityId: id, action: 'revise', before: budgetSnap(before), after: budgetSnap(updated), reason: input.reason });
    return updated;
  });
  return { campaign: (await getOne(orgId, row.id)).campaign };
}

/** Replaces the monthly planned-investment schedule. */
async function setPlan(orgId, actorId, id, { rows }) {
  const c = await prisma.fxCampaign.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!c) return { error: 'not_found' };
  const months = rows.map((r) => r.month);
  if (new Set(months).size !== months.length) return { error: 'plan_duplicate_month' };
  const first = monthOf(c.planned_start);
  const last = monthOf(c.planned_end);
  if ((first || last) && months.some((m) => (first && m < first) || (last && m > last))) return { error: 'plan_outside_window' };
  const total = round2(rows.reduce((a, r) => a + r.planned_amount, 0));
  if (total > Number(c.planned_investment) + 0.001) return { error: 'plan_exceeds_investment', detail: { total, planned_investment: Number(c.planned_investment) } };
  const before = await prisma.fxCampaignPlan.findMany({ where: { campaign_id: id }, orderBy: { month: 'asc' } });
  await prisma.$transaction(async (tx) => {
    await tx.fxCampaignPlan.deleteMany({ where: { campaign_id: id } });
    if (rows.length) await tx.fxCampaignPlan.createMany({ data: rows.map((r) => ({ org_id: orgId, campaign_id: id, month: r.month, planned_amount: r.planned_amount })) });
    await writeAudit(tx, { orgId, actorId, entity: 'plan', entityId: id, action: 'replace', before: before.map((b) => ({ month: b.month, planned_amount: Number(b.planned_amount) })), after: rows });
  });
  return { campaign: (await getOne(orgId, id)).campaign };
}

async function remove(orgId, actorId, id) {
  const c = await prisma.fxCampaign.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!c) return { error: 'not_found' };
  if (await prisma.fxEntry.count({ where: { org_id: orgId, campaign_id: id, deleted_at: null } })) return { error: 'has_entries' };
  await prisma.fxCampaign.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'campaign', entityId: id, action: 'delete', before: { ...snapshot(c), ...budgetSnap(c) } });
  return { ok: true };
}

/** One campaign with its full picture: metrics, timeline, month-by-month series, forecast, plan, budget history, activity. */
async function getOne(orgId, id, { now = new Date() } = {}) {
  const row = await prisma.fxCampaign.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!row) return { error: 'not_found' };
  const settings = await core.ensureSettings(orgId);
  const [item] = await decorate(orgId, [row], { settings, now });
  const c = campaignOut(row);
  const [history, audit, recent] = await Promise.all([
    prisma.fxBudgetHistory.findMany({ where: { campaign_id: id }, orderBy: { created_at: 'desc' } }),
    prisma.fxAudit.findMany({ where: { org_id: orgId, entity_id: id, entity: { in: ['campaign', 'budget', 'plan'] } }, orderBy: { created_at: 'desc' }, take: 30 }),
    prisma.fxEntry.count({ where: { org_id: orgId, campaign_id: id, deleted_at: null } }),
  ]);
  const names = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set([...history.map((h) => h.changed_by), ...audit.map((a) => a.actor_id), row.created_by, row.updated_by].filter(Boolean))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const full = calc.forecast(c, item._entries, item._plan, settings, now);
  return {
    campaign: {
      ...strip(item),
      plan: item._plan,
      plan_source: calc.planMap(c, item._plan).source,
      monthly: calc.monthlySeries(c, item._entries, item._plan),
      forecast: full,
      budget_history: history.map((h) => ({ id: h.id, previous_allocated: Number(h.previous_allocated), new_allocated: Number(h.new_allocated), previous_planned: Number(h.previous_planned), new_planned: Number(h.new_planned), reason: h.reason, effective_date: dayOf(h.effective_date), changed_by: names.get(h.changed_by) || null, created_at: h.created_at })),
      activity: audit.map((a) => ({ id: a.id, entity: a.entity, action: a.action, before: a.before, after: a.after, reason: a.reason, actor: names.get(a.actor_id) || null, created_at: a.created_at })),
      entry_count: recent,
      created_by_name: names.get(row.created_by) || null,
      updated_by_name: names.get(row.updated_by) || null,
    },
  };
}

module.exports = {
  STATUSES, createSchema, updateSchema, statusSchema, budgetSchema, planSchema, listQuerySchema,
  decorate, strip, entriesOf, plansOf, whereOf, list, create, update, setStatus, reviseBudget, setPlan, remove, getOne, campaignOut, OPEN_STATUSES,
};
