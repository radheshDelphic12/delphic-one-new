const { z } = require('zod');
const bcrypt = require('bcryptjs');
const prisma = require('../../config/db');
const { nextEmployeeCode, withEmployeeCodeRetry } = require('../../lib/employeeCode');
const { WORKING_STATUSES } = require('../../lib/employmentStatus');
const { writeAudit } = require('./audit');

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

const listQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  q: z.string().trim().max(100).optional(),
});
const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  phone: text(40),
}).partial();
const ACCESS = ['admin', 'manager', 'staff', 'finance', 'contractor', 'none'];
const createUserSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200),
  phone: text(40),
  access_role: z.enum(ACCESS).default('staff'),
});
const statusSchema = z.object({ active: z.boolean(), reason: text(500) });

const isActive = (m) => WORKING_STATUSES.includes(m.employment_status);

function userOut(m, person) {
  return {
    id: m.person.id,
    name: m.person.name,
    email: m.person.email,
    phone: m.person.phone,
    role: m.role,
    employee_code: m.employee_code,
    active: isActive(m) && m.person.active,
    employment_status: m.employment_status,
    is_superadmin: m.person.is_superadmin,
    gulati_person: person ? { id: person.id, name: person.name, access_role: person.access_role, active: person.active } : null,
  };
}
const snapshot = (m) => ({ name: m.person.name, email: m.person.email, phone: m.person.phone, employment_status: m.employment_status });

const INCLUDE = { person: { select: { id: true, name: true, email: true, phone: true, active: true, is_superadmin: true } } };
const membershipOf = (orgId, id) => prisma.orgMembership.findFirst({ where: { org_id: orgId, person_id: id }, include: INCLUDE });

async function list(orgId, query) {
  const rows = await prisma.orgMembership.findMany({
    where: {
      org_id: orgId,
      ...(query.status === 'active' ? { employment_status: { in: WORKING_STATUSES }, person: { active: true } } : {}),
      ...(query.status === 'inactive' ? { OR: [{ employment_status: { notIn: WORKING_STATUSES } }, { person: { active: false } }] } : {}),
      ...(query.q ? { person: { OR: ['name', 'email'].map((f) => ({ [f]: { contains: query.q, mode: 'insensitive' } })) } } : {}),
    },
    include: INCLUDE,
    orderBy: { person: { name: 'asc' } },
  });
  const people = await prisma.gxPerson.findMany({ where: { org_id: orgId, deleted_at: null, user_id: { in: rows.map((r) => r.person_id) } } });
  const byUser = new Map(people.map((p) => [p.user_id, p]));
  return rows.map((m) => userOut(m, byUser.get(m.person_id)));
}

async function linkedPerson(orgId, userId) {
  return prisma.gxPerson.findFirst({ where: { org_id: orgId, user_id: userId, deleted_at: null } });
}

// A superadmin's profile is only editable by another superadmin (same rule as the global Users page).
function blocked(target, actor) {
  return target.person.is_superadmin && !actor.is_superadmin ? 'forbidden_superadmin' : null;
}

async function update(orgId, actor, id, input) {
  const m = await membershipOf(orgId, id);
  if (!m) return { error: 'not_found' };
  const denied = blocked(m, actor);
  if (denied) return { error: denied };
  if (input.email && input.email.toLowerCase() !== m.person.email.toLowerCase()) {
    if (await prisma.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' }, NOT: { id } } })) return { error: 'email_taken' };
  }
  const before = snapshot(m);
  await prisma.user.update({ where: { id }, data: input });
  const after = await membershipOf(orgId, id);
  // Keep the linked Gulati person's contact details in step with the account.
  const person = await linkedPerson(orgId, id);
  if (person) {
    await prisma.gxPerson.update({
      where: { id: person.id },
      data: { ...(input.name ? { name: input.name } : {}), ...(input.email ? { email: input.email } : {}), ...(input.phone !== undefined ? { phone: input.phone } : {}) },
    });
  }
  await writeAudit(null, { orgId, actorId: actor.id, entity: 'user', entityId: id, action: 'update', before, after: snapshot(after) });
  return { user: userOut(after, await linkedPerson(orgId, id)) };
}

// Deactivation is scoped to this company: the membership is ended (so they can no longer sign in
// to it) and their Gulati person is switched off. The global account is left alone.
async function setActive(orgId, actor, id, { active, reason }) {
  const m = await membershipOf(orgId, id);
  if (!m) return { error: 'not_found' };
  const denied = blocked(m, actor);
  if (denied) return { error: denied };
  if (!active) {
    if (id === actor.id) return { error: 'self_deactivate' };
    if (m.role === 'admin' && isActive(m)) {
      const otherAdmins = await prisma.orgMembership.count({
        where: { org_id: orgId, role: 'admin', employment_status: { in: WORKING_STATUSES }, NOT: { person_id: id }, person: { active: true } },
      });
      if (!otherAdmins) return { error: 'last_admin' };
    }
  }
  const before = snapshot(m);
  const status = active ? 'active' : 'terminated';
  await prisma.$transaction(async (tx) => {
    await tx.orgMembership.update({ where: { id: m.id }, data: { employment_status: status } });
    await tx.gxPerson.updateMany({ where: { org_id: orgId, user_id: id, deleted_at: null }, data: { active } });
  });
  const after = await membershipOf(orgId, id);
  await writeAudit(null, { orgId, actorId: actor.id, entity: 'user', entityId: id, action: active ? 'reactivate' : 'deactivate', before, after: snapshot(after), reason });
  return { user: userOut(after, await linkedPerson(orgId, id)) };
}

// New login for this company: a global account + membership, and (unless admin) a Gulati person that carries the access role.
async function create(orgId, actor, input) {
  const { access_role: access, password, ...profile } = input;
  if (await prisma.user.findFirst({ where: { email: { equals: profile.email, mode: 'insensitive' } } })) return { error: 'email_taken' };
  const role = access === 'admin' ? 'admin' : 'employee';
  const password_hash = await bcrypt.hash(password, 10);
  const userId = await withEmployeeCodeRetry(() => prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { ...profile, password_hash, role }, select: { id: true } });
    await tx.orgMembership.create({ data: { person_id: user.id, org_id: orgId, role, employee_code: await nextEmployeeCode(tx, orgId) } });
    if (access !== 'admin') {
      await tx.gxPerson.create({ data: { org_id: orgId, name: profile.name, email: profile.email, phone: profile.phone, user_id: user.id, access_role: access } });
    }
    return user.id;
  }));
  const m = await membershipOf(orgId, userId);
  await writeAudit(null, { orgId, actorId: actor.id, entity: 'user', entityId: userId, action: 'create', after: { ...snapshot(m), access_role: access } });
  return { user: userOut(m, await linkedPerson(orgId, userId)) };
}

module.exports = { create, createUserSchema, listQuerySchema, updateUserSchema, statusSchema, list, update, setActive };
