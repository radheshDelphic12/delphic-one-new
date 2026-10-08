const prisma = require('../config/db');
const { WORKING_STATUSES } = require('./employmentStatus');

// The holding group(s) a group superadmin may act in. Mirrors authorizeGroupSuperadmin: explicit
// memberships win; a deployment with exactly one holding group falls back to it.
async function groupIdsForSuperadmin(userId) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { is_group_superadmin: true, active: true, org_group_memberships: { select: { org_group_id: true } } },
  });
  if (!u || !u.active || !u.is_group_superadmin) return [];
  const ids = u.org_group_memberships.map((m) => m.org_group_id);
  if (ids.length) return ids;
  const groups = await prisma.orgGroup.findMany({ select: { id: true }, take: 2 });
  return groups.length === 1 ? [groups[0].id] : [];
}

// Switching into a company needs a real, active admin OrgMembership there, so every existing
// RBAC check (role, module access, audit actor) keeps working unchanged. A group superadmin gets
// that membership for every active company of their own holding group, created on demand and
// never for another group's company. Safe to call repeatedly.
async function ensureGroupAdminMemberships(userId, onlyOrgId) {
  const groupIds = await groupIdsForSuperadmin(userId);
  if (!groupIds.length) return [];
  const orgs = await prisma.org.findMany({
    where: { org_group_id: { in: groupIds }, status: 'active', ...(onlyOrgId ? { id: onlyOrgId } : {}) },
    select: { id: true },
  });
  const created = [];
  for (const org of orgs) {
    const existing = await prisma.orgMembership.findUnique({ where: { person_id_org_id: { person_id: userId, org_id: org.id } }, select: { id: true, employment_status: true } });
    if (existing) continue;
    const row = await prisma.orgMembership.create({ data: { person_id: userId, org_id: org.id, role: 'admin', employment_status: 'active' } });
    await prisma.auditLog.create({
      data: { org_id: org.id, actor_id: userId, action: 'group_admin_access', entity_type: 'org_membership', entity_id: row.id, reason: 'Group superadmin opened this company', snapshot: { role: 'admin' } },
    });
    created.push(row.id);
  }
  return created;
}

module.exports = { groupIdsForSuperadmin, ensureGroupAdminMemberships, WORKING_STATUSES };
