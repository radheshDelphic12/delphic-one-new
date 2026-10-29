const fs = require('fs');
const path = require('path');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { todayIst, dayKeyIst } = require('../../lib/istDate');
const attendanceDashboard = require('../attendanceDashboard/attendanceDashboard.service');

// Location check-in: where a full-time employee checked in and out, whether that was inside the office radius, and how late.
// A monitoring feature kept apart from attendance. It READS the work arrangement (office / home) and the shift, and writes only to
// its own tables: attendance, payroll, leave and timesheets are never read from or changed by it.

const DEFAULT_RADIUS_M = 150;
const MAX_RANGE_DAYS = 93;

const num = (v) => (v == null ? null : Number(v));

// Metres between two points on the earth (haversine).
function distanceMeters(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a))));
}

function minutesOfDayInZone(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  return Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
}

// Minutes after the expected start. With a shift: past the start, and only once beyond the shift's grace (same rule attendance uses to
// record lateness). With no shift: past the company's default cutoff. The difference is wrapped to +-12h so an overnight shift's
// early-evening arrival is not read as hours late.
function lateness(shift, defaultCutoff, instant, timeZone, ruleCutoff = null) {
  const at = minutesOfDayInZone(instant, timeZone);
  // An admin-set late time for this shift wins: late is any minute past it.
  if (ruleCutoff != null) {
    const past = ((((at - ruleCutoff + 720) % 1440) + 1440) % 1440) - 720;
    return { cutoff_minutes: ruleCutoff, late_minutes: past > 0 ? past : 0 };
  }
  const start = shift ? shift.start_minutes : defaultCutoff;
  const grace = shift ? shift.grace_minutes : 0;
  const diff = ((((at - start + 720) % 1440) + 1440) % 1440) - 720;
  return { cutoff_minutes: start + grace, late_minutes: diff > grace ? diff : 0 };
}

async function getSettings(orgId) {
  const row = await prisma.locationCheckinSetting.findUnique({ where: { org_id: orgId } });
  return row || { org_id: orgId, selfie_mode: 'required', full_time_only: true, default_cutoff_minutes: 600 };
}

async function updateSettings(orgId, userId, { selfie_mode, full_time_only, default_cutoff_minutes }) {
  const data = {
    ...(selfie_mode !== undefined ? { selfie_mode } : {}),
    ...(full_time_only !== undefined ? { full_time_only } : {}),
    ...(default_cutoff_minutes !== undefined ? { default_cutoff_minutes } : {}),
    updated_by: userId,
  };
  return prisma.locationCheckinSetting.upsert({ where: { org_id: orgId }, create: { org_id: orgId, ...data }, update: data });
}

// ----- Late time per shift (admin) -----
// Each shift with the time it counts as late: the admin's own time here, else the shift start plus its grace.
async function listShiftRules(orgId) {
  const [shifts, rules] = await Promise.all([
    prisma.shift.findMany({ where: { org_id: orgId }, orderBy: { start_minutes: 'asc' }, select: { id: true, name: true, start_minutes: true, grace_minutes: true } }),
    prisma.locationCheckinShiftRule.findMany({ where: { org_id: orgId } }),
  ]);
  const byShift = new Map(rules.map((r) => [r.shift_id, r.late_after_minutes]));
  return shifts.map((s) => ({
    shift_id: s.id,
    name: s.name,
    start_minutes: s.start_minutes,
    grace_minutes: s.grace_minutes,
    default_late_after_minutes: (s.start_minutes + s.grace_minutes) % 1440,
    late_after_minutes: byShift.has(s.id) ? byShift.get(s.id) : null,
  }));
}

async function saveShiftRule(orgId, userId, shiftId, lateAfterMinutes) {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, org_id: orgId }, select: { id: true } });
  if (!shift) return { error: 'shift_not_found' };
  if (lateAfterMinutes == null) {
    await prisma.locationCheckinShiftRule.deleteMany({ where: { org_id: orgId, shift_id: shiftId } });
    return { ok: true };
  }
  const row = await prisma.locationCheckinShiftRule.upsert({
    where: { org_id_shift_id: { org_id: orgId, shift_id: shiftId } },
    create: { org_id: orgId, shift_id: shiftId, late_after_minutes: lateAfterMinutes, updated_by: userId },
    update: { late_after_minutes: lateAfterMinutes, updated_by: userId },
  });
  return { row };
}

// ----- Office map points (admin) -----
async function listGeofences(orgId) {
  const [locations, fences, headcount] = await Promise.all([
    prisma.location.findMany({ where: { org_id: orgId }, orderBy: { name: 'asc' }, select: { id: true, name: true, city: true } }),
    prisma.officeGeofence.findMany({ where: { org_id: orgId } }),
    // how many current full-time employees report to each office, so an admin sees which offices matter
    prisma.orgMembership.groupBy({
      by: ['location_id'],
      where: { org_id: orgId, worker_type: 'full_time_employee', employment_status: { in: ['active', 'notice_period'] }, location_id: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const byLocation = new Map(fences.map((f) => [f.location_id, f]));
  const people = new Map(headcount.map((h) => [h.location_id, h._count._all]));
  return locations.map((l) => {
    const f = byLocation.get(l.id);
    return { location_id: l.id, name: l.name, city: l.city, employees: people.get(l.id) || 0, latitude: f ? num(f.latitude) : null, longitude: f ? num(f.longitude) : null, radius_m: f ? f.radius_m : DEFAULT_RADIUS_M, configured: Boolean(f) };
  });
}

async function saveGeofence(orgId, locationId, { latitude, longitude, radius_m }) {
  const location = await prisma.location.findFirst({ where: { id: locationId, org_id: orgId }, select: { id: true } });
  if (!location) return { error: 'location_not_found' };
  const data = { latitude, longitude, radius_m: radius_m ?? DEFAULT_RADIUS_M };
  const row = await prisma.officeGeofence.upsert({
    where: { org_id_location_id: { org_id: orgId, location_id: locationId } },
    create: { org_id: orgId, location_id: locationId, ...data },
    update: data,
  });
  return { row };
}

async function removeGeofence(orgId, locationId) {
  await prisma.officeGeofence.deleteMany({ where: { org_id: orgId, location_id: locationId } });
  return { ok: true };
}

// ----- Who, where, when -----
async function memberFor(orgId, membershipId) {
  return prisma.orgMembership.findFirst({
    where: { id: membershipId, org_id: orgId },
    select: {
      id: true,
      location_id: true,
      work_mode: true,
      worker_type: true,
      employment_status: true,
      shift: { select: { id: true, start_minutes: true, end_minutes: true, grace_minutes: true, name: true } },
      org: { select: { timezone: true } },
    },
  });
}

// Full-time employees; also contractors once an admin switches "full-time only" off.
const isEligible = (m, settings) =>
  Boolean(m && ['active', 'notice_period'].includes(m.employment_status) && (m.worker_type === 'full_time_employee' || (settings && settings.full_time_only === false)));

// The admin-set late time for the person's shift, or null to follow the shift's own start + grace.
async function shiftRuleFor(orgId, member) {
  if (!member.shift) return null;
  const rule = await prisma.locationCheckinShiftRule.findUnique({ where: { org_id_shift_id: { org_id: orgId, shift_id: member.shift.id } }, select: { late_after_minutes: true } });
  return rule ? rule.late_after_minutes : null;
}

// The office a person reports to on a day: the latest assignment on or before it, else their current office.
async function officeOn(orgId, member, date) {
  const row = await prisma.employeeOfficeAssignment.findFirst({
    where: { org_id: orgId, org_membership_id: member.id, effective_from: { lte: date } },
    orderBy: { effective_from: 'desc' },
    select: { location_id: true },
  });
  return row ? row.location_id : member.location_id;
}

// Where the person is meant to work on a day: an approved office / home choice wins; otherwise a remote person works from home, and a
// day recorded as work from home counts as home. Read only.
async function plannedPlace(orgId, member, date) {
  const [choice, attendance] = await Promise.all([
    prisma.workPlaceDay.findFirst({ where: { org_membership_id: member.id, date, status: 'approved' }, select: { work_place: true } }),
    prisma.attendanceRecord.findFirst({ where: { org_membership_id: member.id, date }, select: { status: true } }),
  ]);
  if (choice) return choice.work_place;
  if (member.work_mode === 'remote' || (attendance && attendance.status === 'wfh')) return 'home';
  return 'office';
}

// Measure a point against the person's office. `at_office` is null when there is no location or no office map point to compare with.
function measure(fence, lat, lng) {
  if (lat == null || lng == null || !fence) return { distance_m: null, at_office: null };
  const distance_m = distanceMeters(lat, lng, num(fence.latitude), num(fence.longitude));
  return { distance_m, at_office: distance_m <= fence.radius_m };
}

// The stored result. A planned home day is never flagged for being away from the office: it is neutral.
function resultFor(place, lat, lng, atOffice) {
  if (place === 'home') return 'work_from_home';
  if (lat == null || lng == null || atOffice == null) return 'location_unavailable';
  return atOffice ? 'in_office' : 'outside_office';
}

const BREAK_REASONS = ['lunch', 'break', 'meeting', 'other'];

const sessionView = (s) => ({
  id: s.id,
  in_at: s.in_at,
  in_result: s.in_result,
  in_distance_m: s.in_distance_m,
  in_at_office: s.in_at_office,
  has_photo: Boolean(s.in_photo),
  out_at: s.out_at,
  out_result: s.out_result,
  out_distance_m: s.out_distance_m,
  out_at_office: s.out_at_office,
  out_reason: s.out_reason,
  edited: Boolean(s.edited_at),
});

const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));

// Time out of desk = the gaps between one check-out and the next check-in of the same day; time at work = the closed sessions.
function dayTotals(sessions) {
  const ordered = [...sessions].sort((a, b) => a.in_at - b.in_at);
  let outOfDesk = 0;
  let breaks = 0;
  let longest = 0;
  let worked = 0;
  ordered.forEach((s, i) => {
    if (s.out_at) worked += minutesBetween(s.in_at, s.out_at);
    const next = ordered[i + 1];
    if (s.out_at && next) {
      const gap = minutesBetween(s.out_at, next.in_at);
      outOfDesk += gap;
      breaks += 1;
      longest = Math.max(longest, gap);
    }
  });
  return { sessions: ordered.map(sessionView), out_of_desk_minutes: outOfDesk, break_count: breaks, longest_break_minutes: longest, worked_minutes: worked, currently_in: ordered.length > 0 && !ordered[ordered.length - 1].out_at };
}

const view = (r) => ({
  id: r.id,
  date: r.date.toISOString().slice(0, 10),
  planned_place: r.planned_place,
  check_in_at: r.check_in_at,
  check_in_result: r.check_in_result,
  check_in_distance_m: r.check_in_distance_m,
  check_in_at_office: r.check_in_at_office,
  check_in_accuracy_m: r.check_in_accuracy_m,
  check_in_lat: num(r.check_in_lat),
  check_in_lng: num(r.check_in_lng),
  has_photo: Boolean(r.check_in_photo),
  cutoff_minutes: r.cutoff_minutes,
  late_minutes: r.late_minutes,
  check_out_at: r.check_out_at,
  check_out_result: r.check_out_result,
  check_out_distance_m: r.check_out_distance_m,
  check_out_at_office: r.check_out_at_office,
  ...dayTotals(r.sessions || []),
});

const withSessions = { sessions: { orderBy: { in_at: 'asc' } } };

const dropFile = (file) => {
  if (file?.path) fs.promises.unlink(file.path).catch(() => {});
};
const dropStored = (name) => {
  if (name) fs.promises.unlink(path.resolve(env.uploadDir, name)).catch(() => {});
};

// Today for the signed-in employee: whether they may use the feature, today's record, and what the day is planned as.
async function today(user) {
  const [member, settings] = await Promise.all([memberFor(user.org_id, user.org_membership_id), getSettings(user.org_id)]);
  if (!isEligible(member, settings)) return { eligible: false };
  const date = todayIst();
  const [record, planned, locationId, ruleCutoff] = await Promise.all([
    prisma.locationCheckin.findUnique({ where: { org_membership_id_date: { org_membership_id: member.id, date } }, include: withSessions }),
    plannedPlace(user.org_id, member, date),
    officeOn(user.org_id, member, date),
    shiftRuleFor(user.org_id, member),
  ]);
  const fence = locationId ? await prisma.officeGeofence.findUnique({ where: { org_id_location_id: { org_id: user.org_id, location_id: locationId } } }) : null;
  const office = locationId ? await prisma.location.findUnique({ where: { id: locationId }, select: { name: true } }) : null;
  return {
    eligible: true,
    date: date.toISOString().slice(0, 10),
    planned_place: planned,
    office_name: office ? office.name : null,
    office_configured: Boolean(fence),
    selfie_mode: settings.selfie_mode,
    shift: member.shift ? { name: member.shift.name, start_minutes: member.shift.start_minutes, grace_minutes: member.shift.grace_minutes } : null,
    late_after_minutes: ruleCutoff != null ? ruleCutoff : member.shift ? (member.shift.start_minutes + member.shift.grace_minutes) % 1440 : settings.default_cutoff_minutes,
    default_cutoff_minutes: settings.default_cutoff_minutes,
    record: record ? view(record) : null,
  };
}

// Check in: the first one of the day opens the day (and sets "late"); after a check-out the person can check in again, and the gap
// between the two is time out of desk. Late is only ever judged on the first check-in.
async function checkIn(user, { latitude, longitude, accuracy_m }, uploaded) {
  let file = uploaded;
  const [member, settings] = await Promise.all([memberFor(user.org_id, user.org_membership_id), getSettings(user.org_id)]);
  if (!isEligible(member, settings)) {
    dropFile(file);
    return { error: 'not_eligible' };
  }
  const date = todayIst();
  const existing = await prisma.locationCheckin.findUnique({ where: { org_membership_id_date: { org_membership_id: member.id, date } }, include: withSessions });
  if (existing && dayTotals(existing.sessions).currently_in) {
    dropFile(file);
    return { error: 'already_checked_in' };
  }
  // Selfie: required (no check-in without one), optional (kept if sent), or off (never kept).
  if (settings.selfie_mode === 'required' && !file) return { error: 'selfie_required' };
  if (settings.selfie_mode === 'off' && file) {
    dropFile(file);
    file = null;
  }

  const planned = existing ? existing.planned_place : await plannedPlace(user.org_id, member, date);
  const locationId = existing ? existing.location_id : await officeOn(user.org_id, member, date);
  const fence = locationId ? await prisma.officeGeofence.findUnique({ where: { org_id_location_id: { org_id: user.org_id, location_id: locationId } } }) : null;
  const { distance_m, at_office } = measure(fence, latitude, longitude);
  const now = new Date();
  const result = resultFor(planned, latitude, longitude, at_office);
  const sessionData = {
    org_id: user.org_id,
    org_membership_id: member.id,
    date,
    in_at: now,
    in_lat: latitude ?? null,
    in_lng: longitude ?? null,
    in_accuracy_m: accuracy_m ?? null,
    in_distance_m: distance_m,
    in_at_office: at_office,
    in_result: result,
    in_photo: file ? file.filename : null,
  };
  try {
    if (existing) {
      await prisma.$transaction([
        prisma.locationCheckinSession.create({ data: { ...sessionData, checkin_id: existing.id } }),
        prisma.locationCheckin.update({
          where: { id: existing.id },
          data: { check_out_at: null, check_out_lat: null, check_out_lng: null, check_out_accuracy_m: null, check_out_distance_m: null, check_out_at_office: null, check_out_result: null },
        }),
      ]);
      return { record: view(await prisma.locationCheckin.findUnique({ where: { id: existing.id }, include: withSessions })) };
    }
    const ruleCutoff = await shiftRuleFor(user.org_id, member);
    const late = lateness(member.shift, settings.default_cutoff_minutes, now, member.org?.timezone || 'Asia/Kolkata', ruleCutoff);
    const row = await prisma.locationCheckin.create({
      data: {
        org_id: user.org_id,
        org_membership_id: member.id,
        date,
        location_id: locationId || null,
        planned_place: planned,
        check_in_at: now,
        check_in_lat: latitude ?? null,
        check_in_lng: longitude ?? null,
        check_in_accuracy_m: accuracy_m ?? null,
        check_in_distance_m: distance_m,
        check_in_at_office: at_office,
        check_in_result: result,
        check_in_photo: file ? file.filename : null,
        cutoff_minutes: late.cutoff_minutes,
        late_minutes: late.late_minutes,
        sessions: { create: [sessionData] },
      },
      include: withSessions,
    });
    return { record: view(row) };
  } catch (err) {
    dropFile(file);
    if (err.code === 'P2002') return { error: 'already_checked_in' };
    throw err;
  }
}

async function checkOut(user, { latitude, longitude, accuracy_m, reason }) {
  const [member, settings] = await Promise.all([memberFor(user.org_id, user.org_membership_id), getSettings(user.org_id)]);
  if (!isEligible(member, settings)) return { error: 'not_eligible' };
  const date = todayIst();
  const record = await prisma.locationCheckin.findUnique({ where: { org_membership_id_date: { org_membership_id: member.id, date } }, include: withSessions });
  if (!record) return { error: 'not_checked_in' };
  const open = [...record.sessions].reverse().find((s) => !s.out_at);
  if (!open) return { error: 'already_checked_out' };
  const fence = record.location_id ? await prisma.officeGeofence.findUnique({ where: { org_id_location_id: { org_id: user.org_id, location_id: record.location_id } } }) : null;
  const { distance_m, at_office } = measure(fence, latitude, longitude);
  const out = {
    out_at: new Date(),
    out_lat: latitude ?? null,
    out_lng: longitude ?? null,
    out_accuracy_m: accuracy_m ?? null,
    out_distance_m: distance_m,
    out_at_office: at_office,
    out_result: resultFor(record.planned_place, latitude, longitude, at_office),
  };
  await prisma.$transaction([
    prisma.locationCheckinSession.update({ where: { id: open.id }, data: { ...out, out_reason: reason || null } }),
    prisma.locationCheckin.update({
      where: { id: record.id },
      data: {
        check_out_at: out.out_at,
        check_out_lat: out.out_lat,
        check_out_lng: out.out_lng,
        check_out_accuracy_m: out.out_accuracy_m,
        check_out_distance_m: out.out_distance_m,
        check_out_at_office: out.out_at_office,
        check_out_result: out.out_result,
      },
    }),
  ]);
  return { record: view(await prisma.locationCheckin.findUnique({ where: { id: record.id }, include: withSessions })) };
}

async function listMine(user, { from, to }) {
  const rows = await prisma.locationCheckin.findMany({
    where: { org_membership_id: user.org_membership_id, date: { gte: from, lte: to } },
    orderBy: { date: 'desc' },
    include: withSessions,
  });
  return rows.map(view);
}

// ----- Admin: correct or remove a record -----
// Every change needs a reason and is written to the audit log. Nothing here touches attendance, leave or pay.
async function audit(db, user, action, day, reason, snapshot) {
  await db.auditLog.create({
    data: { actor_id: user.id, action, entity_type: 'location_checkin', entity_id: day.id, reason, org_id: user.org_id || null, snapshot },
  });
}

// After sessions change, bring the day row back in line: first check-in (and late), latest check-out. No sessions left = no day.
async function recomputeDay(dayId) {
  const day = await prisma.locationCheckin.findUnique({ where: { id: dayId }, include: withSessions });
  if (!day) return null;
  if (!day.sessions.length) {
    await prisma.locationCheckin.delete({ where: { id: dayId } });
    return null;
  }
  const first = day.sessions[0];
  const last = day.sessions[day.sessions.length - 1];
  const [member, settings] = await Promise.all([memberFor(day.org_id, day.org_membership_id), getSettings(day.org_id)]);
  const ruleCutoff = member ? await shiftRuleFor(day.org_id, member) : null;
  const late = lateness(member?.shift || null, settings.default_cutoff_minutes, first.in_at, member?.org?.timezone || 'Asia/Kolkata', ruleCutoff);
  const row = await prisma.locationCheckin.update({
    where: { id: dayId },
    data: {
      check_in_at: first.in_at,
      check_in_lat: first.in_lat,
      check_in_lng: first.in_lng,
      check_in_accuracy_m: first.in_accuracy_m,
      check_in_distance_m: first.in_distance_m,
      check_in_at_office: first.in_at_office,
      check_in_result: first.in_result,
      check_in_photo: first.in_photo,
      cutoff_minutes: late.cutoff_minutes,
      late_minutes: late.late_minutes,
      check_out_at: last.out_at,
      check_out_lat: last.out_lat,
      check_out_lng: last.out_lng,
      check_out_accuracy_m: last.out_accuracy_m,
      check_out_distance_m: last.out_distance_m,
      check_out_at_office: last.out_at_office,
      check_out_result: last.out_result,
    },
    include: withSessions,
  });
  return row;
}

const sessionSnapshot = (s) => ({ in_at: s.in_at, out_at: s.out_at, out_reason: s.out_reason, in_result: s.in_result, out_result: s.out_result });

// Change the in / out time of one session (out_at null re-opens it) or its break reason.
async function updateSession(user, sessionId, { in_at, out_at, out_reason, reason }) {
  const s = await prisma.locationCheckinSession.findFirst({ where: { id: sessionId, org_id: user.org_id } });
  if (!s) return { error: 'not_found' };
  const inAt = in_at || s.in_at;
  const outAt = out_at === undefined ? s.out_at : out_at;
  if (dayKeyIst(inAt) !== s.date.toISOString().slice(0, 10)) return { error: 'wrong_day' };
  if (outAt && outAt <= inAt) return { error: 'bad_times' };
  const siblings = await prisma.locationCheckinSession.findMany({ where: { checkin_id: s.checkin_id, id: { not: s.id } } });
  const end = outAt || inAt;
  const clash = siblings.some((o) => (!outAt && !o.out_at) || (inAt < (o.out_at || o.in_at) && end > o.in_at) || (inAt.getTime() === o.in_at.getTime()));
  if (clash) return { error: 'overlap' };
  const data = { in_at: inAt, out_at: outAt, edited_by: user.id, edited_at: new Date() };
  if (!outAt) Object.assign(data, { out_lat: null, out_lng: null, out_accuracy_m: null, out_distance_m: null, out_at_office: null, out_result: null, out_reason: null });
  else if (out_reason !== undefined) data.out_reason = out_reason;
  const after = await prisma.locationCheckinSession.update({ where: { id: s.id }, data });
  const day = await recomputeDay(s.checkin_id);
  await audit(prisma, user, 'edit_session', { id: s.checkin_id }, reason, { before: sessionSnapshot(s), after: sessionSnapshot(after) });
  return { record: day ? view(day) : null };
}

async function deleteSession(user, sessionId, reason) {
  const s = await prisma.locationCheckinSession.findFirst({ where: { id: sessionId, org_id: user.org_id } });
  if (!s) return { error: 'not_found' };
  await prisma.locationCheckinSession.delete({ where: { id: s.id } });
  dropStored(s.in_photo);
  const day = await recomputeDay(s.checkin_id);
  await audit(prisma, user, 'delete_session', { id: s.checkin_id }, reason, { before: sessionSnapshot(s), day_removed: !day });
  return { record: day ? view(day) : null, day_removed: !day };
}

async function deleteDay(user, dayId, reason) {
  const day = await prisma.locationCheckin.findFirst({ where: { id: dayId, org_id: user.org_id }, include: withSessions });
  if (!day) return { error: 'not_found' };
  await audit(prisma, user, 'delete_day', day, reason, { date: day.date, org_membership_id: day.org_membership_id, sessions: day.sessions.map(sessionSnapshot) });
  await prisma.locationCheckin.delete({ where: { id: day.id } });
  day.sessions.forEach((x) => dropStored(x.in_photo));
  return { ok: true };
}

// ----- Report (HR / admin) -----
// What the day was planned as against where the person actually was. `compare` is the plain-words comparison.
// "Not as planned" covers a check-in away from the office on an office day, at the office on a home day, and an office-day check-in whose
// location could not be read. A home day without a location is not flagged: nobody is expected to be at a place that day.
function compare(r) {
  const planned = r.planned_place;
  const where = r.check_in_at_office; // true office, false away, null unknown
  if (where == null) return planned === 'home' ? 'wfh_no_location' : 'no_location';
  if (planned === 'office') return where ? 'as_planned' : 'office_day_outside';
  return where ? 'home_day_at_office' : 'as_planned';
}
const NOT_AS_PLANNED = ['office_day_outside', 'home_day_at_office', 'no_location'];

const ATTENDANCE_LABEL = { present: 'Present', absent: 'Absent', half_day: 'Half day', leave: 'On leave', holiday: 'Holiday', wfh: 'Work from home' };

async function report(orgId, q) {
  const days = Math.round((q.to - q.from) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) return { error: 'range_too_long' };
  const settings = await getSettings(orgId);
  const where = { org_id: orgId, date: { gte: q.from, lte: q.to } };
  if (q.org_membership_id) where.org_membership_id = q.org_membership_id;
  if (q.location_id) where.location_id = q.location_id;
  if (q.planned_place) where.planned_place = q.planned_place;
  if (q.late_only) where.late_minutes = { gt: 0 };
  if (q.outside_only) where.check_in_result = 'outside_office';
  const records = await prisma.locationCheckin.findMany({ where, orderBy: [{ date: 'desc' }, { check_in_at: 'asc' }], include: withSessions });

  // Everyone the feature applies to, so a person who never checked in still shows on a day they were meant to work.
  const rosterWhere = {
    org_id: orgId,
    ...(settings.full_time_only === false ? {} : { worker_type: 'full_time_employee' }),
    employment_status: { in: ['active', 'notice_period'] },
    ...(q.org_membership_id ? { id: q.org_membership_id } : {}),
    ...(q.location_id ? { location_id: q.location_id } : {}),
  };
  const wantsMissing = !q.late_only && !q.outside_only && !q.mismatch_only;
  const roster = wantsMissing ? await prisma.orgMembership.findMany({ where: rosterWhere, select: { id: true, work_mode: true, location_id: true } }) : [];
  const memberIds = [...new Set([...records.map((r) => r.org_membership_id), ...roster.map((m) => m.id)])];
  const locationIds = [...new Set([...records.map((r) => r.location_id), ...roster.map((m) => m.location_id)].filter(Boolean))];
  const dateRange = { gte: q.from, lte: q.to };
  const [members, locations, attendance, leaves, choices] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, employee_code: true, work_mode: true, person: { select: { name: true, email: true } }, department: { select: { name: true } }, shift: { select: { name: true } } },
    }),
    prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } }),
    prisma.attendanceRecord.findMany({ where: { org_id: orgId, org_membership_id: { in: memberIds }, date: dateRange }, select: { org_membership_id: true, date: true, status: true } }),
    prisma.leaveRequest.findMany({
      where: { org_id: orgId, org_membership_id: { in: memberIds }, status: 'approved', from_date: { lte: q.to }, to_date: { gte: q.from } },
      select: { org_membership_id: true, from_date: true, to_date: true, is_half_day: true, leave_type: { select: { name: true } } },
    }),
    prisma.workPlaceDay.findMany({ where: { org_id: orgId, org_membership_id: { in: memberIds }, date: dateRange, status: 'approved' }, select: { org_membership_id: true, date: true, work_place: true } }),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const locationById = new Map(locations.map((l) => [l.id, l.name]));
  const key = (mid, date) => `${mid}|${date.toISOString().slice(0, 10)}`;
  const attendanceByDay = new Map(attendance.map((a) => [key(a.org_membership_id, a.date), a.status]));
  const choiceByDay = new Map(choices.map((c) => [key(c.org_membership_id, c.date), c.work_place]));
  const leaveOn = (mid, date) => {
    const t = date.getTime();
    return leaves.find((l) => l.org_membership_id === mid && l.from_date.getTime() <= t && l.to_date.getTime() >= t) || null;
  };
  // The attendance status for a day, as the report compares it: an approved leave names its type (CL, SL ...).
  const statusOf = (mid, date) => {
    const leave = leaveOn(mid, date);
    const code = attendanceByDay.get(key(mid, date)) || null;
    if (leave) return { code: code && code !== 'leave' ? code : 'leave', label: `${leave.leave_type.name}${leave.is_half_day ? ' (half day)' : ''}`, leave_type: leave.leave_type.name, full_leave: !leave.is_half_day };
    return { code, label: code ? ATTENDANCE_LABEL[code] || code : null, leave_type: null, full_leave: code === 'leave' };
  };
  const identity = (mid) => {
    const m = memberById.get(mid);
    return { org_membership_id: mid, employee_code: m?.employee_code || null, name: m?.person?.name || '—', department: m?.department?.name || null, shift: m?.shift?.name || null };
  };

  let rows = records.map((r) => {
    const st = statusOf(r.org_membership_id, r.date);
    return {
      ...view(r),
      ...identity(r.org_membership_id),
      office: r.location_id ? locationById.get(r.location_id) || null : null,
      comparison: compare(r),
      attendance_status: st.code,
      attendance_label: st.label,
      leave_type: st.leave_type,
      flags: st.full_leave ? ['leave_but_checked_in'] : [],
    };
  });
  if (q.mismatch_only) rows = rows.filter((r) => NOT_AS_PLANNED.includes(r.comparison));

  // Days the person was meant to work (attendance says present / half day / work from home, or on leave) with no check-in at all.
  const missing = [];
  if (wantsMissing) {
    const checked = new Set(records.map((r) => key(r.org_membership_id, r.date)));
    const rosterById = new Map(roster.map((m) => [m.id, m]));
    for (const a of attendance) {
      const k = key(a.org_membership_id, a.date);
      const m = rosterById.get(a.org_membership_id);
      if (!m || checked.has(k) || a.status === 'holiday' || a.status === 'absent') continue;
      const planned = choiceByDay.get(k) || (m.work_mode === 'remote' || a.status === 'wfh' ? 'home' : 'office');
      if (q.planned_place && q.planned_place !== planned) continue;
      const st = statusOf(a.org_membership_id, a.date);
      const onLeave = st.full_leave || a.status === 'leave';
      missing.push({
        id: null,
        date: a.date.toISOString().slice(0, 10),
        ...identity(a.org_membership_id),
        office: m.location_id ? locationById.get(m.location_id) || null : null,
        planned_place: planned,
        check_in_at: null,
        check_out_at: null,
        check_in_result: null,
        late_minutes: 0,
        has_photo: false,
        sessions: [],
        out_of_desk_minutes: 0,
        break_count: 0,
        worked_minutes: 0,
        comparison: onLeave ? 'on_leave' : 'no_checkin',
        attendance_status: st.code,
        attendance_label: st.label,
        leave_type: st.leave_type,
        flags: onLeave ? [] : ['present_no_checkin'],
      });
    }
  }
  let all = q.no_checkin_only ? [...missing] : [...rows, ...missing];
  if (q.attendance_status) all = all.filter((r) => r.attendance_status === q.attendance_status || (q.attendance_status === 'leave' && r.leave_type));
  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)));

  const checkIns = all.filter((r) => r.id);
  const late = checkIns.filter((r) => r.late_minutes > 0);
  const missingRows = all.filter((r) => r.flags.includes('present_no_checkin'));
  const summary = {
    check_ins: checkIns.length,
    late: late.length,
    avg_late_minutes: late.length ? Math.round(late.reduce((s, r) => s + r.late_minutes, 0) / late.length) : 0,
    outside_office: checkIns.filter((r) => r.check_in_result === 'outside_office').length,
    work_from_home: checkIns.filter((r) => r.check_in_result === 'work_from_home').length,
    location_unavailable: checkIns.filter((r) => r.check_in_result === 'location_unavailable').length,
    office_day_outside: checkIns.filter((r) => r.comparison === 'office_day_outside').length,
    home_day_at_office: checkIns.filter((r) => r.comparison === 'home_day_at_office').length,
    not_as_planned: checkIns.filter((r) => NOT_AS_PLANNED.includes(r.comparison)).length,
    no_checkin: missingRows.length,
    leave_but_checked_in: checkIns.filter((r) => r.flags.includes('leave_but_checked_in')).length,
    avg_out_of_desk_minutes: checkIns.length ? Math.round(checkIns.reduce((s, r) => s + r.out_of_desk_minutes, 0) / checkIns.length) : 0,
  };

  // Per person: how often late, how late on average, how often no check-in on a working day.
  const perPerson = new Map();
  const personOf = (r) => perPerson.get(r.org_membership_id) || { org_membership_id: r.org_membership_id, name: r.name, employee_code: r.employee_code, days: 0, late_days: 0, late_total: 0, outside_days: 0, no_checkin_days: 0, out_of_desk_total: 0 };
  for (const r of checkIns) {
    const p = personOf(r);
    p.days += 1;
    if (r.late_minutes > 0) {
      p.late_days += 1;
      p.late_total += r.late_minutes;
    }
    if (r.check_in_result === 'outside_office') p.outside_days += 1;
    p.out_of_desk_total += r.out_of_desk_minutes;
    perPerson.set(r.org_membership_id, p);
  }
  for (const r of missingRows) {
    const p = personOf(r);
    p.no_checkin_days += 1;
    perPerson.set(r.org_membership_id, p);
  }
  const people = [...perPerson.values()]
    .map(({ late_total, out_of_desk_total, ...p }) => ({ ...p, avg_late_minutes: p.late_days ? Math.round(late_total / p.late_days) : 0, avg_out_of_desk_minutes: p.days ? Math.round(out_of_desk_total / p.days) : 0 }))
    .sort((a, b) => b.late_days - a.late_days || b.avg_late_minutes - a.avg_late_minutes || b.no_checkin_days - a.no_checkin_days);

  return { rows: all, summary, people };
}

// ----- Register (HR / admin): every employee x every day of a month -----
// One row per current employee, one cell per day: what attendance says (present / leave / holiday / weekly off) beside what the person
// did at the workplace (where and when they checked in and out, time out of desk). A working day with no check-in is "missing".
// Read only: attendance is only read, never written.
async function register(orgId, user, { year, month }) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  // The route is already limited to people who read this report, so the register covers everyone, not just direct reports.
  const [attendance, records] = await Promise.all([
    attendanceDashboard.register(orgId, { ...user, role: 'admin' }, { year, month, status: 'current' }),
    prisma.locationCheckin.findMany({ where: { org_id: orgId, date: { gte: from, lte: to } }, include: withSessions }),
  ]);
  const byDay = new Map(records.map((r) => [`${r.org_membership_id}|${r.date.toISOString().slice(0, 10)}`, r]));
  const people = attendance.people.map((p) => {
    const totals = { checked_in: 0, missing: 0, late: 0, away: 0, no_location: 0, leave_but_checked_in: 0, out_of_desk_minutes: 0 };
    const days = p.days.map((d) => {
      const rec = byDay.get(`${p.org_membership_id}|${d.date}`);
      const cell = { date: d.date, weekday: d.weekday, attendance_code: d.code, attendance_kind: d.kind, attendance_label: d.label, checkin: null, state: 'none', flags: [] };
      if (rec) {
        const t = dayTotals(rec.sessions);
        const onLeave = d.kind === 'leave' && !String(d.code).includes('½');
        cell.checkin = {
          id: rec.id,
          planned_place: rec.planned_place,
          first_in: rec.check_in_at,
          last_out: rec.check_out_at,
          result: rec.check_in_result,
          late_minutes: rec.late_minutes,
          comparison: compare(rec),
          ...t,
        };
        cell.state = 'checked_in';
        if (onLeave) cell.flags.push('leave_but_checked_in');
        totals.checked_in += 1;
        totals.out_of_desk_minutes += t.out_of_desk_minutes;
        if (rec.late_minutes > 0) totals.late += 1;
        if (rec.check_in_result === 'outside_office') totals.away += 1;
        if (rec.check_in_result === 'location_unavailable') totals.no_location += 1;
        if (onLeave) totals.leave_but_checked_in += 1;
      } else if (d.in_employment && d.date <= attendance.today && d.day_type === 'working' && !['holiday', 'weekly_off'].includes(d.kind) && !(d.kind === 'leave' && !String(d.code).includes('½'))) {
        // a working day, not a full day of leave: they were meant to check in
        cell.state = 'missing';
        totals.missing += 1;
      } else if (d.kind === 'leave') cell.state = 'leave';
      else if (d.kind === 'holiday' || d.kind === 'weekly_off') cell.state = 'off';
      return cell;
    });
    return { org_membership_id: p.org_membership_id, name: p.name, employee_code: p.employee_code, department: p.department, days, totals };
  });
  return { year, month, today: attendance.today, days: attendance.days, people };
}

const COMPARISON_LABEL = {
  as_planned: 'As planned',
  office_day_outside: 'Office day, checked in away from office',
  home_day_at_office: 'Home day, checked in at office',
  no_location: 'Office day, no location',
  wfh_no_location: 'Home day, no location',
  no_checkin: 'Working day, no check-in',
  on_leave: 'On leave',
};
const RESULT_LABEL = { in_office: 'In office', outside_office: 'Outside office', work_from_home: 'Work from home', location_unavailable: 'Location unavailable' };

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const hhmm = (instant, tz) => {
  if (!instant) return '';
  const m = minutesOfDayInZone(instant, tz);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function toCsv(rows, timeZone = 'Asia/Kolkata') {
  const head = ['Date', 'Employee code', 'Employee', 'Department', 'Shift', 'Attendance status', 'Planned', 'First check-in', 'Last check-out', 'Late (min)', 'Check-in result', 'Distance from office (m)', 'Accuracy (m)', 'Comparison', 'Sessions', 'Out of desk (min)', 'Breaks', 'Office', 'Latitude', 'Longitude'];
  const lines = rows.map((r) =>
    [r.date, r.employee_code, r.name, r.department, r.shift, r.attendance_label, r.planned_place === 'home' ? 'Work from home' : 'Work from office', hhmm(r.check_in_at, timeZone), hhmm(r.check_out_at, timeZone), r.late_minutes, RESULT_LABEL[r.check_in_result] || r.check_in_result, r.check_in_distance_m, r.check_in_accuracy_m, COMPARISON_LABEL[r.comparison] || r.comparison, (r.sessions || []).length, r.out_of_desk_minutes, r.break_count, r.office, r.check_in_lat, r.check_in_lng]
      .map(csvCell)
      .join(',')
  );
  return [head.map(csvCell).join(','), ...lines].join('\n');
}

// The selfie of one record (the day's first check-in) or of one session, for the person it belongs to or a report reader.
// Nothing else in /uploads serves these files.
async function selfiePath(orgId, recordId) {
  const row = await prisma.locationCheckin.findFirst({ where: { id: recordId, org_id: orgId }, select: { check_in_photo: true, org_membership_id: true } });
  if (!row || !row.check_in_photo) return { error: 'not_found' };
  return { file: path.resolve(env.uploadDir, row.check_in_photo), org_membership_id: row.org_membership_id };
}

async function sessionSelfiePath(orgId, sessionId) {
  const row = await prisma.locationCheckinSession.findFirst({ where: { id: sessionId, org_id: orgId }, select: { in_photo: true, org_membership_id: true } });
  if (!row || !row.in_photo) return { error: 'not_found' };
  return { file: path.resolve(env.uploadDir, row.in_photo), org_membership_id: row.org_membership_id };
}

module.exports = {
  BREAK_REASONS,
  distanceMeters,
  lateness,
  getSettings,
  updateSettings,
  listShiftRules,
  saveShiftRule,
  listGeofences,
  saveGeofence,
  removeGeofence,
  today,
  checkIn,
  checkOut,
  listMine,
  updateSession,
  deleteSession,
  deleteDay,
  report,
  register,
  toCsv,
  selfiePath,
  sessionSelfiePath,
};
