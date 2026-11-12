const prisma = require('../../config/db');
const { fail } = require('../../utils/response');

// Who may record a payment against the central Book Keeping (POST /payments/track) and read what was recorded:
//   * the company Admin and the group admin;
//   * on the permission model, anyone holding a finance / billing / payroll create or update permission;
//   * in a company workspace (Zephyr, Gulati, Acconcy, Foundation, Zklyrera, Valterra, Novarex), its admin, manager and finance roles
//     (a staff member or contractor is not let in).
// Undoing or editing a payment stays with the group admin (the routes use authorizeGroupSuperadmin).
const MONEY_ROLES = new Set(['admin', 'manager', 'finance']);
const PERMISSIONS = ['finance.update', 'finance.create', 'billing.update', 'billing.create', 'payroll.update', 'payroll.create'];

const resolvers = () => [
  require('../zephyr/access').resolveZxRole,
  require('../gulati/access').resolveGxRole,
  require('../acconcy/access').resolveAxRole,
  require('../foundation/access').resolveFxRole,
  require('../zklyrera/access').resolveZkRole,
  require('../valterra/access').resolveVtRole,
  require('../novarex/access').resolveNxRole,
];

/** Does the person hold a money-handling role in the workspace of their active company? (Only the matching module finds a person.) */
async function workspaceMoneyRole(user) {
  const found = await Promise.all(resolvers().map((resolve) => Promise.resolve(resolve(user)).catch(() => ({ role: null }))));
  return found.some((r) => r && MONEY_ROLES.has(r.role));
}

async function canTrack(user) {
  const access = user.access;
  const permissionMode = Boolean(access && access.mode === 'permissions');
  const adminLevel = permissionMode ? access.level !== 'employee' : user.role === 'admin';
  if (adminLevel) return true;
  if (permissionMode && PERMISSIONS.some((k) => access.permissions && access.permissions[k])) return true;
  return workspaceMoneyRole(user);
}

const trackAccess = async (req, res, next) => {
  try {
    if (await canTrack(req.user)) return next();
    return fail(res, 403, 'Your role cannot record payments');
  } catch (err) {
    return next(err);
  }
};

/**
 * The company a payment is recorded for. Normally the active company; the group admin may name another company of their group
 * (a loan of Zephyr paid from the Group Debt screen while Delphic is active), so the wallets offered and the entry posted are that company's.
 * Returns { orgId } or { error } (a message for a 403).
 */
async function resolveTargetOrg(user, requestedOrgId) {
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { is_group_superadmin: true, active: true, org_group_memberships: { select: { org_group_id: true } } } });
  const groupAdmin = Boolean(u?.active && u.is_group_superadmin);
  const memberGroups = u ? u.org_group_memberships.map((m) => m.org_group_id) : [];
  if (!requestedOrgId || requestedOrgId === user.org_id) return { orgId: user.org_id, groupAdmin, groupIds: memberGroups };
  if (!groupAdmin) return { error: 'Only the group admin can record a payment for another company' };
  const target = await prisma.org.findUnique({ where: { id: requestedOrgId }, select: { id: true, org_group_id: true } });
  if (!target) return { error: 'That company was not found' };
  let groupIds = u.org_group_memberships.map((m) => m.org_group_id);
  if (!groupIds.length) {
    const own = await prisma.org.findUnique({ where: { id: user.org_id }, select: { org_group_id: true } });
    groupIds = own ? [own.org_group_id] : [];
  }
  return groupIds.includes(target.org_group_id) ? { orgId: target.id, groupAdmin, groupIds } : { error: 'That company is not in your group' };
}

module.exports = { trackAccess, canTrack, workspaceMoneyRole, resolveTargetOrg };
