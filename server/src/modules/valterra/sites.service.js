const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const calc = require('./valterra.calc');

// Mining sites of Valterra Resources. A site is never deleted: closing it keeps every transaction, return and projection, and its
// reports stay readable. All site records are scoped to the company (org_id) and so is every category a site points at.
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
  mining_type_id: uuidOrNull,
  material_id: uuidOrNull,
  additional_materials: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  description: text(4000),
  status: z.enum(STATUSES).optional(),
  start_date: optDate,
  expected_closure_date: optDate,
  manager_name: text(200),
  notes: text(4000),
};
const createSchema = z.object(fields);
const updateSchema = z.object(fields).partial().extend({ reason: z.string().trim().max(500).optional() });
const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  mining_type_id: z.string().uuid().optional(),
  material_id: z.string().uuid().optional(),
  state: z.string().trim().max(120).optional(),
  include_closed: z.enum(['true', 'false']).optional(),
});

const include = { mining_type: { select: { id: true, name: true } }, material: { select: { id: true, name: true } } };
const out = (s) => ({
  id: s.id, code: s.code, name: s.name, location: s.location, state: s.state, district: s.district, country: s.country,
  latitude: s.latitude === null ? null : Number(s.latitude), longitude: s.longitude === null ? null : Number(s.longitude),
  mining_type_id: s.mining_type_id, mining_type: s.mining_type ? { id: s.mining_type.id, name: s.mining_type.name } : null,
  material_id: s.material_id, material: s.material ? { id: s.material.id, name: s.material.name } : null,
  additional_materials: s.additional_materials || [], description: s.description, status: s.status,
  start_date: dayOf(s.start_date), expected_closure_date: dayOf(s.expected_closure_date), manager_name: s.manager_name, notes: s.notes,
  archived_at: s.archived_at, created_at: s.created_at, updated_at: s.updated_at,
});
const snap = (s) => ({ code: s.code, name: s.name, status: s.status, mining_type_id: s.mining_type_id, material_id: s.material_id, location: s.location });

async function categoriesOk(orgId, input) {
  for (const [key, scope] of [['mining_type_id', 'mining_type'], ['material_id', 'material']]) {
    if (input[key] && !(await prisma.vtCategory.findFirst({ where: { id: input[key], org_id: orgId, scope, deleted_at: null }, select: { id: true } }))) return 'category_not_found';
  }
  return null;
}

async function nextCode(orgId) {
  await core.ensureSettings(orgId);
  for (let tries = 0; tries < 20; tries += 1) {
    const s = await prisma.vtSetting.update({ where: { org_id: orgId }, data: { site_seq: { increment: 1 } } });
    const code = `${s.site_prefix}-${String(s.site_seq).padStart(3, '0')}`;
    if (!(await prisma.vtSite.findFirst({ where: { org_id: orgId, code }, select: { id: true } }))) return code;
  }
  throw new Error('Could not allocate a site code');
}

async function list(orgId, rawQuery = {}) {
  const f = listQuerySchema.parse(rawQuery);
  const rows = await prisma.vtSite.findMany({
    where: {
      org_id: orgId,
      ...(f.status ? { status: f.status } : f.include_closed === 'true' ? {} : { status: { not: 'closed' } }),
      ...(f.mining_type_id ? { mining_type_id: f.mining_type_id } : {}),
      ...(f.material_id ? { material_id: f.material_id } : {}),
      ...(f.state ? { state: { equals: f.state, mode: 'insensitive' } } : {}),
      ...(f.q ? { OR: [{ name: { contains: f.q, mode: 'insensitive' } }, { code: { contains: f.q, mode: 'insensitive' } }, { location: { contains: f.q, mode: 'insensitive' } }, { district: { contains: f.q, mode: 'insensitive' } }, { state: { contains: f.q, mode: 'insensitive' } }] } : {}),
    },
    include, orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
  return rows.map(out);
}

async function get(orgId, id) {
  const row = await prisma.vtSite.findFirst({ where: { id, org_id: orgId }, include });
  if (!row) return { error: 'not_found' };
  const [investments, entries, projections] = await Promise.all([
    prisma.vtInvestment.count({ where: { org_id: orgId, site_id: id, deleted_at: null } }),
    prisma.vtEntry.count({ where: { org_id: orgId, site_id: id, deleted_at: null } }),
    prisma.vtProjection.count({ where: { org_id: orgId, site_id: id, deleted_at: null } }),
  ]);
  return { site: { ...out(row), counts: { investments, entries, projections } } };
}

async function create(orgId, actorId, input) {
  const bad = await categoriesOk(orgId, input);
  if (bad) return { error: bad };
  if (input.expected_closure_date && input.start_date && input.expected_closure_date < input.start_date) return { error: 'closure_before_start' };
  let code = input.code;
  if (code && (await prisma.vtSite.findFirst({ where: { org_id: orgId, code }, select: { id: true } }))) return { error: 'duplicate' };
  if (!code) code = await nextCode(orgId);
  const status = input.status || 'active';
  const row = await prisma.vtSite.create({
    data: { ...input, org_id: orgId, code, status, start_date: toDate(input.start_date), expected_closure_date: toDate(input.expected_closure_date), archived_at: status === 'closed' ? new Date() : null, created_by: actorId, updated_by: actorId },
    include,
  });
  await writeAudit(null, { orgId, actorId, entity: 'site', entityId: row.id, action: 'create', after: snap(row) });
  return { site: out(row) };
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.vtSite.findFirst({ where: { id, org_id: orgId }, include });
  if (!before) return { error: 'not_found' };
  const { reason, ...rest } = input;
  const bad = await categoriesOk(orgId, rest);
  if (bad) return { error: bad };
  const start = rest.start_date === undefined ? dayOf(before.start_date) : rest.start_date;
  const closure = rest.expected_closure_date === undefined ? dayOf(before.expected_closure_date) : rest.expected_closure_date;
  if (start && closure && closure < start) return { error: 'closure_before_start' };
  if (rest.code && rest.code !== before.code && (await prisma.vtSite.findFirst({ where: { org_id: orgId, code: rest.code, NOT: { id } }, select: { id: true } }))) return { error: 'duplicate' };
  const data = { ...rest, updated_by: actorId, ...(rest.start_date !== undefined ? { start_date: toDate(rest.start_date) } : {}), ...(rest.expected_closure_date !== undefined ? { expected_closure_date: toDate(rest.expected_closure_date) } : {}) };
  // Closing archives the site (kept, readable, but takes no new records); any other status reopens it.
  if (rest.status && rest.status !== before.status) data.archived_at = rest.status === 'closed' ? new Date() : null;
  const row = await prisma.vtSite.update({ where: { id }, data, include });
  const closing = rest.status && rest.status !== before.status && (rest.status === 'closed' || before.status === 'closed');
  await writeAudit(null, { orgId, actorId, entity: 'site', entityId: id, action: closing ? (rest.status === 'closed' ? 'close' : 'reopen') : 'update', before: snap(before), after: snap(row), reason });
  return { site: out(row) };
}

/** A site's own financial picture for the site page: the same dashboard, narrowed to this site. */
async function summary(orgId, id, rawFilter, ctx) {
  const row = await prisma.vtSite.findFirst({ where: { id, org_id: orgId }, select: { id: true } });
  if (!row) return { error: 'not_found' };
  const finance = require('./finance.service');
  return { dashboard: await finance.dashboard(orgId, { ...rawFilter, site_id: id }, ctx) };
}

module.exports = { STATUSES, createSchema, updateSchema, listQuerySchema, list, get, create, update, summary, out };
