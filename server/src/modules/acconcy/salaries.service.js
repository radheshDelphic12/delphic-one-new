const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const lock = require('./lock');
const { round2, num, sum, dayOf } = require('./deal.calc');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthSchema = z.string().regex(MONTH_RE, 'Use YYYY-MM');
const STATUSES = ['draft', 'approved', 'paid'];

const listQuerySchema = z.object({
  month: monthSchema.optional(),
  from: monthSchema.optional(),
  to: monthSchema.optional(),
  person_id: z.string().uuid().optional(),
  kind: z.enum(['employee', 'contractor']).optional(),
  status: z.enum(STATUSES).optional(),
});
const generateSchema = z.object({ month: monthSchema, reason: z.string().trim().max(500).optional() });
const updateSchema = z.object({
  gross: z.coerce.number().min(0).max(1e10).optional(),
  deductions: z.coerce.number().min(0).max(1e10).optional(),
  notes: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(500).nullable().optional()),
  reason: z.string().trim().max(500).optional(),
});
const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const paySchema = z.object({ paid_on: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()) });

const monthStart = (m) => `${m}-01`;
const monthEnd = (m) => dayOf(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)));
const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const snap = (r) => ({ month: r.month, person_id: r.person_id, gross: num(r.gross), deductions: num(r.deductions), net: num(r.net), status: r.status });
const out = (r) => ({ ...r, gross: num(r.gross), deductions: num(r.deductions), net: num(r.net), person: r.person ? { id: r.person.id, name: r.person.name, kind: r.person.kind, designation: r.person.designation } : undefined });

async function list(orgId, q) {
  const rows = await prisma.axSalary.findMany({
    where: {
      org_id: orgId,
      ...(q.month ? { month: q.month } : { ...(q.from || q.to ? { month: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}) }),
      ...(q.person_id ? { person_id: q.person_id } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.kind ? { person: { is: { kind: q.kind } } } : {}),
    },
    include: { person: { select: { id: true, name: true, kind: true, designation: true } } },
    orderBy: [{ month: 'desc' }, { person: { name: 'asc' } }],
  });
  const data = rows.map(out);
  const total = (st) => round2(sum(data.filter((r) => !st || st.includes(r.status)), (r) => r.net));
  return { data, totals: { net: total(), approved_paid: total(['approved', 'paid']), draft: total(['draft']), paid: total(['paid']), count: data.length } };
}

// Creates a draft row for every active roster person with a monthly salary who was on the team during the month.
async function generate(orgId, actorId, ctx, input) {
  const blocked = await lock.guard(orgId, [monthStart(input.month)], ctx);
  if (blocked) return blocked;
  const start = monthStart(input.month);
  const end = monthEnd(input.month);
  const people = await prisma.axPerson.findMany({ where: { org_id: orgId, deleted_at: null, active: true, monthly_salary: { gt: 0 } } });
  const eligible = people.filter((p) => (!p.joining_date || dayOf(p.joining_date) <= end) && (!p.leaving_date || dayOf(p.leaving_date) >= start));
  const existing = new Set((await prisma.axSalary.findMany({ where: { org_id: orgId, month: input.month }, select: { person_id: true } })).map((r) => r.person_id));
  const fresh = eligible.filter((p) => !existing.has(p.id));
  if (fresh.length) {
    await prisma.axSalary.createMany({ data: fresh.map((p) => ({ org_id: orgId, person_id: p.id, month: input.month, gross: p.monthly_salary, deductions: 0, net: p.monthly_salary, created_by: actorId })) });
    await lock.touch(orgId, [start]);
  }
  await writeAudit(null, { orgId, actorId, entity: 'salary', action: 'generate', after: { month: input.month, created: fresh.length, skipped: eligible.length - fresh.length }, reason: input.reason });
  return { created: fresh.length, skipped: eligible.length - fresh.length };
}

async function find(orgId, id) {
  return prisma.axSalary.findFirst({ where: { id, org_id: orgId }, include: { person: { select: { id: true, name: true, kind: true, designation: true } } } });
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await find(orgId, id);
  if (!before) return { error: 'not_found' };
  const blocked = await lock.guard(orgId, [monthStart(before.month)], ctx);
  if (blocked) return blocked;
  if (before.status !== 'draft' && !ctx.isAdmin) return { error: 'salary_locked' };
  if (before.status !== 'draft' && !ctx.reason) return { error: 'period_reason_required' };
  const gross = input.gross ?? num(before.gross);
  const deductions = input.deductions ?? num(before.deductions);
  if (deductions > gross) return { error: 'invalid', message: 'Deductions cannot be more than the gross salary' };
  const { reason, ...fields } = input;
  const row = await prisma.axSalary.update({ where: { id }, data: { ...fields, gross, deductions, net: round2(gross - deductions) }, include: { person: { select: { id: true, name: true, kind: true, designation: true } } } });
  await lock.touch(orgId, [monthStart(before.month)]);
  await writeAudit(null, { orgId, actorId, entity: 'salary', entityId: id, action: 'update', before: snap(before), after: snap(row), reason });
  return { salary: out(row) };
}

async function setStatus(orgId, actorId, ctx, id, status, extra = {}) {
  const before = await find(orgId, id);
  if (!before) return { error: 'not_found' };
  const blocked = await lock.guard(orgId, [monthStart(before.month)], ctx);
  if (blocked) return blocked;
  if (status === 'approved' && before.status !== 'draft') return { error: 'bad_transition' };
  if (status === 'paid' && before.status !== 'approved') return { error: 'bad_transition' };
  if (status === 'draft' && before.status === 'draft') return { error: 'bad_transition' };
  const row = await prisma.axSalary.update({ where: { id }, data: { status, paid_on: status === 'paid' ? toDate(extra.paid_on || dayOf(new Date())) : null }, include: { person: { select: { id: true, name: true, kind: true, designation: true } } } });
  await lock.touch(orgId, [monthStart(before.month)]);
  await writeAudit(null, { orgId, actorId, entity: 'salary', entityId: id, action: status === 'draft' ? 'unapprove' : status, before: snap(before), after: snap(row), reason: extra.reason });
  return { salary: out(row) };
}

async function remove(orgId, actorId, ctx, id) {
  const before = await find(orgId, id);
  if (!before) return { error: 'not_found' };
  const blocked = await lock.guard(orgId, [monthStart(before.month)], ctx);
  if (blocked) return blocked;
  if (before.status !== 'draft' && !ctx.isAdmin) return { error: 'salary_locked' };
  await prisma.axSalary.delete({ where: { id } });
  await lock.touch(orgId, [monthStart(before.month)]);
  await writeAudit(null, { orgId, actorId, entity: 'salary', entityId: id, action: 'delete', before: snap(before), reason: ctx.reason });
  return { ok: true };
}

module.exports = { MONTH_RE, listQuerySchema, generateSchema, updateSchema, reasonSchema, paySchema, list, generate, update, setStatus, remove };
