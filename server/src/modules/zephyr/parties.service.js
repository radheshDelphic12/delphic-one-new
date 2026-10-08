const { z } = require('zod');
const prisma = require('../../config/db');
const { pageArgs, pagination } = require('../../lib/vertical');
const { writeAudit } = require('./audit');
const serviceTypes = require('./serviceTypes');

const KINDS = ['client', 'vendor', 'both'];
const STATUSES = ['active', 'inactive', 'hold'];
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// '' -> null so cleared form fields clear the column.
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const upperId = (re, message) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : v),
    z.string().regex(re, message).nullable().optional()
  );

const partyFields = {
  kind: z.enum(KINDS),
  name: z.string().trim().min(1).max(200),
  contact_name: text(200),
  phone: text(40),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().email().max(200).nullable().optional()),
  gstin: upperId(GSTIN_RE, 'GSTIN must be 15 characters, e.g. 22AAAAA0000A1Z5'),
  pan: upperId(PAN_RE, 'PAN must be 10 characters, e.g. ABCDE1234F'),
  address: text(500),
  city: text(120),
  state: text(120),
  country: text(120),
  company_name: text(200),
  interested_services: z.array(serviceTypes.serviceKey).max(20).optional(),
  vendor_category: text(120),
  materials_services: text(1000),
  payment_terms: text(200),
  status: z.enum(STATUSES),
  notes: text(2000),
};

const createPartySchema = z.object({ ...partyFields, kind: partyFields.kind.default('client'), status: partyFields.status.default('active') });
const updatePartySchema = z.object(partyFields).partial();
const importSchema = z.object({ rows: z.array(z.record(z.any())).min(1).max(500) });
const listQuerySchema = z.object({
  tab: z.enum(['all', 'client', 'vendor']).default('all'),
  status: z.enum([...STATUSES, 'all']).default('all'),
  service: serviceTypes.serviceKey.optional(),
  vendor_category: z.string().trim().max(120).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const nameKey = (s) => String(s || '').trim().toLowerCase();

async function nameTaken(orgId, name, excludeId) {
  const found = await prisma.zxParty.findFirst({
    where: { org_id: orgId, deleted_at: null, name: { equals: name.trim(), mode: 'insensitive' }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true },
  });
  return Boolean(found);
}

const snapshot = (p) => ({ kind: p.kind, name: p.name, status: p.status, gstin: p.gstin, pan: p.pan, interested_services: p.interested_services, vendor_category: p.vendor_category });

async function expiringCounts(orgId, ids) {
  if (ids.length === 0) return new Map();
  const soon = new Date(Date.now() + 30 * 86400000);
  const rows = await prisma.zxDocument.groupBy({
    by: ['owner_id'],
    where: { org_id: orgId, owner_type: 'party', owner_id: { in: ids }, deleted_at: null, expiry_date: { lte: soon } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.owner_id, r._count._all]));
}

async function list(orgId, query) {
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(query.tab === 'client' ? { kind: { in: ['client', 'both'] } } : {}),
    ...(query.tab === 'vendor' ? { kind: { in: ['vendor', 'both'] } } : {}),
    ...(query.status !== 'all' ? { status: query.status } : {}),
    ...(query.service ? { interested_services: { has: query.service } } : {}),
    ...(query.vendor_category ? { vendor_category: { equals: query.vendor_category, mode: 'insensitive' } } : {}),
    ...(query.q
      ? {
          OR: ['name', 'company_name', 'contact_name', 'email', 'phone', 'gstin', 'city', 'state'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })),
        }
      : {}),
  };
  const [rows, total, counts] = await Promise.all([
    prisma.zxParty.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(query) }),
    prisma.zxParty.count({ where }),
    prisma.zxParty.groupBy({ by: ['kind'], where: { org_id: orgId, deleted_at: null, status: 'active' }, _count: { _all: true } }),
  ]);
  const expiring = await expiringCounts(orgId, rows.map((r) => r.id));
  const categories = [...new Set((await prisma.zxParty.findMany({ where: { org_id: orgId, deleted_at: null, vendor_category: { not: null } }, select: { vendor_category: true } })).map((p) => p.vendor_category))].sort();
  const byKind = Object.fromEntries(counts.map((c) => [c.kind, c._count._all]));
  const clients = (byKind.client || 0) + (byKind.both || 0);
  const vendors = (byKind.vendor || 0) + (byKind.both || 0);
  return {
    data: rows.map((r) => ({ ...r, docs_attention: expiring.get(r.id) || 0 })),
    pagination: pagination(query.page, query.limit, total),
    summary: { clients, vendors, active: clients + vendors - (byKind.both || 0), vendor_categories: categories },
  };
}

async function get(orgId, id) {
  const party = await prisma.zxParty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!party) return { error: 'not_found' };
  return { party };
}

async function create(orgId, actorId, input) {
  if (await nameTaken(orgId, input.name)) return { error: 'duplicate_name' };
  const party = await prisma.zxParty.create({ data: { org_id: orgId, created_by: actorId, ...input } });
  await writeAudit(null, { orgId, actorId, entity: 'party', entityId: party.id, action: 'create', after: snapshot(party) });
  return { party };
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.zxParty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (input.name && (await nameTaken(orgId, input.name, id))) return { error: 'duplicate_name' };
  const party = await prisma.zxParty.update({ where: { id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'party', entityId: id, action: 'update', before: snapshot(before), after: snapshot(party) });
  return { party };
}

async function remove(orgId, actorId, id) {
  const before = await prisma.zxParty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.zxParty.update({ where: { id }, data: { deleted_at: new Date(), status: 'inactive' } });
  await writeAudit(null, { orgId, actorId, entity: 'party', entityId: id, action: 'delete', before: snapshot(before) });
  return { ok: true };
}

// Bulk create from CSV rows the client parsed. Invalid or duplicate rows are skipped with a reason, never fatal.
async function importRows(orgId, actorId, rows) {
  const existing = await prisma.zxParty.findMany({ where: { org_id: orgId, deleted_at: null }, select: { name: true } });
  const seen = new Set(existing.map((p) => nameKey(p.name)));
  const skipped = [];
  const valid = [];
  rows.forEach((raw, index) => {
    const row = index + 1;
    const services = typeof raw.interested_services === 'string' ? raw.interested_services.split(/[;|,]/).map((x) => x.trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean) : raw.interested_services;
    const parsed = createPartySchema.safeParse({
      ...raw,
      ...(services ? { interested_services: services } : {}),
      kind: String(raw.kind || 'client').trim().toLowerCase() || 'client',
      status: String(raw.status || 'active').trim().toLowerCase() || 'active',
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return skipped.push({ row, name: raw.name || '', reason: `${issue.path.join('.') || 'row'}: ${issue.message}` });
    }
    const key = nameKey(parsed.data.name);
    if (seen.has(key)) return skipped.push({ row, name: parsed.data.name, reason: 'Name already exists' });
    seen.add(key);
    return valid.push(parsed.data);
  });
  if (valid.length > 0) {
    await prisma.zxParty.createMany({ data: valid.map((v) => ({ org_id: orgId, created_by: actorId, ...v })) });
    await writeAudit(null, { orgId, actorId, entity: 'party', action: 'import', after: { created: valid.length, skipped: skipped.length } });
  }
  return { created: valid.length, skipped };
}

module.exports = { createPartySchema, updatePartySchema, importSchema, listQuerySchema, list, get, create, update, remove, importRows };
