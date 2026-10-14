const { z } = require('zod');
const prisma = require('../../config/db');
const interviews = require('../interviews/interviews.service');

// Group Dashboard > Travel. A trip is somebody (IT or non-IT, any company) going somewhere for meetings, with one total
// budget. The meetings themselves stay on the Delphic Global calendar; a trip only links to their calendar event ids
// ("cm-<uuid>" for a follow-up meeting, "meeting-<uuid>" for an account's meeting), and the calendar shows a Travel tag.

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const money = z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0).max(1e10));
const moneyOrNull = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(0).max(1e10).nullable());

const travelerSchema = z.object({ user_id: uuidOrNull, name: z.string().trim().min(1).max(120), org_id: uuidOrNull });
const tripFields = {
  title: z.string().trim().min(1).max(200),
  org_id: uuidOrNull, // null = the whole group
  origin: text(120),
  destination: z.string().trim().min(1).max(120),
  start_date: dateStr,
  end_date: dateStr,
  purpose: text(2000),
  budget: money,
  actual_spent: moneyOrNull.optional(),
  status: z.enum(['planned', 'completed', 'cancelled']),
  notes: text(4000),
  travelers: z.array(travelerSchema).max(30),
};
const createSchema = z.object({ ...tripFields, budget: money.default(0), status: tripFields.status.default('planned'), travelers: tripFields.travelers.default([]) });
const updateSchema = z.object(tripFields).partial();
const listQuerySchema = z.object({
  view: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  org_id: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});
const newMeetingSchema = z.object({
  account_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  scheduled_at: z.string().min(8),
  duration_minutes: z.coerce.number().int().min(5).max(1440).default(60),
  location: text(300),
  notes: text(2000),
});

const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' }).format(new Date());
const num = (v) => (v === null || v === undefined ? null : Number(v));
const DAY = 86400000;

async function audit(userId, action, tripId, reason, snapshot) {
  await prisma.auditLog.create({ data: { actor_id: userId, action, entity_type: 'group_travel', entity_id: tripId, reason, snapshot: snapshot || {} } });
}

async function groupOrgs(groupIds) {
  return prisma.org.findMany({
    where: { org_group_id: { in: groupIds }, status: 'active' },
    select: { id: true, name: true, enabled_modules: true },
    orderBy: { name: 'asc' },
  });
}
/** Delphic Global is the company with no vertical marker (the others carry one in enabled_modules). */
const MARKERS = ['gulati', 'zephyr', 'acconcy', 'foundation', 'zklyrera', 'valterra', 'coming_soon'];
const isDelphic = (o) => !MARKERS.some((m) => o.enabled_modules?.includes(m));

function stateOf(t, today) {
  if (t.status === 'cancelled') return 'cancelled';
  if (t.status === 'completed') return 'completed';
  const start = ymd(t.start_date);
  const end = ymd(t.end_date);
  if (end < today) return 'overdue_close'; // dates passed but still marked planned: needs closing
  if (start <= today) return 'ongoing';
  return 'planned';
}

/** Calendar event details for linked meeting keys, so the trip can say who it is meeting and when. */
async function resolveMeetings(keys) {
  const follow = keys.filter((k) => k.startsWith('cm-')).map((k) => k.slice(3));
  const acct = keys.filter((k) => k.startsWith('meeting-')).map((k) => k.slice(8));
  const [fu, ac] = await Promise.all([
    follow.length ? prisma.clientMeeting.findMany({ where: { id: { in: follow } }, include: { account: { select: { name: true } } } }) : [],
    acct.length ? prisma.account.findMany({ where: { id: { in: acct } }, select: { id: true, name: true, meeting_date: true, meeting_mode: true, meeting_location: true, stage: true } }) : [],
  ]);
  const out = new Map();
  for (const m of fu) out.set(`cm-${m.id}`, { key: `cm-${m.id}`, title: m.title, account_name: m.account?.name || null, scheduled_at: m.scheduled_at, mode: m.mode, location: m.location, status: m.status });
  for (const a of ac) out.set(`meeting-${a.id}`, { key: `meeting-${a.id}`, title: 'Client meeting', account_name: a.name, scheduled_at: a.meeting_date, mode: a.meeting_mode, location: a.meeting_location, status: a.stage === 'dropped' ? 'cancelled' : 'scheduled' });
  return out;
}

async function shape(rows, today) {
  const keys = [...new Set(rows.flatMap((r) => r.meetings.map((m) => m.meeting_key)))];
  const resolved = await resolveMeetings(keys);
  return rows.map((t) => {
    const meetings = t.meetings.map((m) => resolved.get(m.meeting_key) || { key: m.meeting_key, title: 'Meeting no longer available', account_name: null, scheduled_at: null, mode: null, location: null, status: 'missing' })
      .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
    const budget = num(t.budget) || 0;
    const spent = num(t.actual_spent);
    return {
      id: t.id, title: t.title, org_id: t.org_id, origin: t.origin, destination: t.destination,
      start_date: ymd(t.start_date), end_date: ymd(t.end_date), days: Math.round((t.end_date - t.start_date) / DAY) + 1,
      purpose: t.purpose, budget, actual_spent: spent, currency: t.currency, status: t.status, notes: t.notes,
      state: stateOf(t, today),
      over_budget: spent !== null && spent > budget && budget > 0,
      remaining_budget: spent === null ? null : budget - spent,
      travelers: t.travelers.map((p) => ({ id: p.id, user_id: p.user_id, name: p.name, org_id: p.org_id })),
      meetings,
    };
  });
}

async function list(groupIds, rawQuery) {
  const q = listQuerySchema.parse(rawQuery);
  const today = todayIst();
  const where = { org_group_id: { in: groupIds }, deleted_at: null, ...(q.org_id ? { org_id: q.org_id } : {}) };
  if (q.month) {
    const first = toDate(`${q.month}-01`);
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    where.start_date = { lte: last };
    where.end_date = { gte: first };
  } else if (q.view === 'upcoming') where.end_date = { gte: toDate(today) };
  else if (q.view === 'past') where.end_date = { lt: toDate(today) };
  const rows = await prisma.groupTravel.findMany({
    where,
    include: { travelers: true, meetings: true },
    orderBy: [{ start_date: q.view === 'past' ? 'desc' : 'asc' }, { created_at: 'asc' }],
  });
  const trips = await shape(rows, today);
  const live = trips.filter((t) => t.status !== 'cancelled');
  const orgs = await groupOrgs(groupIds);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  for (const t of trips) t.org_name = t.org_id ? orgName.get(t.org_id) || null : 'Whole group';
  return {
    today, view: q.view, month: q.month || null, trips,
    summary: {
      trips: live.length,
      ongoing: live.filter((t) => t.state === 'ongoing').length,
      travellers: new Set(live.flatMap((t) => t.travelers.map((p) => p.user_id || p.name))).size,
      meetings: live.reduce((n, t) => n + t.meetings.length, 0),
      budget: live.reduce((n, t) => n + t.budget, 0),
      spent: live.reduce((n, t) => n + (t.actual_spent || 0), 0),
      needs_closing: live.filter((t) => t.state === 'overdue_close').length,
    },
  };
}

/** Pick-lists for the trip form: companies, people of every company, active Delphic Global clients and meetings to link. */
async function options(groupIds) {
  const orgs = await groupOrgs(groupIds);
  const delphic = orgs.filter(isDelphic);
  const today = todayIst();
  const [members, accounts, meetings] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { org_id: { in: orgs.map((o) => o.id) }, left_at: null, employment_status: { not: 'terminated' } },
      select: { org_id: true, person: { select: { id: true, name: true, active: true } } },
    }),
    prisma.account.findMany({
      where: { org_id: { in: delphic.map((o) => o.id) }, type: 'client', stage: 'active', is_project: false, deleted_at: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    interviews.listClientMeetings({ from: new Date(`${today}T00:00:00.000Z`), to: new Date(Date.now() + 180 * DAY), mine: false, user: null, status: undefined }),
  ]);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const seen = new Set();
  const people = [];
  for (const m of members) {
    if (!m.person || m.person.active === false || seen.has(`${m.person.id}:${m.org_id}`)) continue;
    seen.add(`${m.person.id}:${m.org_id}`);
    people.push({ user_id: m.person.id, name: m.person.name, org_id: m.org_id, org_name: orgName.get(m.org_id) });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return {
    companies: orgs.map((o) => ({ id: o.id, name: o.name })),
    people,
    clients: accounts,
    meetings: meetings
      .filter((e) => e.status !== 'cancelled' && e.scheduled_at)
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
      .map((e) => ({ key: e.id, title: e.round_name || e.round_type_label, account_name: e.account_name, scheduled_at: e.scheduled_at, mode: e.meeting_mode, location: e.meeting_location })),
  };
}

async function ownedCompany(groupIds, orgId) {
  if (!orgId) return true;
  return Boolean(await prisma.org.findFirst({ where: { id: orgId, org_group_id: { in: groupIds } }, select: { id: true } }));
}
const validDates = (s, e) => (s && e && e < s ? 'bad_dates' : null);

async function load(groupIds, id) {
  return prisma.groupTravel.findFirst({ where: { id, org_group_id: { in: groupIds }, deleted_at: null }, include: { travelers: true, meetings: true } });
}
async function one(groupIds, id) {
  const row = await load(groupIds, id);
  return row ? (await shape([row], todayIst()))[0] : null;
}

async function create(groupIds, userId, body) {
  const d = createSchema.parse(body);
  if (validDates(d.start_date, d.end_date)) return { error: 'bad_dates' };
  if (!(await ownedCompany(groupIds, d.org_id))) return { error: 'company_not_found' };
  const { travelers, ...rest } = d;
  const row = await prisma.groupTravel.create({
    data: { ...rest, org_group_id: groupIds[0], start_date: toDate(d.start_date), end_date: toDate(d.end_date), created_by: userId, travelers: { create: travelers } },
  });
  await audit(userId, 'create', row.id, `Trip to ${row.destination}`, { budget: num(row.budget) });
  return { trip: await one(groupIds, row.id) };
}

async function update(groupIds, userId, id, body) {
  const d = updateSchema.parse(body);
  const existing = await load(groupIds, id);
  if (!existing) return { error: 'not_found' };
  if (validDates(d.start_date || ymd(existing.start_date), d.end_date || ymd(existing.end_date))) return { error: 'bad_dates' };
  if (d.org_id && !(await ownedCompany(groupIds, d.org_id))) return { error: 'company_not_found' };
  const { travelers, ...rest } = d;
  const data = { ...rest };
  if (d.start_date) data.start_date = toDate(d.start_date);
  if (d.end_date) data.end_date = toDate(d.end_date);
  await prisma.$transaction(async (tx) => {
    await tx.groupTravel.update({ where: { id }, data });
    if (travelers) {
      await tx.groupTravelTraveler.deleteMany({ where: { travel_id: id } });
      if (travelers.length) await tx.groupTravelTraveler.createMany({ data: travelers.map((t) => ({ ...t, travel_id: id })) });
    }
  });
  await audit(userId, 'update', id, `Edited trip to ${d.destination || existing.destination}`, { fields: Object.keys(d) });
  return { trip: await one(groupIds, id) };
}

async function remove(groupIds, userId, id) {
  const existing = await load(groupIds, id);
  if (!existing) return { error: 'not_found' };
  await prisma.groupTravel.update({ where: { id }, data: { deleted_at: new Date() } });
  await audit(userId, 'delete', id, `Deleted trip to ${existing.destination}`, {});
  return { id };
}

async function linkMeeting(groupIds, userId, id, key) {
  if (!/^(cm|meeting)-[0-9a-f-]{36}$/.test(String(key))) return { error: 'bad_meeting' };
  const existing = await load(groupIds, id);
  if (!existing) return { error: 'not_found' };
  if (!(await resolveMeetings([key])).has(key)) return { error: 'meeting_not_found' };
  await prisma.groupTravelMeeting.upsert({ where: { travel_id_meeting_key: { travel_id: id, meeting_key: key } }, create: { travel_id: id, meeting_key: key }, update: {} });
  await audit(userId, 'link_meeting', id, `Linked ${key}`, { key });
  return { trip: await one(groupIds, id) };
}

async function unlinkMeeting(groupIds, userId, id, key) {
  const existing = await load(groupIds, id);
  if (!existing) return { error: 'not_found' };
  await prisma.groupTravelMeeting.deleteMany({ where: { travel_id: id, meeting_key: key } });
  await audit(userId, 'unlink_meeting', id, `Unlinked ${key}`, { key });
  return { trip: await one(groupIds, id) };
}

/** Creates a real in-person meeting with an active Delphic Global client (so it is on the calendar) and links it to the trip. */
async function createMeeting(groupIds, userId, id, body) {
  const d = newMeetingSchema.parse(body);
  const existing = await load(groupIds, id);
  if (!existing) return { error: 'not_found' };
  const orgs = (await groupOrgs(groupIds)).filter(isDelphic);
  const account = await prisma.account.findFirst({ where: { id: d.account_id, org_id: { in: orgs.map((o) => o.id) }, type: 'client', stage: 'active', is_project: false, deleted_at: null } });
  if (!account) return { error: 'client_not_found' };
  const when = new Date(d.scheduled_at);
  if (Number.isNaN(when.getTime())) return { error: 'bad_date' };
  const meeting = await prisma.$transaction(async (tx) => {
    const m = await tx.clientMeeting.create({
      data: { account_id: account.id, org_id: account.org_id, title: d.title, mode: 'offline', scheduled_at: when, duration_minutes: d.duration_minutes, location: d.location || existing.destination, notes: d.notes || null, created_by: userId },
    });
    const attendees = existing.travelers.map((t) => t.user_id).filter(Boolean);
    if (attendees.length) await tx.clientMeetingAttendee.createMany({ data: attendees.map((user_id) => ({ meeting_id: m.id, user_id })), skipDuplicates: true });
    await tx.groupTravelMeeting.create({ data: { travel_id: id, meeting_key: `cm-${m.id}` } });
    return m;
  });
  await audit(userId, 'create_meeting', id, `Added meeting ${d.title}`, { meeting_id: meeting.id });
  return { trip: await one(groupIds, id) };
}

/** For the calendar: meeting_key -> the trip it belongs to (so the event can carry a Travel tag). */
async function tagsFor(keys) {
  if (!keys.length) return new Map();
  const links = await prisma.groupTravelMeeting.findMany({
    where: { meeting_key: { in: keys }, travel: { deleted_at: null, status: { not: 'cancelled' } } },
    include: { travel: { select: { id: true, title: true, destination: true, start_date: true, end_date: true } } },
  });
  return new Map(links.map((l) => [l.meeting_key, { id: l.travel.id, title: l.travel.title, destination: l.travel.destination, start_date: ymd(l.travel.start_date), end_date: ymd(l.travel.end_date) }]));
}

/**
 * For the calendar (Group Super Admin only): one event per day of every trip that overlaps [from, to], so the trip is
 * visible on the Delphic Global calendar and can be opened (and managed) from there. 9 AM IST keeps it on the right day.
 */
async function calendarEvents(groupIds, from, to) {
  if (!groupIds.length) return [];
  const first = toDate(ymd(from));
  const last = toDate(ymd(to));
  const rows = await prisma.groupTravel.findMany({
    where: { org_group_id: { in: groupIds }, deleted_at: null, start_date: { lte: last }, end_date: { gte: first } },
    include: { travelers: true, meetings: true },
    orderBy: { start_date: 'asc' },
  });
  if (!rows.length) return [];
  const orgs = await groupOrgs(groupIds);
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const trips = await shape(rows, todayIst());
  const status = { planned: 'scheduled', completed: 'completed', cancelled: 'cancelled' };
  const events = [];
  for (const t of trips) {
    t.org_name = t.org_id ? orgName.get(t.org_id) || null : 'Whole group';
    const days = t.days;
    for (let i = 0; i < days; i += 1) {
      const day = ymd(new Date(toDate(t.start_date).getTime() + i * DAY));
      if (day < ymd(first) || day > ymd(last)) continue;
      const startsAt = new Date(`${day}T03:30:00.000Z`);
      events.push({
        id: `trip-${t.id}-${day}`,
        kind: 'trip',
        trip_id: t.id,
        trip: t,
        day_number: i + 1,
        days,
        scheduled_at: startsAt,
        duration_minutes: 30,
        ends_at: new Date(startsAt.getTime() + 30 * 60000),
        status: status[t.status] || 'scheduled',
        audience: 'external',
        round_name: null,
        account_name: t.org_name,
        meeting_mode: 'offline',
        meeting_location: t.destination,
        meeting_notes: t.purpose,
        interviewers: t.travelers.map((p) => ({ id: p.user_id || `guest-${p.id}`, name: p.name })),
        scheduled_by: null,
      });
    }
  }
  return events;
}

module.exports = { list, options, create, update, remove, linkMeeting, unlinkMeeting, createMeeting, tagsFor, one, calendarEvents };
