const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const calc = require('./deal.calc');
const inv = require('./investment.calc');
const investments = require('./investments.service');

// The companies Acconcy funds or takes over. A round of money put in is an ax_investments row (type venture) linked by investee_id,
// so cost, current value and the cash coming back (a sale or a dividend, recorded as a realisation) keep the existing arithmetic and
// ledger posting. This file adds the company, its stage (discussion -> committed -> funded | taken_over -> exited | dropped) and the
// company-wise roll-up.
const STAGES = ['discussion', 'committed', 'funded', 'taken_over', 'exited', 'dropped'];
const PIPELINE = ['discussion', 'committed'];
const HELD = ['funded', 'taken_over'];

const text = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());
const uuidOrNull = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());
const optNum = (max) => z.preprocess((v) => (v === '' || v === null ? null : v), z.coerce.number().min(0).max(max).nullable().optional());
const optDate = z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable().optional());
const reqDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const reasonField = z.string().trim().max(500).optional();

const fields = {
  name: z.string().trim().min(1).max(200),
  sector: text(120),
  website: text(300),
  contact_name: text(200),
  contact_email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().email().max(200).nullable().optional()),
  stage: z.enum(STAGES),
  proposed_amount: optNum(1e13),
  proposed_stake_pct: optNum(100),
  expected_return_pct: optNum(10000),
  stake_pct: optNum(100),
  valuation: optNum(1e14),
  lead_id: uuidOrNull,
  deal_id: uuidOrNull,
  decided_at: optDate,
  discussion_notes: text(20000),
  notes: text(4000),
  reason: reasonField,
};
const createSchema = z.object({ ...fields, stage: fields.stage.default('discussion') });
const updateSchema = z.object(fields).partial();
const listQuerySchema = z.object({ stage: z.enum(STAGES).optional(), q: z.string().trim().max(100).optional() });
const fundSchema = z.object({
  investment_date: reqDate,
  amount: z.coerce.number().positive().max(1e13),
  equity_pct: optNum(100),
  current_value: optNum(1e13),
  takeover: z.boolean().default(false),
  notes: text(4000),
  reason: reasonField,
});

const n = (v) => (v == null ? null : Number(v));
const toDate = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const round1 = (v) => Math.round(v * 10) / 10;
const NUMERIC = ['proposed_amount', 'proposed_stake_pct', 'expected_return_pct', 'stake_pct', 'valuation'];
const snap = (r) => ({ name: r.name, stage: r.stage, proposed_amount: n(r.proposed_amount), stake_pct: n(r.stake_pct), valuation: n(r.valuation) });

function shape(row) {
  const rounds = (row.investments || []).filter((i) => !i.deleted_at);
  const perRound = rounds.map((r) => ({ r, h: inv.holding(r, (r.realisations || []).filter((x) => !x.deleted_at)) }));
  const t = inv.totals(perRound.map(({ h }) => h));
  const received = calc.round2(perRound.reduce((a, { h }) => a + h.amount_received, 0));
  const { investments: _drop, ...rest } = row;
  const out = { ...rest };
  for (const k of NUMERIC) out[k] = n(row[k]);
  return {
    ...out,
    rounds_count: rounds.length,
    invested: t.invested,
    current_value: t.current_value,
    amount_received: received,
    realised_gain: t.realised_gain,
    unrealised_gain: t.unrealised_gain,
    gain_loss: t.gain_loss,
    gain_loss_pct: t.gain_loss_pct,
    // what has come back plus what it is worth now, per rupee put in
    multiple: t.invested > 0 ? Math.round(((t.current_value + received) / t.invested) * 100) / 100 : null,
    expected_return_amount: row.proposed_amount != null && row.expected_return_pct != null ? calc.round2((Number(row.proposed_amount) * Number(row.expected_return_pct)) / 100) : null,
    rounds: perRound.map(({ r, h }) => ({ id: r.id, code: r.code, name: r.name, investment_date: calc.dayOf(r.investment_date), amount: h.amount, current_value: h.current_value, equity_pct: n(r.equity_pct), status: r.status, amount_received: h.amount_received, gain_loss: h.gain_loss })),
  };
}

const INCLUDE = { investments: { where: { deleted_at: null }, include: { realisations: { where: { deleted_at: null } } }, orderBy: { investment_date: 'asc' } } };

async function list(orgId, q = {}) {
  const rows = await prisma.axInvestee.findMany({
    where: {
      org_id: orgId, deleted_at: null, ...(q.stage ? { stage: q.stage } : {}),
      ...(q.q ? { OR: ['name', 'sector', 'contact_name'].map((f) => ({ [f]: { contains: q.q, mode: 'insensitive' } })) } : {}),
    },
    include: INCLUDE,
    orderBy: [{ created_at: 'desc' }],
    take: 500,
  });
  const data = rows.map(shape);
  const held = data.filter((d) => HELD.includes(d.stage) || d.rounds_count > 0);
  const sum = (arr, k) => calc.round2(arr.reduce((a, d) => a + (d[k] || 0), 0));
  const invested = sum(held, 'invested');
  const total = { invested, current_value: sum(held, 'current_value'), amount_received: sum(held, 'amount_received'), gain_loss: sum(held, 'gain_loss') };
  total.gain_loss_pct = invested > 0 ? round1((total.gain_loss / invested) * 100) : null;
  const pipeline = data.filter((d) => PIPELINE.includes(d.stage));
  return {
    data,
    totals: { ...total, companies: held.length, pipeline_count: pipeline.length, pipeline_amount: sum(pipeline, 'proposed_amount'), pipeline_expected_return: sum(pipeline, 'expected_return_amount') },
  };
}

async function get(orgId, id) {
  const row = await prisma.axInvestee.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: INCLUDE });
  return row ? { investee: shape(row) } : { error: 'not_found' };
}

async function checkLinks(orgId, input) {
  if (input.lead_id && !(await prisma.axLead.findFirst({ where: { id: input.lead_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'lead_not_found' };
  if (input.deal_id && !(await prisma.axDeal.findFirst({ where: { id: input.deal_id, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'deal_not_found' };
  return null;
}

async function create(orgId, actorId, input) {
  const bad = await checkLinks(orgId, input);
  if (bad) return bad;
  const { reason, decided_at, ...rest } = input;
  const row = await prisma.axInvestee.create({ data: { org_id: orgId, created_by: actorId, ...rest, decided_at: toDate(decided_at) } });
  await writeAudit(null, { orgId, actorId, entity: 'investee', entityId: row.id, action: 'create', after: snap(row), reason });
  return get(orgId, row.id);
}

async function update(orgId, actorId, id, input) {
  const before = await prisma.axInvestee.findFirst({ where: { id, org_id: orgId, deleted_at: null } });
  if (!before) return { error: 'not_found' };
  const bad = await checkLinks(orgId, input);
  if (bad) return bad;
  const { reason, decided_at, ...rest } = input;
  await prisma.axInvestee.update({ where: { id }, data: { ...rest, ...(decided_at !== undefined ? { decided_at: toDate(decided_at) } : {}) } });
  const after = await prisma.axInvestee.findUnique({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'investee', entityId: id, action: 'update', before: snap(before), after: snap(after), reason });
  return get(orgId, id);
}

async function remove(orgId, actorId, id, reason) {
  const before = await prisma.axInvestee.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: { investments: { where: { deleted_at: null }, select: { id: true } } } });
  if (!before) return { error: 'not_found' };
  if (before.investments.length) return { error: 'investee_has_investments' };
  await prisma.axInvestee.update({ where: { id }, data: { deleted_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'investee', entityId: id, action: 'delete', before: snap(before), reason });
  return { ok: true };
}

// Put money into the company: a new round (an investment of type venture), the company moves to funded (or taken over) and its stake
// is the sum of the rounds' equity.
async function fund(orgId, actorId, ctx, id, input) {
  const investee = await prisma.axInvestee.findFirst({ where: { id, org_id: orgId, deleted_at: null }, include: INCLUDE });
  if (!investee) return { error: 'not_found' };
  if (investee.stage === 'dropped') return { error: 'investee_dropped' };
  const round = investee.investments.length + 1;
  const made = await investments.create(orgId, actorId, ctx, {
    name: `${investee.name} - round ${round}`,
    type: 'venture',
    startup_name: investee.name,
    investee_id: id,
    deal_id: investee.deal_id,
    investment_date: input.investment_date,
    amount: input.amount,
    current_value: input.current_value ?? input.amount,
    equity_pct: input.equity_pct ?? null,
    notes: input.notes ?? null,
    reason: input.reason,
  });
  if (made.error) return made;
  const equity = calc.round2(investee.investments.reduce((a, i) => a + Number(i.equity_pct || 0), 0) + Number(input.equity_pct || 0));
  const stage = input.takeover ? 'taken_over' : HELD.includes(investee.stage) ? investee.stage : 'funded';
  await prisma.axInvestee.update({ where: { id }, data: { stage, stake_pct: equity > 0 ? equity : investee.stake_pct, decided_at: investee.decided_at || toDate(input.investment_date) } });
  await writeAudit(null, { orgId, actorId, entity: 'investee', entityId: id, action: 'fund', before: { stage: investee.stage }, after: { stage, amount: input.amount, round }, reason: input.reason });
  return get(orgId, id);
}

module.exports = { STAGES, createSchema, updateSchema, listQuerySchema, fundSchema, list, get, create, update, remove, fund };
