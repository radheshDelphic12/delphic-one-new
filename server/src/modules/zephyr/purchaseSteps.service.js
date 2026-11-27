const { z } = require('zod');
const prisma = require('../../config/db');

// Zephyr > Properties > a property > Purchase timeline: the plan for buying it. Each step has a planned date and, once it happens, a
// done date (and optionally the amount due at that step). A step past its planned date and not done is late. "Add the usual steps"
// fills the common sequence, which can then be edited, reordered by date, or removed.

const DEFAULT_STEPS = ['Token / booking amount', 'Due diligence and title check', 'Sale agreement signed', 'Loan sanction', 'Balance payment', 'Registration', 'Possession'];
const day = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31').nullable().optional());
const stepSchema = z.object({
  title: z.string().trim().min(1, 'Name the step').max(120),
  planned_date: day,
  done_date: day,
  amount: z.preprocess((v) => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().min(0).max(1e13).nullable().optional()),
  notes: z.string().trim().max(1000).nullable().optional(),
  sort_order: z.coerce.number().int().min(0).max(1000).optional(),
});
const stepUpdateSchema = stepSchema.partial();
const asDate = (v) => (v ? new Date(`${v}T00:00:00Z`) : null);
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : null);

/** The steps of one property, in order, each with its state (done / late / upcoming / no date) and how late it is. */
async function stepsFor(orgId, propertyId, { canFinance = true } = {}) {
  const rows = await prisma.zxPropertyPurchaseStep.findMany({ where: { org_id: orgId, property_id: propertyId }, orderBy: [{ sort_order: 'asc' }, { planned_date: 'asc' }, { created_at: 'asc' }] });
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => {
    const planned = ymd(r.planned_date);
    const done = ymd(r.done_date);
    const state = done ? 'done' : !planned ? 'no_date' : planned < today ? 'late' : 'upcoming';
    const daysLate = state === 'late' ? Math.round((Date.parse(today) - Date.parse(planned)) / 86400000) : 0;
    const daysEarlyOrLate = done && planned ? Math.round((Date.parse(done) - Date.parse(planned)) / 86400000) : null;
    return { id: r.id, title: r.title, planned_date: planned, done_date: done, notes: r.notes, sort_order: r.sort_order, state, days_late: daysLate, done_vs_plan_days: daysEarlyOrLate, ...(canFinance ? { amount: r.amount == null ? null : Number(r.amount) } : {}) };
  });
}

const liveProperty = (orgId, id) => prisma.zxProperty.findFirst({ where: { id, org_id: orgId, deleted_at: null }, select: { id: true } });

async function addStep(orgId, actorId, ctx, propertyId, input) {
  if (!(await liveProperty(orgId, propertyId))) return { error: 'not_found' };
  if (input.amount != null && !ctx.canFinance) return { error: 'finance_only' };
  const last = await prisma.zxPropertyPurchaseStep.findFirst({ where: { org_id: orgId, property_id: propertyId }, orderBy: { sort_order: 'desc' } });
  await prisma.zxPropertyPurchaseStep.create({
    data: { org_id: orgId, property_id: propertyId, title: input.title, planned_date: asDate(input.planned_date), done_date: asDate(input.done_date), amount: input.amount ?? null, notes: input.notes || null, sort_order: input.sort_order ?? (last ? last.sort_order + 1 : 0), created_by: actorId },
  });
  return { ok: true };
}

/** The usual sequence of steps, added once (steps that already exist by name are skipped). */
async function addDefaultSteps(orgId, actorId, propertyId) {
  if (!(await liveProperty(orgId, propertyId))) return { error: 'not_found' };
  const existing = await prisma.zxPropertyPurchaseStep.findMany({ where: { org_id: orgId, property_id: propertyId }, select: { title: true, sort_order: true } });
  const have = new Set(existing.map((e) => e.title.toLowerCase()));
  let order = existing.reduce((m, e) => Math.max(m, e.sort_order), -1);
  const data = DEFAULT_STEPS.filter((t) => !have.has(t.toLowerCase())).map((title) => ({ org_id: orgId, property_id: propertyId, title, sort_order: (order += 1), created_by: actorId }));
  if (data.length) await prisma.zxPropertyPurchaseStep.createMany({ data });
  return { ok: true, added: data.length };
}

async function updateStep(orgId, ctx, propertyId, stepId, input) {
  const row = await prisma.zxPropertyPurchaseStep.findFirst({ where: { id: stepId, org_id: orgId, property_id: propertyId } });
  if (!row) return { error: 'not_found' };
  if (input.amount !== undefined && !ctx.canFinance) return { error: 'finance_only' };
  const data = {};
  for (const k of ['title', 'notes', 'sort_order', 'amount']) if (input[k] !== undefined) data[k] = input[k];
  if (input.planned_date !== undefined) data.planned_date = asDate(input.planned_date);
  if (input.done_date !== undefined) data.done_date = asDate(input.done_date);
  await prisma.zxPropertyPurchaseStep.update({ where: { id: stepId }, data });
  return { ok: true };
}

async function removeStep(orgId, propertyId, stepId) {
  const done = await prisma.zxPropertyPurchaseStep.deleteMany({ where: { id: stepId, org_id: orgId, property_id: propertyId } });
  return done.count ? { ok: true } : { error: 'not_found' };
}

/**
 * Every property's purchase on one timeline (Zephyr > Properties > Purchase timeline): the purchase date, the planned steps (planned /
 * done dates) and, for finance, the purchase cost and each acquisition cost paid with its date. Sorted by date; the screen sorts and charts it.
 */
async function timeline(orgId, ctx) {
  const props = await prisma.zxProperty.findMany({ where: { org_id: orgId, deleted_at: null }, select: { id: true, code: true, name: true, status: true, purchase_date: true, purchase_cost: true }, orderBy: { code: 'asc' } });
  const ids = props.map((p) => p.id);
  const [steps, costs] = await Promise.all([
    prisma.zxPropertyPurchaseStep.findMany({ where: { org_id: orgId, property_id: { in: ids } } }),
    ctx.canFinance ? prisma.zxLedgerEntry.findMany({ where: { org_id: orgId, property_id: { in: ids }, source_type: 'property_acquisition', deleted_at: null }, select: { property_id: true, entry_date: true, amount: true, service_type: true, reference: true } }) : [],
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const byId = new Map(props.map((p) => [p.id, p]));
  const prop = (id) => { const p = byId.get(id); return { id: p.id, code: p.code, name: p.name, status: p.status }; };
  const events = [];
  for (const p of props) {
    if (p.purchase_date) events.push({ property: prop(p.id), date: ymd(p.purchase_date), kind: 'purchase', title: 'Purchased', state: 'done', ...(ctx.canFinance ? { amount: Number(p.purchase_cost) || null } : {}) });
  }
  for (const st of steps) {
    const planned = ymd(st.planned_date); const done = ymd(st.done_date);
    const state = done ? 'done' : !planned ? 'no_date' : planned < today ? 'late' : 'upcoming';
    const date = done || planned;
    if (!date) continue;
    events.push({ property: prop(st.property_id), date, planned_date: planned, done_date: done, kind: 'step', title: st.title, state, ...(ctx.canFinance ? { amount: st.amount == null ? null : Number(st.amount) } : {}) });
  }
  for (const c of costs) {
    events.push({ property: prop(c.property_id), date: ymd(c.entry_date), kind: 'payment', title: `${String(c.service_type || 'cost').replace(/_/g, ' ')} paid${c.reference ? ` (${c.reference})` : ''}`, state: 'done', amount: Number(c.amount) });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.property.code.localeCompare(b.property.code));
  return { events, properties: props.map((p) => ({ id: p.id, code: p.code, name: p.name, purchase_date: ymd(p.purchase_date) })) };
}

module.exports = { timeline, DEFAULT_STEPS, stepSchema, stepUpdateSchema, stepsFor, addStep, addDefaultSteps, updateStep, removeStep };
