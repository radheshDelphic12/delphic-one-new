const prisma = require('../../config/db');
const { dayKey, reportFrom, reportTo, optionalDateRange } = require('./reports.service');

/**
 * Report drill-down: the individual records behind one count in a report table.
 * The client sends back the identifiers of the row (person / account / day / month)
 * plus the report's current filters; each resolver rebuilds the same `where` the
 * report used for that count, so the list always adds up to the number clicked.
 */

const MAX_ROWS = 500;
const ACTIVE_REQUIREMENT_STATUSES = ['open', 'in_progress', 'on_hold'];
const SOURCE_LABEL = { direct: 'Bench', vendor: 'Vendor', linkedin: 'Market' };
const ACCOUNT_TYPE_LABEL = { client: 'Client', vendor: 'Vendor' };

const day = (value) => (value ? dayKey(value) : '—');
const dash = (value) => (value == null || value === '' ? '—' : value);
const titleCase = (value) => (value ? String(value).replace(/_/g, ' ') : '—');

// ---- date helpers --------------------------------------------------------------

/** One IST day (`date`), one IST month (`month` = YYYY-MM), else the report's own range. */
function rangeOf(q) {
  if (q.date) return { gte: reportFrom(q.date), lte: reportTo(q.date) };
  if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
    const [y, m] = q.month.split('-').map(Number);
    const last = String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
    return { gte: reportFrom(`${q.month}-01`), lte: reportTo(`${q.month}-${last}`) };
  }
  return optionalDateRange(q.date_from, q.date_to);
}

// ---- record shapes (every resolver returns one of these) -------------------------

const PROFILE_COLUMNS = [
  { key: 'name', label: 'Candidate' },
  { key: 'source', label: 'Type' },
  { key: 'sourcer', label: 'Sourced by' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'date', label: 'Sourced on' },
];
const PROFILE_INCLUDE = {
  added_by_user: { select: { name: true } },
  vendor_account: { select: { name: true } },
};
const profileRow = (p) => ({
  id: p.id,
  link: `/profiles/${p.id}`,
  name: p.name,
  source: dash(SOURCE_LABEL[p.source] || p.source),
  sourcer: dash(p.added_by_user?.name),
  vendor: dash(p.vendor_account?.name),
  date: day(p.created_at),
});

const SUBMISSION_INCLUDE = {
  profile: { select: { id: true, name: true } },
  submitted_by_user: { select: { name: true } },
  seat: { select: { requirement: { select: { title: true, account: { select: { name: true } } } } } },
};
const submissionColumns = (dateLabel, dateKey) => [
  { key: 'name', label: 'Candidate' },
  { key: 'requirement', label: 'Requirement' },
  { key: 'client', label: 'Client' },
  { key: 'stage', label: 'Stage' },
  { key: 'recruiter', label: 'Submitted by' },
  { key: dateKey, label: dateLabel },
];
const submissionRow = (s, dateKey = 'date', dateValue = s.created_at) => ({
  id: s.id,
  link: s.profile?.id ? `/profiles/${s.profile.id}` : null,
  name: dash(s.profile?.name),
  requirement: dash(s.seat?.requirement?.title),
  client: dash(s.seat?.requirement?.account?.name),
  stage: titleCase(s.stage),
  recruiter: dash(s.submitted_by_user?.name),
  [dateKey]: day(dateValue),
});

const REQUIREMENT_COLUMNS = [
  { key: 'title', label: 'Requirement' },
  { key: 'client', label: 'Client' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'sales_owner', label: 'Sales owner' },
  { key: 'date', label: 'Created' },
];
const REQUIREMENT_INCLUDE = {
  account: { select: { name: true } },
  sales_owner: { select: { name: true } },
};
const requirementRow = (r) => ({
  id: r.id,
  link: `/requirements/${r.id}`,
  title: r.title,
  client: dash(r.account?.name),
  status: titleCase(r.status),
  priority: titleCase(r.priority),
  sales_owner: dash(r.sales_owner?.name),
  date: day(r.created_at),
});

const ACCOUNT_COLUMNS = [
  { key: 'name', label: 'Account' },
  { key: 'type', label: 'Type' },
  { key: 'stage', label: 'Stage' },
  { key: 'brought_by', label: 'Brought by' },
  { key: 'owner', label: 'POC' },
  { key: 'date', label: 'Created' },
];
const ACCOUNT_INCLUDE = {
  owner: { select: { name: true } },
  origin_owner: { select: { name: true } },
};
const accountRow = (a, extra = {}) => ({
  id: extra.id || a.id,
  link: `/accounts/${a.id}`,
  name: a.name,
  type: dash(ACCOUNT_TYPE_LABEL[a.type] || (a.type ? titleCase(a.type) : 'Unclassified')),
  stage: titleCase(a.stage),
  brought_by: dash(a.origin_owner?.name),
  owner: dash(a.owner?.name),
  date: day(a.created_at),
  ...extra,
});

const ROUND_COLUMNS = [
  { key: 'name', label: 'Candidate' },
  { key: 'requirement', label: 'Requirement' },
  { key: 'client', label: 'Client' },
  { key: 'interviewer', label: 'Interviewer' },
  { key: 'result', label: 'Result' },
  { key: 'date', label: 'Round date' },
];

// ---- resolvers --------------------------------------------------------------------

const list = (title, columns, rows, total) => ({
  title,
  columns,
  rows,
  total,
  truncated: total > rows.length,
});

async function profiles(title, where) {
  const [total, rows] = await Promise.all([
    prisma.profile.count({ where }),
    prisma.profile.findMany({ where, include: PROFILE_INCLUDE, orderBy: { created_at: 'desc' }, take: MAX_ROWS }),
  ]);
  return list(title, PROFILE_COLUMNS, rows.map(profileRow), total);
}

async function submissions(title, where, { dateLabel = 'Submitted on', dateOf } = {}) {
  const [total, rows] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({ where, include: SUBMISSION_INCLUDE, orderBy: { created_at: 'desc' }, take: MAX_ROWS }),
  ]);
  return list(
    title,
    submissionColumns(dateLabel, 'date'),
    rows.map((s) => submissionRow(s, 'date', dateOf ? dateOf(s) : s.created_at)),
    total
  );
}

async function requirements(title, where) {
  const [total, rows] = await Promise.all([
    prisma.requirement.count({ where }),
    prisma.requirement.findMany({ where, include: REQUIREMENT_INCLUDE, orderBy: { created_at: 'desc' }, take: MAX_ROWS }),
  ]);
  return list(title, REQUIREMENT_COLUMNS, rows.map(requirementRow), total);
}

async function accounts(title, where) {
  const [total, rows] = await Promise.all([
    prisma.account.count({ where }),
    prisma.account.findMany({ where, include: ACCOUNT_INCLUDE, orderBy: { created_at: 'desc' }, take: MAX_ROWS }),
  ]);
  return list(title, ACCOUNT_COLUMNS, rows.map((a) => accountRow(a)), total);
}

async function rounds(title, where) {
  const [total, rows] = await Promise.all([
    prisma.interviewRound.count({ where }),
    prisma.interviewRound.findMany({
      where,
      orderBy: { scheduled_at: 'desc' },
      take: MAX_ROWS,
      select: {
        id: true,
        scheduled_at: true,
        result: true,
        interviewer_name: true,
        interviewers: { select: { user: { select: { name: true } } } },
        submission: {
          select: {
            profile: { select: { id: true, name: true } },
            seat: { select: { requirement: { select: { title: true, account: { select: { name: true } } } } } },
          },
        },
      },
    }),
  ]);
  return list(
    title,
    ROUND_COLUMNS,
    rows.map((r) => ({
      id: r.id,
      link: r.submission?.profile?.id ? `/profiles/${r.submission.profile.id}` : null,
      name: dash(r.submission?.profile?.name),
      requirement: dash(r.submission?.seat?.requirement?.title),
      client: dash(r.submission?.seat?.requirement?.account?.name),
      interviewer: dash(r.interviewers.map((i) => i.user?.name).filter(Boolean).join(', ') || r.interviewer_name),
      result: titleCase(r.result),
      date: day(r.scheduled_at),
    })),
    total
  );
}

/** Account stage events (account -> meeting_scheduled), one row per event like the report counts them. */
async function meetingEvents(title, q, { converted = false } = {}) {
  const range = rangeOf(q);
  const where = {
    entity_type: 'account',
    to_stage: 'meeting_scheduled',
    ...(range ? { changed_at: range } : {}),
    ...(q.person_id ? { changed_by: q.person_id } : {}),
    ...(q.client_id ? { entity_id: q.client_id } : {}),
  };
  const events = await prisma.stageHistory.findMany({ where, orderBy: { changed_at: 'desc' } });
  const accountRows = events.length
    ? await prisma.account.findMany({
        where: { id: { in: [...new Set(events.map((e) => e.entity_id))] }, ...(converted ? { stage: 'active' } : {}) },
        include: ACCOUNT_INCLUDE,
      })
    : [];
  const byId = new Map(accountRows.map((a) => [a.id, a]));
  // "Converted" counts each account once however often it was rescheduled; "scheduled" counts every event.
  const seen = new Set();
  const kept = events.filter((e) => {
    if (!byId.has(e.entity_id)) return false;
    if (!converted) return true;
    if (seen.has(e.entity_id)) return false;
    seen.add(e.entity_id);
    return true;
  });
  const rows = kept
    .slice(0, MAX_ROWS)
    .map((e) => accountRow(byId.get(e.entity_id), { id: e.id, date: day(e.changed_at) }));
  const total = kept.length;
  return list(title, ACCOUNT_COLUMNS.map((c) => (c.key === 'date' ? { ...c, label: 'Meeting scheduled on' } : c)), rows, total);
}

const profileScope = (q) => ({
  on_bench: false,
  ...(q.source ? { source: q.source } : {}),
});

const RESOLVERS = {
  // ---- HR report ----
  'hr:sourcing': (q) => {
    const range = rangeOf(q);
    return profiles('Profiles sourced', {
      ...profileScope(q),
      ...(range ? { created_at: range } : {}),
      ...(q.person_id ? { added_by: q.person_id } : {}),
    });
  },
  'hr:submissions': (q) => {
    const range = rangeOf(q);
    return submissions('Submissions', {
      ...(range ? { created_at: range } : {}),
      profile: { ...profileScope(q), ...(q.person_id ? { added_by: q.person_id } : {}) },
    });
  },
  'hr:round1_by_sourcer': (q) => hrRounds(q, { by: 'sourcer' }),
  'hr:round1_by_interviewer': (q) => hrRounds(q, { by: 'interviewer' }),

  // ---- Joinings ----
  'joinings:by_sourcer': (q) => joinedSubmissions(q, 'Joinings by sourcer', { profile: { added_by: q.person_id } }),
  'joinings:by_vendor': (q) => joinedSubmissions(q, 'Joinings by vendor', { profile: { vendor_account_id: q.person_id } }),
  'joinings:by_sales_poc': (q) =>
    joinedSubmissions(q, 'Joinings by sales POC', {
      seat: { requirement: { sales_owner_id: q.person_id || null } },
    }),
  'joinings:by_interviewer': (q) => {
    const types = q.metric === 'l1' ? ['internal_r1'] : q.metric === 'l2' ? ['internal_r2'] : ['internal_r1', 'internal_r2'];
    const interviewer = q.person_id
      ? { interviewers: { some: { user_id: q.person_id } } }
      : { interviewers: { none: {} }, interviewer_name: q.person_name || null };
    return joinedSubmissions(q, 'Joinings by interviewer', {
      interview_rounds: { some: { round_type: { in: types }, ...interviewer } },
    });
  },

  // ---- BDA reports ----
  'bda-reports:accounts_created': (q) => {
    const range = rangeOf(q);
    return accounts('Accounts brought', {
      origin_owner_id: q.person_id || { not: null },
      ...(q.client_id ? { id: q.client_id } : {}),
      ...(q.account_type ? { type: q.account_type === 'unclassified' ? null : q.account_type } : {}),
      ...(range ? { created_at: range } : {}),
    });
  },
  'bda-reports:meetings_scheduled': (q) =>
    meetingEvents(q.metric === 'converted_to_active' ? 'Meetings converted to active' : 'Meetings scheduled', q, {
      converted: q.metric === 'converted_to_active',
    }),
  'bda-reports:meetings_conversion': (q) =>
    meetingEvents(q.metric === 'converted_to_active' ? 'Meetings converted to active' : 'Meetings scheduled', q, {
      converted: q.metric === 'converted_to_active',
    }),
  'bda-reports:requirements_brought_counts': (q) => {
    const range = rangeOf(q);
    return requirements('Requirements from BDA clients', {
      ...(range ? { created_at: range } : {}),
      account: {
        type: 'client',
        origin_owner_id: q.person_id || { not: null },
        ...(q.client_id ? { id: q.client_id } : {}),
      },
    });
  },

  // ---- Sales reports ----
  'sales-reports:requirements_created': (q) => {
    const range = rangeOf(q);
    return requirements('Requirements created', {
      sales_owner_id: q.person_id,
      ...(q.client_id ? { account_id: q.client_id } : {}),
      ...(range ? { created_at: range } : {}),
    });
  },
  'sales-reports:meetings_attended': (q) => {
    const range = rangeOf(q);
    return accounts('Meetings attended', {
      meeting_date: range || { not: null },
      meeting_attendees: { some: { user_id: q.person_id, user: { role: { in: ['sales', 'admin'] } } } },
      ...(q.client_id ? { id: q.client_id } : {}),
    });
  },
  'sales-reports:profiles_submitted_to_client': async (q) => {
    const range = rangeOf(q);
    const history = await prisma.stageHistory.findMany({
      where: { entity_type: 'submission', to_stage: 'submitted_to_client', ...(range ? { changed_at: range } : {}) },
      orderBy: { changed_at: 'asc' },
      select: { entity_id: true, changed_at: true },
    });
    const at = new Map();
    for (const h of history) if (!at.has(h.entity_id)) at.set(h.entity_id, h.changed_at);
    return submissions(
      'Profiles submitted to client',
      {
        id: { in: [...at.keys()] },
        seat: { requirement: { sales_owner_id: q.person_id, ...(q.client_id ? { account_id: q.client_id } : {}) } },
      },
      { dateLabel: 'Submitted to client on', dateOf: (s) => at.get(s.id) }
    );
  },

  // ---- Coverage reports ----
  'clients-without-requirements:main': (q) =>
    requirements('Active requirements', { account_id: q.account_id, status: { in: ACTIVE_REQUIREMENT_STATUSES } }),
  'recruiter-vendor-gaps:main': (q) => {
    const range = rangeOf(q);
    const profileWhere = {
      vendor_account_id: q.account_id,
      ...(q.recruiter_id ? { added_by: q.recruiter_id } : {}),
      ...(range ? { created_at: range } : {}),
    };
    // "Submitted" counts profiles that have at least one submission (not submissions).
    return q.metric === 'profiles_submitted'
      ? profiles('Profiles submitted from this vendor', { ...profileWhere, submissions: { some: {} } })
      : profiles('Profiles sourced from this vendor', profileWhere);
  },
};

function hrRounds(q, { by }) {
  const range = rangeOf(q);
  const where = {
    round_type: 'internal_r1',
    ...(range ? { scheduled_at: range } : {}),
    ...(q.metric === 'completed' ? { result: { in: ['pass', 'fail'] } } : {}),
    ...(q.metric === 'shortlisted' ? { result: 'pass' } : {}),
    submission: {
      profile: {
        ...profileScope(q),
        ...(by === 'sourcer' && q.person_id ? { added_by: q.person_id } : {}),
      },
    },
    ...(by === 'interviewer' && q.person_id ? { interviewers: { some: { user_id: q.person_id } } } : {}),
    ...(by === 'interviewer' && !q.person_id
      ? { interviewers: { none: {} }, interviewer_name: q.person_name || null }
      : {}),
  };
  const label = { scheduled: 'Round 1 scheduled', completed: 'Round 1 completed', shortlisted: 'Round 1 shortlisted' };
  return rounds(label[q.metric] || label.scheduled, where);
}

function joinedSubmissions(q, title, extraWhere) {
  return submissions(
    title,
    { stage: 'closed', actual_joining_date: rangeOf(q), ...extraWhere },
    { dateLabel: 'Joined on', dateOf: (s) => s.actual_joining_date }
  );
}

/** Who may open a drill-down — the same roles that may open the report itself. */
const REPORT_ROLES = {
  hr: ['admin'],
  joinings: ['admin', 'sales'],
  'bda-reports': ['admin', 'bda'],
  'sales-reports': ['admin', 'sales'],
  'clients-without-requirements': ['admin', 'sales', 'bda'],
  'recruiter-vendor-gaps': ['admin', 'recruiter'],
};

async function drilldown(user, query) {
  const roles = REPORT_ROLES[query.report];
  if (!roles) return { error: 'unknown_report' };
  if (!roles.includes(user.role)) return { error: 'forbidden' };
  const resolver = RESOLVERS[`${query.report}:${query.table}`];
  if (!resolver) return { error: 'unknown_table' };

  const q = { ...query };
  // The reports scope these callers to their own rows; the drill-down must not widen that.
  if (query.report === 'bda-reports' && user.role === 'bda') q.person_id = user.id;
  if (query.report === 'sales-reports' && user.role === 'sales') q.person_id = user.id;
  if (query.report === 'recruiter-vendor-gaps' && user.role === 'recruiter') q.recruiter_id = user.id;
  if (query.report === 'clients-without-requirements' && user.role === 'bda') {
    const owned = await prisma.account.count({ where: { id: q.account_id, owner_id: user.id } });
    if (!owned) return { error: 'forbidden' };
  }

  return { data: await resolver(q) };
}

module.exports = { drilldown, REPORT_ROLES };
