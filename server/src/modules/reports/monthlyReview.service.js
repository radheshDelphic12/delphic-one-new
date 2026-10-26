// Monthly performance review: one block per employee, one row per month since they joined (or since the chosen start month).
// Every row carries attendance (working days, present days) and the measures of the person's function, and every measure is a
// list of records, so the count and the drill-down are always the same rows:
//   Sales : client meetings scheduled, clients that became Active, requirements brought / owned / won, meetings attended, profiles submitted
//   HR    : profiles submitted to the client, joinings, vendors onboarded (Active)
//   IT    : active projects, billable and non-billable projects (from the allocations and the billing rates)
// The function comes from the person's department.

const prisma = require('../../config/db');
const dashboard = require('../timesheets/dashboard.service');
const attendance = require('../attendanceDashboard/attendanceDashboard.service');
const { todayIst } = require('../../lib/istDate');

const ymd = (d) => d.toISOString().slice(0, 10);
const monthKey = (d) => d.toISOString().slice(0, 7);
const MAX_MONTHS = 36;

const FUNCTIONS = ['sales', 'hr', 'it', 'other'];
function functionOf(departmentName) {
  const n = String(departmentName || '').toLowerCase();
  if (/sales|business dev|\bbd\b|\bbda\b/.test(n)) return 'sales';
  if (/\bhr\b|human|recruit|talent/.test(n)) return 'hr';
  if (/\bit\b|tech|engineer|develop|software|infra|product/.test(n)) return 'it';
  return 'other';
}

const METRICS = {
  meetings_scheduled: { label: 'Client meetings scheduled', fn: 'sales' },
  clients_active: { label: 'Meetings that became Active clients', fn: 'sales' },
  req_brought: { label: 'Requirements (brought by them)', fn: 'sales' },
  req_brought_won: { label: 'Closures on their clients (requirements won)', fn: 'sales' },
  req_owned_live: { label: 'Requirements owned (running)', fn: 'sales' },
  req_owned: { label: 'Requirements created (as owner)', fn: 'sales' },
  req_owned_won: { label: 'Won (as owner)', fn: 'sales' },
  meetings_attended: { label: 'Meetings attended', fn: ['sales', 'hr'] },
  submitted_on_owned: { label: 'Profiles submitted to client (their requirements)', fn: 'sales' },
  joinings_owned: { label: 'Joinings (their requirements)', fn: 'sales' },
  profiles_submitted: { label: 'Profiles submitted to client', fn: 'hr' },
  interviews_taken: { label: 'Interviews taken', fn: 'hr' },
  interviews_shortlisted: { label: 'Shortlisted in interviews', fn: 'hr' },
  interviews_joined: { label: 'Shortlisted who joined finally', fn: 'hr' },
  joinings: { label: 'Joinings', fn: 'hr' },
  vendors_onboarded: { label: 'Vendors onboarded', fn: 'hr' },
  projects_active: { label: 'Active projects', fn: 'it' },
  projects_billable: { label: 'Billable projects', fn: 'it' },
  projects_non_billable: { label: 'Non-billable projects', fn: 'it' },
  projects_daily: { label: 'Avg projects per day', fn: 'it' },
};

// What each function sees, in this order.
const ORDER = {
  sales: ['meetings_scheduled', 'clients_active', 'req_brought', 'req_brought_won', 'req_owned_live', 'req_owned', 'req_owned_won', 'meetings_attended', 'submitted_on_owned', 'joinings_owned'],
  hr: ['profiles_submitted', 'interviews_taken', 'interviews_shortlisted', 'interviews_joined', 'joinings', 'vendors_onboarded', 'meetings_attended'],
  it: ['projects_active', 'projects_billable', 'projects_non_billable', 'projects_daily'],
  other: [],
};

function monthsBetween(fromKey, toKey) {
  const out = [];
  let [y, m] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < MAX_MONTHS) {
    out.push({ year: y, month: m, key: `${y}-${String(m).padStart(2, '0')}` });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
const bounds = (fromKey, toKey) => {
  const [fy, fm] = fromKey.split('-').map(Number);
  const [ty, tm] = toKey.split('-').map(Number);
  return { from: new Date(Date.UTC(fy, fm - 1, 1)), to: new Date(Date.UTC(ty, tm, 1) - 1) };
};

const REQ_SELECT = { id: true, title: true, account: { select: { name: true } } };

// First day each account turned Active (stage history), else the day it was created.
async function activationDates(accounts) {
  const ids = accounts.map((a) => a.id);
  const rows = ids.length ? await prisma.stageHistory.findMany({ where: { entity_type: 'account', to_stage: 'active', entity_id: { in: ids } }, orderBy: { changed_at: 'asc' }, select: { entity_id: true, changed_at: true } }) : [];
  const first = new Map();
  for (const r of rows) if (!first.has(r.entity_id)) first.set(r.entity_id, r.changed_at);
  return new Map(accounts.map((a) => [a.id, first.get(a.id) || a.created_at]));
}

// Meetings the person was tagged on: a client's first meeting (account meeting) and the extra client meetings on the calendar.
async function meetingItems(orgId, userId, dateRange, push) {
  const attended = await prisma.accountMeetingAttendee.findMany({ where: { user_id: userId, account: { org_id: orgId, meeting_date: dateRange } }, select: { account: { select: { name: true, meeting_date: true } } } });
  for (const a of attended) push('meetings_attended', a.account.meeting_date, a.account.name, 'Client meeting');
  const extra = await prisma.clientMeetingAttendee.findMany({ where: { user_id: userId, meeting: { scheduled_at: dateRange, status: { not: 'cancelled' }, account: { org_id: orgId } } }, select: { meeting: { select: { title: true, scheduled_at: true, account: { select: { name: true } } } } } });
  for (const x of extra) push('meetings_attended', x.meeting.scheduled_at, x.meeting.account?.name || 'Client', x.meeting.title);
}

// "Submitted to client" events of the given submissions inside the range.
async function submittedEvents(submissionWhere, range) {
  const subs = await prisma.submission.findMany({ where: submissionWhere, select: { id: true, profile: { select: { name: true } }, seat: { select: { requirement: { select: { title: true, account: { select: { name: true } } } } } } } });
  if (!subs.length) return [];
  const byId = new Map(subs.map((s) => [s.id, s]));
  const events = await prisma.stageHistory.findMany({ where: { entity_type: 'submission', to_stage: 'submitted_to_client', entity_id: { in: [...byId.keys()] }, changed_at: { gte: range.from, lte: range.to } }, select: { entity_id: true, changed_at: true } });
  return events.map((e) => {
    const s = byId.get(e.entity_id);
    const req = s.seat?.requirement;
    return { date: e.changed_at, title: s.profile?.name || 'Profile', sub: [req?.title, req?.account?.name].filter(Boolean).join(' Â· ') };
  });
}

// All records behind a person's measures, for the months in `range` (dates). `opts.billable` / `opts.nonBillable` narrow the IT projects.
async function loadItems(orgId, member, fn, range, opts) {
  const userId = member.user_id;
  const items = [];
  const push = (metric, date, title, sub, value, extra) => items.push({ metric, month: monthKey(date), date: ymd(date), title, sub: sub || '', value, extra });
  const dateRange = { gte: range.from, lte: range.to };

  if (fn === 'sales') {
    const meetingEvents = await prisma.stageHistory.findMany({ where: { entity_type: 'account', to_stage: 'meeting_scheduled', changed_by: userId, changed_at: dateRange }, orderBy: { changed_at: 'asc' }, select: { entity_id: true, changed_at: true } });
    const accs = meetingEvents.length ? await prisma.account.findMany({ where: { id: { in: [...new Set(meetingEvents.map((e) => e.entity_id))] }, org_id: orgId, type: 'client' }, select: { id: true, name: true, stage: true } }) : [];
    const accById = new Map(accs.map((a) => [a.id, a]));
    const converted = new Set();
    for (const e of meetingEvents) {
      const a = accById.get(e.entity_id);
      if (!a) continue;
      push('meetings_scheduled', e.changed_at, a.name, `Client now: ${a.stage.replace(/_/g, ' ')}`);
      if (a.stage === 'active' && !converted.has(a.id)) { converted.add(a.id); push('clients_active', e.changed_at, a.name, 'Active client'); }
    }
    const brought = await prisma.requirement.findMany({ where: { account: { origin_owner_id: userId, org_id: orgId }, created_at: dateRange }, select: { ...REQ_SELECT, created_at: true } });
    for (const r of brought) push('req_brought', r.created_at, r.title, r.account?.name);
    const owned = await prisma.requirement.findMany({ where: { sales_owner_id: userId, account: { org_id: orgId }, created_at: dateRange }, select: { ...REQ_SELECT, created_at: true } });
    for (const r of owned) push('req_owned', r.created_at, r.title, r.account?.name);
    // a requirement is won when a candidate on it has joined; counted once, in the month of the joining
    const wonWhere = (extra) => ({ stage: 'closed', actual_joining_date: dateRange, seat: { requirement: { account: { org_id: orgId }, ...extra } } });
    const wonSelect = { actual_joining_date: true, seat: { select: { requirement: { select: REQ_SELECT } } } };
    for (const [metric, extra] of [['req_brought_won', { account: { org_id: orgId, origin_owner_id: userId } }], ['req_owned_won', { sales_owner_id: userId }]]) {
      const rows = await prisma.submission.findMany({ where: wonWhere(extra), select: wonSelect });
      const seen = new Set();
      for (const s of rows) {
        const r = s.seat?.requirement;
        const key = `${r?.id}|${monthKey(s.actual_joining_date)}`;
        if (!r || seen.has(key)) continue;
        seen.add(key);
        push(metric, s.actual_joining_date, r.title, r.account?.name);
      }
    }
    await meetingItems(orgId, userId, dateRange, push);
    // requirements they own that were running during each month (created on or before it, not yet closed at its start)
    const live = await prisma.requirement.findMany({ where: { sales_owner_id: userId, account: { org_id: orgId }, created_at: { lte: range.to }, OR: [{ closed_at: null }, { closed_at: { gte: range.from } }] }, select: { ...REQ_SELECT, created_at: true, closed_at: true } });
    for (const mo of monthsBetween(monthKey(range.from), monthKey(range.to))) {
      const start = new Date(Date.UTC(mo.year, mo.month - 1, 1));
      const end = new Date(Date.UTC(mo.year, mo.month, 0, 23, 59, 59));
      for (const r of live) if (r.created_at <= end && (!r.closed_at || r.closed_at >= start)) push('req_owned_live', start, r.title, r.account?.name);
    }
    const joinedOwned = await prisma.submission.findMany({ where: wonWhere({ sales_owner_id: userId }), select: { actual_joining_date: true, profile: { select: { name: true } }, seat: { select: { requirement: { select: REQ_SELECT } } } } });
    for (const s of joinedOwned) push('joinings_owned', s.actual_joining_date, s.profile?.name || 'Candidate', [s.seat?.requirement?.title, s.seat?.requirement?.account?.name].filter(Boolean).join(' · '));
    for (const e of await submittedEvents({ seat: { requirement: { sales_owner_id: userId, account: { org_id: orgId } } } }, range)) push('submitted_on_owned', e.date, e.title, e.sub);
  }

  if (fn === 'hr') {
    await meetingItems(orgId, userId, dateRange, push);
    // Interviews the person took (tagged as an interviewer, held and not cancelled), those that ended in a shortlist (result pass), and
    // the shortlisted candidates who finally joined: each candidate is counted once per month, whatever the date of the joining.
    const rounds = await prisma.interviewRound.findMany({
      where: { deleted_at: null, status: { not: 'cancelled' }, scheduled_at: { gte: range.from, lte: new Date(Math.min(range.to.getTime(), Date.now())) }, interviewers: { some: { user_id: userId } }, submission: { seat: { requirement: { account: { org_id: orgId } } } } },
      select: { scheduled_at: true, result: true, round_name: true, round_type: true, submission: { select: { id: true, stage: true, actual_joining_date: true, profile: { select: { name: true } }, seat: { select: { requirement: { select: { title: true } } } } } } },
      orderBy: { scheduled_at: 'asc' },
    });
    const joinedSeen = new Set();
    for (const r of rounds) {
      const cand = r.submission?.profile?.name || 'Candidate';
      const sub = [r.round_name || String(r.round_type).replace(/_/g, ' '), r.submission?.seat?.requirement?.title].filter(Boolean).join(' · ');
      push('interviews_taken', r.scheduled_at, cand, sub);
      if (r.result === 'pass') {
        push('interviews_shortlisted', r.scheduled_at, cand, sub);
        const key = `${r.submission?.id}|${monthKey(r.scheduled_at)}`;
        if (r.submission?.stage === 'closed' && r.submission.actual_joining_date && !joinedSeen.has(key)) { joinedSeen.add(key); push('interviews_joined', r.scheduled_at, cand, `Joined ${ymd(r.submission.actual_joining_date)} · ${sub}`); }
      }
    }
    for (const e of await submittedEvents({ submitted_by: userId, seat: { requirement: { account: { org_id: orgId } } } }, range)) push('profiles_submitted', e.date, e.title, e.sub);
    const joined = await prisma.submission.findMany({ where: { submitted_by: userId, stage: 'closed', actual_joining_date: dateRange, seat: { requirement: { account: { org_id: orgId } } } }, select: { actual_joining_date: true, profile: { select: { name: true } }, seat: { select: { requirement: { select: REQ_SELECT } } } } });
    for (const s of joined) push('joinings', s.actual_joining_date, s.profile?.name || 'Candidate', [s.seat?.requirement?.title, s.seat?.requirement?.account?.name].filter(Boolean).join(' Â· '));
    const vendors = await prisma.account.findMany({ where: { org_id: orgId, type: 'vendor', stage: 'active', origin_owner_id: userId }, select: { id: true, name: true, created_at: true } });
    const when = await activationDates(vendors);
    for (const v of vendors) {
      const at = when.get(v.id);
      if (at >= range.from && at <= range.to) push('vendors_onboarded', at, v.name, 'Active vendor');
    }
  }

  if (fn === 'it') {
    const rows = await prisma.projectMemberAssignment.findMany({
      where: { org_id: orgId, org_membership_id: member.id },
      select: { start_date: true, end_date: true, account: { select: { id: true, name: true, project_name: true, project_code: true, agreement_start_date: true, agreement_end_date: true, billing_rates: { select: { rate: true, effective_from: true } } } } },
    });
    // A person is on a project only inside the project's own agreement dates too (Finance > Projects): from the later of the two starts to
    // the earlier of the two ends. Two contracts with the same name are told apart by their project code.
    const later = (a, b) => (a && b ? (a > b ? a : b) : a || b || null);
    const earlier = (a, b) => (a && b ? (a < b ? a : b) : a || b || null);
    for (const r of rows) {
      r.start_date = later(r.start_date, r.account.agreement_start_date);
      r.end_date = earlier(r.end_date, r.account.agreement_end_date);
    }
    const months = monthsBetween(monthKey(range.from), monthKey(range.to));
    for (const m of months) {
      const mFrom = new Date(Date.UTC(m.year, m.month - 1, 1));
      const mTo = new Date(Date.UTC(m.year, m.month, 0));
      const counted = [];
      const byProject = new Map();
      for (const r of rows) {
        if ((r.start_date && r.start_date > mTo) || (r.end_date && r.end_date < mFrom)) continue;
        const billable = r.account.billing_rates.some((b) => Number(b.rate) > 0 && b.effective_from <= mTo);
        if (billable ? !opts.billable : !opts.nonBillable) continue;
        const base = r.account.project_name || r.account.name;
        const name = r.account.project_code ? `${base} (${r.account.project_code})` : base;
        counted.push({ r, name });
        const p = byProject.get(r.account.id) || { name, billable, starts: [], ends: [], open: false };
        if (r.start_date) p.starts.push(r.start_date);
        if (r.end_date) p.ends.push(r.end_date); else p.open = true;
        byProject.set(r.account.id, p);
      }
      // one record per project for the month, with the dates the admin entered on the allocation (Finance > Project costing)
      for (const p of byProject.values()) {
        const start = p.starts.length ? new Date(Math.min(...p.starts)) : null;
        const end = p.open || !p.ends.length ? null : new Date(Math.max(...p.ends));
        const startedNow = Boolean(start && start >= mFrom);
        const endedNow = Boolean(end && end <= mTo);
        const extra = { start_date: start ? ymd(start) : null, end_date: end ? ymd(end) : null, state: endedNow ? 'ended_this_month' : startedNow ? 'started_this_month' : 'ongoing' };
        const kind = p.billable ? 'Billable' : 'Non-billable';
        push('projects_active', mFrom, p.name, kind, undefined, extra);
        push(p.billable ? 'projects_billable' : 'projects_non_billable', mFrom, p.name, kind, undefined, extra);
      }
      // every day from joining (or the 1st) to today (or month end): how many of those projects the person was on that day
      const today = todayIst();
      const dayFrom = member.joined_at && member.joined_at > mFrom ? member.joined_at : mFrom;
      const dayTo = mTo < today ? mTo : today;
      for (let t = dayFrom.getTime(); t <= dayTo.getTime(); t += 86400000) {
        const day = new Date(t);
        const names = [...new Set(counted.filter(({ r }) => (!r.start_date || r.start_date <= day) && (!r.end_date || r.end_date >= day)).map((c) => c.name))];
        // projects whose last day is this day, or that began on it
        const ended = [...new Set(counted.filter(({ r }) => r.end_date && ymd(r.end_date) === ymd(day)).map((c) => c.name))];
        const started = [...new Set(counted.filter(({ r }) => r.start_date && ymd(r.start_date) === ymd(day)).map((c) => c.name))];
        push('projects_daily', day, `${names.length} project${names.length === 1 ? '' : 's'}`, names.join(', '), names.length, { names, ended, started });
      }
    }
  }
  return items;
}

async function eligibleMembers(orgId, user, q) {
  const todayDate = todayIst();
  const visible = await dashboard.visibleMembers(orgId, user, { includeExited: true });
  const ids = visible.filter((m) => m.worker_type !== 'contractor' && !m.vendor_account_id).map((m) => m.id);
  const members = await prisma.orgMembership.findMany({
    where: { id: { in: ids }, org_id: orgId, ...(q.team_id ? { team_id: q.team_id } : {}) },
    select: {
      id: true, person_id: true, employee_code: true, joined_at: true, left_at: true, notice_end_date: true, employment_status: true, work_mode: true,
      team: { select: { id: true, name: true } },
      department: { select: { name: true } },
      person: { select: { id: true, name: true, department: { select: { name: true } } } },
    },
    orderBy: { person: { name: 'asc' } },
  });
  const search = String(q.search || '').trim().toLowerCase();
  const status = q.status || 'current';
  return members
    .map((m) => ({ ...m, user_id: m.person?.id, state: attendance.employmentState(m, todayDate), fn: functionOf(m.department?.name || m.person?.department?.name) }))
    .filter((m) => (status === 'all' ? true : status === 'current' ? m.state !== 'exited' : m.state === status))
    .filter((m) => !q.function || q.function === 'all' || m.fn === q.function)
    .filter((m) => !search || (m.person?.name || '').toLowerCase().includes(search) || (m.employee_code || '').toLowerCase().includes(search));
}

// The months a person is reviewed for: from the later of their joining month and the chosen start, to the earlier of the chosen end and their last month.
function monthsFor(m, q, todayKey) {
  const joinKey = m.joined_at ? monthKey(m.joined_at) : q.from_month || todayKey;
  const fromKey = q.from_month && q.from_month > joinKey ? q.from_month : joinKey;
  const last = m.left_at || (['terminated', 'notice_period'].includes(m.employment_status) ? m.notice_end_date : null);
  let toKey = q.to_month || todayKey;
  if (toKey > todayKey) toKey = todayKey;
  if (last && monthKey(last) < toKey) toKey = monthKey(last);
  return fromKey > toKey ? [] : monthsBetween(fromKey, toKey);
}

const CONCURRENCY = 4;
async function inBatches(list, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += CONCURRENCY) out.push(...(await Promise.all(list.slice(i, i + CONCURRENCY).map(fn))));
  return out;
}

const parseBool = (v, d) => (v === undefined || v === '' ? d : v === true || v === '1' || v === 'true');

async function review(orgId, user, q = {}) {
  const todayKey = monthKey(todayIst());
  const all = await eligibleMembers(orgId, user, q);
  const limit = Math.min(Math.max(Number(q.limit) || 10, 1), 50);
  const page = Math.max(Number(q.page) || 1, 1);
  const slice = all.slice((page - 1) * limit, page * limit);
  const opts = { billable: parseBool(q.include_billable, true), nonBillable: parseBool(q.include_non_billable, false) };

  const people = await inBatches(slice, async (m) => {
    const months = monthsFor(m, q, todayKey);
    const last = m.left_at || (['terminated', 'notice_period'].includes(m.employment_status) ? m.notice_end_date : null);
    const base = {
      org_membership_id: m.id, name: m.person?.name || 'Unknown', employee_code: m.employee_code || null, team: m.team?.name || null,
      department: m.department?.name || m.person?.department?.name || null, function: m.fn, joined_at: m.joined_at ? ymd(m.joined_at) : null,
      last_working_day: last ? ymd(last) : null, status: m.state,
    };
    if (!months.length) return { ...base, months: [] };
    const range = bounds(months[0].key, months[months.length - 1].key);
    const [items, att] = await Promise.all([
      loadItems(orgId, m, m.fn, range, opts),
      Promise.all(months.map((mo) => attendance.memberMonth(orgId, m, mo))),
    ]);
    const counts = new Map();
    for (const it of items) {
      if (it.metric === 'projects_daily') continue;
      counts.set(`${it.month}|${it.metric}`, (counts.get(`${it.month}|${it.metric}`) || 0) + 1);
    }
    // the daily measure is an average over the days of the month so far
    for (const mo of months) {
      const days = items.filter((it) => it.metric === 'projects_daily' && it.month === mo.key);
      if (days.length) counts.set(`${mo.key}|projects_daily`, Math.round((days.reduce((a, d) => a + d.value, 0) / days.length) * 10) / 10);
    }
    const metricKeys = (ORDER[m.fn] || []).filter((k) => !(k === 'projects_billable' && !opts.billable) && !(k === 'projects_non_billable' && !opts.nonBillable));
    return {
      ...base,
      months: months.map((mo, i) => {
        const { days, ...a } = att[i];
        return { key: mo.key, year: mo.year, month: mo.month, ...a, metrics: metricKeys.map((k) => ({ key: k, label: METRICS[k].label, count: counts.get(`${mo.key}|${k}`) || 0 })) };
      }).reverse(),
    };
  });

  const teams = await prisma.team.findMany({ where: { org_id: orgId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  return { page, limit, total: all.length, pages: Math.max(Math.ceil(all.length / limit), 1), people, teams, functions: FUNCTIONS };
}

// The records behind one count. `metric` 'attendance' lists the days of the month.
async function details(orgId, user, { org_membership_id: id, metric, year, month, include_billable, include_non_billable }) {
  const all = await eligibleMembers(orgId, user, { status: 'all' });
  const m = all.find((x) => x.id === id);
  if (!m) return { error: 'not_found' };
  const key = `${year}-${String(month).padStart(2, '0')}`;
  if (metric === 'attendance') {
    const a = await attendance.memberMonth(orgId, m, { year: Number(year), month: Number(month) });
    return { metric, label: 'Attendance', month: key, items: a.days.map((d) => ({ date: d.date, title: d.code || d.kind, sub: d.label || d.kind.replace(/_/g, ' '), kind: d.kind })), summary: { working_days: a.working_days, present: a.present, leave: a.leave, absent: a.absent } };
  }
  if (metric === 'daywise') {
    const opts = { billable: parseBool(include_billable, true), nonBillable: parseBool(include_non_billable, false) };
    const [items, a] = await Promise.all([loadItems(orgId, m, m.fn, bounds(key, key), opts), attendance.memberMonth(orgId, m, { year: Number(year), month: Number(month) })]);
    return { metric, label: 'Day-wise', month: key, function: m.fn, items: buildDays(key, a.days, items, ymd(todayIst())), summary: { working_days: a.working_days, present: a.present, leave: a.leave, absent: a.absent } };
  }
  if (!METRICS[metric]) return { error: 'bad_metric' };
  const range = bounds(key, key);
  const items = await loadItems(orgId, m, m.fn, range, { billable: parseBool(include_billable, true), nonBillable: parseBool(include_non_billable, false) });
  return { metric, label: METRICS[metric].label, month: key, items: items.filter((i) => i.metric === metric && i.month === key).map(({ date, title, sub, value, extra }) => ({ date, title, sub, ...(value !== undefined ? { value } : {}), ...(extra || {}) })) };
}

// Measures that sit on the first of the month (not on a day), so they have no place in the day-wise view.
const MONTH_LEVEL = new Set(['projects_active', 'projects_billable', 'projects_non_billable']);

// One month, day by day: the attendance of the day and what the person did that day (their function's records, or the projects for IT).
function buildDays(key, attDays, items, today) {
  const byDate = new Map();
  const day = (date) => {
    if (!byDate.has(date)) byDate.set(date, { date, attendance: null, projects: null, measures: new Map() });
    return byDate.get(date);
  };
  for (const d of attDays || []) {
    const date = String(d.date).slice(0, 10);
    if (monthKey(new Date(`${date}T00:00:00Z`)) === key) day(date).attendance = { kind: d.kind, label: d.label || String(d.kind).replace(/_/g, ' '), code: d.code || null };
  }
  for (const it of items) {
    if (it.month !== key || MONTH_LEVEL.has(it.metric)) continue;
    const d = day(it.date);
    if (it.metric === 'projects_daily') { d.projects = { count: it.value || 0, names: it.extra?.names || [], ended: it.extra?.ended || [], started: it.extra?.started || [] }; continue; }
    if (!d.measures.has(it.metric)) d.measures.set(it.metric, { key: it.metric, label: METRICS[it.metric].label, titles: [] });
    d.measures.get(it.metric).titles.push(it.title);
  }
  return [...byDate.values()]
    .filter((d) => d.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => ({ ...d, measures: [...d.measures.values()].map((x) => ({ ...x, count: x.titles.length })) }));
}

// The one-line text of a day's activity, for the exports.
function dayActivity(d) {
  const parts = d.measures.map((x) => `${x.label}: ${x.titles.join(', ')}`);
  if (d.projects) {
    parts.push(`Projects (${d.projects.count}): ${d.projects.names.join(', ') || '-'}`);
    if (d.projects.ended.length) parts.push(`Last day: ${d.projects.ended.join(', ')}`);
    if (d.projects.started.length) parts.push(`Started: ${d.projects.started.join(', ')}`);
  }
  return parts.join(' | ');
}

// Day by day for the filtered review (Excel second sheet, PDF second section): one row per employee and day that has attendance or activity.
// Stops at MAX_DAY_ROWS rows; `truncated` says so.
const MAX_DAY_ROWS = 20000;
async function exportDayRows(orgId, user, q = {}) {
  const todayKey = monthKey(todayIst());
  const today = ymd(todayIst());
  const all = (await eligibleMembers(orgId, user, q)).slice(0, 500);
  const opts = { billable: parseBool(q.include_billable, true), nonBillable: parseBool(q.include_non_billable, false) };
  const perPerson = await inBatches(all, async (m) => {
    const months = monthsFor(m, q, todayKey);
    if (!months.length) return [];
    const items = await loadItems(orgId, m, m.fn, bounds(months[0].key, months[months.length - 1].key), opts);
    const out = [];
    for (const mo of months) {
      const att = await attendance.memberMonth(orgId, m, mo);
      for (const d of buildDays(mo.key, att.days, items, today)) {
        out.push({
          'Employee code': m.employee_code || '', Employee: m.person?.name || 'Unknown', Team: m.team?.name || '', Function: m.fn.toUpperCase(),
          Month: mo.key, Date: d.date, Attendance: d.attendance ? d.attendance.label : '', 'Projects that day': d.projects ? d.projects.count : '', Activity: dayActivity(d),
        });
      }
    }
    return out;
  });
  const rows = perPerson.flat().filter((r) => r.Attendance || r.Activity);
  return { rows: rows.slice(0, MAX_DAY_ROWS), truncated: rows.length > MAX_DAY_ROWS };
}

// Every employee and month of the filtered review as flat rows, for the Excel / PDF export (all pages, at most 500 employees).
async function exportRows(orgId, user, q = {}) {
  const people = [];
  for (let page = 1; page <= 10; page += 1) {
    const r = await review(orgId, user, { ...q, page, limit: 50 });
    people.push(...r.people);
    if (page >= r.pages) break;
  }
  const rows = [];
  for (const p of people) {
    for (const m of p.months) {
      const row = {
        'Employee code': p.employee_code || '', Employee: p.name, Team: p.team || '', Function: p.function.toUpperCase(),
        Joined: p.joined_at || '', 'Last working day': p.last_working_day || '', Month: m.key,
        'Working days': m.working_days, Present: m.no_data ? 'Data not available' : m.present, Leave: m.no_data ? '' : m.leave, Absent: m.no_data ? '' : m.absent,
      };
      for (const x of m.metrics) row[x.label] = x.count;
      rows.push(row);
    }
  }
  // one shape for every row, so the sheet columns line up
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? ''])));
}

module.exports = { review, details, exportRows, exportDayRows, functionOf, METRICS };
