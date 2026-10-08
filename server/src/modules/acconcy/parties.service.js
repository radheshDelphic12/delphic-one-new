const { z } = require('zod');
const prisma = require('../../config/db');
const { pageArgs, pagination } = require('../../lib/vertical');
const { writeAudit } = require('./audit');

const KINDS = ['client', 'vendor', 'both'];
const STATUSES = ['active', 'inactive', 'hold'];
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const upperId = (re, message) =>
  z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : v), z.string().regex(re, message).nullable().optional());

const partyFields = {
  kind: z.enum(KINDS),
  name: z.string().trim().min(1).max(200),
  company_name: text(200),
  contact_name: text(200),
  phone: text(40),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().email().max(200).nullable().optional()),
  gstin: upperId(GSTIN_RE, 'GSTIN must be 15 characters, e.g. 22AAAAA0000A1Z5'),
  pan: upperId(PAN_RE, 'PAN must be 10 characters, e.g. ABCDE1234F'),
  address: text(500),
  city: text(120),
  state: text(120),
  country: text(120),
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
  vendor_category: z.string().trim().max(120).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const nameKey = (s) => String(s || '').trim().toLowerCase();
const snapshot = (p) => ({ kind: p.kind, name: p.name, status: p.status, gstin: p.gstin, pan: p.pan, vendor_category: p.vendor_category });

async function nameTaken(orgId, name, excludeId) {
  return Boolean(
    await prisma.axParty.findFirst({
      where: { org_id: orgId, deleted_at: null, name: { equals: name.trim(), mode: 'insensitive' }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    })
  );
}

async function list(orgId, query) {
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(query.tab === 'client' ? { kind: { in: ['client', 'both'] } } : {}),
    ...(query.tab === 'vendor' ? { kind: { in: ['vendor', 'both'] } } : {}),
    ...(query.status !== 'all' ? { status: query.status } : {}),
    ...(query.vendor_category ? { vendor_category: { equals: query.vendor_category, mode: 'insensitive' } } : {}),
    ...(query.q ? { OR: ['name', 'company_name', 'contact_name', 'email', 'phone', 'gstin', 'city', 'state'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) } : {}),
  };
  const [rows, total, counts, cats] = await Promise.all([
    prisma.axParty.findMany({ where, orderBy: { name: 'asc' }, ...pageArgs(query) }),
    prisma.axParty.count({ where }),
    prisma.axParty.groupBy({ by: ['kind'], where: { org_id: orgId, deleted_at: null, status: 'active' }, _count: { _all: true } }),
    prisma.axParty.findMany({ where: { org_id: orgId, deleted_at: null, vendor_category: { not: null } }, select: { vendor_category: true }, distinct: ['vendor_category'] }),
  ]);
  const byKind = Object.fromEntries(counts.map((c) => [c.kind, c._count._all]));
  return {
    data: rows,
    pagination: pagination(query.page, query.limit, total),
    summary: { clients: (byKind.client || 0) + (byKind.both || 0), vendors: (byKind.vendor || 0) + (byKind.both || 0), vendor_categories: cats.map((c) => c.vendor_category).sort() },
  };
}

async function get(orgId, id) {
  const party = await prisma.axParty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  return party ? { party } : { error: 'not_found' };
}

async function create(orgId, actorId, input) {
  if (await nameTaken(orgId, input.name)) return { error: 'duplicate_name' };
  const party = await prisma.axParty.create({ data: { org_id: orgId, created_by: actorId, ...input } });
  await writeAudit(null, { orgId, actorId, entity: 'party', entityId: party.id, action: 'create', after: snapshot(party) });
  return { party };
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.axParty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (input.name && (await nameTaken(orgId, input.name, id))) return { error: 'duplicate_name' };
  const party = await prisma.axParty.update({ where: { id }, data: input });
  await writeAudit(null, { orgId, actorId, entity: 'party', entityId: id, action: 'update', before: snapshot(before), after: snapshot(party) });
  return { party };
}

async function remove(orgId, actorId, id) {
  const before = await prisma.axParty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.axParty.update({ where: { id }, data: { deleted_at: new Date(), status: 'inactive' } });
  await writeAudit(null, { orgId, actorId, entity: 'party', entityId: id, action: 'delete', before: snapshot(before) });
  return { ok: true };
}

// Bulk create from CSV rows. Invalid or duplicate rows are skipped with a reason, never fatal.
async function importRows(orgId, actorId, rows) {
  const existing = await prisma.axParty.findMany({ where: { org_id: orgId, deleted_at: null }, select: { name: true } });
  const seen = new Set(existing.map((p) => nameKey(p.name)));
  const skipped = [];
  const valid = [];
  rows.forEach((raw, index) => {
    const row = index + 1;
    const parsed = createPartySchema.safeParse({ ...raw, kind: String(raw.kind || 'client').trim().toLowerCase() || 'client', status: String(raw.status || 'active').trim().toLowerCase() || 'active' });
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
    await prisma.axParty.createMany({ data: valid.map((v) => ({ org_id: orgId, created_by: actorId, ...v })) });
    await writeAudit(null, { orgId, actorId, entity: 'party', action: 'import', after: { created: valid.length, skipped: skipped.length } });
  }
  return { created: valid.length, skipped };
}

// Active party of the right kind in this org (client for sales / lead client, vendor for purchases).
async function partyOk(orgId, partyId, role) {
  if (!partyId) return true;
  const kinds = role === 'client' ? ['client', 'both'] : role === 'vendor' ? ['vendor', 'both'] : KINDS;
  return Boolean(await prisma.axParty.findFirst({ where: { id: partyId, org_id: orgId, deleted_at: null, kind: { in: kinds } }, select: { id: true } }));
}

// Account statement: the party's deals with revenue / expense booked against them in the ledger.
async function statement(orgId, id) {
  const party = await prisma.axParty.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!party) return { error: 'not_found' };
  const [deals, leads, entries] = await Promise.all([
    prisma.axDeal.findMany({ where: { org_id: orgId, deleted_at: null, OR: [{ party_id: id }, { vendor_id: id }] }, select: { id: true, code: true, name: true, status: true, service_type: true, deal_amount: true } }),
    prisma.axLead.count({ where: { org_id: orgId, deleted_at: null, party_id: id } }),
    prisma.axLedgerEntry.findMany({ where: { org_id: orgId, deleted_at: null, party_id: id }, select: { type: true, amount: true } }),
  ]);
  const total = (type) => entries.filter((e) => e.type === type).reduce((a, e) => a + Number(e.amount), 0);
  return {
    party,
    deals: deals.map((d) => ({ ...d, deal_amount: d.deal_amount == null ? null : Number(d.deal_amount) })),
    leads,
    revenue: total('revenue'),
    expense: total('expense'),
  };
}

module.exports = { createPartySchema, updatePartySchema, importSchema, listQuerySchema, list, get, create, update, remove, importRows, partyOk, statement };
