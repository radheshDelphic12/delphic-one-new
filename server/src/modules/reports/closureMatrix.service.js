const { z } = require('zod');
const prisma = require('../../config/db');

// Client-wise / vendor-wise matrix: one row per client (or vendor) of every stage, one column per month, a count in each cell.
//   Client measures: projects (a project won = a contract added in Finance > Projects, by its agreement start date, else the day it was
//   created), joinings (candidates who joined on the client's requirements, by joining date), requirements (requirements closed).
//   Vendor measure: joinings (candidates sourced from the vendor who joined, by joining date).
// Every count is clickable: closureRecords() returns the records behind a cell, a row total, a column total or the grand total, built
// from the very same events as the counts, so the list always agrees with the number that was clicked.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 330 * 60 * 1000;
const RECORDS_LIMIT = 1000;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalEnum = (values) => z.preprocess((v) => (v === '' ? undefined : v), z.enum(values).optional());
const REQ_TYPES = ['managed_services', 'recruitment', 'project', 'internal_hiring'];
const STAGES = ['lead', 'meeting_scheduled', 'active', 'rescheduled', 'dropped'];

const matrixSchema = z.object({
  kind: z.enum(['client', 'vendor']),
  date_from: day,
  date_to: day,
  measure: optionalEnum(['projects', 'joinings', 'requirements']),
  req_type: optionalEnum(REQ_TYPES),
  account_stage: optionalEnum(STAGES),
  vendor_type: optionalEnum(['assets', 'bgv']),
  premium: optionalEnum(['yes', 'no']),
  search: z.string().trim().max(100).optional(),
  hide_empty: optionalEnum(['true']),
});
// The records behind one number: the same filters, narrowed to one client / vendor and / or one month.
const recordsSchema = matrixSchema.extend({
  account_id: z.preprocess((v) => (v === '' ? undefined : v), z.union([z.string().uuid(), z.literal('none')]).optional()),
  month: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}$/).optional()),
});

const istMonth = (value) => {
  const d = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const istDay = (value) => new Date(new Date(value).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
const plainMonth = (value) => new Date(value).toISOString().slice(0, 7);
const plainDay = (value) => new Date(value).toISOString().slice(0, 10);

function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const [ey, em] = to.slice(0, 7).split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push({ key: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTHS_SHORT[m - 1]} ${y}` });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 60) break;
  }
  return out;
}

// Reads everything the matrix and its records are built from: the row owners and one event per counted item.
async function collect(orgId, q) {
  const measure = q.kind === 'vendor' ? 'joinings' : q.measure === 'requirements' ? 'projects' : q.measure || 'projects';
  const months = monthsBetween(q.date_from, q.date_to);
  const first = new Date(`${months[0].key}-01T00:00:00.000+05:30`);
  const lastKey = months[months.length - 1].key;
  const [ly, lm] = lastKey.split('-').map(Number);
  const end = new Date(new Date(`${ly + (lm === 12 ? 1 : 0)}-${String(lm === 12 ? 1 : lm + 1).padStart(2, '0')}-01T00:00:00.000+05:30`).getTime() - 1);
  const inRange = { gte: first, lte: end };

  // Row owners: every client (or vendor) of the company, whatever its stage. Projects themselves are listed through their client.
  const accountWhere = {
    org_id: orgId,
    type: q.kind,
    is_project: false,
    ...(q.account_stage ? { stage: q.account_stage } : {}),
    ...(q.premium ? { is_premium: q.premium === 'yes' } : {}),
    ...(q.kind === 'vendor' && q.vendor_type ? { vendor_type: q.vendor_type } : {}),
    ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}),
  };
  const accounts = await prisma.account.findMany({ where: accountWhere, select: { id: true, name: true, stage: true, is_premium: true, vendor_type: true }, orderBy: { name: 'asc' } });
  const rows = new Map(accounts.map((a) => [a.id, { id: a.id, name: a.name, stage: a.stage, premium: a.is_premium, vendor_type: a.vendor_type, counts: {}, total: 0 }]));
  const unlinked = { id: null, name: 'Not linked to a client', stage: null, premium: false, vendor_type: null, counts: {}, total: 0 };
  const events = []; // { account_id, month, record }
  const add = (accountId, monthKey, record) => {
    if (!months.some((m) => m.key === monthKey)) return;
    const row = accountId ? rows.get(accountId) : unlinked;
    if (!row) return; // filtered out by the account filters
    row.counts[monthKey] = (row.counts[monthKey] || 0) + 1;
    row.total += 1;
    events.push({ account_id: accountId || null, month: monthKey, record: { ...record, party: row.name, party_id: row.id } });
  };

  if (measure === 'projects' || measure === 'requirements') {
    // "Projects won" = requirement tickets marked Won (closed), counted in the month they were closed
    const reqs = await prisma.requirement.findMany({
      where: { status: 'closed', closed_at: inRange, account: { org_id: orgId }, ...(q.req_type ? { req_type: q.req_type } : {}) },
      select: { id: true, title: true, req_type: true, account_id: true, closed_at: true },
    });
    for (const r of reqs) {
      add(r.account_id, istMonth(r.closed_at), { kind: 'requirement', id: r.id, title: r.title, subtitle: r.req_type ? r.req_type.replace(/_/g, ' ') : null, date: istDay(r.closed_at), date_label: 'Won on', path: `/requirements/${r.id}` });
    }
  } else {
    const subs = await prisma.submission.findMany({
      where: {
        stage: 'closed',
        actual_joining_date: { gte: new Date(`${months[0].key}-01T00:00:00.000Z`), lte: new Date(Date.UTC(ly, lm, 0)) },
        ...(q.req_type ? { seat: { requirement: { req_type: q.req_type } } } : {}),
        ...(q.kind === 'vendor' ? { profile: { vendor_account_id: { not: null } } } : {}),
      },
      select: { id: true, actual_joining_date: true, seat: { select: { requirement: { select: { id: true, title: true, account_id: true } } } }, profile: { select: { name: true, vendor_account_id: true } } },
    });
    for (const s of subs) {
      const owner = q.kind === 'vendor' ? s.profile?.vendor_account_id : s.seat?.requirement?.account_id;
      add(owner, plainMonth(s.actual_joining_date), {
        kind: 'joining', id: s.id, title: s.profile?.name || 'Candidate', subtitle: s.seat?.requirement?.title || null,
        date: plainDay(s.actual_joining_date), date_label: 'Joined on', path: `/submissions/${s.id}`,
      });
    }
  }
  return { measure, months, rows, unlinked, events, accountsCount: accounts.length };
}

async function closureMatrix(orgId, input) {
  const q = matrixSchema.parse(input);
  const { measure, months, rows, unlinked, accountsCount } = await collect(orgId, q);
  let list = [...rows.values()];
  if (unlinked.total > 0 && !q.account_stage && !q.premium && !q.search) list.push(unlinked);
  if (q.hide_empty) list = list.filter((r) => r.total > 0);
  list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const totals = {};
  for (const r of list) for (const [k, n] of Object.entries(r.counts)) totals[k] = (totals[k] || 0) + n;
  return { kind: q.kind, measure, months, rows: list, totals, grand_total: list.reduce((a, r) => a + r.total, 0), accounts: accountsCount };
}

/** The records behind one number of the matrix (a cell, a row total, a column total or the grand total). */
async function closureRecords(orgId, input) {
  const q = recordsSchema.parse(input);
  const { measure, events, unlinked } = await collect(orgId, q);
  const showUnlinked = !q.account_stage && !q.premium && !q.search; // the "not linked" row only exists when no account filter is set
  let picked = events.filter((e) => (e.account_id ? true : showUnlinked));
  if (q.account_id) picked = picked.filter((e) => (q.account_id === 'none' ? e.account_id === null : e.account_id === q.account_id));
  if (q.month) picked = picked.filter((e) => e.month === q.month);
  picked.sort((a, b) => (a.record.date < b.record.date ? 1 : a.record.date > b.record.date ? -1 : a.record.title.localeCompare(b.record.title)));
  return { kind: q.kind, measure, total: picked.length, truncated: picked.length > RECORDS_LIMIT, records: picked.slice(0, RECORDS_LIMIT).map((e) => ({ ...e.record, month: e.month })), unlinked_total: unlinked.total };
}

module.exports = { closureMatrix, closureRecords, matrixSchema };
