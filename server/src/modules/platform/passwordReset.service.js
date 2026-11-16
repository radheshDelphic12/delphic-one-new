const crypto = require('crypto');
const prisma = require('../../config/db');
const usersService = require('../users/users.service');
const audit = require('./audit.service');
const deletion = require('./customerDeletion.service');

// Admin password reset (Delphic One > Team, and the customer's first admin for owner super admins). One shared rule set:
//  - the password is hashed and stored by users.service.setPassword (the same bcrypt hashing as creating or editing a user) and ends the person's
//    earlier sessions (sign-in tokens and refresh tokens issued before the reset stop working);
//  - the new password is shown ONCE to the admin in the response; it is never stored readable, never logged, never put in the audit trail;
//  - an audit entry records who reset whom and when (and the person's email), nothing else;
//  - a person who also works in another company, a super admin, a group super admin or a platform admin is never reset from here;
//  - the app has no "must change at next sign-in" mechanism today, so the person is asked (on the screen) to change it after signing in.

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; // no look-alikes (0/O, 1/l/I)
function generate() {
  const pick = () => ALPHABET[crypto.randomInt(ALPHABET.length)];
  let raw;
  do { raw = Array.from({ length: 16 }, pick).join(''); } while (!/[a-z]/.test(raw) || !/[A-Z]/.test(raw) || !/[0-9]/.test(raw));
  return raw.match(/.{4}/g).join('-');
}

const MIN = 8;
const MAX = 100;
const typedOk = (p) => typeof p === 'string' && p.length >= MIN && p.length <= MAX;

async function blockers(person) {
  const reasons = [];
  if (person.is_superadmin) reasons.push('is a super admin');
  if (person.is_group_superadmin) reasons.push('is a group super admin');
  if (await prisma.platformAdmin.count({ where: { user_id: person.id } })) reasons.push('is a platform admin');
  return reasons;
}

// Delphic One > Team. Only a member of this company; yourself is refused (use Settings, which asks for the current password).
async function resetTeamMember(orgId, actor, personId, { password } = {}) {
  const m = await prisma.orgMembership.findUnique({ where: { person_id_org_id: { person_id: personId, org_id: orgId } }, select: { person: { select: { id: true, email: true, is_superadmin: true, is_group_superadmin: true } } } });
  if (!m) return { error: 'not_found' };
  if (personId === actor.id) return { error: 'self' };
  if (password !== undefined && !typedOk(password)) return { error: 'weak_password' };
  if ((await blockers(m.person)).length) return { error: 'protected_user' };
  if (await prisma.orgMembership.count({ where: { person_id: personId, org_id: { not: orgId } } })) return { error: 'shared_user' };
  const pw = password === undefined ? generate() : password;
  await usersService.setPassword(personId, pw);
  await audit.record(actor.id, 'password_reset', 'user', personId, null, { scope: 'delphic_one_team', email: m.person.email });
  return { email: m.person.email, password: pw };
}

// The first admin login of a customer's workspace, by a super admin of our own group. Refuses a deleted customer and a customer with no workspace.
async function resetCustomerAdmin(input, actorId, { password } = {}) {
  if (!(await deletion.isOwnerSuperAdmin(actorId))) return { error: 'not_allowed' };
  const target = await deletion.resolve(input);
  if (target.error) return target;
  const { dox, sc } = target;
  if (!sc) return { error: 'no_workspace' };
  if (sc.status === 'deleted' || dox?.deleted_at) return { error: 'customer_deleted' };
  if (password !== undefined && !typedOk(password)) return { error: 'weak_password' };

  const slot = await prisma.saasSlot.findFirst({ where: { customer_id: sc.id, is_admin: true, user_id: { not: null } }, select: { user_id: true } });
  let personId = slot?.user_id;
  if (!personId) personId = (await prisma.orgMembership.findFirst({ where: { org_id: sc.org_id, role: 'admin' }, orderBy: { joined_at: 'asc' }, select: { person_id: true } }))?.person_id;
  if (!personId) return { error: 'no_admin' };
  const person = await prisma.user.findUnique({ where: { id: personId }, select: { id: true, email: true, is_superadmin: true, is_group_superadmin: true } });
  if ((await blockers(person)).length) return { error: 'protected_user' };
  if (await prisma.orgMembership.count({ where: { person_id: personId, org: { org_group_id: { not: sc.org_group_id } } } })) return { error: 'shared_user' };
  const pw = password === undefined ? generate() : password;
  await usersService.setPassword(personId, pw);
  await audit.record(actorId, 'password_reset', 'user', personId, null, { scope: 'customer_admin', customer: sc.name, email: person.email });
  return { email: person.email, password: pw, customer: sc.name };
}

module.exports = { generate, resetTeamMember, resetCustomerAdmin };
