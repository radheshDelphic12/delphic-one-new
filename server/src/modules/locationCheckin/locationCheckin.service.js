const fs = require('fs');
const path = require('path');
const prisma = require('../../config/db');
const env = require('../../config/env');
const { todayIst } = require('../../lib/istDate');

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
});

const dropFile = (file) => {
  if (file?.path) fs.promises.unlink(file.path).catch(() => {});
};

// Today for the signed-in employee: whether they may use the feature, today's record, and what the day is planned as.
async function today(user) {
  const [member, settings] = await Promise.all([memberFor(user.org_id, user.org_membership_id), getSettings(user.org_id)]);
  if (!isEligible(member, settings)) return { eligible: false };
  const date = todayIst();
  const [record, planned, locationId, ruleCutoff] = await Promise.all([
    prisma.locationCheckin.findUnique({ where: { org_membership_id_date: { org_membership_id: member.id, date } } }),
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

async function checkIn(user, { latitude, longitude, accuracy_m }, uploaded) {
  let file = uploaded;
  const [member, settings] = await Promise.all([memberFor(user.org_id, user.org_membership_id), getSettings(user.org_id)]);
  if (!isEligible(member, settings)) {
    dropFile(file);
    return { error: 'not_eligible' };
  }
  const date = todayIst();
  const existing = await prisma.locationCheckin.findUnique({ where: { org_membership_id_date: { org_membership_id: member.id, date } }, select: { id: true } });
  if (existing) {
    dropFile(file);
    return { error: 'already_checked_in' };
  }
  // Selfie: required (no check-in without one), optional (kept if sent), or off (never kept).
  if (settings.selfie_mode === 'required' && !file) return { error: 'selfie_required' };
  if (settings.selfie_mode === 'off' && file) {
    dropFile(file);
    file = null;
  }

  const [planned, locationId, ruleCutoff] = await Promise.all([plannedPlace(user.org_id, member, date), officeOn(user.org_id, member, date), shiftRuleFor(user.org_id, member)]);
  const fence = locationId ? await prisma.officeGeofence.findUnique({ where: { org_id_location_id: { org_id: user.org_id, location_id: locationId } } }) : null;
  const { distance_m, at_office } = measure(fence, latitude, longitude);
  const now = new Date();
  const late = lateness(member.shift, settings.default_cutoff_minutes, now, member.org?.timezone || 'Asia/Kolkata', ruleCutoff);
  try {
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
        check_in_result: resultFor(planned, latitude, longitude, at_office),
        check_in_photo: file ? file.filename : null,
        cutoff_minutes: late.cutoff_minutes,
        late_minutes: late.late_minutes,
      },
    });
    return { record: view(row) };
  } catch (err) {
    dropFile(file);
    if (err.code === 'P2002') return { error: 'already_checked_in' };
    throw err;
  }
}

async function checkOut(user, { latitude, longitude, accuracy_m }) {
  const [member, settings] = await Promise.all([memberFor(user.org_id, user.org_membership_id), getSettings(user.org_id)]);
  if (!isEligible(member, settings)) return { error: 'not_eligible' };
  const date = todayIst();
  const record = await prisma.locationCheckin.findUnique({ where: { org_membership_id_date: { org_membership_id: member.id, date } } });
  if (!record) return { error: 'not_checked_in' };
  if (record.check_out_at) return { error: 'already_checked_out' };
  const fence = record.location_id ? await prisma.officeGeofence.findUnique({ where: { org_id_location_id: { org_id: user.org_id, location_id: record.location_id } } }) : null;
  const { distance_m, at_office } = measure(fence, latitude, longitude);
  const row = await prisma.locationCheckin.update({
    where: { id: record.id },
    data: {
      check_out_at: new Date(),
      check_out_lat: latitude ?? null,
      check_out_lng: longitude ?? null,
      check_out_accuracy_m: accuracy_m ?? null,
      check_out_distance_m: distance_m,
      check_out_at_office: at_office,
      check_out_result: resultFor(record.planned_place, latitude, longitude, at_office),
    },
  });
  return { record: view(row) };
}

async function listMine(user, { from, to }) {
  const rows = await prisma.locationCheckin.findMany({
    where: { org_membership_id: user.org_membership_id, date: { gte: from, lte: to } },
    orderBy: { date: 'desc' },
  });
  return rows.map(view);
}

// ----- Report (HR / admin) -----
// What the day was planned as against where the person actually was. `compare` is the plain-words comparison.
function compare(r) {
  const planned = r.planned_place;
  const where = r.check_in_at_office; // true office, false away, null unknown
  if (where == null) return planned === 'home' ? 'wfh_no_location' : 'no_location';
  if (planned === 'office') return where ? 'as_planned' : 'office_day_outside';
  return where ? 'home_day_at_office' : 'as_planned';
}

async function report(orgId, q) {
  const days = Math.round((q.to - q.from) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) return { error: 'range_too_long' };
  const where = { org_id: orgId, date: { gte: q.from, lte: q.to } };
  if (q.org_membership_id) where.org_membership_id = q.org_membership_id;
  if (q.location_id) where.location_id = q.location_id;
  if (q.planned_place) where.planned_place = q.planned_place;
  if (q.late_only) where.late_minutes = { gt: 0 };
  if (q.outside_only) where.check_in_result = 'outside_office';
  const records = await prisma.locationCheckin.findMany({ where, orderBy: [{ date: 'desc' }, { check_in_at: 'asc' }] });

  const memberIds = [...new Set(records.map((r) => r.org_membership_id))];
  const locationIds = [...new Set(records.map((r) => r.location_id).filter(Boolean))];
  const [members, locations] = await Promise.all([
    prisma.orgMembership.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, employee_code: true, person: { select: { name: true, email: true } }, department: { select: { name: true } }, shift: { select: { name: true } } },
    }),
    prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } }),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const locationById = new Map(locations.map((l) => [l.id, l.name]));

  let rows = records.map((r) => {
    const m = memberById.get(r.org_membership_id);
    return {
      ...view(r),
      org_membership_id: r.org_membership_id,
      employee_code: m?.employee_code || null,
      name: m?.person?.name || '—',
      department: m?.department?.name || null,
      shift: m?.shift?.name || null,
      office: r.location_id ? locationById.get(r.location_id) || null : null,
      comparison: compare(r),
    };
  });
  if (q.mismatch_only) rows = rows.filter((r) => r.comparison === 'office_day_outside' || r.comparison === 'home_day_at_office');

  const late = rows.filter((r) => r.late_minutes > 0);
  const summary = {
    check_ins: rows.length,
    late: late.length,
    avg_late_minutes: late.length ? Math.round(late.reduce((s, r) => s + r.late_minutes, 0) / late.length) : 0,
    outside_office: rows.filter((r) => r.check_in_result === 'outside_office').length,
    work_from_home: rows.filter((r) => r.check_in_result === 'work_from_home').length,
    location_unavailable: rows.filter((r) => r.check_in_result === 'location_unavailable').length,
    office_day_outside: rows.filter((r) => r.comparison === 'office_day_outside').length,
    home_day_at_office: rows.filter((r) => r.comparison === 'home_day_at_office').length,
  };

  // Per person: how often late, how late on average.
  const perPerson = new Map();
  for (const r of rows) {
    const p = perPerson.get(r.org_membership_id) || { org_membership_id: r.org_membership_id, name: r.name, employee_code: r.employee_code, days: 0, late_days: 0, late_total: 0, outside_days: 0 };
    p.days += 1;
    if (r.late_minutes > 0) {
      p.late_days += 1;
      p.late_total += r.late_minutes;
    }
    if (r.check_in_result === 'outside_office') p.outside_days += 1;
    perPerson.set(r.org_membership_id, p);
  }
  const people = [...perPerson.values()]
    .map(({ late_total, ...p }) => ({ ...p, avg_late_minutes: p.late_days ? Math.round(late_total / p.late_days) : 0 }))
    .sort((a, b) => b.late_days - a.late_days || b.avg_late_minutes - a.avg_late_minutes);

  return { rows, summary, people };
}

const COMPARISON_LABEL = {
  as_planned: 'As planned',
  office_day_outside: 'Office day, checked in away from office',
  home_day_at_office: 'Home day, checked in at office',
  no_location: 'Office day, no location',
  wfh_no_location: 'Home day, no location',
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
  const head = ['Date', 'Employee code', 'Employee', 'Department', 'Shift', 'Planned', 'Check-in', 'Check-out', 'Late (min)', 'Check-in result', 'Distance from office (m)', 'Accuracy (m)', 'Comparison', 'Office', 'Latitude', 'Longitude'];
  const lines = rows.map((r) =>
    [r.date, r.employee_code, r.name, r.department, r.shift, r.planned_place === 'home' ? 'Work from home' : 'Work from office', hhmm(r.check_in_at, timeZone), hhmm(r.check_out_at, timeZone), r.late_minutes, RESULT_LABEL[r.check_in_result] || r.check_in_result, r.check_in_distance_m, r.check_in_accuracy_m, COMPARISON_LABEL[r.comparison] || r.comparison, r.office, r.check_in_lat, r.check_in_lng]
      .map(csvCell)
      .join(',')
  );
  return [head.map(csvCell).join(','), ...lines].join('\n');
}

// The selfie file of one record, for the person it belongs to or a report reader. Nothing else in /uploads serves these files.
async function selfiePath(orgId, recordId) {
  const row = await prisma.locationCheckin.findFirst({ where: { id: recordId, org_id: orgId }, select: { check_in_photo: true, org_membership_id: true } });
  if (!row || !row.check_in_photo) return { error: 'not_found' };
  return { file: path.resolve(env.uploadDir, row.check_in_photo), org_membership_id: row.org_membership_id };
}

module.exports = {
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
  report,
  toCsv,
  selfiePath,
};
