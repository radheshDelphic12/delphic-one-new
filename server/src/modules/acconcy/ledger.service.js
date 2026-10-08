const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const parties = require('./parties.service');
const lock = require('./lock');
const { dayOf } = require('./deal.calc');
const { SERVICE_KEYS } = require('./serviceTypes');

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const reqDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const entryFields = {
  entry_date: reqDate,
  type: z.enum(['revenue', 'expense']),
  category_id: z.string().uuid(),
  deal_id: uuidOrNull,
  party_id: uuidOrNull,
  vendor_id: uuidOrNull,
  amount: z.coerce.number().positive().max(1e13),
  tax: z.preprocess((v) => (v === '' || v == null ? 0 : v), z.coerce.number().min(0).max(1e13)),
  payment_mode: text(60),
  reference: text(200),
  description: text(1000),
  reason: z.string().trim().max(500).optional(),
};
const createEntrySchema = z.object(entryFields);
const updateEntrySchema = z.object(entryFields).partial();
const listQuerySchema = z.object({
  type: z.enum(['revenue', 'expense']).optional(),
  deal_id: z.string().uuid().optional(),
  scope: z.enum(['deal', 'company']).optional(),
  category_id: z.string().uuid().optional(),
  party_id: z.string().uuid().optional(),
  vendor_id: z.string().uuid().optional(),
  service_type: z.enum(SERVICE_KEYS).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const snap = (e) => ({ date: dayOf(e.entry_date), type: e.type, amount: Number(e.amount), tax: Number(e.tax), category_id: e.category_id, deal_id: e.deal_id, party_id: e.party_id, vendor_id: e.vendor_id });

async function list(orgId, query) {
  const range = {};
  if (query.from) range.gte = toDate(query.from);
  if (query.to) range.lte = toDate(query.to);
  const rows = await prisma.axLedgerEntry.findMany({
    where: {
      org_id: orgId,
      deleted_at: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.deal_id ? { deal_id: query.deal_id } : {}),
      ...(query.scope === 'deal' ? { deal_id: { not: null } } : {}),
      ...(query.scope === 'company' ? { deal_id: null } : {}),
      ...(query.category_id ? { category_id: query.category_id } : {}),
      ...(query.party_id ? { party_id: query.party_id } : {}),
      ...(query.vendor_id ? { vendor_id: query.vendor_id } : {}),
      ...(query.service_type ? { deal: { is: { service_type: query.service_type, deleted_at: null } } } : {}),
      ...(Object.keys(range).length ? { entry_date: range } : {}),
      ...(query.q ? { OR: [{ description: { contains: query.q, mode: 'insensitive' } }, { reference: { contains: query.q, mode: 'insensitive' } }] } : {}),
    },
    include: { category: { select: { name: true } }, deal: { select: { id: true, code: true, name: true, service_type: true } } },
    orderBy: [{ entry_date: 'desc' }, { created_at: 'desc' }],
    take: query.limit,
  });
  const partyIds = [...new Set(rows.flatMap((r) => [r.party_id, r.vendor_id]).filter(Boolean))];
  const ps = partyIds.length ? await prisma.axParty.findMany({ where: { id: { in: partyIds }, org_id: orgId }, select: { id: true, name: true } }) : [];
  const pm = new Map(ps.map((p) => [p.id, p]));
  const data = rows.map((r) => ({ ...r, amount: Number(r.amount), tax: Number(r.tax), category_name: r.category?.name || null, party: pm.get(r.party_id) || null, vendor: pm.get(r.vendor_id) || null }));
  const total = (type) => data.filter((r) => r.type === type).reduce((a, r) => a + r.amount, 0);
  return { data, totals: { revenue: total('revenue'), expense: total('expense') } };
}

async function refs(orgId, input, before) {
  if (input.category_id && input.category_id !== before?.category_id) {
    const cat = await prisma.axCategory.findFirst({ where: { id: input.category_id, org_id: orgId, deleted_at: null, active: true } });
    if (!cat) return { error: 'invalid', message: 'Unknown category' };
    if ((input.type || before?.type) !== cat.kind) return { error: 'invalid', message: 'The category does not match the entry type' };
  }
  if (input.deal_id && input.deal_id !== before?.deal_id) {
    if (!(await prisma.axDeal.findFirst({ where: { id: input.deal_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'deal_not_found' };
  }
  if (input.party_id && input.party_id !== before?.party_id && !(await parties.partyOk(orgId, input.party_id, 'client'))) return { error: 'party_not_found' };
  if (input.vendor_id && input.vendor_id !== before?.vendor_id && !(await parties.partyOk(orgId, input.vendor_id, 'vendor'))) return { error: 'vendor_not_found' };
  return null;
}

async function create(orgId, actorId, ctx, input) {
  await core.ensureCategories(orgId);
  const bad = await refs(orgId, input, null);
  if (bad) return bad;
  const blocked = await lock.guard(orgId, [input.entry_date], ctx);
  if (blocked) return blocked;
  const { reason, entry_date, ...rest } = input;
  const row = await prisma.axLedgerEntry.create({ data: { org_id: orgId, created_by: actorId, ...rest, entry_date: toDate(entry_date) } });
  await lock.touch(orgId, [entry_date]);
  await writeAudit(null, { orgId, actorId, entity: 'expense', entityId: row.id, action: 'create', after: snap(row), reason });
  return { id: row.id };
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.axLedgerEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (before.source_type) return { error: 'auto_posted' };
  const bad = await refs(orgId, input, before);
  if (bad) return bad;
  const newDate = input.entry_date || dayOf(before.entry_date);
  const blocked = (await lock.guard(orgId, [dayOf(before.entry_date)], ctx)) || (await lock.guard(orgId, [newDate], ctx));
  if (blocked) return blocked;
  const { reason, entry_date, ...rest } = input;
  const row = await prisma.axLedgerEntry.update({ where: { id }, data: { ...rest, ...(entry_date ? { entry_date: toDate(entry_date) } : {}) } });
  await lock.touch(orgId, [dayOf(before.entry_date), newDate]);
  await writeAudit(null, { orgId, actorId, entity: 'expense', entityId: id, action: 'update', before: snap(before), after: snap(row), reason });
  return { id };
}

async function remove(orgId, actorId, ctx, id) {
  const before = await prisma.axLedgerEntry.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (before.source_type) return { error: 'auto_posted' };
  const blocked = await lock.guard(orgId, [dayOf(before.entry_date)], ctx);
  if (blocked) return blocked;
  await prisma.axLedgerEntry.update({ where: { id }, data: { deleted_at: new Date() } });
  await lock.touch(orgId, [dayOf(before.entry_date)]);
  await writeAudit(null, { orgId, actorId, entity: 'expense', entityId: id, action: 'delete', before: snap(before), reason: ctx.reason });
  return { ok: true };
}

module.exports = { createEntrySchema, updateEntrySchema, listQuerySchema, list, create, update, remove };
