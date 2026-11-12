const prisma = require('../../config/db');
const { todayIst, dayKeyIst } = require('../../lib/istDate');

// Contractor check-in: a plain in / out clock for contractors. No location, no selfie, no late rule. Kept apart from attendance,
// payroll and the project timesheet: it reads who the person is and writes only to its own table.

const MAX_RANGE_DAYS = 93;

const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));

async function memberFor(orgId, membershipId) {
  return prisma.orgMembership.findFirst({ where: { id: membershipId, org_id: orgId }, select: { id: true, worker_type: true, employment_status: true } });
}

const isEligible = (m) => Boolean(m && m.worker_type === 'contractor' && ['active', 'notice_period'].includes(m.employment_status));

const sessionView = (s) => ({ id: s.id, in_at: s.in_at, out_at: s.out_at, edited: Boolean(s.edited_at) });

// One day's sessions as a row: first in, last out, time at work (closed sessions) and whether the person is in now.
function dayView(date, sessions) {
  const ordered = [...sessions].sort((a, b) => a.in_at - b.in_at);
  const worked = ordered.reduce((sum, s) => (s.out_at ? sum + minutesBetween(s.in_at, s.out_at) : sum), 0);
  const last = ordered[ordered.length - 1];
  return {
    date,
    first_in: ordered[0]?.in_at || null,
    last_out: last && last.out_at ? last.out_at : null,
    worked_minutes: worked,
    currently_in: Boolean(last && !last.out_at),
    sessions: ordered.map(sessionView),
  };
}

const dateKey = (d) => d.toISOString().slice(0, 10);

function groupByDay(rows) {
  const byDay = new Map();
  for (const r of rows) {
    const k = dateKey(r.date);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(r);
  }
  return byDay;
}

async function today(user) {
  const member = await memberFor(user.org_id, user.org_membership_id);
  if (!isEligible(member)) return { eligible: false };
  const date = todayIst();
  const rows = await prisma.contractorCheckin.findMany({ where: { org_membership_id: member.id, date }, orderBy: { in_at: 'asc' } });
  return { eligible: true, ...dayView(dateKey(date), rows) };
}

async function checkIn(user) {
  const member = await memberFor(user.org_id, user.org_membership_id);
  if (!isEligible(member)) return { error: 'not_eligible' };
  const date = todayIst();
  const open = await prisma.contractorCheckin.findFirst({ where: { org_membership_id: member.id, date, out_at: null } });
  if (open) return { error: 'already_checked_in' };
  await prisma.contractorCheckin.create({ data: { org_id: user.org_id, org_membership_id: member.id, date, in_at: new Date() } });
  return { day: await today(user) };
}

async function checkOut(user) {
  const member = await memberFor(user.org_id, user.org_membership_id);
  if (!isEligible(member)) return { error: 'not_eligible' };
  const date = todayIst();
  const open = await prisma.contractorCheckin.findFirst({ where: { org_membership_id: member.id, date, out_at: null }, orderBy: { in_at: 'desc' } });
  if (!open) return { error: 'not_checked_in' };
  await prisma.contractorCheckin.update({ where: { id: open.id }, data: { out_at: new Date() } });
  return { day: await today(user) };
}

async function listMine(user, { from, to }) {
  const rows = await prisma.contractorCheckin.findMany({ where: { org_membership_id: user.org_membership_id, date: { gte: from, lte: to } }, orderBy: { in_at: 'asc' } });
  return [...groupByDay(rows)].map(([date, list]) => dayView(date, list)).sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ----- Report (HR / admin) -----
async function people(orgId) {
  const rows = await prisma.orgMembership.findMany({
    where: { org_id: orgId, worker_type: 'contractor', employment_status: { in: ['active', 'notice_period'] } },
    select: { id: true, employee_code: true, person: { select: { name: true } } },
    orderBy: { person: { name: 'asc' } },
  });
  return rows.map((m) => ({ org_membership_id: m.id, employee_code: m.employee_code, name: m.person?.name || '—' }));
}

async function report(orgId, q) {
  const days = Math.round((q.to - q.from) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) return { error: 'range_too_long' };
  const rows = await prisma.contractorCheckin.findMany({
    where: { org_id: orgId, date: { gte: q.from, lte: q.to }, ...(q.org_membership_id ? { org_membership_id: q.org_membership_id } : {}) },
    orderBy: { in_at: 'asc' },
  });
  const ids = [...new Set(rows.map((r) => r.org_membership_id))];
  const members = await prisma.orgMembership.findMany({
    where: { id: { in: ids } },
    select: { id: true, employee_code: true, vendor_account_id: true, person: { select: { name: true } } },
  });
  const vendorIds = [...new Set(members.map((m) => m.vendor_account_id).filter(Boolean))];
  const vendors = vendorIds.length ? await prisma.account.findMany({ where: { id: { in: vendorIds }, org_id: orgId }, select: { id: true, name: true } }) : [];
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const memberById = new Map(members.map((m) => [m.id, m]));

  const perMember = new Map();
  for (const r of rows) {
    if (!perMember.has(r.org_membership_id)) perMember.set(r.org_membership_id, []);
    perMember.get(r.org_membership_id).push(r);
  }
  const out = [];
  for (const [mid, list] of perMember) {
    const m = memberById.get(mid);
    for (const [date, dayRows] of groupByDay(list)) {
      out.push({
        ...dayView(date, dayRows),
        org_membership_id: mid,
        employee_code: m?.employee_code || null,
        name: m?.person?.name || '—',
        vendor: m?.vendor_account_id ? vendorName.get(m.vendor_account_id) || null : null,
      });
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)));
  const summary = {
    days: out.length,
    contractors: perMember.size,
    worked_minutes: out.reduce((s, r) => s + r.worked_minutes, 0),
    still_in: out.filter((r) => r.currently_in).length,
  };
  return { rows: out, summary };
}

// ----- Admin: correct or remove a session (a reason is required and audited) -----
async function audit(user, action, row, reason, snapshot) {
  await prisma.auditLog.create({ data: { actor_id: user.id, action, entity_type: 'contractor_checkin', entity_id: row.id, reason, org_id: user.org_id || null, snapshot } });
}

const snap = (s) => ({ date: s.date, org_membership_id: s.org_membership_id, in_at: s.in_at, out_at: s.out_at });

async function updateSession(user, id, { in_at, out_at, reason }) {
  const s = await prisma.contractorCheckin.findFirst({ where: { id, org_id: user.org_id } });
  if (!s) return { error: 'not_found' };
  const inAt = in_at || s.in_at;
  const outAt = out_at === undefined ? s.out_at : out_at;
  if (dayKeyIst(inAt) !== dateKey(s.date)) return { error: 'wrong_day' };
  if (outAt && outAt <= inAt) return { error: 'bad_times' };
  const siblings = await prisma.contractorCheckin.findMany({ where: { org_membership_id: s.org_membership_id, date: s.date, id: { not: s.id } } });
  const end = outAt || inAt;
  const clash = siblings.some((o) => (!outAt && !o.out_at) || (inAt < (o.out_at || o.in_at) && end > o.in_at) || inAt.getTime() === o.in_at.getTime());
  if (clash) return { error: 'overlap' };
  const after = await prisma.contractorCheckin.update({ where: { id: s.id }, data: { in_at: inAt, out_at: outAt, edited_by: user.id, edited_at: new Date() } });
  await audit(user, 'edit_session', s, reason, { before: snap(s), after: snap(after) });
  return { session: sessionView(after) };
}

async function deleteSession(user, id, reason) {
  const s = await prisma.contractorCheckin.findFirst({ where: { id, org_id: user.org_id } });
  if (!s) return { error: 'not_found' };
  await audit(user, 'delete_session', s, reason, { before: snap(s) });
  await prisma.contractorCheckin.delete({ where: { id: s.id } });
  return { ok: true };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const hhmm = (instant) => {
  if (!instant) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
  return parts;
};

function toCsv(rows) {
  const head = ['Date', 'Employee code', 'Contractor', 'Vendor', 'First check-in', 'Last check-out', 'Time at work (min)', 'Sessions'];
  const lines = rows.map((r) => [r.date, r.employee_code, r.name, r.vendor, hhmm(r.first_in), hhmm(r.last_out), r.worked_minutes, r.sessions.length].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...lines].join('\n');
}

module.exports = { today, checkIn, checkOut, listMine, people, report, updateSession, deleteSession, toCsv };
