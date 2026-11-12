const { z } = require('zod');
const prisma = require('../../config/db');

// Reports > Joining & attrition: who joined and who left the company in each month, with the joining rate and the attrition rate.
//   headcount      = people whose joined_at is on or before the day and whose left_at is empty or after the day
//   joining rate   = joiners in the period / average headcount of the period x 100
//   attrition rate = leavers in the period / average headcount of the period x 100   (annualised = x 12 / months in the period)
// Read-only; every count has a details list behind it (clickable in the screen).

const monthStr = z.string().regex(/^\d{4}-\d{2}$/, 'Use a month like 2026-11');
const optionalUuid = z.preprocess((v) => (v === '' || v === undefined ? undefined : v), z.string().uuid().optional());
const baseSchema = z.object({
  from: monthStr.optional(),
  to: monthStr.optional(),
  department_id: optionalUuid,
  include_contractors: z.preprocess((v) => v === true || v === 'true' || v === '1', z.boolean()).default(false),
});
const detailsSchema = baseSchema.extend({
  kind: z.enum(['joiners', 'leavers', 'headcount', 'early_leavers']),
  month: monthStr.optional(), // one month of the range; leave out for the whole range
});

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EARLY_MONTHS = 6; // leaving within this many months of joining counts as early attrition
const round1 = (n) => Math.round((n + Number.EPSILON) * 10) / 10;
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

function monthKey(y, m) { return `${y}-${String(m).padStart(2, '0')}`; }
function startOf(key) { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, 1)); }
function nextMonthStart(key) { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m, 1)); }

/** The months of the range, oldest first. Default: the last 12 months including this one. */
function monthsOf({ from, to }) {
  const now = new Date();
  const last = to || monthKey(now.getUTCFullYear(), now.getUTCMonth() + 1);
  let first = from;
  if (!first) {
    const [y, m] = last.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 12, 1));
    first = monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  if (first > last) return [];
  const out = [];
  let cursor = startOf(first);
  const end = startOf(last);
  while (cursor <= end && out.length < 60) {
    out.push(monthKey(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return out;
}

const labelOf = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTH_NAMES[m - 1]} ${y}`; };

async function loadPeople(orgId, { department_id, include_contractors }) {
  return prisma.orgMembership.findMany({
    where: {
      org_id: orgId,
      ...(department_id ? { department_id } : {}),
      ...(include_contractors ? {} : { worker_type: 'full_time_employee' }),
    },
    select: {
      id: true, employee_code: true, joined_at: true, left_at: true, employment_status: true, worker_type: true,
      department: { select: { id: true, name: true } }, designation: { select: { name: true } }, person: { select: { name: true } },
      resignation_requests: { select: { reason_category: true, status: true, created_at: true }, orderBy: { created_at: 'desc' }, take: 1 },
    },
  });
}

const present = (p, at) => p.joined_at && p.joined_at < at && (!p.left_at || p.left_at >= at); // on the payroll at the start of `at` (a day)
const inMonth = (date, key) => Boolean(date) && date >= startOf(key) && date < nextMonthStart(key);
const tenureMonths = (p) => (p.left_at ? Math.max(0, (p.left_at - p.joined_at) / (30.4375 * 86400000)) : null);

function reasonOf(p) {
  const r = p.resignation_requests?.[0];
  if (r?.reason_category) return r.reason_category;
  if (p.employment_status === 'terminated') return 'Terminated';
  return r ? 'Resigned (no reason category)' : 'Not recorded';
}

function metrics({ opening, joiners, leavers }) {
  const closing = opening + joiners - leavers;
  const avg = (opening + closing) / 2;
  return { opening, joiners, leavers, closing, average_headcount: round2(avg), joining_rate: avg > 0 ? round1((joiners / avg) * 100) : 0, attrition_rate: avg > 0 ? round1((leavers / avg) * 100) : 0 };
}

async function movement(orgId, query) {
  const q = baseSchema.parse(query || {});
  const months = monthsOf(q);
  if (!months.length) return { months: [], summary: null, departments: [], reasons: [], filters: q };
  const people = await loadPeople(orgId, q);
  const first = startOf(months[0]);
  const lastEnd = nextMonthStart(months[months.length - 1]);

  const monthly = months.map((key) => {
    const opening = people.filter((p) => present(p, startOf(key))).length;
    const joiners = people.filter((p) => inMonth(p.joined_at, key)).length;
    const leavers = people.filter((p) => inMonth(p.left_at, key)).length;
    return { key, label: labelOf(key), ...metrics({ opening, joiners, leavers }) };
  });

  const inRangeJoin = (p) => p.joined_at && p.joined_at >= first && p.joined_at < lastEnd;
  const inRangeLeft = (p) => p.left_at && p.left_at >= first && p.left_at < lastEnd;
  const opening = people.filter((p) => present(p, first)).length;
  const joiners = people.filter(inRangeJoin).length;
  const leavers = people.filter(inRangeLeft);
  const closing = opening + joiners - leavers.length;
  // average headcount over the range = mean of the monthly averages, so a big hiring month does not distort the rate
  const avg = monthly.reduce((s, m) => s + m.average_headcount, 0) / monthly.length;
  const early = leavers.filter((p) => tenureMonths(p) !== null && tenureMonths(p) < EARLY_MONTHS).length;
  const summary = {
    months: months.length, from: months[0], to: months[months.length - 1], opening, joiners, leavers: leavers.length, closing, average_headcount: round2(avg),
    joining_rate: avg > 0 ? round1((joiners / avg) * 100) : 0,
    attrition_rate: avg > 0 ? round1((leavers.length / avg) * 100) : 0,
    attrition_rate_annualised: avg > 0 ? round1(((leavers.length / avg) * 100 * 12) / months.length) : 0,
    early_leavers: early, early_months: EARLY_MONTHS,
    avg_tenure_of_leavers_months: leavers.length ? round1(leavers.reduce((s, p) => s + (tenureMonths(p) || 0), 0) / leavers.length) : null,
  };

  const deptMap = new Map();
  const ensure = (id, name) => { if (!deptMap.has(id)) deptMap.set(id, { department_id: id === 'none' ? null : id, department: name, opening: 0, joiners: 0, leavers: 0 }); return deptMap.get(id); };
  for (const p of people) {
    const row = () => ensure(p.department?.id || 'none', p.department?.name || 'No department');
    if (present(p, first)) row().opening += 1;
    if (inRangeJoin(p)) row().joiners += 1;
    if (inRangeLeft(p)) row().leavers += 1;
  }
  const departments = [...deptMap.values()].map((d) => ({ ...d, ...metrics(d) })).filter((d) => d.opening || d.joiners || d.leavers).sort((a, b) => b.leavers - a.leavers || a.department.localeCompare(b.department));

  const reasonMap = new Map();
  for (const p of leavers) reasonMap.set(reasonOf(p), (reasonMap.get(reasonOf(p)) || 0) + 1);
  const reasons = [...reasonMap.entries()].map(([reason, count]) => ({ reason, count, share: round1((count / leavers.length) * 100) })).sort((a, b) => b.count - a.count);

  return { filters: q, months: monthly, summary, departments, reasons };
}

/** The people behind a count. */
async function details(orgId, query) {
  const q = detailsSchema.parse(query || {});
  const months = monthsOf(q);
  if (!months.length) return { rows: [] };
  const people = await loadPeople(orgId, q);
  const scope = q.month ? [q.month] : months;
  const from = startOf(scope[0]);
  const to = nextMonthStart(scope[scope.length - 1]);
  const within = (d) => Boolean(d) && d >= from && d < to;
  let picked;
  if (q.kind === 'joiners') picked = people.filter((p) => within(p.joined_at));
  else if (q.kind === 'leavers') picked = people.filter((p) => within(p.left_at));
  else if (q.kind === 'early_leavers') picked = people.filter((p) => within(p.left_at) && tenureMonths(p) !== null && tenureMonths(p) < EARLY_MONTHS);
  else picked = people.filter((p) => present(p, to)); // headcount at the end of the period
  const rows = picked.map((p) => ({
    id: p.id, name: p.person?.name || '', employee_code: p.employee_code, department: p.department?.name || null, designation: p.designation?.name || null,
    joined_at: ymd(p.joined_at), left_at: ymd(p.left_at), tenure_months: p.left_at ? round1(tenureMonths(p)) : null, reason: p.left_at ? reasonOf(p) : null, worker_type: p.worker_type,
  })).sort((a, b) => String(b.left_at || b.joined_at).localeCompare(String(a.left_at || a.joined_at)));
  return { kind: q.kind, month: q.month || null, rows };
}

module.exports = { movement, details, baseSchema, detailsSchema, monthsOf };
