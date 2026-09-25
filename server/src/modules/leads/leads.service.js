const { z } = require('zod');
const prisma = require('../../config/db');
const { num, round2, pageArgs, pagination, userNames } = require('../../lib/vertical');
const contractsService = require('../contracts/contracts.service');
const projectsService = require('../projects/projects.service');

const CURRENCY = z.enum(['INR', 'USD', 'AED', 'SAR', 'EUR', 'GBP']);
const optStr = (max = 300) => z.string().trim().max(max).optional().nullable();
const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];

const leadFields = {
  name: z.string().trim().min(1).max(200),
  category: z.enum(['self_project', 'client_project', 'other']).default('other'),
  self_project_basis: z.enum(['investor', 'customer_deal', 'project_type']).optional().nullable(),
  investor_name: optStr(200),
  customer_deal_ref: optStr(200),
  project_type: optStr(120),
  contact_name: optStr(200),
  email: z.string().email().optional().nullable(),
  phone: optStr(40),
  source: optStr(120),
  estimated_value: z.coerce.number().min(0).optional().nullable(),
  expected_monthly: z.coerce.number().min(0).optional().nullable(),
  currency: CURRENCY.default('INR'),
  owner_id: z.string().uuid().optional().nullable(),
  notes: optStr(2000),
};

const BASIS_FIELD = { investor: 'investor_name', customer_deal: 'customer_deal_ref', project_type: 'project_type' };

// A self-project lead must say what it is built on: an investor, a customer
// deal, or a project type - and name it.
function selfProjectRules(v, ctx) {
  if (v.category !== 'self_project') return;
  if (!v.self_project_basis) {
    ctx.addIssue({ code: 'custom', path: ['self_project_basis'], message: 'A self project needs a basis: investor, customer deal or project type' });
    return;
  }
  const field = BASIS_FIELD[v.self_project_basis];
  if (!v[field] || !String(v[field]).trim()) {
    ctx.addIssue({ code: 'custom', path: [field], message: `Enter the ${field.replace(/_/g, ' ')} for this self project` });
  }
}

const createLeadSchema = z.object(leadFields).superRefine(selfProjectRules);
const updateLeadSchema = z.object(leadFields).partial();
const stageSchema = z.object({ stage: z.enum(STAGES), reason: optStr(300) });
const convertSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('project') }),
  z.object({
    to: z.literal('contract'),
    kind: z.enum(['construction', 'recurring', 'service']),
    start_date: z.coerce.date(),
    end_date: z.coerce.date().optional().nullable(),
    billing_frequency: z.enum(['one_time', 'monthly', 'quarterly', 'annual']).default('one_time'),
    recurring_amount: z.coerce.number().positive().optional().nullable(),
    value: z.coerce.number().min(0).optional(),
  }),
]);
const listQuerySchema = z.object({
  stage: z.enum(STAGES).optional(),
  category: z.enum(['self_project', 'client_project', 'other']).optional(),
  owner_id: z.string().uuid().optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// won / lost are terminal; everything else can move freely except back to `new`.
function stageMoveAllowed(from, to) {
  if (from === to) return false;
  if (from === 'won' || from === 'lost') return false;
  return to !== 'new';
}

// Keep only the basis-specific field that applies, so stale values never linger.
function sanitize(data) {
  const next = { ...data };
  if (next.category && next.category !== 'self_project') {
    next.self_project_basis = null;
    next.investor_name = null;
    next.customer_deal_ref = null;
    next.project_type = next.category === 'client_project' ? next.project_type : null;
  } else if (next.self_project_basis) {
    for (const [basis, field] of Object.entries(BASIS_FIELD)) {
      if (basis !== next.self_project_basis && field !== 'project_type') next[field] = null;
    }
  }
  return next;
}

function serialize(row, owners) {
  return {
    ...row,
    estimated_value: num(row.estimated_value),
    expected_monthly: num(row.expected_monthly),
    owner: row.owner_id ? owners?.get(row.owner_id) || null : null,
  };
}

async function create(orgId, userId, body) {
  const row = await prisma.lead.create({ data: { ...sanitize(body), org_id: orgId, owner_id: body.owner_id || userId } });
  return { lead: serialize(row) };
}

async function list(orgId, { stage, category, owner_id, search, page, limit }) {
  const where = {
    org_id: orgId,
    ...(stage ? { stage } : {}),
    ...(category ? { category } : {}),
    ...(owner_id ? { owner_id } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: { created_at: 'desc' }, ...pageArgs({ page, limit }) }),
    prisma.lead.count({ where }),
  ]);
  const owners = await userNames(rows.map((r) => r.owner_id));
  return { data: rows.map((r) => serialize(r, owners)), pagination: pagination(page, limit, total) };
}

async function get(orgId, id) {
  const row = await prisma.lead.findFirst({ where: { id, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  return { lead: serialize(row, await userNames([row.owner_id])) };
}

async function update(orgId, id, patch) {
  const existing = await prisma.lead.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (existing.stage === 'won' || existing.stage === 'lost') return { error: 'lead_closed' };

  const merged = { ...existing, ...patch };
  const check = z.object(leadFields).superRefine(selfProjectRules).safeParse({
    ...merged,
    estimated_value: merged.estimated_value === null ? null : Number(merged.estimated_value),
    expected_monthly: merged.expected_monthly === null ? null : Number(merged.expected_monthly),
  });
  if (!check.success) return { error: 'invalid', issues: check.error.issues };

  const row = await prisma.lead.update({ where: { id }, data: sanitize(patch) });
  return { lead: serialize(row) };
}

async function changeStage(orgId, id, { stage }) {
  const existing = await prisma.lead.findFirst({ where: { id, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (!stageMoveAllowed(existing.stage, stage)) return { error: 'invalid_transition' };
  const row = await prisma.lead.update({ where: { id }, data: { stage } });
  return { lead: serialize(row) };
}

// Turn a lead into a self project or a contract, marking it won and linking
// the result back so nothing is re-keyed.
async function convert(orgId, userId, id, body) {
  const lead = await prisma.lead.findFirst({ where: { id, org_id: orgId } });
  if (!lead) return { error: 'not_found' };
  if (lead.stage === 'won' || lead.stage === 'lost') return { error: 'lead_closed' };

  if (body.to === 'project') {
    if (lead.category !== 'self_project') return { error: 'not_self_project' };
    const created = await projectsService.createProject(orgId, userId, {
      name: lead.name,
      project_type: lead.project_type,
      investor_name: lead.investor_name,
      customer_deal_ref: lead.customer_deal_ref,
      lead_id: lead.id,
      budget: num(lead.estimated_value),
      currency: lead.currency,
    });
    const row = await prisma.lead.update({ where: { id }, data: { stage: 'won', converted_project_id: created.project.id } });
    return { lead: serialize(row), project: created.project };
  }

  const parsed = contractsService.createContractSchema.safeParse({
    kind: body.kind,
    title: lead.name,
    counterparty_name: lead.name,
    lead_id: lead.id,
    value: body.value ?? num(lead.estimated_value) ?? 0,
    currency: lead.currency,
    start_date: body.start_date,
    end_date: body.end_date,
    billing_frequency: body.billing_frequency,
    recurring_amount: body.recurring_amount ?? num(lead.expected_monthly),
  });
  if (!parsed.success) return { error: 'invalid', issues: parsed.error.issues };
  const created = await contractsService.create(orgId, userId, parsed.data);
  if (created.error) return created;
  const row = await prisma.lead.update({ where: { id }, data: { stage: 'won', converted_contract_id: created.contract.id } });
  return { lead: serialize(row), contract: created.contract };
}

async function summary(orgId) {
  const rows = await prisma.lead.findMany({
    where: { org_id: orgId },
    select: { stage: true, category: true, estimated_value: true, expected_monthly: true },
  });
  const funnel = Object.fromEntries(STAGES.map((s) => [s, { count: 0, value: 0 }]));
  const byCategory = { self_project: 0, client_project: 0, other: 0 };
  let openValue = 0;
  let expectedMonthly = 0;
  for (const r of rows) {
    funnel[r.stage].count += 1;
    funnel[r.stage].value = round2(funnel[r.stage].value + Number(r.estimated_value || 0));
    byCategory[r.category] += 1;
    if (r.stage !== 'won' && r.stage !== 'lost') {
      openValue += Number(r.estimated_value || 0);
      expectedMonthly += Number(r.expected_monthly || 0);
    }
  }
  const closed = funnel.won.count + funnel.lost.count;
  return {
    total: rows.length,
    funnel,
    by_category: byCategory,
    open_pipeline_value: round2(openValue),
    open_expected_monthly: round2(expectedMonthly),
    win_rate: closed ? Math.round((funnel.won.count / closed) * 100) : null,
  };
}

module.exports = {
  createLeadSchema,
  updateLeadSchema,
  stageSchema,
  convertSchema,
  listQuerySchema,
  create,
  list,
  get,
  update,
  changeStage,
  convert,
  summary,
};
