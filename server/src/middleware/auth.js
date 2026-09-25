const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');
const prisma = require('../config/db');
const orgContext = require('../lib/orgContext');
const { fail } = require('../utils/response');

// Multi-company ERP (Phase 1): the JWT carries an `org_id` for users who have
// an OrgMembership (everyone, post Phase-0 backfill). Tokens issued before
// this shipped simply have no `org_id` claim — `payload.org_id` is undefined
// and everything below no-ops back to today's global-role behavior, so old
// tokens keep working until they expire/refresh.
//
// Role is resolved *for that org*, live from the DB. A token carrying an org
// context without a matching active membership is rejected rather than
// falling back to a global role, which would make tenant isolation optional.
async function resolveOrgContext(user, orgId) {
  if (!orgId) return user;
  const membership = await prisma.orgMembership.findUnique({
    where: { person_id_org_id: { person_id: user.id, org_id: orgId } },
    select: { id: true, role: true, employment_status: true },
  });
  if (!membership || membership.employment_status !== 'active') return null;
  return { ...user, role: membership.role, org_id: orgId, org_membership_id: membership.id };
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 401, 'Missing access token');

  try {
    const payload = jwt.verify(token, env.jwt.accessSecret);
    const base = { id: payload.sub, role: payload.role, name: payload.name, email: payload.email };
    resolveOrgContext(base, payload.org_id)
      .then((user) => {
        if (!user) return fail(res, 403, 'Active organization membership required');
        req.user = user;
        // Multi-company ERP (HLD §5, layer 1): the rest of this request runs
        // inside an AsyncLocalStorage context carrying the resolved org_id,
        // so config/db.js's Prisma middleware can auto-stamp org_id on
        // writes that forget to set it. Empty org_id (no membership, or a
        // pre-Phase-1 token) means the middleware no-ops — zero behavior
        // change for anything that stays oblivious to org context.
        orgContext.run({ org_id: user.org_id, org_membership_id: user.org_membership_id }, next);
      })
      .catch(next);
  } catch (_err) {
    return fail(res, 401, 'Invalid or expired access token');
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, 'Not authenticated');
    if (!roles.includes(req.user.role)) return fail(res, 403, 'Insufficient role');
    return next();
  };
}

// Hard gate: 403 unless the caller is an active superadmin. The flag is always
// re-read from the DB (never trusted from the JWT), so a demoted superadmin loses
// access on the very next request.
async function authorizeSuperadmin(req, res, next) {
  try {
    if (!req.user) return fail(res, 401, 'Not authenticated');
    const u = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { is_superadmin: true, active: true },
    });
    if (!u || !u.active || !u.is_superadmin) return fail(res, 403, 'Superadmin only');
    req.user.is_superadmin = true;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Non-failing: resolves req.user.is_superadmin from the DB so shared routes
// (PATCH /users/:id, PATCH /accounts/:id) and lockCheck can branch on a verified flag.
async function loadSuperadminFlag(req, res, next) {
  try {
    if (!req.user) return next();
    const u = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { is_superadmin: true, active: true },
    });
    req.user.is_superadmin = Boolean(u && u.active && u.is_superadmin);
    return next();
  } catch (err) {
    return next(err);
  }
}

// Multi-company ERP (Phase 1): read access to the cross-org super dashboard
// only — a flag separate from any per-org `authorize('admin')` /
// `authorizeSuperadmin`, per HLD §2. Same re-read-from-DB pattern, never a
// JWT claim.
async function authorizeGroupSuperadmin(req, res, next) {
  try {
    if (!req.user) return fail(res, 401, 'Not authenticated');
    const u = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        is_group_superadmin: true,
        active: true,
        org_group_memberships: { select: { org_group_id: true } },
      },
    });
    if (!u || !u.active || !u.is_group_superadmin) return fail(res, 403, 'Group superadmin only');
    req.user.is_group_superadmin = true;
    let groupIds = u.org_group_memberships.map((membership) => membership.org_group_id);
    // Local single-holding deployments created before group memberships were
    // introduced remain usable; once multiple holding groups exist, explicit
    // memberships are mandatory.
    if (groupIds.length === 0) {
      const groups = await prisma.orgGroup.findMany({ select: { id: true }, take: 2 });
      if (groups.length !== 1) return fail(res, 403, 'No authorized holding company');
      groupIds = [groups[0].id];
    }
    req.user.org_group_ids = groupIds;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Multi-company ERP (Phase 2): the new ERP modules (calendars, attendance,
// leave, ...) are meaningless without an active org context, unlike the
// existing recruitment routes (which stay oblivious to org_id for now — see
// resolveOrgContext above). Gate them on req.user.org_membership_id instead
// of silently no-op'ing.
function requireOrgMembership(req, res, next) {
  if (!req.user) return fail(res, 401, 'Not authenticated');
  if (!req.user.org_membership_id) return fail(res, 403, 'No active org membership');
  return next();
}

// Multi-company ERP (Phase 9): a deliberately separate auth path for
// ExternalAccess guests (Legal/CA) — they're not a User, have no password,
// and never get req.user / org context set here. The bearer token is an
// opaque secret (not a JWT); only its SHA-256 hash is ever stored, so this
// looks it up the same way a password would, not verifies a signature.
async function authenticateExternal(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return fail(res, 401, 'Missing access token');

    const token_hash = crypto.createHash('sha256').update(token).digest('hex');
    const grant = await prisma.externalAccess.findUnique({ where: { token_hash } });
    if (!grant || grant.revoked_at || grant.expires_at < new Date()) {
      return fail(res, 401, 'Invalid or expired access token');
    }

    req.externalAccess = grant;
    prisma.externalAccess
      .update({ where: { id: grant.id }, data: { last_used_at: new Date(), use_count: { increment: 1 } } })
      .catch(() => {});
    return next();
  } catch (err) {
    return next(err);
  }
}

// scope is { resources: string[] } — an allow-list of module names this
// grant may read (e.g. 'accounting'). No wildcard support yet: every grant
// names its resources explicitly, matching the "scoped" half of HLD §9's
// "scoped, time-boxed, read-only" description.
function requireExternalScope(resource) {
  return (req, res, next) => {
    if (!req.externalAccess) return fail(res, 401, 'Not authenticated');
    const resources = req.externalAccess.scope?.resources;
    if (!Array.isArray(resources) || !resources.includes(resource)) {
      return fail(res, 403, 'This access grant does not cover that resource');
    }
    return next();
  };
}

module.exports = {
  authenticate,
  authorize,
  authorizeSuperadmin,
  loadSuperadminFlag,
  authorizeGroupSuperadmin,
  requireOrgMembership,
  authenticateExternal,
  requireExternalScope,
};
