const { z } = require('zod');
const prisma = require('../../config/db');

// Client-wise / vendor-wise matrix: one row per client (or vendor) of every stage, one column per month, a count in each cell.
//   Client measures: projects (a project won = a contract added in Finance > Projects, by its agreement start date, else the day it was
//   created), joinings (candidates who joined on the client's requirements, by joining date), requirements (requirements closed).
//   Vendor measure: joinings (candidates sourced from the vendor who joined, by joining date).
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 330 * 60 * 1000;
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

const istMonth = (value) => {
  const d = new Date(new Date(value).getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const plainMonth = (value) => new Date(value).toISOString().slice(0, 7);

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

async function closureMatrix(orgId, input) {
  const q = matrixSchema.parse(input);
  const measure = q.kind === 'vendor' ? 'joinings' : q.measure || 'projects';
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
  const add = (accountId, monthKey) => {
    if (!months.some((m) => m.key === monthKey)) return;
    const row = accountId ? rows.get(accountId) : unlinked;
    if (!row) return; // filtered out by the account filters
    row.counts[monthKey] = (row.counts[monthKey] || 0) + 1;
    row.total += 1;
  };

  if (measure === 'projects') {
    const projects = await prisma.account.findMany({
      where: { org_id: orgId, type: 'client', is_project: true, ...(q.req_type ? { service_category: q.req_type } : {}) },
      select: { client_account_id: true, agreement_start_date: true, created_at: true },
    });
    for (const p of projects) {
      const when = p.agreement_start_date ? plainMonth(p.agreement_start_date) : istMonth(p.created_at);
      add(p.client_account_id, when);
    }
  } else if (measure === 'requirements') {
    const reqs = await prisma.requirement.findMany({ where: { status: 'closed', closed_at: inRange, account: { org_id: orgId }, ...(q.req_type ? { req_type: q.req_type } : {}) }, select: { account_id: true, closed_at: true } });
    for (const r of reqs) add(r.account_id, istMonth(r.closed_at));
  } else {
    const subs = await prisma.submission.findMany({
      where: {
        stage: 'closed',
        actual_joining_date: { gte: new Date(`${months[0].key}-01T00:00:00.000Z`), lte: new Date(Date.UTC(ly, lm, 0)) },
        ...(q.req_type ? { seat: { requirement: { req_type: q.req_type } } } : {}),
        ...(q.kind === 'vendor' ? { profile: { vendor_account_id: { not: null } } } : {}),
      },
      select: { actual_joining_date: true, seat: { select: { requirement: { select: { account_id: true } } } }, profile: { select: { vendor_account_id: true } } },
    });
    for (const s of subs) add(q.kind === 'vendor' ? s.profile?.vendor_account_id : s.seat?.requirement?.account_id, plainMonth(s.actual_joining_date));
  }

  let list = [...rows.values()];
  if (unlinked.total > 0 && !q.account_stage && !q.premium && !q.search) list.push(unlinked);
  if (q.hide_empty) list = list.filter((r) => r.total > 0);
  list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const totals = {};
  for (const r of list) for (const [k, n] of Object.entries(r.counts)) totals[k] = (totals[k] || 0) + n;
  return { kind: q.kind, measure, months, rows: list, totals, grand_total: list.reduce((a, r) => a + r.total, 0), accounts: accounts.length };
}

module.exports = { closureMatrix, matrixSchema };
