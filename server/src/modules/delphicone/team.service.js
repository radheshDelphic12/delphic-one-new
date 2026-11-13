const crypto = require('crypto');
const prisma = require('../../config/db');
const usersService = require('../users/users.service');

// The Delphic One team: the people of the Delphic One company itself (our own sales and admin team). It REUSES the user service that People > Users uses
// (usersService.create / update), so the same rules, audit and sign-in behaviour apply; this file only adds the guard rails that keep it inside this one
// company: only members of the given org are listed or touched, a person who also works in another company is never edited from here (their login is
// shared), you cannot lock yourself out, and the last active admin cannot be removed.

const ROLES = ['admin', 'sales', 'bda'];
const tempPassword = () => `${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(4).toString('hex')}`;

async function list(orgId) {
  const members = await prisma.orgMembership.findMany({
    where: { org_id: orgId },
    select: { person_id: true, role: true, employment_status: true, joined_at: true, person: { select: { id: true, name: true, email: true, phone: true, active: true, is_superadmin: true, is_group_superadmin: true } } },
    orderBy: { joined_at: 'asc' },
  });
  const others = members.length ? await prisma.orgMembership.groupBy({ by: ['person_id'], where: { person_id: { in: members.map((m) => m.person_id) }, org_id: { not: orgId } }, _count: { _all: true } }) : [];
  const shared = new Set(others.map((o) => o.person_id));
  return members.map((m) => {
    const p = m.person;
    const protectedUser = p.is_superadmin || p.is_group_superadmin;
    return {
      id: p.id, name: p.name, email: p.email, phone: p.phone, role: m.role, active: p.active, employment_status: m.employment_status, joined_at: m.joined_at,
      shared: shared.has(p.id), protected: protectedUser, can_edit: !shared.has(p.id) && !protectedUser,
    };
  });
}

// Add a person to this company. Their first password is generated and shown once unless one is given. An email that already has a login anywhere is
// refused, exactly as People > Users does: the existing flow never attaches an existing person to another company.
async function add(orgId, actor, { name, email, role, phone, password }) {
  if (!ROLES.includes(role)) return { error: 'bad_role' };
  const clean = email.trim().toLowerCase();
  if (await prisma.user.findFirst({ where: { email: { equals: clean, mode: 'insensitive' } }, select: { id: true } })) return { error: 'email_taken' };
  const pw = password || tempPassword();
  const r = await usersService.create(orgId, { name: name.trim(), email: clean, password: pw, role, phone: phone || null });
  if (r.error) return r;
  return { user: r.user, temp_password: password ? null : pw };
}

async function update(orgId, actor, personId, patch) {
  const m = await prisma.orgMembership.findUnique({ where: { person_id_org_id: { person_id: personId, org_id: orgId } }, select: { role: true, person: { select: { id: true, active: true, is_superadmin: true, is_group_superadmin: true } } } });
  if (!m) return { error: 'not_found' };
  if (m.person.is_superadmin || m.person.is_group_superadmin) return { error: 'protected_user' };
  if (await prisma.orgMembership.count({ where: { person_id: personId, org_id: { not: orgId } } })) return { error: 'shared_user' };
  const data = {};
  if (patch.role !== undefined) { if (!ROLES.includes(patch.role)) return { error: 'bad_role' }; if (patch.role !== m.role) data.role = patch.role; }
  if (patch.active !== undefined && patch.active !== m.person.active) data.active = patch.active;
  if (!Object.keys(data).length) return { error: 'nothing_to_change' };
  if (personId === actor.id) return { error: 'self' };
  const losesAdmin = m.role === 'admin' && m.person.active && (data.role !== undefined || data.active === false);
  if (losesAdmin) {
    const otherAdmins = await prisma.orgMembership.count({ where: { org_id: orgId, role: 'admin', person_id: { not: personId }, person: { active: true } } });
    if (!otherAdmins) return { error: 'last_admin' };
  }
  const r = await usersService.update(orgId, personId, data, actor);
  return r.error ? r : { user: r.user };
}

module.exports = { ROLES, list, add, update };
