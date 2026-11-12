const prisma = require('../../config/db');

/** Is this company on the permission model (default basic access + permission set + grants)? Read live, never cached. */
async function isPermissionMode(orgId) {
  if (!orgId) return false;
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { access_mode: true } });
  return org?.access_mode === 'permissions';
}

module.exports = { isPermissionMode };
