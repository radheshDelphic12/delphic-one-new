const prisma = require('../../config/db');
const { WORKING_STATUSES } = require('../../lib/employmentStatus');
const { resolveWorkerFields, WORKER_FIELDS } = require('../../lib/workerType');
const { nextEmployeeCode, withEmployeeCodeRetry } = require('../../lib/employeeCode');
const allocationsService = require('../allocations/allocations.service');

const MEMBERSHIP_SELECT = {
  id: true,
  org_id: true,
  role: true,
  employment_status: true,
  employee_code: true,
  joined_at: true,
  worker_type: true,
  org: { select: { id: true, name: true, slug: true, logo_url: true, status: true, enabled_modules: true, is_master_workspace: true } },
};

// Powers the org switcher UI: every org the caller currently belongs to.
async function listMyMemberships(userId) {
  return prisma.orgMembership.findMany({
    where: { person_id: userId, employment_status: { in: WORKING_STATUSES } },
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

  const result = await withEmployeeCodeRetry(() => prisma.$transaction(async (tx) => {
    const org = await tx.org.create({
      data: { org_group_id: currentOrg.org_group_id, name, slug, logo_url: logo_url || null, timezone, default_currency },
      select: { id: true, name: true, slug: true, logo_url: true, status: true, timezone: true, default_currency: true },
    });
    const membership = await tx.orgMembership.create({
      data: { person_id: userId, org_id: org.id, role: 'admin', employee_code: await nextEmployeeCode(tx, org.id) },
      select: { id: true, org_id: true, role: true, employment_status: true, employee_code: true },
    });
    return { org, membership };
  }));
  return result;
}

// Client brief: default (Ahmedabad/Indore/Gurgaon) + custom locations, an
// Org-scoped directory used by calendars (holiday sets) and OrgMembership
// (an employee's office).
async function listLocations(orgId) {
  return prisma.location.findMany({ where: { org_id: orgId }, orderBy: { name: 'asc' } });
}

// An org has ONE default location: marking a location as the default moves
// the flag, so two defaults never coexist.
async function createLocation(orgId, { name, city, country, is_default }) {
  const existing = await prisma.location.findUnique({ where: { org_id_name: { org_id: orgId, name } } });
  if (existing) return { error: 'name_taken' };
  const location = await prisma.$transaction(async (tx) => {
    if (is_default) await tx.location.updateMany({ where: { org_id: orgId, is_default: true }, data: { is_default: false } });
    return tx.location.create({ data: { org_id: orgId, name, city, country, is_default } });
  });
  return { location };
}

async function updateLocation(orgId, locationId, patch) {
  const location = await prisma.location.findFirst({ where: { id: locationId, org_id: orgId } });
  if (!location) return { error: 'not_found' };
  if (patch.name && patch.name !== location.name) {
    const taken = await prisma.location.findUnique({ where: { org_id_name: { org_id: orgId, name: patch.name } } });
    if (taken) return { error: 'name_taken' };
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (patch.is_default) await tx.location.updateMany({ where: { org_id: orgId, is_default: true, id: { not: locationId } }, data: { is_default: false } });
    return tx.location.update({ where: { id: locationId }, data: patch });
  });
  return { location: updated };
}

// Blocked while anything still points at the location (employees, calendars,
// expense claims) — reassign them first rather than leave them dangling.
async function deleteLocation(orgId, locationId) {
  const location = await prisma.location.findFirst({ where: { id: locationId, org_id: orgId } });
  if (!location) return { error: 'not_found' };
  const [employees, calendars, claims] = await Promise.all([
    prisma.orgMembership.count({ where: { location_id: locationId } }),
    prisma.calendar.count({ where: { location_id: locationId } }),
    prisma.expenseClaim.count({ where: { location_id: locationId } }),
  ]);
  if (employees || calendars || claims) return { error: 'in_use', employees, calendars, claims };
  await prisma.location.delete({ where: { id: locationId } });
  return { deleted: true };
}

const MEMBERSHIP_DETAIL_SELECT = {
  id: true,
  org_id: true,
  employee_code: true,
  joined_at: true,
  left_at: true,
  notice_start_date: true,
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
  team: { select: { id: true, name: true } },
  work_mode: true,
  worker_type: true,
  vendor_account: { select: { id: true, name: true } },
  vendor_rate: true,
  vendor_rate_currency: true,
};

// A person as shown in the reporting view: enough to recognise and link them.
const PERSON_CARD_SELECT = {
  id: true,
  employee_code: true,
  employment_status: true,
  person: { select: { name: true, email: true } },
  designation: { select: { name: true } },
  department: { select: { name: true } },
};

function personCard(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.person?.name || null,
    email: row.person?.email || null,
    employee_code: row.employee_code,
    designation: row.designation?.name || null,
    department: row.department?.name || null,
    employment_status: row.employment_status,
  };
}

// An employee's reporting view: their manager, their direct reports, and
// their team (lead + members). Directory-level info — the same people the org
// chart shows every member — so any member of the org may read it.
async function getReporting(orgId, membershipId) {
  const me = await prisma.orgMembership.findFirst({
    where: { id: membershipId, org_id: orgId },
    select: { id: true, manager_id: true, team_id: true },
  });
  if (!me) return null;
  const active = { employment_status: { not: 'terminated' } };
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
  const [manager, reports, team] = await Promise.all([
    me.manager_id ? prisma.orgMembership.findFirst({ where: { id: me.manager_id, org_id: orgId }, select: PERSON_CARD_SELECT }) : null,
    prisma.orgMembership.findMany({ where: { org_id: orgId, manager_id: me.id, ...active }, select: PERSON_CARD_SELECT }),
    me.team_id
      ? prisma.team.findFirst({
        where: { id: me.team_id, org_id: orgId },
        select: {
          id: true,
          name: true,
          lead: { select: PERSON_CARD_SELECT },
          members: { where: active, select: PERSON_CARD_SELECT },
        },
      })
      : null,
  ]);
  return {
    manager: personCard(manager),
    direct_reports: reports.map(personCard).sort(byName),
    team: team
      ? { id: team.id, name: team.name, lead: personCard(team.lead), members: team.members.map(personCard).sort(byName) }
      : null,
  };
}

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
async function updateMembership(orgId, membershipId, patch, actorUserId = null) {
  const membership = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId } });
  if (!membership) return { error: 'not_found' };

  if (patch.manager_id) {
    if (patch.manager_id === membershipId) return { error: 'self_manager' };
    const manager = await prisma.orgMembership.findFirst({ where: { id: patch.manager_id, org_id: orgId } });
    if (!manager) return { error: 'manager_not_found' };
  }

  if (patch.team_id) {
    const team = await prisma.team.findFirst({ where: { id: patch.team_id, org_id: orgId } });
    if (!team) return { error: 'team_not_found' };
  }

  if (patch.employee_code) {
    const clash = await prisma.orgMembership.findFirst({
      where: { org_id: orgId, employee_code: patch.employee_code, NOT: { id: membershipId } },
      select: { id: true },
    });
    if (clash) return { error: 'employee_code_taken' };
  }

  const worker = await resolveWorkerFields(orgId, membership, patch);
  if (worker.error) return worker;
  const data = { ...patch };
  for (const key of WORKER_FIELDS) delete data[key];
  Object.assign(data, worker.data);
  // Team is effective-dated: the change goes through TeamMembershipPeriod
  // (which also moves the team_id pointer), never a plain overwrite.
  // Notice period: LWD can't precede the notice date; exiting records left_at
  // (the LWD, else today) so reports stop counting the person after it.
  const noticeStart = data.notice_start_date !== undefined ? data.notice_start_date : membership.notice_start_date;
  const lwd = data.notice_end_date !== undefined ? data.notice_end_date : membership.notice_end_date;
  if (noticeStart && lwd && lwd < noticeStart) return { error: 'lwd_before_notice' };
  // Joining date: can't come after the person's last working day / exit date.
  const lastDay = lwd || membership.left_at;
  if (data.joined_at && lastDay && data.joined_at > lastDay) return { error: 'joined_after_exit' };
  if (data.employment_status === 'terminated' && membership.employment_status !== 'terminated' && !membership.left_at) {
    data.left_at = lwd || new Date(new Date().toISOString().slice(0, 10));
  }
  if (data.employment_status && data.employment_status !== 'terminated' && membership.employment_status === 'terminated') data.left_at = null;

  const teamChange = data.team_id !== undefined && data.team_id !== membership.team_id;
  const teamEffective = data.team_effective_date;
  delete data.team_id;
  delete data.team_effective_date;

  const updated = await prisma.$transaction(async (tx) => {
    if (teamChange) {
      const result = await allocationsService.changeTeam(orgId, actorUserId, membershipId, patch.team_id, teamEffective, tx);
      if (result.error) throw Object.assign(new Error(result.error), { code: result.error });
    }
    // A contractor is always a self-service 'employee' in the portal, on the
    // User row too (the role a membership-less login falls back to).
    if (data.role) await tx.user.update({ where: { id: membership.person_id }, data: { role: data.role } });
    return tx.orgMembership.update({ where: { id: membershipId }, data, select: MEMBERSHIP_DETAIL_SELECT });
  }).catch((err) => {
    if (err.code === 'future_team_change') return { error: 'future_team_change' };
    throw err;
  });
  if (updated.error) return updated;
  return { membership: updated };
}

// Bank + emergency contact. Kept out of MEMBERSHIP_DETAIL_SELECT on purpose:
// that read is open to every member of the org; this one is admin-or-self.
const PERSONAL_SELECT = {
  id: true,
  person: { select: { name: true } },
  bank_account_holder: true,
  bank_name: true,
  bank_account_number: true,
  bank_ifsc: true,
  bank_branch: true,
  aadhaar_number: true,
  pan_number: true,
  emergency_contact_name: true,
  emergency_contact_relation: true,
  emergency_contact_phone: true,
  emergency_contact_email: true,
  personal_details_updated_at: true,
};

async function getPersonalDetails(orgId, membershipId) {
  return prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: PERSONAL_SELECT });
}

async function updatePersonalDetails(orgId, membershipId, patch) {
  const existing = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: { id: true } });
  if (!existing) return null;
  const data = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  return prisma.orgMembership.update({ where: { id: membershipId }, data: { ...data, personal_details_updated_at: new Date() }, select: PERSONAL_SELECT });
}

module.exports = {
  getReporting,
  getPersonalDetails,
  updatePersonalDetails,
  updateSettings,
  listMyMemberships,
  listOrgs,
  createOrganization,
  listMemberships,
  getMembership,
  listLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  updateMembership,
  updateValuation,
};
