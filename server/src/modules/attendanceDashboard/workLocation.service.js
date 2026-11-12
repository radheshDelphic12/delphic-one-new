// Work location away from the base office (a project site or travel). A person has one base office (org_memberships.location_id plus
// the dated employee_office_assignments); on the days of a work location assignment check-in is measured against that place
// instead, and the register shows it. The base office itself never changes. Sites that are not our offices live in work_sites, so
// they never reach office lists, headcount, calendars, expense or group charges.
const prisma = require('../../config/db');

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const PURPOSES = ['project', 'travel', 'other'];
const num = (v) => (v === null || v === undefined ? null : Number(v));

// ----- Sites -----

const siteView = (s) => ({
  id: s.id, name: s.name, city: s.city, address: s.address, latitude: num(s.latitude), longitude: num(s.longitude),
  radius_m: s.radius_m, client_account_id: s.client_account_id, configured: s.latitude != null && s.longitude != null,
});

async function listSites(orgId) {
  const rows = await prisma.workSite.findMany({ where: { org_id: orgId }, orderBy: { name: 'asc' } });
  return rows.map(siteView);
}

async function clientExists(orgId, id) {
  if (!id) return true;
  return Boolean(await prisma.account.findFirst({ where: { id, org_id: orgId, type: 'client' }, select: { id: true } }));
}

async function createSite(orgId, actor, data) {
  if (!(await clientExists(orgId, data.client_account_id))) return { error: 'client_not_found' };
  const row = await prisma.workSite.create({ data: { org_id: orgId, created_by: actor.id, ...data } });
  return { site: siteView(row) };
}

async function updateSite(orgId, id, data) {
  const existing = await prisma.workSite.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (data.client_account_id && !(await clientExists(orgId, data.client_account_id))) return { error: 'client_not_found' };
  const row = await prisma.workSite.update({ where: { id }, data });
  return { site: siteView(row) };
}

// ----- Assignments -----

// Names for a set of assignments: the place, its city, the purpose and the project.
async function describe(orgId, rows) {
  const locationIds = [...new Set(rows.map((r) => r.location_id).filter(Boolean))];
  const siteIds = [...new Set(rows.map((r) => r.work_site_id).filter(Boolean))];
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter(Boolean))];
  const [locations, sites, accounts] = await Promise.all([
    locationIds.length ? prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true, city: true } }) : [],
    siteIds.length ? prisma.workSite.findMany({ where: { id: { in: siteIds }, org_id: orgId }, select: { id: true, name: true, city: true } }) : [],
    accountIds.length ? prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, project_name: true } }) : [],
  ]);
  const loc = new Map(locations.map((l) => [l.id, l]));
  const site = new Map(sites.map((s) => [s.id, s]));
  const account = new Map(accounts.map((a) => [a.id, a]));
  return rows.map((r) => {
    const place = r.work_site_id ? site.get(r.work_site_id) : loc.get(r.location_id);
    const project = r.account_id ? account.get(r.account_id) : null;
    return {
      id: r.id, org_membership_id: r.org_membership_id, from_date: ymd(r.from_date), to_date: ymd(r.to_date),
      kind: r.work_site_id ? 'site' : 'office', location_id: r.location_id, work_site_id: r.work_site_id,
      place_name: place?.name || null, city: place?.city || null, purpose: r.purpose,
      account_id: r.account_id, project_name: project ? project.project_name || project.name : null,
      deployment_person_id: r.deployment_person_id, note: r.note,
      cancelled: Boolean(r.cancelled_at), cancel_reason: r.cancel_reason, created_at: r.created_at,
    };
  });
}

async function history(orgId, membershipId) {
  const rows = await prisma.workLocationAssignment.findMany({ where: { org_id: orgId, org_membership_id: membershipId }, orderBy: { from_date: 'desc' } });
  return describe(orgId, rows);
}

// Active (not cancelled) assignments of the given people that touch [from, to]; the register and calendar mark those days "away".
async function activeBetween(orgId, membershipIds, from, to) {
  if (!membershipIds.length) return [];
  return prisma.workLocationAssignment.findMany({
    where: { org_id: orgId, org_membership_id: { in: membershipIds }, cancelled_at: null, from_date: { lte: to }, to_date: { gte: from } },
    orderBy: { from_date: 'asc' },
  });
}

// membership id -> (date -> { place_name, city, purpose, project_name }) for the register and calendar.
async function awayByPerson(orgId, membershipIds, from, to) {
  const rows = await activeBetween(orgId, membershipIds, from, to);
  const described = await describe(orgId, rows);
  const out = new Map();
  described.forEach((a) => {
    const days = out.get(a.org_membership_id) || new Map();
    for (let t = new Date(`${a.from_date}T00:00:00.000Z`).getTime(); t <= new Date(`${a.to_date}T00:00:00.000Z`).getTime(); t += 86400000) {
      const key = new Date(t).toISOString().slice(0, 10);
      if (key >= ymd(from) && key <= ymd(to)) days.set(key, { place_name: a.place_name, city: a.city, purpose: a.purpose, project_name: a.project_name, kind: a.kind });
    }
    out.set(a.org_membership_id, days);
  });
  return out;
}

async function create(orgId, actor, body) {
  const { org_membership_id, from_date, to_date, location_id, work_site_id, purpose = 'project', account_id, deployment_person_id, note } = body;
  if (ymd(to_date) < ymd(from_date)) return { error: 'bad_dates' };
  if (Boolean(location_id) === Boolean(work_site_id)) return { error: 'one_place' };
  const member = await prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId }, select: { id: true } });
  if (!member) return { error: 'membership_not_found' };
  if (location_id && !(await prisma.location.findFirst({ where: { id: location_id, org_id: orgId }, select: { id: true } }))) return { error: 'place_not_found' };
  if (work_site_id && !(await prisma.workSite.findFirst({ where: { id: work_site_id, org_id: orgId }, select: { id: true } }))) return { error: 'place_not_found' };
  if (account_id && !(await prisma.account.findFirst({ where: { id: account_id, org_id: orgId }, select: { id: true } }))) return { error: 'project_not_found' };

  const clash = await prisma.workLocationAssignment.findFirst({
    where: { org_id: orgId, org_membership_id, cancelled_at: null, from_date: { lte: to_date }, to_date: { gte: from_date } },
    select: { from_date: true, to_date: true },
  });
  if (clash) return { error: 'overlaps', clash: { from_date: ymd(clash.from_date), to_date: ymd(clash.to_date) } };

  const row = await prisma.workLocationAssignment.create({
    data: { org_id: orgId, org_membership_id, from_date, to_date, location_id: location_id || null, work_site_id: work_site_id || null, purpose, account_id: account_id || null, deployment_person_id: deployment_person_id || null, note: note || null, created_by: actor.id },
  });
  return { assignment: (await describe(orgId, [row]))[0] };
}

// Cancel an assignment, or end it early: with `end_from` the person is back at base from that day (the days before stay).
async function cancel(orgId, actor, id, { reason, end_from }) {
  const row = await prisma.workLocationAssignment.findFirst({ where: { id, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  if (row.cancelled_at) return { error: 'already_cancelled' };
  const data = { cancel_reason: reason, cancelled_by: actor.id };
  if (end_from && ymd(end_from) > ymd(row.from_date) && ymd(end_from) <= ymd(row.to_date)) {
    // Ended early: the days before end_from stay on record, so the row is shortened, not cancelled.
    const lastDay = new Date(new Date(end_from).getTime() - 86400000);
    const updated = await prisma.workLocationAssignment.update({ where: { id }, data: { ...data, to_date: lastDay } });
    return { assignment: (await describe(orgId, [updated]))[0] };
  }
  const updated = await prisma.workLocationAssignment.update({ where: { id }, data: { ...data, cancelled_at: new Date() } });
  return { assignment: (await describe(orgId, [updated]))[0] };
}

// ----- Where a person is measured on a day -----

// The base office on a day: the latest dated office assignment on or before it, else the current office.
async function baseOfficeOn(orgId, member, date) {
  const row = await prisma.employeeOfficeAssignment.findFirst({
    where: { org_id: orgId, org_membership_id: member.id, effective_from: { lte: date } },
    orderBy: { effective_from: 'desc' },
    select: { location_id: true },
  });
  return row ? row.location_id : member.location_id;
}

// { kind: 'base' | 'office' | 'site', location_id, work_site_id, assignment_id, fence, name, city, purpose }
// 'base' = no assignment covers the day (the person's own office); 'office' = another of our offices; 'site' = a work site.
async function placeOn(orgId, member, date) {
  const assignment = await prisma.workLocationAssignment.findFirst({
    where: { org_id: orgId, org_membership_id: member.id, cancelled_at: null, from_date: { lte: date }, to_date: { gte: date } },
    orderBy: { from_date: 'desc' },
  });
  if (assignment && assignment.work_site_id) {
    const site = await prisma.workSite.findFirst({ where: { id: assignment.work_site_id, org_id: orgId } });
    if (site) {
      return {
        kind: 'site', location_id: null, work_site_id: site.id, assignment_id: assignment.id, purpose: assignment.purpose, name: site.name, city: site.city,
        fence: site.latitude != null && site.longitude != null ? { latitude: site.latitude, longitude: site.longitude, radius_m: site.radius_m } : null,
      };
    }
  }
  const locationId = assignment && assignment.location_id ? assignment.location_id : await baseOfficeOn(orgId, member, date);
  const [fence, location] = locationId
    ? await Promise.all([
      prisma.officeGeofence.findUnique({ where: { org_id_location_id: { org_id: orgId, location_id: locationId } } }),
      prisma.location.findUnique({ where: { id: locationId }, select: { name: true, city: true } }),
    ])
    : [null, null];
  return {
    kind: assignment && assignment.location_id ? 'office' : 'base', location_id: locationId || null, work_site_id: null, assignment_id: assignment ? assignment.id : null,
    purpose: assignment ? assignment.purpose : null, name: location?.name || null, city: location?.city || null, fence,
  };
}

module.exports = { PURPOSES, listSites, createSite, updateSite, history, create, cancel, activeBetween, awayByPerson, placeOn, baseOfficeOn, describe };
