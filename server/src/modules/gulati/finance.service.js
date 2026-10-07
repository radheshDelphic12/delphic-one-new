const { z } = require('zod');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const core = require('./core.service');
const leads = require('./leads.service');
const deals = require('./deals.service');
const calc = require('./deal.calc');

const { round2, num, dayOf } = calc;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const filterSchema = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  month: monthStr.optional(),
  trading_type: z.string().trim().max(40).optional(),
  party_id: z.string().uuid().optional(),
  vendor_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  assignee_id: z.string().uuid().optional(),
});
const closeSchema = z.object({ note: z.string().trim().max(500).optional() });
const reopenSchema = z.object({ reason: z.string().trim().min(1).max(500) });

const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const monthOf = (d) => dayOf(d).slice(0, 7);
function range(f) {
  let { from, to } = f;
  if (f.month) {
    from = `${f.month}-01`;
    to = dayOf(new Date(Date.UTC(Number(f.month.slice(0, 4)), Number(f.month.slice(5)), 0)));
  }
  return { from, to };
}
const inRange = (r) => (r.from || r.to ? { ...(r.from ? { gte: toDate(r.from) } : {}), ...(r.to ? { lte: toDate(r.to) } : {}) } : undefined);
const pct = (x, base) => (base > 0 ? Math.round((x / base) * 1000) / 10 : null);

// Deals that match the deal-dimension filters; null when no such filter is set (company level included).
async function dealScope(orgId, f) {
  const dimension = f.trading_type || f.party_id || f.vendor_id || f.deal_id || f.assignee_id;
  if (!dimension) return null;
  const rows = await prisma.gxDeal.findMany({
    where: {
      org_id: orgId,
      deleted_at: null,
      ...(f.trading_type ? { trading_type: f.trading_type } : {}),
      ...(f.party_id ? { party_id: f.party_id } : {}),
      ...(f.deal_id ? { id: f.deal_id } : {}),
      ...(f.assignee_id ? { OR: [{ assignee_id: f.assignee_id }, { contractor_id: f.assignee_id }] } : {}),
      // vendor filter: a deal's primary vendor, or any vendor that sold into it
      ...(f.vendor_id ? { AND: [{ OR: [{ vendor_id: f.vendor_id }, { purchases: { some: { vendor_id: f.vendor_id, deleted_at: null } } }] }] } : {}),
    },
    select: { id: true },
  });
  return rows.map((d) => d.id);
}

async function rows(orgId, f) {
  const r = range(f);
  const scope = await dealScope(orgId, f);
  const dealWhere = scope ? { deal_id: { in: scope } } : {};
  const base = { org_id: orgId, deleted_at: null, ...dealWhere };
  const [purchases, sales, entries] = await Promise.all([
    prisma.gxPurchase.findMany({ where: { ...base, ...(f.vendor_id ? { vendor_id: f.vendor_id } : {}), ...(r.from || r.to ? { purchase_date: inRange(r) } : {}) }, include: { deal: { select: { trading_type: true } } } }),
    prisma.gxSale.findMany({ where: { ...base, ...(r.from || r.to ? { sale_date: inRange(r) } : {}) }, include: { deal: { select: { trading_type: true } } } }),
    prisma.gxLedgerEntry.findMany({ where: { ...base, ...(r.from || r.to ? { entry_date: inRange(r) } : {}) }, include: { deal: { select: { trading_type: true } } } }),
  ]);
  return { purchases, sales, entries, scoped: Boolean(scope), range: r };
}

const blank = () => ({ sales_revenue: 0, purchase_cost: 0, deal_expenses: 0, company_expenses: 0, company_income: 0, purchase_qty: 0, sales_qty: 0 });
function accumulate(bucket, kind, row) {
  const a = num(row.amount);
  if (kind === 'sale') { bucket.sales_revenue += a; bucket.sales_qty += num(row.quantity); }
  else if (kind === 'purchase') { bucket.purchase_cost += a; bucket.purchase_qty += num(row.quantity); }
  else if (row.deal_id) { if (row.type === 'expense') bucket.deal_expenses += a; else bucket.company_income += a; }
  else if (row.type === 'expense') bucket.company_expenses += a;
  else bucket.company_income += a;
}
function finish(b) {
  const gross = round2(b.sales_revenue - b.purchase_cost);
  const net = round2(gross - b.deal_expenses - b.company_expenses + b.company_income);
  return {
    sales_revenue: round2(b.sales_revenue), purchase_cost: round2(b.purchase_cost), gross_profit: gross,
    deal_expenses: round2(b.deal_expenses), company_expenses: round2(b.company_expenses), company_income: round2(b.company_income),
    net_profit: net, gross_margin_pct: pct(gross, b.sales_revenue), net_margin_pct: pct(net, b.sales_revenue),
    purchase_qty: calc.round3(b.purchase_qty), sales_qty: calc.round3(b.sales_qty),
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
  data.purchases.forEach((r) => add('purchase', r));
  data.sales.forEach((r) => add('sale', r));
  data.entries.forEach((r) => add('entry', r));
  return m;
}

async function pnl(orgId, f) {
  const data = await rows(orgId, f);
  const total = blank();
  const feed = (kind, r) => accumulate(total, kind, r);
  data.purchases.forEach((r) => feed('purchase', r));
  data.sales.forEach((r) => feed('sale', r));
  data.entries.forEach((r) => feed('entry', r));
  const byMonth = group(data, (k, r) => monthOf(r.purchase_date || r.sale_date || r.entry_date));
  const types = new Map((await core.listTypes(orgId)).map((t) => [t.key, t.label]));
  const byType = group(data, (k, r) => r.deal?.trading_type || null);
  const byDealMap = group(data, (k, r) => r.deal_id || null);
  const dealRows = byDealMap.size ? await prisma.gxDeal.findMany({ where: { org_id: orgId, id: { in: [...byDealMap.keys()] } }, select: { id: true, code: true, name: true, trading_type: true, status: true } }) : [];
  const dm = new Map(dealRows.map((d) => [d.id, d]));
  return {
    filters: { ...data.range, trading_type: f.trading_type || null, party_id: f.party_id || null, vendor_id: f.vendor_id || null, deal_id: f.deal_id || null, assignee_id: f.assignee_id || null },
    company_level_included: !data.scoped,
    totals: finish(total),
    by_month: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, b]) => ({ month, ...finish(b) })),
    by_trading_type: [...byType.entries()].map(([key, b]) => ({ key, label: types.get(key) || key, ...finish(b) })),
    by_deal: [...byDealMap.entries()].map(([id, b]) => ({ id, ...(dm.get(id) || {}), ...finish(b) })).sort((a, b) => b.net_profit - a.net_profit),
  };
}

// Trading-type report: Copper Cathode vs other deals, with quantities.
async function tradingReport(orgId, f) {
  const data = await rows(orgId, f);
  const types = await core.listTypes(orgId);
  const byType = group(data, (k, r) => r.deal?.trading_type || null);
  const r = data.range;
  const countRows = await prisma.gxDeal.findMany({
    where: { org_id: orgId, deleted_at: null, ...(f.trading_type ? { trading_type: f.trading_type } : {}) },
    select: { id: true, trading_type: true, start_date: true },
  });
  const active = new Set([...data.purchases, ...data.sales].map((x) => x.deal_id));
  const dealCount = (key) => countRows.filter((d) => d.trading_type === key && (!(r.from || r.to) || active.has(d.id) || (d.start_date && (!r.from || dayOf(d.start_date) >= r.from) && (!r.to || dayOf(d.start_date) <= r.to)))).length;
  const keys = new Set([...types.map((t) => t.key), ...byType.keys()]);
  return [...keys].map((key) => {
    const b = byType.get(key) || blank();
    const t = types.find((x) => x.key === key);
    return { key, label: t?.label || key, deals: dealCount(key), ...finish(b) };
  });
}

// Company figures that feed evaluation: totals, receivables / payables, deal values and (admin) valuation.
async function overview(orgId, f, caps = []) {
  const all = await pnl(orgId, f);
  const dealRows = await prisma.gxDeal.findMany({ where: { org_id: orgId, deleted_at: null, status: { not: 'cancelled' } } });
  const decorated = await deals.decorate(orgId, dealRows);
  const active = decorated.filter((d) => deals.ACTIVE.includes(d.status));
  const done = decorated.filter((d) => d.status === 'completed');
  const out = {
    ...all.totals,
    receivables: round2(calc.sum(decorated, (d) => d.summary.client_outstanding)),
    payables: round2(calc.sum(decorated, (d) => d.summary.vendor_outstanding)),
    active_deal_value: round2(calc.sum(active, (d) => d.expected_sale_amount ?? d.summary.sales_revenue)),
    completed_deal_value: round2(calc.sum(done, (d) => d.summary.sales_revenue)),
    active_deals: active.length,
    completed_deals: done.length,
  };
  if (caps.includes('valuation')) out.valuation = await valuation(orgId);
  return out;
}

// Valuation is its own setting-driven method: it only reads financial performance, a deal never edits it.
async function valuation(orgId) {
  const s = await core.ensureSettings(orgId);
  const end = dayOf(new Date());
  const start = dayOf(new Date(Date.UTC(new Date().getUTCFullYear() - 1, new Date().getUTCMonth() + 1, 1)));
  const t = (await pnl(orgId, { from: start, to: end })).totals;
  const mult = num(s.valuation_multiple);
  let value = null;
  if (s.valuation_method === 'manual') value = num(s.valuation_manual);
  else if (s.valuation_method === 'revenue_multiple') value = round2(mult * t.sales_revenue);
  else value = round2(mult * Math.max(0, t.net_profit));
  return { method: s.valuation_method, multiple: mult, manual: num(s.valuation_manual), value, trailing_revenue: t.sales_revenue, trailing_net_profit: t.net_profit, as_of: end };
}

// ---- month lock ----
async function periods(orgId) {
  const stored = await prisma.gxPeriodClose.findMany({ where: { org_id: orgId }, orderBy: { month: 'desc' } });
  const [p, s, e] = await Promise.all([
    prisma.gxPurchase.findFirst({ where: { org_id: orgId, deleted_at: null }, orderBy: { purchase_date: 'asc' }, select: { purchase_date: true } }),
    prisma.gxSale.findFirst({ where: { org_id: orgId, deleted_at: null }, orderBy: { sale_date: 'asc' }, select: { sale_date: true } }),
    prisma.gxLedgerEntry.findFirst({ where: { org_id: orgId, deleted_at: null }, orderBy: { entry_date: 'asc' }, select: { entry_date: true } }),
  ]);
  const firsts = [p?.purchase_date, s?.sale_date, e?.entry_date].filter(Boolean).map(monthOf).sort();
  const now = monthOf(new Date());
  const months = new Set(stored.map((x) => x.month));
  if (firsts.length) {
    let [y, m] = firsts[0].split('-').map(Number);
    for (let i = 0; i < 240; i += 1) {
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
  const existing = await prisma.gxPeriodClose.findUnique({ where: { org_id_month: { org_id: orgId, month } } });
  if (existing?.status === 'closed') return { error: 'already_closed' };
  const snapshot = { ...(await pnl(orgId, { month })).totals, note: input.note || null };
  const row = await prisma.gxPeriodClose.upsert({
    where: { org_id_month: { org_id: orgId, month } },
    update: { status: 'closed', snapshot, closed_by: actorId, closed_at: new Date(), stale: false, stale_at: null },
    create: { org_id: orgId, month, status: 'closed', snapshot, closed_by: actorId, closed_at: new Date() },
  });
  await writeAudit(null, { orgId, actorId, entity: 'period', entityId: row.id, action: 'close', after: { month, net_profit: snapshot.net_profit } });
  return { period: row };
}

async function reopenMonth(orgId, actorId, month, input) {
  const existing = await prisma.gxPeriodClose.findUnique({ where: { org_id_month: { org_id: orgId, month } } });
  if (!existing || existing.status !== 'closed') return { error: 'not_closed' };
  const row = await prisma.gxPeriodClose.update({ where: { id: existing.id }, data: { status: 'open', reopen_reason: input.reason, reopened_at: new Date() } });
  await writeAudit(null, { orgId, actorId, entity: 'period', entityId: row.id, action: 'reopen', before: { month, status: 'closed' }, after: { status: 'open' }, reason: input.reason });
  return { period: row };
}

// ---- dashboard ----
async function dashboard(orgId, caps) {
  const ls = await leads.summary(orgId);
  const dealRows = await prisma.gxDeal.findMany({ where: { org_id: orgId, deleted_at: null } });
  const decorated = await deals.decorate(orgId, dealRows);
  const live = decorated.filter((d) => d.status !== 'cancelled');
  const active = live.filter((d) => deals.ACTIVE.includes(d.status));
  const types = await core.listTypes(orgId);
  const stage = (s) => ls.by_stage[s].count;
  const pipeline = {
    total: ls.total,
    new: stage('new'),
    in_discussion: stage('in_discussion'),
    negotiation: stage('negotiation'),
    sourcing: stage('sourcing'),
    won: stage('won'),
    dropped: stage('dropped'),
    on_hold: stage('on_hold'),
    open_value: ls.open_value,
    by_trading_type: ls.by_trading_type,
  };
  const activeTrading = {
    active_deals: active.length,
    by_trading_type: types.map((t) => ({ key: t.key, label: t.label, count: active.filter((d) => d.trading_type === t.key).length })),
    pending_sourcing: active.filter((d) => (d.summary.quantities.remaining_to_source ?? 0) > 0).length,
    pending_supply: active.filter((d) => (d.summary.quantities.remaining_to_supply ?? 0) > 0).length,
    delayed: active.filter((d) => d.summary.delayed).length,
  };
  const out = { pipeline, active_trading: activeTrading };
  if (caps.includes('overview')) {
    out.financial = await overview(orgId, {}, caps);
    const top = (arr, f) => arr.reduce((best, d) => (f(d) > (best ? f(best) : -Infinity) ? d : best), null);
    const brief = (d, value) => (d ? { id: d.id, code: d.code, name: d.name, value } : null);
    const hv = top(live, (d) => d.summary.sales_revenue);
    const hp = top(live, (d) => d.summary.net_profit);
    const countBy = (key) => {
      const m = new Map();
      for (const d of live) if (d[key]) m.set(d[key], (m.get(d[key]) || 0) + 1);
      const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      return best ? { id: best[0], count: best[1] } : null;
    };
    const names = async (ids) => new Map((await prisma.gxParty.findMany({ where: { id: { in: ids.filter(Boolean) }, org_id: orgId }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
    const client = countBy('party_id');
    const vendor = countBy('vendor_id');
    const nm = await names([client?.id, vendor?.id]);
    out.performance = {
      highest_value_deal: hv && hv.summary.sales_revenue > 0 ? brief(hv, hv.summary.sales_revenue) : null,
      highest_profit_deal: hp && hp.summary.net_profit > 0 ? brief(hp, hp.summary.net_profit) : null,
      most_active_client: client ? { ...client, name: nm.get(client.id) || null } : null,
      most_active_vendor: vendor ? { ...vendor, name: nm.get(vendor.id) || null } : null,
      by_trading_type: await tradingReport(orgId, {}),
    };
  }
  return out;
}

module.exports = { filterSchema, closeSchema, reopenSchema, pnl, tradingReport, overview, valuation, periods, closeMonth, reopenMonth, dashboard };
