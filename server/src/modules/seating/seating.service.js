const { z } = require('zod');
const prisma = require('../../config/db');

// People > Seating: the desks of each office, who sits at which desk, who is in the office today, and the room left for hiring
// (free desks against the open positions of the teams and the people joining soon at that office).

const WORKING = ['active', 'on_leave', 'notice_period'];
const uuid = z.string().uuid();
const addSchema = z.object({
  location_id: uuid,
  labels: z.array(z.string().trim().min(1).max(30)).max(500).optional(),
  prefix: z.string().trim().max(20).optional(),
  count: z.coerce.number().int().min(1).max(500).optional(),
  start: z.coerce.number().int().min(1).max(100000).default(1),
  zone: z.string().trim().max(60).nullable().optional(),
}).refine((v) => (v.labels && v.labels.length) || v.count, 'Give the desk numbers or how many to add');
const updateSchema = z.object({ label: z.string().trim().min(1).max(30).optional(), zone: z.string().trim().max(60).nullable().optional(), active: z.boolean().optional() });
const assignSchema = z.object({ org_membership_id: uuid.nullable() });

const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

async function overview(orgId, locationId) {
  const locations = await prisma.location.findMany({ where: { org_id: orgId }, select: { id: true, name: true, city: true }, orderBy: { name: 'asc' } });
  const loc = locations.find((l) => l.id === locationId) || locations[0];
  if (!loc) return { locations: [], location: null, seats: [], unseated: [], summary: null };
  const [seats, people, teams, attendance] = await Promise.all([
    prisma.officeSeat.findMany({ where: { org_id: orgId, location_id: loc.id }, orderBy: [{ zone: 'asc' }, { label: 'asc' }] }),
    prisma.orgMembership.findMany({
      where: { org_id: orgId, location_id: loc.id, employment_status: { in: [...WORKING, 'pending_onboarding'] }, deleted_at: null },
      select: { id: true, employment_status: true, joined_at: true, worker_type: true, person: { select: { name: true } }, designation: { select: { name: true } }, department: { select: { name: true } } },
    }),
    prisma.team.findMany({ where: { org_id: orgId }, select: { open_positions: true } }),
    prisma.attendanceRecord.findMany({ where: { org_id: orgId, date: today() }, select: { org_membership_id: true, status: true, check_in_at: true } }),
  ]);
  const todayBy = new Map(attendance.map((a) => [a.org_membership_id, a]));
  const inOffice = (id) => { const a = todayBy.get(id); return a ? ['present', 'half_day'].includes(a.status) : false; };
  const byId = new Map(people.map((p) => [p.id, p]));
  const card = (p) => ({ id: p.id, name: p.person?.name || 'Unknown', designation: p.designation?.name || null, department: p.department?.name || null, status: p.employment_status, in_office_today: inOffice(p.id), today: todayBy.get(p.id)?.status || null });
  const seatRows = seats.map((s) => {
    const p = s.org_membership_id ? byId.get(s.org_membership_id) : null;
    return { id: s.id, label: s.label, zone: s.zone, active: s.active, person: p ? card(p) : null, assigned_elsewhere: Boolean(s.org_membership_id && !p) };
  });
  const seated = new Set(seats.map((s) => s.org_membership_id).filter(Boolean));
  const now = new Date();
  const working = people.filter((p) => WORKING.includes(p.employment_status) && (!p.joined_at || p.joined_at <= now));
  const joining = people.filter((p) => p.employment_status === 'pending_onboarding' || (p.joined_at && p.joined_at > now));
  const unseated = working.filter((p) => !seated.has(p.id)).map(card).sort((a, b) => a.name.localeCompare(b.name));
  const activeSeats = seatRows.filter((s) => s.active);
  const free = activeSeats.filter((s) => !s.person && !s.assigned_elsewhere).length;
  const openPositions = teams.reduce((t, x) => t + (x.open_positions || 0), 0);
  const joiningSoon = joining.filter((p) => !seated.has(p.id)).length;
  return {
    locations, location: loc, seats: seatRows, unseated,
    joining: joining.map(card),
    summary: {
      seats: activeSeats.length, occupied: activeSeats.length - free, free, people: working.length, unseated: unseated.length,
      in_office_today: working.filter((p) => inOffice(p.id)).length, joining_soon: joiningSoon, open_positions: openPositions,
      // free desks once the people already at the office without a desk and those joining are seated; negative = desks to add
      free_after_planned: free - unseated.length - joiningSoon,
      room_for_hiring: free - unseated.length - joiningSoon,
    },
  };
}

async function addSeats(orgId, input) {
  const loc = await prisma.location.findFirst({ where: { id: input.location_id, org_id: orgId }, select: { id: true } });
  if (!loc) return { error: 'location_not_found' };
  const labels = input.labels?.length ? input.labels : Array.from({ length: input.count }, (_, i) => `${input.prefix || ''}${input.start + i}`);
  const res = await prisma.officeSeat.createMany({ data: [...new Set(labels)].map((label) => ({ org_id: orgId, location_id: loc.id, label, zone: input.zone || null })), skipDuplicates: true });
  return { added: res.count, skipped: labels.length - res.count };
}

const findSeat = (orgId, id) => prisma.officeSeat.findFirst({ where: { id, org_id: orgId } });

async function updateSeat(orgId, id, input) {
  const seat = await findSeat(orgId, id);
  if (!seat) return { error: 'not_found' };
  if (input.label && input.label !== seat.label && await prisma.officeSeat.findFirst({ where: { location_id: seat.location_id, label: input.label } })) return { error: 'label_taken' };
  if (input.active === false && seat.org_membership_id) return { error: 'seat_taken' };
  return { seat: await prisma.officeSeat.update({ where: { id }, data: input }) };
}

async function removeSeat(orgId, id) {
  const seat = await findSeat(orgId, id);
  if (!seat) return { error: 'not_found' };
  if (seat.org_membership_id) return { error: 'seat_taken' };
  await prisma.officeSeat.delete({ where: { id } });
  return { removed: true };
}

/** Put a person at a desk (they leave any desk they had), or free the desk (null). */
async function assign(orgId, id, membershipId) {
  const seat = await findSeat(orgId, id);
  if (!seat) return { error: 'not_found' };
  if (!membershipId) {
    await prisma.officeSeat.update({ where: { id }, data: { org_membership_id: null, assigned_at: null } });
    return { ok: true };
  }
  if (!seat.active) return { error: 'seat_inactive' };
  const m = await prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId, employment_status: { not: 'terminated' } }, select: { id: true } });
  if (!m) return { error: 'person_not_found' };
  await prisma.$transaction([
    prisma.officeSeat.updateMany({ where: { org_membership_id: membershipId, NOT: { id } }, data: { org_membership_id: null, assigned_at: null } }),
    prisma.officeSeat.update({ where: { id }, data: { org_membership_id: membershipId, assigned_at: new Date() } }),
  ]);
  return { ok: true };
}

module.exports = { addSchema, updateSchema, assignSchema, overview, addSeats, updateSeat, removeSeat, assign };
