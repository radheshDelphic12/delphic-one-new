const prisma = require('../../config/db');
const { teamUserIds } = require('../permissions');
const { levelOf, effectivePermissions, legacyPermissions, deriveLegacyRole } = require('./effective');

/**
 * What a signed-in person can do in a company that is on the permission model. Read live on every request, so an Admin's change
 * to a grant, a set or a removal reaches an open session on its next call.
 *
 * Args:
 *   membership: the OrgMembership row with `role`, `is_leave_manager`, `custom_role` and `person` ({ is_superadmin, is_group_superadmin }).
 *   orgId: the company.
 *
 * Returns:
 *   Fields to merge into `req.user`: role (derived, for the gates that still ask for a plain role), access, custom_role,
 *   custom_permissions (what `can()` reads) and team_user_ids when a permission is scoped to the team.
 */
async function loadAccess(orgId, membership) {
  const level = levelOf(membership.person, membership.role);
  if (level !== 'employee') {
    const everything = effectivePermissions({ level });
    return { role: 'admin', access: { mode: 'permissions', level, permissions: everything.permissions, basic: everything.basic, set: null } };
  }
  const grants = await prisma.permissionGrant.findMany({ where: { org_membership_id: membership.id }, select: { key: true, scope: true, effect: true } });
  const set = membership.custom_role || null;
  const { permissions, basic } = effectivePermissions({ level, setPermissions: set?.permissions, grants, isLeaveManager: membership.is_leave_manager });
  const out = {
    role: deriveLegacyRole({ level, setBaseRole: set?.base_role, permissions }),
    access: { mode: 'permissions', level, permissions, basic, set: set ? { id: set.id, name: set.name } : null },
    custom_permissions: legacyPermissions(permissions),
  };
  if (set) out.custom_role = { id: set.id, name: set.name };
  if (Object.values(permissions).includes('team')) out.team_user_ids = await teamUserIds(orgId, membership.id);
  return out;
}

module.exports = { loadAccess };
