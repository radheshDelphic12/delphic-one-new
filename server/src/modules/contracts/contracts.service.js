const { z } = require('zod');
const prisma = require('../../config/db');
const { num, round2, pageArgs, pagination } = require('../../lib/vertical');

const CURRENCY = z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']);
const optStr = (max = 300) => z.string().trim().max(max).optional().nullable();

const baseFields = {
  kind: z.enum(['construction', 'recurring', 'service']),
  title: z.string().trim().min(1).max(200),
  counterparty_name: z.string().trim().min(1).max(200),
  lead_id: z.string().uuid().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  value: z.coerce.number().min(0).default(0),
  currency: CURRENCY.default('INR'),
  start_date: z.coerce.date(),
  end_date: z.coerce.date().optional().nullable(),
  billing_frequency: z.enum(['one_time', 'monthly', 'quarterly', 'annual']).default('one_time'),
  recurring_amount: z.coerce.number().positive().optional().nullable(),
  progress_percent: z.coerce.number().int().min(0).max(100).default(0),
  billed_to_date: z.coerce.number().min(0).default(0),
  site_location: optStr(300),
  notes: optStr(2000),
};

function contractRules(v, ctx) {
  if (v.kind === 'recurring') {
    if (!v.recurring_amount) ctx.addIssue({ code: 'custom', path: ['recurring_amount'], message: 'Recurring contracts need a recurring amount' });
    if (v.billing_frequency === 'one_time') ctx.addIssue({ code: 'custom', path: ['billing_frequency'], message: 'Recurring contracts must bill monthly, quarterly or annually' });
  }
  if (v.end_date && v.end_date < v.start_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'end_date must not be before start_date' });
  if (v.value > 0 && v.billed_to_date > v.value) ctx.addIssue({ code: 'custom', path: ['billed_to_date'], message: 'Billed amount cannot exceed the contract value' });
}

const createContractSchema = z.object(baseFields).superRefine(contractRules);
const updateContractSchema = z.object(baseFields).partial();
const statusSchema = z.object({ status: z.enum(['active', 'completed', 'terminated']) });
const listQuerySchema = z.object({
  kind: z.enum(['construction', 'recurring', 'service']).optional(),
  status: z.enum(['draft', 'active', 'completed', 'terminated']).optional(),
  project_id: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const STATUS_TRANSITIONS = {
  draft: ['active', 'terminated'],
  active: ['completed', 'terminated'],
  completed: [],
  terminated: [],
};

const PERIOD_MONTHS = { monthly: 1, quarterly: 3, annual: 12 };

/** Monthly-equivalent revenue of a recurring contract (0 for anything else). */
function monthlyEquivalent(contract) {
  if (contract.kind !== 'recurring' || !contract.recurring_amount) return 0;
  const months = PERIOD_MONTHS[contract.billing_frequency];
  return months ? Number(contract.recurring_amount) / months : 0;
}

function covers(contract, monthStart, monthEnd) {
  // Contract is live for any part of [monthStart, monthEnd).
  if (new Date(contract.start_date) >= monthEnd) return false;
  return !contract.end_date || new Date(contract.end_date) >= monthStart;
}

function serialize(row) {
  return {
    ...row,
    value: num(row.value),
    recurring_amount: num(row.recurring_amount),
    billed_to_date: num(row.billed_to_date),
    monthly_equivalent: round2(monthlyEquivalent(row)),
    outstanding: num(row.value) ? round2(num(row.value) - num(row.billed_to_date)) : null,
  };
}

async function create(orgId, userId, body) {
  if (body.project_id) {
    const project = await prisma.selfProject.findFirst({ where: { id: body.project_id, org_id: orgId } });
    if (!project) return { error: 'project_not_found' };
  }
  const row = await prisma.contract.create({ data: { ...body, org_id: orgId, created_by: userId, status: 'draft' } });
  return { contract: serialize(row) };
}

async function list(orgId, { kind, status, project_id, search, page, limit }) {
  const where = {
    org_id: orgId,
    ...(kind ? { kind } : {}),
    ...(status ? { status } : {}),
    ...(project_id ? { project_id } : {}),
    ...(search
      ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { counterparty_name: { contains: search, mode: 'insensitive' } }] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: { project: { select: { id: true, name: true } } },
      orderBy: { created_at: 'desc' },
      ...pageArgs({ page, limit }),
    }),
    prisma.contract.count({ where }),
  ]);
  return { data: rows.map(serialize), pagination: pagination(page, limit, total) };
}

async function get(orgId, id) {
  const row = await prisma.contract.findFirst({ where: { id, org_id: orgId }, include: { project: { select: { id: true, name: true } } } });
  return row ? { contract: serialize(row) } : { error: 'not_found' };
}

async function update(orgId, id, patch) {
  const existing = await prisma.contract.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (existing.status === 'completed' || existing.status === 'terminated') return { error: 'contract_closed' };

  const merged = { ...existing, ...patch };
  const check = z.object(baseFields).superRefine(contractRules).safeParse({
    ...merged,
    value: Number(merged.value),
    recurring_amount: merged.recurring_amount === null ? null : Number(merged.recurring_amount),
    billed_to_date: Number(merged.billed_to_date),
  });
  if (!check.success) return { error: 'invalid', issues: check.error.issues };
  if (patch.project_id) {
    const project = await prisma.selfProject.findFirst({ where: { id: patch.project_id, org_id: orgId } });
    if (!project) return { error: 'project_not_found' };
  }
  const row = await prisma.contract.update({ where: { id }, data: patch });
  return { contract: serialize(row) };
}

async function changeStatus(orgId, id, { status }) {
  const existing = await prisma.contract.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (!STATUS_TRANSITIONS[existing.status].includes(status)) return { error: 'invalid_transition' };
  const row = await prisma.contract.update({
    where: { id },
    data: { status, ...(status === 'completed' ? { progress_percent: 100 } : {}) },
  });
  return { contract: serialize(row) };
}

/**
 * Portfolio view: current MRR/ARR, a 12-month expected-recurring-revenue
 * schedule (recurring contracts that are active and live in each month),
 * contracts ending soon, and construction billing progress.
 */
async function summary(orgId, now = new Date()) {
  const contracts = await prisma.contract.findMany({ where: { org_id: orgId } });
  const active = contracts.filter((c) => c.status === 'active');
  const recurring = active.filter((c) => c.kind === 'recurring');

  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const mrr = round2(recurring.filter((c) => covers(c, startOfMonth, nextMonth)).reduce((s, c) => s + monthlyEquivalent(c), 0));

  const schedule = [];
  for (let i = 0; i < 12; i += 1) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i + 1, 1));
    const live = recurring.filter((c) => covers(c, from, to));
    schedule.push({
      month: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`,
      expected_revenue: round2(live.reduce((s, c) => s + monthlyEquivalent(c), 0)),
      contracts: live.length,
    });
  }

  const byStatus = { draft: 0, active: 0, completed: 0, terminated: 0 };
  for (const c of contracts) byStatus[c.status] += 1;

  const soon = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const expiring = active
    .filter((c) => c.end_date && new Date(c.end_date) >= now && new Date(c.end_date) <= soon)
    .sort((a, b) => new Date(a.end_date) - new Date(b.end_date))
    .map((c) => ({ id: c.id, title: c.title, counterparty_name: c.counterparty_name, end_date: c.end_date, monthly_equivalent: round2(monthlyEquivalent(c)) }));

  const construction = active.filter((c) => c.kind === 'construction');
  const totalValue = construction.reduce((s, c) => s + Number(c.value), 0);
  const totalBilled = construction.reduce((s, c) => s + Number(c.billed_to_date), 0);

  return {
    mrr,
    arr: round2(mrr * 12),
    recurring_contracts: recurring.length,
    schedule,
    by_status: byStatus,
    expiring_soon: expiring,
    construction: {
      active: construction.length,
      total_value: round2(totalValue),
      billed_to_date: round2(totalBilled),
      outstanding: round2(totalValue - totalBilled),
      avg_progress: construction.length ? Math.round(construction.reduce((s, c) => s + c.progress_percent, 0) / construction.length) : 0,
    },
  };
}

/** Revenue recognised from recurring contracts in a calendar month (used by org financials). */
async function recurringRevenueForMonth(orgId, year, month) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const rows = await prisma.contract.findMany({
    where: { org_id: orgId, kind: 'recurring', status: { in: ['active', 'completed'] }, start_date: { lt: to } },
  });
  return round2(rows.filter((c) => covers(c, from, to)).reduce((s, c) => s + monthlyEquivalent(c), 0));
}

module.exports = {
  createContractSchema,
  updateContractSchema,
  statusSchema,
  listQuerySchema,
  monthlyEquivalent,
  create,
  list,
  get,
  update,
  changeStatus,
  summary,
  recurringRevenueForMonth,
};
