const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');

const KINDS = ['employee', 'contractor'];
const ACCESS = ['manager', 'staff', 'finance', 'contractor', 'none'];
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const dateOnly = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());

const personFields = {
  name: z.string().trim().min(1).max(200),
  kind: z.enum(KINDS),
  designation: text(120),
  phone: text(40),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().email().max(200).nullable().optional()),
  joining_date: dateOnly.optional(),
  leaving_date: dateOnly.optional(),
  notes: text(2000),
  active: z.boolean(),
  monthly_salary: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e10).nullable().optional()),
  // admin-only
  user_id: uuidOrNull,
  access_role: z.enum(ACCESS),
};
const createPersonSchema = z.object({ ...personFields, kind: personFields.kind.default('employee'), active: personFields.active.default(true), access_role: personFields.access_role.default('none') });
const updatePersonSchema = z.object(personFields).partial();
const listQuerySchema = z.object({
  kind: z.enum([...KINDS, 'all']).default('all'),
  active: z.enum(['true', 'false', 'all']).default('all'),
  q: z.string().trim().max(100).optional(),
});

const ADMIN_FIELDS = ['user_id', 'access_role', 'monthly_salary'];
const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const snapshot = (p) => ({ name: p.name, kind: p.kind, active: p.active, access_role: p.access_role, user_id: p.user_id, monthly_salary: p.monthly_salary == null ? null : Number(p.monthly_salary) });

const personOut = (p) => ({ ...p, monthly_salary: p.monthly_salary == null ? null : Number(p.monthly_salary) });

async function list(orgId, query) {
  return (await prisma.axPerson.findMany({
    where: {
      org_id: orgId,
      deleted_at: null,
      ...(query.kind !== 'all' ? { kind: query.kind } : {}),
      ...(query.active !== 'all' ? { active: query.active === 'true' } : {}),
      ...(query.q ? { OR: ['name', 'email', 'phone', 'designation'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) } : {}),
    },
    orderBy: { name: 'asc' },
  })).map(personOut);
}

async function get(orgId, id) {
  const person = await prisma.axPerson.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  return person ? { person: personOut(person) } : { error: 'not_found' };
}

async function checkUser(orgId, userId, selfId) {
  if (!userId) return null;
  const member = await prisma.orgMembership.findFirst({ where: { org_id: orgId, person_id: userId }, select: { id: true } });
  if (!member) return { error: 'user_not_in_org' };
  const linked = await prisma.axPerson.findFirst({ where: { org_id: orgId, user_id: userId, deleted_at: null, ...(selfId ? { NOT: { id: selfId } } : {}) }, select: { id: true } });
  return linked ? { error: 'user_linked' } : null;
}

async function create(orgId, actorId, ctx, input) {
  if (!ctx.isAdmin && ADMIN_FIELDS.some((f) => input[f] !== undefined && input[f] !== 'none' && input[f] !== null)) return { error: 'admin_only_field' };
  const bad = await checkUser(orgId, input.user_id);
  if (bad) return bad;
  const { joining_date, leaving_date, ...rest } = input;
  const person = await prisma.axPerson.create({ data: { org_id: orgId, ...rest, joining_date: toDate(joining_date), leaving_date: toDate(leaving_date) } });
  await writeAudit(null, { orgId, actorId, entity: 'person', entityId: person.id, action: 'create', after: snapshot(person) });
  return { person };
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.axPerson.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (!ctx.isAdmin && ADMIN_FIELDS.some((f) => input[f] !== undefined)) return { error: 'admin_only_field' };
  if (input.user_id) {
    const bad = await checkUser(orgId, input.user_id, id);
    if (bad) return bad;
  }
  const { joining_date, leaving_date, ...rest } = input;
  const person = await prisma.axPerson.update({
    where: { id },
    data: { ...rest, ...(joining_date !== undefined ? { joining_date: toDate(joining_date) } : {}), ...(leaving_date !== undefined ? { leaving_date: toDate(leaving_date) } : {}) },
  });
  await writeAudit(null, { orgId, actorId, entity: 'person', entityId: id, action: 'update', before: snapshot(before), after: snapshot(person) });
  return { person };
}

async function remove(orgId, actorId, id) {
  const before = await prisma.axPerson.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.axPerson.update({ where: { id }, data: { deleted_at: new Date(), active: false, user_id: null } });
  await writeAudit(null, { orgId, actorId, entity: 'person', entityId: id, action: 'delete', before: snapshot(before) });
  return { ok: true };
}

// An assignee / contractor reference must be an active roster person of the right kind.
async function personOk(orgId, personId, kind) {
  if (!personId) return true;
  return Boolean(await prisma.axPerson.findFirst({ where: { id: personId, org_id: orgId, kind, active: true, deleted_at: null }, select: { id: true } }));
}

// Lead owners: org admins and Acconcy managers with a login.
async function ownerCandidates(orgId) {
  const [admins, managers] = await Promise.all([
    prisma.orgMembership.findMany({ where: { org_id: orgId, role: 'admin' }, select: { person_id: true } }),
    prisma.axPerson.findMany({ where: { org_id: orgId, access_role: 'manager', active: true, deleted_at: null, user_id: { not: null } }, select: { user_id: true } }),
  ]);
  return new Set([...admins.map((a) => a.person_id), ...managers.map((m) => m.user_id)]);
}
async function ownerOk(orgId, ownerId) {
  return !ownerId || (await ownerCandidates(orgId)).has(ownerId);
}
async function listOwners(orgId) {
  const ids = [...(await ownerCandidates(orgId))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  return users.sort((a, b) => a.name.localeCompare(b.name));
}

// names for decorating rows: id -> { id, name }
async function nameMap(orgId, personIds, partyIds) {
  const pid = [...new Set(personIds.filter(Boolean))];
  const aid = [...new Set(partyIds.filter(Boolean))];
  const [people, parties] = await Promise.all([
    pid.length ? prisma.axPerson.findMany({ where: { id: { in: pid }, org_id: orgId }, select: { id: true, name: true } }) : [],
    aid.length ? prisma.axParty.findMany({ where: { id: { in: aid }, org_id: orgId }, select: { id: true, name: true } }) : [],
  ]);
  return { people: new Map(people.map((p) => [p.id, p])), parties: new Map(parties.map((p) => [p.id, p])) };
}

module.exports = { createPersonSchema, updatePersonSchema, listQuerySchema, list, get, create, update, remove, personOk, ownerOk, listOwners, nameMap };
