const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ensureGroupAdminMemberships } = require('../../lib/groupAccess');
const prisma = require('../../config/db');
const { WORKING_STATUSES, isWorking } = require('../../lib/employmentStatus');
const env = require('../../config/env');

// Multi-company ERP (Phase 1): membership select shared by login/refresh so
// the token payload and the switcher list agree on shape.
const MEMBERSHIP_SELECT = {
  id: true,
  org_id: true,
  role: true,
  employment_status: true,
  worker_type: true,
  org: { select: { id: true, name: true, slug: true, logo_url: true, status: true, enabled_modules: true, is_master_workspace: true } },
};

// A user with no OrgMembership yet (any token issued before Phase 0/1, or a
// test-created user with no membership) gets `org_id: null` — everything
// downstream (authenticate's resolveOrgContext) treats that as "no org
// context" and falls back to today's global-role behavior.
async function defaultMembershipFor(userId) {
  return prisma.orgMembership.findFirst({
    where: { person_id: userId, employment_status: { in: WORKING_STATUSES } },
    orderBy: [{ joined_at: 'asc' }, { org: { is_master_workspace: 'desc' } }, { org: { name: 'asc' } }],
    select: MEMBERSHIP_SELECT,
  });
}

function signAccessToken(user, orgId, role) {
  return jwt.sign(
    { sub: user.id, role: role || user.role, name: user.name, email: user.email, org_id: orgId || null },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpires }
  );
}

function signRefreshToken(user, orgId) {
  return jwt.sign({ sub: user.id, org_id: orgId || null }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpires,
  });
}

// Public, pre-login branding lookup for the workspace picker. Deliberately
// returns only what the sign-in screen displays (name, slug, logo) — never
// ids, status, members or group — and only for active orgs.
async function lookupWorkspace(slug) {
  return prisma.org.findFirst({
    where: { slug, status: 'active' },
    select: { name: true, slug: true, logo_url: true },
  });
}

async function login(email, password, orgSlug) {
  // department rides along so the client knows it right after sign-in (IT
  // timesheet, department-gated calendar) — same shape as GET /users/me.
  const user = await prisma.user.findUnique({ where: { email }, include: { department: { select: { id: true, name: true } } } });
  if (!user || !user.active) return null;

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) return null;

  // A group superadmin gets an admin membership in every company of the group on sign-in, so a company added since the
  // last visit (such as Gulati Foundation) is in the company list straight away.
  if (user.is_group_superadmin) await ensureGroupAdminMemberships(user.id);

  const [memberships, defaultMembership] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { person_id: user.id, employment_status: { in: WORKING_STATUSES } },
      orderBy: [{ joined_at: 'asc' }, { org: { is_master_workspace: 'desc' } }, { org: { name: 'asc' } }],
      select: MEMBERSHIP_SELECT,
    }),
    defaultMembershipFor(user.id),
  ]);

  // A workspace was chosen on the sign-in screen. Checked only AFTER the
  // password is verified, so this can't be used to probe who belongs where.
  let activeMembership = defaultMembership;
  if (orgSlug) {
    activeMembership = memberships.find((m) => m.org.slug === orgSlug);
    if (!activeMembership) return { error: 'no_workspace_access' };
  }

  return {
    access_token: signAccessToken(user, activeMembership?.org_id, activeMembership?.role),
    refresh_token: signRefreshToken(user, activeMembership?.org_id),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      active: user.active,
      is_superadmin: user.is_superadmin,
      is_group_superadmin: user.is_group_superadmin,
      phone: user.phone,
      department_id: user.department_id,
      department: user.department || null,
    },
    memberships,
    active_org: activeMembership?.org || null,
  };
}

async function refresh(refreshToken) {
  let payload;
  try {
    payload = jwt.verify(refreshToken, env.jwt.refreshSecret);
  } catch {
    return null;
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.active) return null;

  // Re-verify the membership carried on the refresh token is still active
  // (offboarding takes effect on next refresh, not just next login) — if
  // it's gone, fall back to whatever the user's current default org is.
  let orgId = null;
  let role = user.role;
  if (payload.org_id) {
    const membership = await prisma.orgMembership.findUnique({
      where: { person_id_org_id: { person_id: user.id, org_id: payload.org_id } },
      select: { org_id: true, role: true, employment_status: true },
    });
    if (membership && isWorking(membership.employment_status)) {
      orgId = membership.org_id;
      role = membership.role;
    }
  }
  if (!orgId) {
    const fallback = await defaultMembershipFor(user.id);
    orgId = fallback?.org_id || null;
    role = fallback?.role || user.role;
  }

  return {
    access_token: signAccessToken(user, orgId, role),
    refresh_token: signRefreshToken(user, orgId),
  };
}

// Multi-company ERP (Phase 1) — the org switcher's backend half. Re-issues
// tokens scoped to `orgId`, the way `login`/`refresh` do, once the caller is
// confirmed to hold an active membership there.
async function switchOrg(userId, orgId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) return { error: 'not_found' };

  // A group superadmin may open any company of their own holding group (admin membership created on demand).
  if (user.is_group_superadmin) await ensureGroupAdminMemberships(userId, orgId);
  const membership = await prisma.orgMembership.findUnique({
    where: { person_id_org_id: { person_id: userId, org_id: orgId } },
    select: MEMBERSHIP_SELECT,
  });
  if (!membership || membership.employment_status !== 'active') return { error: 'not_a_member' };
  if (membership.org.enabled_modules?.includes('coming_soon')) return { error: 'coming_soon', org: membership.org };

  return {
    access_token: signAccessToken(user, membership.org_id, membership.role),
    refresh_token: signRefreshToken(user, membership.org_id),
    active_org: membership.org,
  };
}

async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, reason: 'not_found' };

  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) return { ok: false, reason: 'invalid_current' };

  const password_hash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { password_hash } });
  return { ok: true };
}

module.exports = { login, refresh, changePassword, switchOrg, lookupWorkspace };
