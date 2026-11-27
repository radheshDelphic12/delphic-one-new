const { z } = require('zod');
const prisma = require('../../config/db');

// Group Dashboard > Directory. The people the group knows across all its companies: a contact can belong to several of our companies
// (one point of contact is often a network across them). Each has a status (in connect / fresh / left), a source (LinkedIn, event,
// reference), follow-ups and when they were last contacted.
//
// The pipeline: every person who appears in any company (clients' and vendors' contacts, Delphic One customers, employees, contractors)
// and is not yet in the directory waits here; the group admin adds them (as fresh) or skips them, and a skipped person does not come back.

const STATUSES = ['in_connect', 'fresh', 'left'];
const SOURCES = ['linkedin', 'event', 'reference', 'other'];
const KINDS = ['client', 'vendor', 'customer', 'employee', 'contractor', 'other'];
const uuid = z.string().uuid();
const day = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional());
const opt = (n) => z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(n).nullable().optional());
const contactSchema = z.object({
  org_group_id: uuid.optional(),
  name: z.string().trim().min(1, 'Name').max(150),
  email: z.preprocess((v) => (v === '' || v == null ? null : String(v).trim().toLowerCase()), z.string().email('A valid email').nullable().optional()),
  phone: opt(40), designation: opt(120), organisation: opt(150), linkedin_url: opt(300), notes: opt(3000),
  kind: z.enum(KINDS).default('other'),
  company_ids: z.array(uuid).max(50).default([]),
  status: z.enum(STATUSES).default('fresh'),
  source: z.enum(SOURCES).nullable().optional(),
  last_connected_on: day, next_followup_date: day,
});
const contactUpdateSchema = contactSchema.partial().omit({ org_group_id: true });
const followupSchema = z.object({ note: z.string().trim().min(1, 'Write what happened').max(2000), contacted_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), next_followup_date: day, status: z.enum(STATUSES).optional() });
const listSchema = z.object({ q: z.string().trim().max(100).optional(), status: z.enum(STATUSES).optional(), kind: z.enum(KINDS).optional(), company_id: uuid.optional(), source: z.enum(SOURCES).optional(), followup: z.enum(['due']).optional() });

const asDate = (v) => (v ? new Date(`${v}T00:00:00Z`) : v === null ? null : undefined);
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);
const norm = (s) => String(s || '').trim().toLowerCase();
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);

const groupOrgs = (groupIds) => prisma.org.findMany({ where: { org_group_id: { in: groupIds } }, select: { id: true, name: true, org_group_id: true }, orderBy: { name: 'asc' } });

function view(c, orgName) {
  return {
    id: c.id, name: c.name, email: c.email, phone: c.phone, designation: c.designation, organisation: c.organisation, kind: c.kind, status: c.status, source: c.source,
    linkedin_url: c.linkedin_url, notes: c.notes, companies: c.company_ids.map((id) => ({ id, name: orgName.get(id) || 'Company' })),
    last_connected_on: ymd(c.last_connected_on), next_followup_date: ymd(c.next_followup_date),
    followup_due: Boolean(c.next_followup_date && ymd(c.next_followup_date) <= today() && c.status !== 'left'),
    followups: (c.followups || []).map((f) => ({ id: f.id, note: f.note, contacted_on: ymd(f.contacted_on), next_followup_date: ymd(f.next_followup_date), created_at: f.created_at })),
    updated_at: c.updated_at,
  };
}

async function list(groupIds, q) {
  const orgs = await groupOrgs(groupIds);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const where = { org_group_id: { in: groupIds }, deleted_at: null };
  if (q.status) where.status = q.status;
  if (q.kind) where.kind = q.kind;
  if (q.source) where.source = q.source;
  if (q.company_id) where.company_ids = { has: q.company_id };
  if (q.followup === 'due') { where.next_followup_date = { lte: new Date(`${today()}T00:00:00Z`) }; where.status = { not: 'left' }; }
  if (q.q) where.OR = ['name', 'email', 'phone', 'organisation', 'designation'].map((k) => ({ [k]: { contains: q.q, mode: 'insensitive' } }));
  const rows = await prisma.groupDirectoryContact.findMany({ where, include: { followups: { orderBy: { contacted_on: 'desc' }, take: 5 } }, orderBy: { name: 'asc' }, take: 2000 });
  const all = await prisma.groupDirectoryContact.groupBy({ by: ['status'], where: { org_group_id: { in: groupIds }, deleted_at: null }, _count: { _all: true } });
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const g of all) counts[g.status] = g._count._all;
  return { contacts: rows.map((r) => view(r, orgName)), counts, companies: orgs.map((o) => ({ id: o.id, name: o.name })) };
}

async function checkCompanies(groupId, ids) {
  if (!ids || !ids.length) return true;
  return (await prisma.org.count({ where: { id: { in: ids }, org_group_id: groupId } })) === new Set(ids).size;
}

/** The same person already in the directory: the same email, or the same phone number (compared by its last 10 digits, so +91 / spaces do not matter). */
async function findDuplicate(groupId, { email, phone }, exceptId) {
  const base = { org_group_id: groupId, deleted_at: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) };
  if (email) {
    const byEmail = await prisma.groupDirectoryContact.findFirst({ where: { ...base, email: { equals: norm(email), mode: 'insensitive' } }, select: { id: true, name: true } });
    if (byEmail) return byEmail;
  }
  const want = digits(phone);
  if (want.length < 8) return null;
  const withPhone = await prisma.groupDirectoryContact.findMany({ where: { ...base, phone: { not: null } }, select: { id: true, name: true, phone: true } });
  return withPhone.find((c) => digits(c.phone) === want) || null;
}

async function create(groupIds, actorId, input) {
  const groupId = input.org_group_id && groupIds.includes(input.org_group_id) ? input.org_group_id : groupIds[0];
  if (!(await checkCompanies(groupId, input.company_ids))) return { error: 'company_not_in_group' };
  const dup = await findDuplicate(groupId, input);
  if (dup) return { error: 'duplicate', name: dup.name };
  const row = await prisma.groupDirectoryContact.create({
    data: { ...input, org_group_id: groupId, company_ids: [...new Set(input.company_ids)], last_connected_on: asDate(input.last_connected_on), next_followup_date: asDate(input.next_followup_date), created_by: actorId },
  });
  return { contact: view({ ...row, followups: [] }, new Map((await groupOrgs(groupIds)).map((o) => [o.id, o.name]))) };
}

const findContact = (groupIds, id) => prisma.groupDirectoryContact.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null }, include: { followups: { orderBy: { contacted_on: 'desc' } } } });

async function update(groupIds, id, input) {
  const c = await findContact(groupIds, id);
  if (!c) return { error: 'not_found' };
  if (input.company_ids && !(await checkCompanies(c.org_group_id, input.company_ids))) return { error: 'company_not_in_group' };
  if (input.email || input.phone) {
    const dup = await findDuplicate(c.org_group_id, { email: input.email, phone: input.phone }, id);
    if (dup) return { error: 'duplicate', name: dup.name };
  }
  const data = { ...input };
  if (input.company_ids) data.company_ids = [...new Set(input.company_ids)];
  if (input.last_connected_on !== undefined) data.last_connected_on = asDate(input.last_connected_on);
  if (input.next_followup_date !== undefined) data.next_followup_date = asDate(input.next_followup_date);
  await prisma.groupDirectoryContact.update({ where: { id }, data });
  return { contact: view(await findContact(groupIds, id), new Map((await groupOrgs(groupIds)).map((o) => [o.id, o.name]))) };
}

async function remove(groupIds, id) {
  const c = await findContact(groupIds, id);
  if (!c) return { error: 'not_found' };
  await prisma.groupDirectoryContact.update({ where: { id }, data: { deleted_at: new Date() } });
  return { removed: true };
}

/** A follow-up: what happened; it sets "last connected" to that day and the next follow-up date; it can change the status too. */
async function addFollowup(groupIds, actorId, id, input) {
  const c = await findContact(groupIds, id);
  if (!c) return { error: 'not_found' };
  const on = input.contacted_on || today();
  await prisma.$transaction([
    prisma.groupDirectoryFollowup.create({ data: { contact_id: id, note: input.note, contacted_on: asDate(on), next_followup_date: asDate(input.next_followup_date ?? null), created_by: actorId } }),
    prisma.groupDirectoryContact.update({
      where: { id },
      data: {
        last_connected_on: !c.last_connected_on || ymd(c.last_connected_on) < on ? asDate(on) : c.last_connected_on,
        next_followup_date: asDate(input.next_followup_date ?? null),
        ...(input.status ? { status: input.status } : c.status === 'fresh' ? { status: 'in_connect' } : {}),
      },
    }),
  ]);
  return { contact: view(await findContact(groupIds, id), new Map((await groupOrgs(groupIds)).map((o) => [o.id, o.name]))) };
}

// ---- the pipeline: people found in the companies, not yet in the directory and not skipped.
// view 'skipped' lists the skipped ones instead (with when and by whom), so a skip can be undone ("Bring back").
// Each client / vendor row carries the account's status (lead, meeting scheduled, active, rescheduled, dropped).

async function pipeline(groupIds, { view } = {}) {
  const skippedView = view === 'skipped';
  const orgs = await groupOrgs(groupIds);
  const orgIds = orgs.map((o) => o.id);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const [accounts, members, customers, contacts, skips] = await Promise.all([
    prisma.account.findMany({ where: { org_id: { in: orgIds }, type: { in: ['client', 'vendor'] }, is_project: false }, select: { id: true, org_id: true, type: true, stage: true, name: true, poc_name: true, poc_email: true, poc_phone: true, poc_designation: true, created_at: true } }),
    prisma.orgMembership.findMany({ where: { org_id: { in: orgIds }, employment_status: { not: 'terminated' }, deleted_at: null }, select: { id: true, org_id: true, worker_type: true, created_at: true, person: { select: { id: true, name: true, email: true, phone: true } }, designation: { select: { name: true } } } }),
    prisma.doxCustomer.findMany({ where: { org_id: { in: orgIds }, deleted_at: null }, select: { id: true, org_id: true, name: true, contact_name: true, contact_email: true, contact_phone: true, created_at: true } }).catch(() => []),
    prisma.groupDirectoryContact.findMany({ where: { org_group_id: { in: groupIds }, deleted_at: null }, select: { email: true, phone: true, pipeline_key: true } }),
    prisma.groupDirectorySkip.findMany({ where: { org_group_id: { in: groupIds } }, select: { pipeline_key: true, skipped_by: true, created_at: true } }),
  ]);
  const skipOf = new Map(skips.map((s) => [s.pipeline_key, s]));
  const known = new Set([...contacts.map((c) => c.pipeline_key).filter(Boolean), ...(skippedView ? [] : skips.map((s) => s.pipeline_key))]);
  const knownEmail = new Set(contacts.map((c) => norm(c.email)).filter(Boolean));
  const knownPhone = new Set(contacts.map((c) => digits(c.phone)).filter((p) => p.length >= 8));
  const out = new Map(); // one person (by email, else phone, else the record) found in several companies is one row
  const push = (key, row) => {
    if (known.has(key)) return;
    if (skippedView && !skipOf.has(key)) return;
    if (row.email && knownEmail.has(norm(row.email))) return;
    if (row.phone && knownPhone.has(digits(row.phone))) return;
    const id = row.email ? `e:${norm(row.email)}` : digits(row.phone).length >= 8 ? `p:${digits(row.phone)}` : key;
    const cur = out.get(id);
    if (cur) {
      if (!cur.company_ids.includes(row.company_id)) cur.company_ids.push(row.company_id);
      cur.keys.push(key);
      if (!cur.stage && row.stage) cur.stage = row.stage;
      return;
    }
    out.set(id, { key, keys: [key], stage: row.stage || null, name: row.name, email: row.email || null, phone: row.phone || null, designation: row.designation || null, organisation: row.organisation || null, kind: row.kind, company_ids: [row.company_id], found_in: row.found_in, created_at: row.created_at });
  };
  for (const a of accounts) {
    if (!a.poc_name && !a.poc_email && !a.poc_phone) continue;
    push(`account:${a.id}`, { name: a.poc_name || a.name, email: a.poc_email, phone: a.poc_phone, designation: a.poc_designation, organisation: a.name, kind: a.type, stage: a.stage, company_id: a.org_id, found_in: `${a.type === 'client' ? 'Client' : 'Vendor'} ${a.name}`, created_at: a.created_at });
  }
  for (const m of members) {
    if (!m.person) continue;
    push(`member:${m.person.id}`, { name: m.person.name, email: m.person.email, phone: m.person.phone, designation: m.designation?.name, organisation: orgName.get(m.org_id), kind: m.worker_type === 'contractor' ? 'contractor' : 'employee', company_id: m.org_id, found_in: m.worker_type === 'contractor' ? 'Contractor' : 'Employee', created_at: m.created_at });
  }
  for (const c of customers) {
    push(`customer:${c.id}`, { name: c.contact_name || c.name, email: c.contact_email, phone: c.contact_phone, organisation: c.name, kind: 'customer', company_id: c.org_id, found_in: `Customer ${c.name}`, created_at: c.created_at });
  }
  let rows = [...out.values()].map((r) => ({ ...r, companies: r.company_ids.map((id) => ({ id, name: orgName.get(id) || 'Company' })) }));
  if (skippedView) {
    const by = [...new Set(skips.map((s) => s.skipped_by).filter(Boolean))];
    const names = new Map(by.length ? (await prisma.user.findMany({ where: { id: { in: by } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]) : []);
    rows = rows.map((r) => {
      const sk = r.keys.map((k) => skipOf.get(k)).filter(Boolean).sort((a, b) => b.created_at - a.created_at)[0];
      return { ...r, skipped: sk ? { at: sk.created_at, by: sk.skipped_by ? { id: sk.skipped_by, name: names.get(sk.skipped_by) || null } : null } : null };
    }).sort((a, b) => new Date(b.skipped?.at || 0) - new Date(a.skipped?.at || 0));
  } else {
    rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return { candidates: rows, count: rows.length, skipped: skippedView ? rows.length : new Set(skips.map((s) => s.pipeline_key)).size };
}

const addFromPipelineSchema = z.object({ keys: z.array(z.string().max(80)).min(1).max(20), status: z.enum(STATUSES).default('fresh'), source: z.enum(SOURCES).nullable().optional() });
const skipSchema = z.object({ keys: z.array(z.string().max(80)).min(1).max(20) });

/** Add one pipeline person (all the records found for them) to the directory. */
async function addFromPipeline(groupIds, actorId, { keys, status, source }) {
  const { candidates } = await pipeline(groupIds);
  const cand = candidates.find((c) => c.keys.some((k) => keys.includes(k)));
  if (!cand) return { error: 'not_found' };
  const row = await prisma.groupDirectoryContact.create({
    data: {
      org_group_id: groupIds[0], name: cand.name, email: cand.email ? norm(cand.email) : null, phone: cand.phone, designation: cand.designation, organisation: cand.organisation,
      kind: cand.kind, company_ids: cand.company_ids, status, source: source || null, pipeline_key: cand.key, created_by: actorId,
    },
  });
  // the other records of the same person stop showing too
  const others = cand.keys.filter((k) => k !== cand.key);
  if (others.length) await prisma.groupDirectorySkip.createMany({ data: others.map((k) => ({ org_group_id: groupIds[0], pipeline_key: k, skipped_by: actorId })), skipDuplicates: true });
  return { contact: { id: row.id, name: row.name } };
}

async function skip(groupIds, actorId, { keys }) {
  await prisma.groupDirectorySkip.createMany({ data: keys.map((k) => ({ org_group_id: groupIds[0], pipeline_key: k, skipped_by: actorId })), skipDuplicates: true });
  return { skipped: keys.length };
}

/** Bring skipped people back into the pipeline (undo a skip). */
async function unskip(groupIds, { keys }) {
  const r = await prisma.groupDirectorySkip.deleteMany({ where: { org_group_id: { in: groupIds }, pipeline_key: { in: keys } } });
  return { restored: r.count };
}

module.exports = { STATUSES, SOURCES, KINDS, contactSchema, contactUpdateSchema, followupSchema, listSchema, addFromPipelineSchema, skipSchema, list, create, update, remove, addFollowup, pipeline, addFromPipeline, skip, unskip };
