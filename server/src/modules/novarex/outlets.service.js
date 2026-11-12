const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const calc = require('./novarex.calc');

// Outlets of Novarex Pharmaceuticals. An outlet is never deleted: closing it keeps every transaction, return and projection, and its
// reports stay readable. All outlet records are scoped to the company (org_id) and so is every category an outlet points at.
const { dayOf } = calc;
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optDate = z.preprocess((v) => (v === '' ? null : v), dateStr.nullable().optional());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const optNum = (min, max) => z.preprocess((v) => (v === '' || v === null || v === undefined ? null : v), z.coerce.number().min(min).max(max).nullable().optional());
const STATUSES = ['planned', 'active', 'inactive', 'closed'];
const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

const fields = {
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(30).optional(),
  location: text(300),
  state: text(120),
  district: text(120),
  country: text(120),
  latitude: optNum(-90, 90),
  longitude: optNum(-180, 180),
  ownership_type_id: uuidOrNull,
  format_id: uuidOrNull,
  tags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  description: text(4000),
  status: z.enum(STATUSES).optional(),
  start_date: optDate,
  expected_closure_date: optDate,
  manager_name: text(200),
  gstin: text(20),
  drug_licence_no: text(80),
  drug_licence_expiry: optDate,
  legal_entity: text(200),
  agreement_ref: text(120),
  notes: text(4000),
};
const createSchema = z.object(fields);
const updateSchema = z.object(fields).partial().extend({ reason: z.string().trim().max(500).optional() });
const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  ownership_type_id: z.string().uuid().optional(),
  format_id: z.string().uuid().optional(),
  state: z.string().trim().max(120).optional(),
  include_closed: z.enum(['true', 'false']).optional(),
});

const include = { ownership_type: { select: { id: true, name: true, kind: true } }, format: { select: { id: true, name: true } } };
const out = (s) => ({
  id: s.id, code: s.code, name: s.name, location: s.location, state: s.state, district: s.district, country: s.country,
  latitude: s.latitude === null ? null : Number(s.latitude), longitude: s.longitude === null ? null : Number(s.longitude),
  ownership_type_id: s.ownership_type_id, ownership_type: s.ownership_type ? { id: s.ownership_type.id, name: s.ownership_type.name, kind: s.ownership_type.kind } : null,
  format_id: s.format_id, format: s.format ? { id: s.format.id, name: s.format.name } : null,
  tags: s.tags || [], description: s.description, status: s.status,
  start_date: dayOf(s.start_date), expected_closure_date: dayOf(s.expected_closure_date), manager_name: s.manager_name, gstin: s.gstin, drug_licence_no: s.drug_licence_no, drug_licence_expiry: dayOf(s.drug_licence_expiry), legal_entity: s.legal_entity, agreement_ref: s.agreement_ref, notes: s.notes,
  archived_at: s.archived_at, created_at: s.created_at, updated_at: s.updated_at,
});
const snap = (s) => ({ code: s.code, name: s.name, status: s.status, ownership_type_id: s.ownership_type_id, format_id: s.format_id, location: s.location, gstin: s.gstin, drug_licence_no: s.drug_licence_no, legal_entity: s.legal_entity, agreement_ref: s.agreement_ref });

async function categoriesOk(orgId, input) {
  for (const [key, scope] of [['ownership_type_id', 'ownership_type'], ['format_id', 'format']]) {
    if (input[key] && !(await prisma.nxCategory.findFirst({ where: { id: input[key], org_id: orgId, scope, deleted_at: null }, select: { id: true } }))) return 'category_not_found';
  }
  return null;
}

async function nextCode(orgId) {
  await core.ensureSettings(orgId);
  for (let tries = 0; tries < 20; tries += 1) {
    const s = await prisma.nxSetting.update({ where: { org_id: orgId }, data: { outlet_seq: { increment: 1 } } });
    const code = `${s.outlet_prefix}-${String(s.outlet_seq).padStart(3, '0')}`;
    if (!(await prisma.nxOutlet.findFirst({ where: { org_id: orgId, code }, select: { id: true } }))) return code;
  }
  throw new Error('Could not allocate an outlet code');
}

async function list(orgId, rawQuery = {}) {
  const f = listQuerySchema.parse(rawQuery);
  const rows = await prisma.nxOutlet.findMany({
    where: {
      org_id: orgId,
      ...(f.status ? { status: f.status } : f.include_closed === 'true' ? {} : { status: { not: 'closed' } }),
      ...(f.ownership_type_id ? { ownership_type_id: f.ownership_type_id } : {}),
      ...(f.format_id ? { format_id: f.format_id } : {}),
      ...(f.state ? { state: { equals: f.state, mode: 'insensitive' } } : {}),
      ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { code: { contains: f.q, mode: 'insensitive' } }, { location: { contains: f.q, mode: 'insensitive' } }, { district: { contains: f.q, mode: 'insensitive' } }, { state: { contains: f.q, mode: 'insensitive' } }] } : {}),
    },
    include, orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
  return rows.map(out);
}

async function get(orgId, id) {
  const row = await prisma.nxOutlet.findFirst({ where: { id, org_id: orgId }, include });
  if (!row) return { error: 'not_found' };
  const [investments, entries, projections] = await Promise.all([
    prisma.nxInvestment.count({ where: { org_id: orgId, outlet_id: id, deleted_at: null } }),
    prisma.nxEntry.count({ where: { org_id: orgId, outlet_id: id, deleted_at: null } }),
    prisma.nxProjection.count({ where: { org_id: orgId, outlet_id: id, deleted_at: null } }),
  ]);
  return { outlet: { ...out(row), counts: { investments, entries, projections } } };
}

async function create(orgId, actorId, input) {
  const bad = await categoriesOk(orgId, input);
  if (bad) return { error: bad };
  if (input.expected_closure_date && input.start_date && input.expected_closure_date < input.start_date) return { error: 'closure_before_start' };
  let code = input.code;
  if (code && (await prisma.nxOutlet.findFirst({ where: { org_id: orgId, code }, select: { id: true } }))) return { error: 'duplicate' };
  if (!code) code = await nextCode(orgId);
  const status = input.status || 'active';
  const row = await prisma.nxOutlet.create({
    data: { ...input, org_id: orgId, code, status, start_date: toDate(input.start_date), drug_licence_expiry: toDate(input.drug_licence_expiry), expected_closure_date: toDate(input.expected_closure_date), archived_at: status === 'closed' ? new Date() : null, created_by: actorId, updated_by: actorId },
    include,
  });
  await writeAudit(null, { orgId, actorId, entity: 'outlet', entityId: row.id, action: 'create', after: snap(row) });
  return { outlet: out(row) };
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.nxOutlet.findFirst({ where: { id, org_id: orgId }, include });
  if (!before) return { error: 'not_found' };
  const { reason, ...rest } = input;
  const bad = await categoriesOk(orgId, rest);
  if (bad) return { error: bad };
  const start = rest.start_date === undefined ? dayOf(before.start_date) : rest.start_date;
  const closure = rest.expected_closure_date === undefined ? dayOf(before.expected_closure_date) : rest.expected_closure_date;
  if (start && closure && closure < start) return { error: 'closure_before_start' };
  if (rest.code && rest.code !== before.code && (await prisma.nxOutlet.findFirst({ where: { org_id: orgId, code: rest.code, NOT: { id } }, select: { id: true } }))) return { error: 'duplicate' };
  const data = { ...rest, updated_by: actorId, ...(rest.start_date !== undefined ? { start_date: toDate(rest.start_date) } : {}), ...(rest.drug_licence_expiry !== undefined ? { drug_licence_expiry: toDate(rest.drug_licence_expiry) } : {}), ...(rest.expected_closure_date !== undefined ? { expected_closure_date: toDate(rest.expected_closure_date) } : {}) };
  // Closing archives the outlet (kept, readable, but takes no new records); any other status reopens it.
  if (rest.status && rest.status !== before.status) data.archived_at = rest.status === 'closed' ? new Date() : null;
  const row = await prisma.nxOutlet.update({ where: { id }, data, include });
  const closing = rest.status && rest.status !== before.status && (rest.status === 'closed' || before.status === 'closed');
  await writeAudit(null, { orgId, actorId, entity: 'outlet', entityId: id, action: closing ? (rest.status === 'closed' ? 'close' : 'reopen') : 'update', before: snap(before), after: snap(row), reason });
  return { outlet: out(row) };
}

/** An outlet's own financial picture for the outlet page: the same dashboard, narrowed to this outlet. */
async function summary(orgId, id, rawFilter, ctx) {
  const row = await prisma.nxOutlet.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
  if (!row) return { error: 'not_found' };
  const finance = require('./finance.service');
  return { dashboard: await finance.dashboard(orgId, { ...rawFilter, outlet_id: id }, ctx) };
}

module.exports = { STATUSES, createSchema, updateSchema, listQuerySchema, list, get, create, update, summary, out };
