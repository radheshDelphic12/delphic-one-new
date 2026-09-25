const prisma = require('../../config/db');

const MEMBERSHIP_SELECT = {
  id: true,
  org_id: true,
  role: true,
  employment_status: true,
  employee_code: true,
  joined_at: true,
  org: { select: { id: true, name: true, slug: true, logo_url: true, status: true, enabled_modules: true, is_master_workspace: true } },
};

// Powers the org switcher UI: every org the caller currently belongs to.
async function listMyMemberships(userId) {
  return prisma.orgMembership.findMany({
    where: { person_id: userId, employment_status: 'active' },
    orderBy: { joined_at: 'asc' },
    select: MEMBERSHIP_SELECT,
  });
}

// Group-superadmin only (see authorizeGroupSuperadmin) — the org picker for
// cross-org admin screens / the future super dashboard.
async function listOrgs(orgGroupIds) {
  return prisma.org.findMany({
    where: { org_group_id: { in: orgGroupIds } },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      slug: true,
      logo_url: true,
      status: true,
      timezone: true,
      default_currency: true,
      valuation: true,
      valuation_method: true,
      valuation_multiple: true,
      enabled_modules: true,
    },
  });
}

// Group superadmin, Group Overview dashboard — manually set/clear a
// subsidiary's valuation figure. Scoped to the caller's own holding
// group(s), same posture as listOrgs.
async function updateValuation(orgGroupIds, orgId, valuation) {
  const org = await prisma.org.findFirst({ where: { id: orgId, org_group_id: { in: orgGroupIds } } });
  if (!org) return { error: 'not_found' };
  const updated = await prisma.org.update({
    where: { id: orgId },
    data: { valuation },
    select: { id: true, name: true, valuation: true },
  });
  return { org: updated };
}

async function updateSettings(orgGroupIds, orgId, patch) {
  const org = await prisma.org.findFirst({ where: { id: orgId, org_group_id: { in: orgGroupIds } } });
  if (!org) return { error: 'not_found' };
  const updated = await prisma.org.update({
    where: { id: orgId },
    data: patch,
    select: { id: true, name: true, enabled_modules: true, valuation_method: true, valuation_multiple: true, valuation: true },
  });
  return { org: updated };
}

async function createOrganization(userId, currentOrgId, { name, slug, logo_url, timezone, default_currency }) {
  const currentOrg = await prisma.org.findUnique({ where: { id: currentOrgId }, select: { org_group_id: true } });
  if (!currentOrg) return { error: 'org_not_found' };
  const existing = await prisma.org.findUnique({ where: { slug } });
  if (existing) return { error: 'slug_taken' };

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.org.create({
      data: { org_group_id: currentOrg.org_group_id, name, slug, logo_url: logo_url || null, timezone, default_currency },
      select: { id: true, name: true, slug: true, logo_url: true, status: true, timezone: true, default_currency: true },
    });
    const membership = await tx.orgMembership.create({
      data: { person_id: userId, org_id: org.id, role: 'admin' },
      select: { id: true, org_id: true, role: true, employment_status: true },
    });
    return { org, membership };
  });
  return result;
}

// Client brief: default (Ahmedabad/Indore/Gurgaon) + custom locations, an
// Org-scoped directory used by calendars (holiday sets) and OrgMembership
// (an employee's office).
async function listLocations(orgId) {
  return prisma.location.findMany({ where: { org_id: orgId }, orderBy: { name: 'asc' } });
}

async function createLocation(orgId, { name, city, country, is_default }) {
  const existing = await prisma.location.findUnique({ where: { org_id_name: { org_id: orgId, name } } });
  if (existing) return { error: 'name_taken' };
  const location = await prisma.location.create({ data: { org_id: orgId, name, city, country, is_default } });
  return { location };
}

const MEMBERSHIP_DETAIL_SELECT = {
  id: true,
  org_id: true,
  employee_code: true,
  joined_at: true,
  left_at: true,
  notice_end_date: true,
  role: true,
  employment_status: true,
  person: { select: { id: true, name: true, email: true, phone: true, active: true } },
  location: { select: { id: true, name: true } },
  shift: { select: { id: true, name: true, start_minutes: true, end_minutes: true, grace_minutes: true } },
  manager: { select: { id: true, person: { select: { id: true, name: true } } } },
  hr_poc: { select: { id: true, name: true } },
  sourcing_poc: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
};

async function listMemberships(orgId, { search, include_terminated }) {
  return prisma.orgMembership.findMany({
    where: {
      org_id: orgId,
      ...(include_terminated ? {} : { employment_status: { not: 'terminated' } }),
      ...(search
        ? { person: { name: { contains: search, mode: 'insensitive' } } }
        : {}),
    },
    orderBy: { joined_at: 'asc' },
    select: MEMBERSHIP_DETAIL_SELECT,
  });
}

async function getMembership(orgId, membershipId) {
  return prisma.orgMembership.findFirst({
    where: { id: membershipId, org_id: orgId },
    select: MEMBERSHIP_DETAIL_SELECT,
  });
}

// HR/Sourcing POC + location/shift/manager/directory mapping — client brief
// "Stakeholder & HR POC mapping". A manager must be a membership in the
// same org (can't report to someone at a different company).
async function updateMembership(orgId, membershipId, patch) {
  const membership = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId } });
  if (!membership) return { error: 'not_found' };

  if (patch.manager_id) {
    if (patch.manager_id === membershipId) return { error: 'self_manager' };
    const manager = await prisma.orgMembership.findFirst({ where: { id: patch.manager_id, org_id: orgId } });
    if (!manager) return { error: 'manager_not_found' };
  }

  const updated = await prisma.orgMembership.update({
    where: { id: membershipId },
    data: patch,
    select: MEMBERSHIP_DETAIL_SELECT,
  });
  return { membership: updated };
}

module.exports = {
  updateSettings,
  listMyMemberships,
  listOrgs,
  createOrganization,
  listMemberships,
  getMembership,
  listLocations,
  createLocation,
  updateMembership,
  updateValuation,
};
