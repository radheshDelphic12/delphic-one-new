const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const calc = require('./valterra.calc');

const { round2, LINES } = calc;
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const STATUSES = ['draft', 'approved', 'archived'];

const fields = {
  name: z.string().trim().min(1).max(200),
  month: monthStr,
  line: z.enum(LINES),
  category_id: uuidOrNull,
  site_id: uuidOrNull,
  investment_id: uuidOrNull,
  amount: z.coerce.number().min(0).max(1e12),
  status: z.enum(STATUSES).optional(),
  notes: text(1000),
};
const createSchema = z.object(fields);
const updateSchema = z.object(fields).partial();
const listQuerySchema = z.object({
  from: monthStr.optional(), to: monthStr.optional(), line: z.enum(LINES).optional(), status: z.enum(STATUSES).optional(), category_id: z.string().uuid().optional(),
  site_id: z.union([z.string().uuid(), z.literal('none')]).optional(), mining_type_id: z.string().uuid().optional(), material_id: z.string().uuid().optional(),
});

const out = (p) => ({
  id: p.id, name: p.name, site_id: p.site_id, site: p.site ? { id: p.site.id, code: p.site.code, name: p.site.name } : null, month: p.month, line: p.line, line_label: calc.LINE_LABEL[p.line], category_id: p.category_id, category: p.category ? { id: p.category.id, name: p.category.name } : null,
  investment_id: p.investment_id, investment: p.investment ? { id: p.investment.id, code: p.investment.code, name: p.investment.name } : null,
  amount: Number(p.amount), status: p.status, notes: p.notes, created_at: p.created_at, updated_at: p.updated_at,
});
const include = { site: { select: { id: true, code: true, name: true } }, category: { select: { id: true, name: true } }, investment: { select: { id: true, code: true, name: true } } };
const snap = (p) => ({ site_id: p.site_id, name: p.name, month: p.month, line: p.line, amount: Number(p.amount), status: p.status });
const INVESTMENT_LINES = ['new_investment', 'principal_recovery', 'investment_earnings'];

async function list(orgId, rawQuery = {}) {
  const f = listQuerySchema.parse(rawQuery);
  const rows = await prisma.vtProjection.findMany({
    where: { org_id: orgId, deleted_at: null, ...(f.line ? { line: f.line } : {}), ...(f.status ? { status: f.status } : {}), ...(f.category_id ? { category_id: f.category_id } : {}), ...core.siteWhere(f), ...(f.from || f.to ? { month: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}) },
    include, orderBy: [{ month: 'asc' }, { line: 'asc' }, { created_at: 'asc' }],
  });
  return rows.map(out);
}

async function refsOk(orgId, line, input) {
  if (input.investment_id) {
    if (!INVESTMENT_LINES.includes(line)) return 'investment_only_investment_line';
    if (!(await prisma.vtInvestment.findFirst({ where: { id: input.investment_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return 'investment_not_found';
  }
  if (input.category_id && !(await prisma.vtCategory.findFirst({ where: { id: input.category_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return 'category_not_found';
  return null;
}

async function create(orgId, actorId, input) {
  const bad = await refsOk(orgId, input.line, input);
  if (bad) return { error: bad };
  const siteBad = await core.siteCheck(orgId, input.site_id, { creating: true });
  if (siteBad) return { error: siteBad };
  const row = await prisma.vtProjection.create({ data: { org_id: orgId, ...input, status: input.status || 'draft', created_by: actorId }, include });
  await writeAudit(null, { orgId, actorId, entity: 'projection', entityId: row.id, action: 'create', after: snap(row) });
  return { projection: out(row) };
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.vtProjection.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const bad = await refsOk(orgId, input.line || before.line, { investment_id: input.investment_id ?? undefined, category_id: input.category_id ?? undefined });
  if (bad) return { error: bad };
  if (input.site_id !== undefined) {
    const siteBad = await core.siteCheck(orgId, input.site_id, { creating: input.site_id !== before.site_id });
    if (siteBad) return { error: siteBad };
  }
  const row = await prisma.vtProjection.update({ where: { id }, data: input, include });
  await writeAudit(null, { orgId, actorId, entity: 'projection', entityId: id, action: 'update', before: snap(before), after: snap(row) });
  return { projection: out(row) };
}

async function remove(orgId, actorId, id) {
  const before = await prisma.vtProjection.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.vtProjection.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'projection', entityId: id, action: 'delete', before: snap(before) });
  return { ok: true };
}

module.exports = { STATUSES, createSchema, updateSchema, listQuerySchema, list, create, update, remove, out, round2 };
