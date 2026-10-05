const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');

const KINDS = ['employee', 'contractor'];
const ACCESS_ROLES = ['manager', 'staff', 'none'];
const PAY_BASES = ['monthly', 'daily'];
// Fields only an org admin may set: who can log in, and what a person is paid.
const ADMIN_ONLY = ['access_role', 'user_id', 'pay_basis', 'rate'];

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
  vendor_party_id: uuidOrNull,
  notes: text(1000),
  active: z.boolean(),
  access_role: z.enum(ACCESS_ROLES),
  user_id: uuidOrNull,
  pay_basis: z.preprocess((v) => (v === '' ? null : v), z.enum(PAY_BASES).nullable().optional()),
  rate: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(1e10).nullable().optional()),
};
const createPersonSchema = z.object({ ...personFields, kind: personFields.kind.default('employee'), active: personFields.active.default(true), access_role: personFields.access_role.optional() });
const updatePersonSchema = z.object(personFields).partial();
const listQuerySchema = z.object({
  kind: z.enum(KINDS).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  q: z.string().trim().max(100).optional(),
});
const assignmentFields = {
  project_id: z.string().uuid(),
  role: text(120),
  from_date: dateOnly.optional(),
  to_date: dateOnly.optional(),
  allocation_pct: z.coerce.number().int().min(1).max(100),
};
const assignmentCreateSchema = z.object({ ...assignmentFields, allocation_pct: assignmentFields.allocation_pct.default(100) });
const assignmentUpdateSchema = z.object(assignmentFields).partial().omit({ project_id: true });

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const dayOf = (v) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const num = (v) => (v === null || v === undefined ? null : Number(v));

function personOut(p, showPay) {
  const out = {
    id: p.id,
    name: p.name,
    kind: p.kind,
    designation: p.designation,
    phone: p.phone,
    email: p.email,
    joining_date: p.joining_date,
    leaving_date: p.leaving_date,
    vendor_party_id: p.vendor_party_id,
    vendor_party: p.vendor_party ? { id: p.vendor_party.id, name: p.vendor_party.name } : null,
    notes: p.notes,
    active: p.active,
    user_id: p.user_id,
    user_email: p.user?.email || null,
    access_role: p.access_role,
  };
  if (showPay) {
    out.pay_basis = p.pay_basis;
    out.rate = num(p.rate);
  }
  return out;
}
const INCLUDE = { user: { select: { email: true } }, vendor_party: { select: { id: true, name: true } } };
const snapshot = (p) => ({ name: p.name, kind: p.kind, active: p.active, access_role: p.access_role, pay_basis: p.pay_basis, rate: num(p.rate) });

async function userInOrg(orgId, userId) {
  return Boolean(await prisma.orgMembership.findFirst({ where: { org_id: orgId, person_id: userId } }));
}

async function checkPerson(orgId, current, input, excludeId) {
  const merged = { ...current, ...input };
  if ((merged.pay_basis == null) !== (merged.rate == null)) return 'pay_incomplete';
  const joining = input.joining_date !== undefined ? input.joining_date : dayOf(current.joining_date);
  const leaving = input.leaving_date !== undefined ? input.leaving_date : dayOf(current.leaving_date);
  if (joining && leaving && leaving < joining) return 'bad_dates';
  if (input.user_id && input.user_id !== current.user_id) {
    if (!(await userInOrg(orgId, input.user_id))) return 'user_not_in_org';
    if (await prisma.zxPerson.findFirst({ where: { org_id: orgId, user_id: input.user_id, ...(excludeId ? { NOT: { id: excludeId } } : {}) } })) return 'user_linked';
  }
  if (input.vendor_party_id) {
    const v = await prisma.zxParty.findFirst({ where: { id: input.vendor_party_id, org_id: orgId, deleted_at: null }, select: { kind: true } });
    if (!v || v.kind === 'client') return 'vendor_invalid';
  }
  if (merged.kind === 'employee' && merged.vendor_party_id) return 'employee_vendor';
  return null;
}

const hasAdminField = (input) => ADMIN_ONLY.some((k) => input[k] !== undefined);

async function list(orgId, ctx, query) {
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.status === 'active' ? { active: true } : query.status === 'inactive' ? { active: false } : {}),
    ...(query.q ? { OR: ['name', 'designation', 'phone', 'email'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) } : {}),
  };
  const rows = await prisma.zxPerson.findMany({ where, include: INCLUDE, orderBy: { name: 'asc' } });
  const counts = rows.length
    ? await prisma.zxAssignment.groupBy({ by: ['person_id'], where: { org_id: orgId, person_id: { in: rows.map((r) => r.id) }, deleted_at: null }, _count: { _all: true } })
    : [];
  const countMap = new Map(counts.map((c) => [c.person_id, c._count._all]));
  return rows.map((r) => ({ ...personOut(r, ctx.isAdmin), assignment_count: countMap.get(r.id) || 0 }));
}

async function get(orgId, ctx, id) {
  const person = await prisma.zxPerson.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: INCLUDE });
  if (!person) return { error: 'not_found' };
  const assignments = await prisma.zxAssignment.findMany({
    where: { person_id: id, org_id: orgId, deleted_at: null },
    orderBy: { created_at: 'desc' },
    include: { project: { select: { id: true, code: true, name: true, status: true } } },
  });
  const salaries = ctx.isAdmin
    ? (await prisma.zxSalaryRecord.findMany({ where: { person_id: id, org_id: orgId }, orderBy: { month: 'desc' }, take: 24 })).map(salaryOut)
    : undefined;
  return { person: { ...personOut(person, ctx.isAdmin), assignments, ...(salaries ? { salaries } : {}) } };
}

function salaryOut(s) {
  return { ...s, rate: num(s.rate), days: num(s.days), gross: num(s.gross), deductions: num(s.deductions), net: num(s.net) };
}

async function create(orgId, actorId, ctx, input) {
  if (!ctx.isAdmin && hasAdminField(input)) return { error: 'admin_only_field' };
  const problem = await checkPerson(orgId, {}, input, null);
  if (problem) return { error: problem };
  const { joining_date, leaving_date, ...rest } = input;
  const person = await prisma.zxPerson.create({
    data: { org_id: orgId, ...rest, joining_date: toDate(joining_date), leaving_date: toDate(leaving_date) },
    include: INCLUDE,
  });
  await writeAudit(null, { orgId, actorId, entity: 'person', entityId: person.id, action: 'create', after: snapshot(person) });
  return { person: personOut(person, ctx.isAdmin) };
}

async function update(orgId, actorId, ctx, id, input) {
  const before = await prisma.zxPerson.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  if (!ctx.isAdmin && hasAdminField(input)) return { error: 'admin_only_field' };
  const problem = await checkPerson(orgId, before, input, id);
  if (problem) return { error: problem };
  const { joining_date, leaving_date, ...rest } = input;
  const data = { ...rest, ...(joining_date !== undefined ? { joining_date: toDate(joining_date) } : {}), ...(leaving_date !== undefined ? { leaving_date: toDate(leaving_date) } : {}) };
  // A pay change must not rewrite slips that were already approved; only drafts are regenerated by hand.
  const person = await prisma.zxPerson.update({ where: { id }, data, include: INCLUDE });
  await writeAudit(null, { orgId, actorId, entity: 'person', entityId: id, action: 'update', before: snapshot(before), after: snapshot(person) });
  return { person: personOut(person, ctx.isAdmin) };
}

async function remove(orgId, actorId, id) {
  const before = await prisma.zxPerson.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  await prisma.zxPerson.update({ where: { id }, data: { deleted_at: new Date(), active: false, access_role: 'none' } });
  await writeAudit(null, { orgId, actorId, entity: 'person', entityId: id, action: 'delete', before: snapshot(before) });
  return { ok: true };
}

// --- assignments ---
const overlaps = (aFrom, aTo, bFrom, bTo) => (!aTo || !bFrom || bFrom <= aTo) && (!bTo || !aFrom || aFrom <= bTo);

async function allocationProblem(orgId, personId, from, to, pct, excludeId) {
  const others = await prisma.zxAssignment.findMany({ where: { org_id: orgId, person_id: personId, deleted_at: null, ...(excludeId ? { NOT: { id: excludeId } } : {}) } });
  const total = others.filter((o) => overlaps(from, to, dayOf(o.from_date), dayOf(o.to_date))).reduce((a, o) => a + o.allocation_pct, 0);
  return total + pct > 100 ? total : null;
}

async function liveProject(orgId, projectId) {
  const project = await prisma.zxProject.findFirst({ where: { id: projectId, org_id: orgId, deleted_at: null }, select: { id: true, status: true } });
  if (!project) return { error: 'project_not_found' };
  if (project.status === 'completed' || project.status === 'cancelled') return { error: 'project_closed' };
  return { project };
}

async function addAssignment(orgId, actorId, personId, input) {
  const person = await prisma.zxPerson.findFirst({ where: { id: personId, org_id: orgId, deleted_at: null } });
  if (!person) return { error: 'not_found' };
  const live = await liveProject(orgId, input.project_id);
  if (live.error) return live;
  if (input.from_date && input.to_date && input.to_date < input.from_date) return { error: 'bad_dates' };
  if (await prisma.zxAssignment.findFirst({ where: { person_id: personId, project_id: input.project_id, deleted_at: null, to_date: null } })) return { error: 'already_assigned' };
  const used = await allocationProblem(orgId, personId, input.from_date || null, input.to_date || null, input.allocation_pct, null);
  if (used !== null) return { error: 'over_allocated', used };
  const { from_date, to_date, ...rest } = input;
  const a = await prisma.zxAssignment.create({ data: { org_id: orgId, person_id: personId, ...rest, from_date: toDate(from_date), to_date: toDate(to_date) } });
  await writeAudit(null, { orgId, actorId, entity: 'assignment', entityId: a.id, action: 'create', after: { person_id: personId, project_id: a.project_id, allocation_pct: a.allocation_pct } });
  return { ok: true };
}

async function updateAssignment(orgId, actorId, personId, id, input) {
  const before = await prisma.zxAssignment.findFirst({ where: { id, person_id: personId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'assignment_not_found' };
  const from = input.from_date !== undefined ? input.from_date : dayOf(before.from_date);
  const to = input.to_date !== undefined ? input.to_date : dayOf(before.to_date);
  if (from && to && to < from) return { error: 'bad_dates' };
  const pct = input.allocation_pct ?? before.allocation_pct;
  const used = await allocationProblem(orgId, personId, from, to, pct, id);
  if (used !== null) return { error: 'over_allocated', used };
  const { from_date, to_date, ...rest } = input;
  await prisma.zxAssignment.update({ where: { id }, data: { ...rest, ...(from_date !== undefined ? { from_date: toDate(from_date) } : {}), ...(to_date !== undefined ? { to_date: toDate(to_date) } : {}) } });
  await writeAudit(null, { orgId, actorId, entity: 'assignment', entityId: id, action: 'update', before: { allocation_pct: before.allocation_pct }, after: { allocation_pct: pct } });
  return { ok: true };
}

async function removeAssignment(orgId, actorId, personId, id) {
  const before = await prisma.zxAssignment.findFirst({ where: { id, person_id: personId, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'assignment_not_found' };
  await prisma.zxAssignment.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'assignment', entityId: id, action: 'delete', before: { project_id: before.project_id } });
  return { ok: true };
}

module.exports = {
  ADMIN_ONLY, createPersonSchema, updatePersonSchema, listQuerySchema, assignmentCreateSchema, assignmentUpdateSchema,
  personOut, salaryOut, overlaps, dayOf, toDate, num,
  list, get, create, update, remove, addAssignment, updateAssignment, removeAssignment,
};
