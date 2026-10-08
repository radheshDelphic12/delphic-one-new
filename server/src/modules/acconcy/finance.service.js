const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const leads = require('./leads.service');
const deals = require('./deals.service');
const investments = require('./investments.service');
const calc = require('./deal.calc');
const invCalc = require('./investment.calc');
const valuationCalc = require('./valuation.calc');
const { SERVICE_KEYS, SERVICE_TYPES } = require('./serviceTypes');

const { round2, num, dayOf, pct } = calc;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

// Every report / P&L / dashboard filter. Applied server-side so totals always equal the rows behind them.
const filterSchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  month: monthStr.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  service_type: z.enum(SERVICE_KEYS).optional(),
  party_id: z.string().uuid().optional(),
  vendor_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
});
const closeSchema = z.object({ note: z.string().trim().max(500).optional() });
const reopenSchema = z.object({ reason: z.string().trim().min(1).max(500) });
const recordSchema = z.object({ month: monthStr, notes: z.string().trim().max(500).optional() });
const trendSchema = z.object({ from: monthStr.optional(), to: monthStr.optional(), state: z.enum(['locked', 'unlocked', 'all']).optional() });

const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const monthOf = (d) => dayOf(d).slice(0, 7);
const monthEnd = (m) => dayOf(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)));
function range(f) {
  let { from, to } = f;
  if (f.month) {
    from = `${f.month}-01`;
    to = monthEnd(f.month);
  } else if (f.year && !from && !to) {
    from = `${f.year}-01-01`;
    to = `${f.year}-12-31`;
  }
  return { from, to };
}
const inRange = (r) => (r.from || r.to ? { ...(r.from ? { gte: toDate(r.from) } : {}), ...(r.to ? { lte: toDate(r.to) } : {}) } : undefined);
const monthRange = (r) => (r.from || r.to ? { ...(r.from ? { gte: r.from.slice(0, 7) } : {}), ...(r.to ? { lte: r.to.slice(0, 7) } : {}) } : undefined);

// Deals that match the deal-dimension filters; null when no such filter is set (company level then included).
async function dealScope(orgId, f) {
  const dimension = f.service_type || f.party_id || f.vendor_id || f.deal_id || f.assignee_id;
  if (!dimension) return null;
  const rows = await prisma.axDeal.findMany({
    where: {
      org_id: orgId,
      deleted_at: null,
      ...(f.service_type ? { service_type: f.service_type } : {}),
      ...(f.party_id ? { party_id: f.party_id } : {}),
      ...(f.deal_id ? { id: f.deal_id } : {}),
      ...(f.assignee_id ? { OR: [{ assignee_id: f.assignee_id }, { contractor_id: f.assignee_id }] } : {}),
    },
    select: { id: true, vendor_id: true },
  });
  return rows;
}

async function rows(orgId, f) {
  const r = range(f);
  const scope = await dealScope(orgId, f);
  const dealIds = scope ? scope.map((d) => d.id) : null;
  let entryWhere = { org_id: orgId, deleted_at: null };
  if (scope) {
    const vendorDeals = f.vendor_id ? scope.filter((d) => d.vendor_id === f.vendor_id).map((d) => d.id) : null;
    entryWhere = f.vendor_id
      ? { ...entryWhere, deal_id: { in: dealIds }, OR: [{ vendor_id: f.vendor_id }, { deal_id: { in: vendorDeals } }] }
      : { ...entryWhere, deal_id: { in: dealIds } };
  } else if (f.vendor_id) {
    entryWhere = { ...entryWhere, OR: [{ vendor_id: f.vendor_id }, { deal: { is: { vendor_id: f.vendor_id } } }] };
  }
  if (r.from || r.to) entryWhere.entry_date = inRange(r);
  const entries = await prisma.axLedgerEntry.findMany({ where: entryWhere, include: { deal: { select: { service_type: true } } } });
  // Salaries are company level: included only when no deal-dimension filter is set, or when filtering by one employee.
  const salaryScoped = Boolean(f.service_type || f.party_id || f.vendor_id || f.deal_id);
  const salaries = salaryScoped
    ? []
    : await prisma.axSalary.findMany({
        where: { org_id: orgId, status: { in: ['approved', 'paid'] }, ...(f.assignee_id ? { person_id: f.assignee_id } : {}), ...(monthRange(r) ? { month: monthRange(r) } : {}) },
        include: { person: { select: { kind: true } } },
      });
  return { entries, salaries, scoped: Boolean(scope) || Boolean(f.vendor_id), range: r };
}

const blank = () => ({ revenue_deal: 0, revenue_other: 0, expense_deal: 0, expense_other: 0, salaries: 0, contractor_costs: 0 });
function accumulate(b, kind, row) {
  const a = num(row.amount ?? row.net);
  if (kind === 'salary') {
    if (row.person?.kind === 'contractor') b.contractor_costs += a;
    else b.salaries += a;
  } else if (row.type === 'revenue') {
    if (row.deal_id) b.revenue_deal += a;
    else b.revenue_other += a;
  } else if (row.deal_id) b.expense_deal += a;
  else b.expense_other += a;
}
function finish(b) {
  const revenue = round2(b.revenue_deal + b.revenue_other);
  const expenses = round2(b.expense_deal + b.expense_other + b.salaries + b.contractor_costs);
  const net = round2(revenue - expenses);
  return {
    revenue,
    deal_revenue: round2(b.revenue_deal),
    other_revenue: round2(b.revenue_other),
    expenses,
    deal_expenses: round2(b.expense_deal),
    operational_expenses: round2(b.expense_other),
    salaries: round2(b.salaries),
    contractor_costs: round2(b.contractor_costs),
    net_profit: net,
    margin_pct: pct(net, revenue),
  };
}
function group(data, keyOf) {
  const m = new Map();
  const add = (kind, r) => {
    const k = keyOf(kind, r);
    if (!k) return;
    if (!m.has(k)) m.set(k, blank());
    accumulate(m.get(k), kind, r);
  };
  data.entries.forEach((r) => add('entry', r));
  data.salaries.forEach((r) => add('salary', r));
  return m;
}

async function pnl(orgId, f) {
  const data = await rows(orgId, f);
  const total = blank();
  data.entries.forEach((r) => accumulate(total, 'entry', r));
  data.salaries.forEach((r) => accumulate(total, 'salary', r));
  const byMonth = group(data, (k, r) => (k === 'salary' ? r.month : monthOf(r.entry_date)));
  const byService = group(data, (k, r) => (k === 'entry' ? r.deal?.service_type || null : null));
  const byDealMap = group(data, (k, r) => (k === 'entry' ? r.deal_id || null : null));
  const dealRows = byDealMap.size ? await prisma.axDeal.findMany({ where: { org_id: orgId, id: { in: [...byDealMap.keys()] } }, select: { id: true, code: true, name: true, service_type: true, status: true } }) : [];
  const dm = new Map(dealRows.map((d) => [d.id, d]));
  return {
    filters: { ...data.range, service_type: f.service_type || null, party_id: f.party_id || null, vendor_id: f.vendor_id || null, deal_id: f.deal_id || null, assignee_id: f.assignee_id || null },
    company_level_included: !data.scoped && !(f.service_type || f.party_id || f.vendor_id || f.deal_id),
    totals: finish(total),
    by_month: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, b]) => ({ month, ...finish(b) })),
    by_service: [...byService.entries()].map(([key, b]) => ({ key, label: SERVICE_TYPES.find((t) => t.key === key)?.label || key, ...finish(b) })),
    by_deal: [...byDealMap.entries()].map(([id, b]) => ({ id, ...(dm.get(id) || {}), ...finish(b) })).sort((a, b) => b.net_profit - a.net_profit),
  };
}

// Investment rows under the same filters (date range on investment_date; deal / service / deal-dimension filters).
async function investmentRows(orgId, f) {
  const r = range(f);
  const scope = await dealScope(orgId, f);
  const where = {
    org_id: orgId,
    deleted_at: null,
    ...(f.service_type ? { service_type: f.service_type } : {}),
    ...(scope ? { deal_id: { in: scope.map((d) => d.id) } } : {}),
    ...(r.from || r.to ? { investment_date: inRange(r) } : {}),
  };
  const found = await prisma.axInvestment.findMany({ where, include: { realisations: { where: { deleted_at: null } } } });
  return investments.decorate(found);
}

const flat = (r) => ({ ...r, ...r.performance });

// Service-wise report (brief section 26): revenue / expense / profit per service, plus the investment block for the
// services that hold investments. Realised gains reach revenue through the ledger; unrealised never does.
async function serviceReport(orgId, f) {
  const data = await rows(orgId, f);
  const byService = group(data, (k, r) => (k === 'entry' ? r.deal?.service_type || null : null));
  const inv = await investmentRows(orgId, f);
  const dealCounts = await prisma.axDeal.groupBy({ by: ['service_type'], where: { org_id: orgId, deleted_at: null, ...(f.service_type ? { service_type: f.service_type } : {}), ...(f.party_id ? { party_id: f.party_id } : {}) }, _count: { _all: true } });
  const dc = new Map(dealCounts.map((d) => [d.service_type, d._count._all]));
  return SERVICE_TYPES.filter((t) => !f.service_type || t.key === f.service_type).map((t) => {
    const fin = finish(byService.get(t.key) || blank());
    const mine = inv.filter((i) => (i.service_type || null) === t.key);
    return {
      key: t.key,
      label: t.label,
      deals: dc.get(t.key) || 0,
      revenue: fin.revenue,
      expenses: fin.expenses,
      profit: fin.net_profit,
      margin_pct: fin.margin_pct,
      investment: invCalc.totals(mine.map(flat)),
      investment_count: mine.length,
    };
  });
}

async function investmentReport(orgId, f) {
  const inv = await investmentRows(orgId, f);
  const types = investments.TYPES.map((t) => ({ type: t, count: inv.filter((i) => i.type === t).length, ...invCalc.totals(inv.filter((i) => i.type === t).map(flat)) }));
  return { totals: invCalc.totals(inv.map(flat)), by_type: types, count: inv.length };
}

// ---- valuation (formula in valuation.calc.js; multipliers in settings) ----
async function multipliers(orgId) {
  const s = await core.ensureSettings(orgId);
  return { profit: num(s.profit_multiplier), asset: num(s.asset_multiplier), include_investments: s.include_investments_in_assets };
}

// Asset value at the end of a month: active assets dated on / before it (+ open investments when the setting is on).
async function assetValueAt(orgId, month, include) {
  const end = toDate(monthEnd(month));
  const [assets, invs] = await Promise.all([
    prisma.axAsset.findMany({ where: { org_id: orgId, deleted_at: null, status: 'active', as_of_date: { lte: end } }, select: { value: true } }),
    include ? prisma.axInvestment.findMany({ where: { org_id: orgId, deleted_at: null, investment_date: { lte: end } }, include: { realisations: { where: { deleted_at: null, realised_date: { lte: end } } } } }) : [],
  ]);
  const assetsTotal = round2(calc.sum(assets, (a) => a.value));
  const invTotal = round2(calc.sum(invs, (i) => invCalc.holding(i, i.realisations).current_value));
  return { assets: assetsTotal, investments: invTotal, total: round2(assetsTotal + invTotal) };
}

async function valuationFor(orgId, month, m) {
  const mult = m || (await multipliers(orgId));
  const totals = (await pnl(orgId, { month })).totals;
  const profit = totals.net_profit;
  const asset = await assetValueAt(orgId, month, mult.include_investments);
  return { month, revenue: totals.revenue, ...valuationCalc.calculate(profit, asset.total, { profit: mult.profit, asset: mult.asset }), asset_breakdown: asset };
}

const monthIdx = (m) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5)) - 1;
const monthAt = (i) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

// Every month from -> to (default: last 12 months), oldest first.
async function valuationTrend(orgId, q = {}) {
  const to = q.to || monthOf(new Date());
  const from = q.from || monthAt(monthIdx(to) - 11);
  if (from > to || monthIdx(to) - monthIdx(from) > 119) return { error: 'bad_range' };
  const state = q.state || 'all';
  const mult = await multipliers(orgId);
  const keys = [];
  for (let i = monthIdx(from); i <= monthIdx(to); i += 1) keys.push(monthAt(i));
  const closes = await prisma.axPeriodClose.findMany({ where: { org_id: orgId, status: 'closed', month: { in: keys } }, select: { month: true, snapshot: true } });
  const closedBy = new Map(closes.map((c) => [c.month, c]));
  // locked = frozen figures of closed months (0 until a month is closed); unlocked = live figures of open months; all = every month live.
  const monthFor = async (month) => {
    const live = await valuationFor(orgId, month, mult);
    const close = closedBy.get(month);
    if (state === 'locked') {
      if (!close) return { ...live, revenue: 0, ...valuationCalc.calculate(0, live.asset_value, { profit: mult.profit, asset: mult.asset }) };
      const snap = close.snapshot || {};
      return { ...live, revenue: round2(num(snap.revenue)), ...valuationCalc.calculate(num(snap.net_profit), live.asset_value, { profit: mult.profit, asset: mult.asset }) };
    }
    if (state === 'unlocked' && close) return { ...live, revenue: 0, ...valuationCalc.calculate(0, live.asset_value, { profit: mult.profit, asset: mult.asset }) };
    return live;
  };
  const months = [];
  for (let i = 0; i < keys.length; i += 4) months.push(...(await Promise.all(keys.slice(i, i + 4).map(monthFor))));
  const closed = new Set(closedBy.keys());
  const history = await valuationHistory(orgId, { limit: 24 });
  const current = months[months.length - 1];
  const previous = months.length > 1 ? months[months.length - 2] : null;
  return {
    currency: 'INR',
    state,
    from,
    to,
    formula: { profit: mult.profit, asset_value: mult.asset, include_investments: mult.include_investments },
    months: months.map((x) => ({ ...x, closed: closed.has(x.month) })),
    current,
    previous,
    change: previous ? round2(current.total - previous.total) : null,
    history,
  };
}

async function valuation(orgId) {
  const month = monthOf(new Date());
  const t = await valuationTrend(orgId, { from: monthAt(monthIdx(month) - 1), to: month });
  return { ...t.current, previous_total: t.previous?.total ?? null, change: t.change };
}

const histOut = (h) => ({ ...h, valuation_date: dayOf(h.valuation_date), profit: num(h.profit), asset_value: num(h.asset_value), profit_multiplier: num(h.profit_multiplier), asset_multiplier: num(h.asset_multiplier), profit_component: num(h.profit_component), asset_component: num(h.asset_component), total: num(h.total) });
async function valuationHistory(orgId, { limit = 50 } = {}) {
  const rows2 = await prisma.axValuationHistory.findMany({ where: { org_id: orgId }, orderBy: [{ valuation_date: 'desc' }, { created_at: 'desc' }], take: limit });
  return rows2.map(histOut);
}

// Saves today's calculation with the multipliers used, so the figure stays auditable if the formula changes later.
async function recordValuation(orgId, actorId, input, source = 'manual') {
  if (input.month > monthOf(new Date())) return { error: 'future_month' };
  const v = await valuationFor(orgId, input.month);
  const row = await prisma.axValuationHistory.create({
    data: {
      org_id: orgId,
      valuation_date: toDate(source === 'month_close' ? monthEnd(input.month) : dayOf(new Date())),
      month: input.month,
      profit: v.profit,
      asset_value: v.asset_value,
      profit_multiplier: v.profit_multiplier,
      asset_multiplier: v.asset_multiplier,
      profit_component: v.profit_component,
      asset_component: v.asset_component,
      total: v.total,
      source,
      notes: input.notes || null,
      created_by: actorId,
    },
  });
  await writeAudit(null, { orgId, actorId, entity: 'valuation', entityId: row.id, action: 'record', after: { month: input.month, total: v.total, profit_multiplier: v.profit_multiplier, asset_multiplier: v.asset_multiplier } });
  return { valuation: histOut(row) };
}

// ---- month lock ----
async function periods(orgId) {
  const stored = await prisma.axPeriodClose.findMany({ where: { org_id: orgId }, orderBy: { month: 'desc' } });
  const [e, s, i] = await Promise.all([
    prisma.axLedgerEntry.findFirst({ where: { org_id: orgId, deleted_at: null }, orderBy: { entry_date: 'asc' }, select: { entry_date: true } }),
    prisma.axSalary.findFirst({ where: { org_id: orgId }, orderBy: { month: 'asc' }, select: { month: true } }),
    prisma.axInvestment.findFirst({ where: { org_id: orgId, deleted_at: null }, orderBy: { investment_date: 'asc' }, select: { investment_date: true } }),
  ]);
  const firsts = [e && monthOf(e.entry_date), s?.month, i && monthOf(i.investment_date)].filter(Boolean).sort();
  const now = monthOf(new Date());
  const months = new Set(stored.map((x) => x.month));
  if (firsts.length) {
    let [y, m] = firsts[0].split('-').map(Number);
    for (let k = 0; k < 240; k += 1) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      months.add(key);
      if (key >= now) break;
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  }
  months.add(now);
  const byMonth = new Map(stored.map((x) => [x.month, x]));
  const out = [];
  for (const month of [...months].sort().reverse()) {
    const row = byMonth.get(month);
    const live = (await pnl(orgId, { month })).totals;
    out.push({ month, status: row?.status || 'open', stale: Boolean(row?.stale), closed_at: row?.closed_at || null, reopen_reason: row?.reopen_reason || null, snapshot: row?.snapshot || null, live });
  }
  return out;
}

async function closeMonth(orgId, actorId, month, input) {
  if (month > monthOf(new Date())) return { error: 'future_month' };
  const existing = await prisma.axPeriodClose.findUnique({ where: { org_id_month: { org_id: orgId, month } } });
  if (existing?.status === 'closed') return { error: 'already_closed' };
  const t = (await pnl(orgId, { month })).totals;
  const inv = await investmentReport(orgId, { month });
  const snapshot = { ...t, investments: inv.totals, note: input.note || null };
  const row = await prisma.axPeriodClose.upsert({
    where: { org_id_month: { org_id: orgId, month } },
    update: { status: 'closed', snapshot, closed_by: actorId, closed_at: new Date(), stale: false, stale_at: null },
    create: { org_id: orgId, month, status: 'closed', snapshot, closed_by: actorId, closed_at: new Date() },
  });
  await writeAudit(null, { orgId, actorId, entity: 'period', entityId: row.id, action: 'close', after: { month, net_profit: t.net_profit } });
  await recordValuation(orgId, actorId, { month, notes: 'Recorded when the month was closed' }, 'month_close');
  return { period: row };
}

async function reopenMonth(orgId, actorId, month, input) {
  const existing = await prisma.axPeriodClose.findUnique({ where: { org_id_month: { org_id: orgId, month } } });
  if (!existing || existing.status !== 'closed') return { error: 'not_closed' };
  const row = await prisma.axPeriodClose.update({ where: { id: existing.id }, data: { status: 'open', reopen_reason: input.reason, reopened_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'period', entityId: row.id, action: 'reopen', before: { month, status: 'closed' }, after: { status: 'open' }, reason: input.reason });
  return { period: row };
}

// ---- overview, dashboard, reports ----
async function overview(orgId, f, caps = []) {
  const all = await pnl(orgId, f);
  const dealRows = await prisma.axDeal.findMany({ where: deals.whereOf(orgId, { service_type: f.service_type, party_id: f.party_id, vendor_id: f.vendor_id, assignee_id: f.assignee_id }) });
  const decorated = (await deals.decorate(orgId, dealRows)).filter((d) => (!f.deal_id || d.id === f.deal_id) && d.status !== 'cancelled');
  const active = decorated.filter((d) => deals.ACTIVE.includes(d.status));
  const done = decorated.filter((d) => d.status === 'completed');
  const inv = await investmentReport(orgId, f);
  const out = {
    ...all.totals,
    active_deals: active.length,
    completed_deals: done.length,
    total_deal_value: round2(calc.sum(decorated, (d) => d.deal_amount)),
    active_deal_value: round2(calc.sum(active, (d) => d.deal_amount)),
    deals_by_service: SERVICE_TYPES.map((t) => ({ key: t.key, label: t.label, count: decorated.filter((d) => d.service_type === t.key).length, value: round2(calc.sum(decorated.filter((d) => d.service_type === t.key), (d) => d.deal_amount)) })),
    investments: inv.totals,
  };
  if (caps.includes('valuation')) out.valuation = await valuation(orgId);
  return out;
}

async function dashboard(orgId, caps, f = {}) {
  const lead = leads.summary.bind(null, orgId);
  const ls = await lead({ service_type: f.service_type });
  const stage = (s) => ls.by_stage[s].count;
  const out = {
    pipeline: {
      total: ls.total, new: stage('new'), in_discussion: stage('in_discussion'), qualification: stage('qualification'), proposal: stage('proposal'),
      negotiation: stage('negotiation'), won: stage('won'), dropped: stage('dropped'), on_hold: stage('on_hold'), closed: stage('closed'),
      open_value: ls.open_value, win_rate: ls.win_rate, by_service_type: ls.by_service_type,
    },
  };
  const dealRows = await deals.decorate(orgId, await prisma.axDeal.findMany({ where: deals.whereOf(orgId, { service_type: f.service_type }) }));
  const live = dealRows.filter((d) => d.status !== 'cancelled');
  out.deals = {
    active: live.filter((d) => deals.ACTIVE.includes(d.status)).length,
    completed: live.filter((d) => d.status === 'completed').length,
    delayed: live.filter((d) => d.summary.delayed).length,
    total_value: round2(calc.sum(live, (d) => d.deal_amount)),
    by_service: SERVICE_TYPES.map((t) => ({ key: t.key, label: t.label, count: live.filter((d) => d.service_type === t.key).length, value: round2(calc.sum(live.filter((d) => d.service_type === t.key), (d) => d.deal_amount)) })),
  };
  if (caps.includes('overview')) {
    out.financial = await overview(orgId, f, caps);
    const top = (arr, g) => arr.reduce((best, d) => (g(d) > (best ? g(best) : -Infinity) ? d : best), null);
    const hv = top(live, (d) => d.summary.revenue);
    const hp = top(live, (d) => d.summary.profit);
    const brief = (d, value) => (d ? { id: d.id, code: d.code, name: d.name, value } : null);
    out.performance = {
      highest_revenue_deal: hv && hv.summary.revenue > 0 ? brief(hv, hv.summary.revenue) : null,
      highest_profit_deal: hp && hp.summary.profit > 0 ? brief(hp, hp.summary.profit) : null,
      by_service: await serviceReport(orgId, f),
    };
  }
  return out;
}

// Lead reports: by service, by stage, by employee, and conversion (won -> deal).
async function leadReport(orgId, q, scope = {}) {
  const rowsL = await leads.decorate(orgId, await prisma.axLead.findMany({ where: leads.whereOf(orgId, q, scope), take: 5000 }));
  const by = (keyOf, labelOf) => {
    const m = new Map();
    for (const l of rowsL) {
      const k = keyOf(l);
      if (!m.has(k)) m.set(k, { key: k, label: labelOf(l), total: 0, won: 0, dropped: 0, open: 0, converted: 0, expected_amount: 0 });
      const b = m.get(k);
      b.total += 1;
      b.expected_amount += l.expected_amount || 0;
      if (l.stage === 'won') b.won += 1;
      else if (l.stage === 'dropped') b.dropped += 1;
      else if (leads.OPEN_STAGES.includes(l.stage)) b.open += 1;
      if (l.deal_id) b.converted += 1;
    }
    return [...m.values()].map((b) => ({ ...b, expected_amount: round2(b.expected_amount), conversion_pct: b.won ? Math.round((b.converted / b.won) * 100) : null }));
  };
  const won = rowsL.filter((l) => l.stage === 'won').length;
  const converted = rowsL.filter((l) => l.deal_id).length;
  return {
    total: rowsL.length,
    won,
    converted,
    conversion_pct: won ? Math.round((converted / won) * 100) : null,
    by_service: by((l) => l.service_type, (l) => l.service_label),
    by_stage: leads.STAGES.map((s) => ({ key: s, label: s, total: rowsL.filter((l) => l.stage === s).length })),
    by_employee: by((l) => l.assignee_id || l.contractor_id || 'unassigned', (l) => l.assignee?.name || l.contractor?.name || 'Unassigned'),
  };
}

// Deal reports: by service, by client, by month, with revenue / expense / profit from the ledger.
async function dealReport(orgId, q, scope = {}) {
  const rowsD = await deals.list(orgId, q, scope);
  const sumOf = (list, key) => round2(calc.sum(list, (d) => d.summary[key]));
  const agg = (keyOf, labelOf) => {
    const m = new Map();
    for (const d of rowsD) {
      const k = keyOf(d);
      if (!k) continue;
      if (!m.has(k)) m.set(k, { key: k, label: labelOf(d), list: [] });
      m.get(k).list.push(d);
    }
    return [...m.values()].map((g) => ({ key: g.key, label: g.label, deals: g.list.length, deal_amount: round2(calc.sum(g.list, (d) => d.deal_amount)), revenue: sumOf(g.list, 'revenue'), expense: sumOf(g.list, 'expense'), profit: sumOf(g.list, 'profit') }));
  };
  return {
    totals: { deals: rowsD.length, deal_amount: round2(calc.sum(rowsD, (d) => d.deal_amount)), revenue: sumOf(rowsD, 'revenue'), expense: sumOf(rowsD, 'expense'), profit: sumOf(rowsD, 'profit') },
    by_service: agg((d) => d.service_type, (d) => d.service_label),
    by_client: agg((d) => d.party_id, (d) => d.party?.name || 'No client'),
    by_month: agg((d) => (d.start_date ? monthOf(d.start_date) : null), (d) => monthOf(d.start_date)).sort((a, b) => a.key.localeCompare(b.key)),
    deals: rowsD.map((d) => ({ id: d.id, code: d.code, name: d.name, service_type: d.service_type, service_label: d.service_label, status: d.status, party: d.party, start_date: d.start_date, deal_amount: d.deal_amount, ...d.summary })),
  };
}

module.exports = {
  filterSchema, closeSchema, reopenSchema, recordSchema, trendSchema,
  pnl, serviceReport, investmentReport, overview, dashboard, leadReport, dealReport,
  valuation, valuationFor, valuationTrend, valuationHistory, recordValuation, periods, closeMonth, reopenMonth,
};
