const crypto = require('crypto');
const prisma = require('../../config/db');

function generateToken() {
  return `ext_${crypto.randomBytes(32).toString('hex')}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Never hand token_hash back over the API — it's the at-rest credential
// store, not a display field, same posture as User.password_hash.
const GRANT_SELECT = {
  id: true,
  org_id: true,
  email: true,
  scope: true,
  granted_by: true,
  expires_at: true,
  revoked_at: true,
  last_used_at: true,
  use_count: true,
  created_at: true,
};

// The plaintext token is returned exactly once, here — only its hash is
// ever persisted, so a lost token means re-granting, not recovering it.
async function grantAccess(orgId, grantedByUserId, { email, resources, expires_at }) {
  const token = generateToken();
  const grant = await prisma.externalAccess.create({
    data: {
      org_id: orgId,
      email,
      scope: { resources },
      token_hash: hashToken(token),
      granted_by: grantedByUserId,
      expires_at,
    },
    select: GRANT_SELECT,
  });
  return { grant, token };
}

async function listGrants(orgId, { email, active }) {
  const where = { org_id: orgId, ...(email ? { email } : {}) };
  if (active === true) {
    where.revoked_at = null;
    where.expires_at = { gt: new Date() };
  } else if (active === false) {
    where.OR = [{ revoked_at: { not: null } }, { expires_at: { lte: new Date() } }];
  }
  return prisma.externalAccess.findMany({ where, select: GRANT_SELECT, orderBy: { created_at: 'desc' } });
}

async function revokeGrant(orgId, grantId) {
  const grant = await prisma.externalAccess.findFirst({ where: { id: grantId, org_id: orgId } });
  if (!grant) return { error: 'not_found' };
  if (grant.revoked_at) return { error: 'already_revoked' };

  const updated = await prisma.externalAccess.update({
    where: { id: grantId },
    data: { revoked_at: new Date() },
    select: GRANT_SELECT,
  });
  return { grant: updated };
}

module.exports = { grantAccess, listGrants, revokeGrant };
