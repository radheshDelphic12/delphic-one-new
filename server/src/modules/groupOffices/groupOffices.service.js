const prisma = require('../../config/db');
const { WORKING_STATUSES } = require('../../lib/employmentStatus');
const orgs = require('../orgs/orgs.service');

// Group Dashboard > Offices: every office location of every company in the caller's holding group(s), with how many people sit
// in each, the people behind each count, and add / edit / delete of a company's locations from one place. The per-company
// Offices page and Settings > Locations keep working as before; this reuses the same location rules (orgs.service).

const STATUSES = ['working', 'active', 'on_leave', 'pending_onboarding', 'notice_period', 'terminated', 'all'];
const WORK_MODES = ['remote', 'onsite', 'hybrid', 'not_set'];
const USER_TYPES = ['full_time_employee', 'contractor'];
const PEOPLE_LIMIT = 2000;

const groupOrgs = (groupIds) => prisma.org.findMany({
  where: { org_group_id: { in: groupIds } },
  select: { id: true, name: true, enabled_modules: true },
  orderBy: { name: 'asc' },
});

// The people counted: by default everyone still working (active, serving notice, on leave), narrowed like the Offices page.
function peopleWhere(orgIds, f = {}) {
  const status = STATUSES.includes(f.status) ? f.status : 'working';
  return {
    org_id: { in: orgIds },
    ...(status === 'all' ? {} : { employment_status: status === 'working' ? { in: WORKING_STATUSES } : status }),
    ...(WORK_MODES.includes(f.work_mode) ? { work_mode: f.work_mode === 'not_set' ? null : f.work_mode } : {}),
    ...(USER_TYPES.includes(f.user_type) ? { worker_type: f.user_type } : {}),
  };
}

/** One entry per company with its locations and headcounts, plus the whole group rolled up by office name. */
async function overview(groupIds, filters = {}) {
  const companies = await groupOrgs(groupIds);
  const orgIds = companies.map((o) => o.id);
  const [locations, counts] = await Promise.all([
    prisma.location.findMany({ where: { org_id: { in: orgIds } }, orderBy: [{ is_default: 'desc' }, { name: 'asc' }] }),
    prisma.orgMembership.groupBy({ by: ['org_id', 'location_id'], where: peopleWhere(orgIds, filters), _count: { _all: true } }),
  ]);
  const count = new Map(counts.map((c) => [`${c.org_id}|${c.location_id || 'none'}`, c._count._all]));

  const rollup = new Map(); // office name (case-insensitive) -> { name, people_count, companies: [{ org, people_count }] }
  const rows = companies.map((org) => {
    const own = locations.filter((l) => l.org_id === org.id).map((l) => {
      const people_count = count.get(`${org.id}|${l.id}`) || 0;
      const key = l.name.trim().toLowerCase();
      if (!rollup.has(key)) rollup.set(key, { name: l.name, people_count: 0, companies: [] });
      const r = rollup.get(key);
      r.people_count += people_count;
      r.companies.push({ org_id: org.id, org: org.name, people_count });
      return { id: l.id, name: l.name, city: l.city, country: l.country, address: l.address, is_default: l.is_default, people_count };
    });
    const no_office = count.get(`${org.id}|none`) || 0;
    return {
      org: { id: org.id, name: org.name, coming_soon: Boolean(org.enabled_modules?.includes('coming_soon')) },
      locations: own,
      no_office_count: no_office,
      total_people: own.reduce((s, l) => s + l.people_count, 0) + no_office,
    };
  });

  return {
    totals: {
      companies: rows.length,
      offices: rows.reduce((s, c) => s + c.locations.length, 0),
      people: rows.reduce((s, c) => s + c.total_people, 0),
      no_office: rows.reduce((s, c) => s + c.no_office_count, 0),
    },
    by_office: [...rollup.values()].sort((a, b) => b.people_count - a.people_count || a.name.localeCompare(b.name)),
    companies: rows,
  };
}

/** The people behind one count: one office of one company, or those with no office ("none"), or one office name across the group. */
async function people(groupIds, { org_id, location_id, office_name, ...filters }) {
  const companies = await groupOrgs(groupIds);
  const orgIds = companies.map((o) => o.id);
  if (org_id && !orgIds.includes(org_id)) return { error: 'forbidden' };
  const names = new Map(companies.map((o) => [o.id, o.name]));

  let where = { ...peopleWhere(org_id ? [org_id] : orgIds, filters) };
  if (location_id === 'none') where.location_id = null;
  else if (location_id) where.location_id = location_id;
  else if (office_name) where.location = { name: { equals: office_name, mode: 'insensitive' } };

  const rows = await prisma.orgMembership.findMany({
    where,
    take: PEOPLE_LIMIT,
    orderBy: [{ org_id: 'asc' }, { person: { name: 'asc' } }],
    select: {
      id: true,
      org_id: true,
      employee_code: true,
      employment_status: true,
      work_mode: true,
      worker_type: true,
      person: { select: { id: true, name: true, email: true, department: { select: { name: true } } } },
      department: { select: { name: true } },
      designation: { select: { name: true } },
      location: { select: { name: true } },
    },
  });
  return {
    total: rows.length,
    items: rows.map((m) => ({
      membership_id: m.id,
      org_id: m.org_id,
      user_id: m.person.id,
      name: m.person.name,
      email: m.person.email,
      company: names.get(m.org_id) || '',
      employee_code: m.employee_code,
      designation: m.designation?.name || null,
      department: m.department?.name || m.person.department?.name || null,
      office: m.location?.name || null,
      employment_status: m.employment_status,
      work_mode: m.work_mode,
      worker_type: m.worker_type,
    })),
  };
}

// A company must belong to the caller's group before anything is written to it.
async function ownOrg(groupIds, orgId) {
  return prisma.org.findFirst({ where: { id: orgId, org_group_id: { in: groupIds } }, select: { id: true } });
}

async function addLocation(groupIds, { org_id, ...body }) {
  if (!(await ownOrg(groupIds, org_id))) return { error: 'forbidden' };
  return orgs.createLocation(org_id, body);
}

async function editLocation(groupIds, orgId, locationId, patch) {
  if (!(await ownOrg(groupIds, orgId))) return { error: 'forbidden' };
  return orgs.updateLocation(orgId, locationId, patch);
}

async function removeLocation(groupIds, orgId, locationId) {
  if (!(await ownOrg(groupIds, orgId))) return { error: 'forbidden' };
  return orgs.deleteLocation(orgId, locationId);
}

/** Place one person (one membership, so one company) in an office of that same company. */
async function assignOffice(groupIds, membershipId, locationId) {
  const membership = await prisma.orgMembership.findFirst({
    where: { id: membershipId, org: { org_group_id: { in: groupIds } } },
    select: { id: true, org_id: true },
  });
  if (!membership) return { error: 'membership_not_found' };
  const location = await prisma.location.findFirst({ where: { id: locationId, org_id: membership.org_id }, select: { id: true, name: true } });
  if (!location) return { error: 'location_mismatch' };
  await prisma.orgMembership.update({ where: { id: membership.id }, data: { location_id: location.id } });
  return { membership_id: membership.id, location_id: location.id, office: location.name };
}

module.exports = { overview, people, addLocation, editLocation, removeLocation, assignOffice };
