const { z } = require('zod');
const prisma = require('../../config/db');
const money = require('./money.service');
const calc = require('./property.calc');
const leads = require('./leads.service');
const projects = require('./projects.service');
const properties = require('./properties.service');
const rent = require('./rent.service');
const tasks = require('./tasks.service');
const sales = require('./sales.service');
const serviceTypes = require('./serviceTypes');

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const servicesQuerySchema = z.object({ preset: z.enum(['month', 'last_month', 'quarter', 'fy', 't12', 'custom']).default('fy'), from: dateStr.optional(), to: dateStr.optional() });

const r2 = money.round2;
const num = money.num;
const margin = (revenue, profit) => (revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null);

// One block per Zephyr service with the figures that matter for that business.
async function serviceReport(orgId, ctx, query) {
  const range = money.resolveRange(query.preset, query.from, query.to);
  const [labels, projectRows, pnl, leadRows, propRows, unitRows, saleList, rentPaid] = await Promise.all([
    serviceTypes.labels(orgId),
    prisma.zxProject.findMany({ where: { org_id: orgId, deleted_at: null }, select: { id: true, service_type: true, status: true, contract_value: true, details: true } }),
    money.byDimension(orgId, range.from, range.to, 'service', { includeSalaries: ctx.isAdmin }),
    prisma.zxLead.findMany({ where: { org_id: orgId, deleted_at: null }, select: { service_type: true, stage: true } }),
    prisma.zxProperty.findMany({ where: { org_id: orgId, deleted_at: null } }),
    prisma.zxPropertyUnit.findMany({ where: { org_id: orgId, deleted_at: null }, select: { property_id: true, status: true } }),
    ctx.canFinance ? sales.list(orgId, { from: range.from, to: range.to }) : { data: [], totals: {} },
    prisma.zxRentPayment.aggregate({ where: { org_id: orgId, deleted_at: null, paid_on: { gte: money.toDate(range.from), lte: money.toDate(range.to) } }, _sum: { amount: true } }),
  ]);
  const fin = Object.fromEntries(pnl.map((r) => [r.key || 'none', r]));
  const out = {};

  for (const key of ['civil_construction', 'interior_design']) {
    const mine = projectRows.filter((p) => p.service_type === key);
    const f = fin[key] || { revenue: 0, expense: 0, salaries: null, profit: 0 };
    out[key] = {
      label: labels.get(key),
      projects: mine.length,
      live: mine.filter((p) => ['planned', 'active', 'on_hold'].includes(p.status)).length,
      completed: mine.filter((p) => p.status === 'completed').length,
      contract_value: r2(mine.reduce((a, p) => a + (num(p.contract_value) || 0), 0)),
      cost: f.expense,
      salaries: f.salaries,
      revenue: f.revenue,
      profit: f.profit,
      margin_pct: margin(f.revenue, f.profit),
    };
  }

  const totalUnits = unitRows.length;
  const occupied = unitRows.filter((u) => u.status === 'rented').length;
  const mgmt = fin.property_management || { revenue: 0, expense: 0, profit: 0 };
  const loans = ctx.canFinance ? await prisma.zxPropertyLoan.findMany({ where: { org_id: orgId, deleted_at: null, status: 'active' } }) : [];
  const months = Math.max(1, (Number(range.to.slice(0, 4)) - Number(range.from.slice(0, 4))) * 12 + (Number(range.to.slice(5, 7)) - Number(range.from.slice(5, 7))) + 1);
  const financing = r2(loans.reduce((a, l) => a + calc.monthlyFinancing(l), 0) * months);
  out.property_management = {
    label: labels.get('property_management'),
    properties: propRows.filter((p) => p.status !== 'sold').length,
    units: totalUnits,
    occupied,
    occupancy_pct: totalUnits ? Math.round((occupied / totalUnits) * 1000) / 10 : null,
    rent_collected: r2(num(rentPaid._sum.amount) || 0),
    expenses: mgmt.expense,
    ...(ctx.canFinance ? { financing, cash_flow: r2((num(rentPaid._sum.amount) || 0) - mgmt.expense - financing) } : {}),
  };

  if (ctx.canFinance) {
    const sold = saleList.data;
    const holding = sold.filter((s) => s.holding_days !== null);
    out.property_trading = {
      label: labels.get('property_trading'),
      properties: propRows.length,
      total_investment: r2(propRows.reduce((a, p) => a + calc.totalInvestment(p), 0)),
      sales: sold.length,
      sold_value: saleList.totals.sale_value || 0,
      cost_basis: saleList.totals.cost_basis || 0,
      selling_costs: saleList.totals.selling_costs || 0,
      realized_profit: saleList.totals.realized_profit || 0,
      avg_holding_days: holding.length ? Math.round(holding.reduce((a, s) => a + s.holding_days, 0) / holding.length) : null,
    };
  }

  const consulting = projectRows.filter((p) => p.service_type === 'real_estate_consulting');
  const cf = fin.real_estate_consulting || { revenue: 0, expense: 0, profit: 0 };
  const details = consulting.map((p) => p.details || {});
  const pcts = details.map((d) => Number(d.commission_pct)).filter((n) => n > 0);
  const closedDeals = consulting.filter((p) => ['completed', 'closed'].includes(p.status) || (p.details || {}).closing_date);
  out.real_estate_consulting = {
    label: labels.get('real_estate_consulting'),
    leads: leadRows.filter((l) => l.service_type === 'real_estate_consulting').length,
    won_leads: leadRows.filter((l) => l.service_type === 'real_estate_consulting' && l.stage === 'won').length,
    projects: consulting.length,
    closed_deals: closedDeals.length,
    property_value: r2(details.reduce((a, d) => a + (Number(d.property_value) || 0), 0)),
    avg_commission_pct: pcts.length ? r2(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null,
    revenue: cf.revenue,
    expenses: cf.expense,
    profit: cf.profit,
  };
  return { range, services: out };
}

// Everything the Zephyr home screen shows, limited to what the caller's role may see.
async function dashboard(orgId, ctx, caps) {
  const has = (c) => caps.includes(c);
  const month = money.currentMonth();
  const range = money.resolveRange('fy');
  const [leadSummary, followUps, projectSummary, propertySummary, rentSummary, rentOverdue, taskSummary, overview, monthSum] = await Promise.all([
    has('leads') ? leads.summary(orgId) : null,
    has('leads') ? leads.followUps(orgId) : [],
    has('projects') ? projects.summary(orgId) : null,
    has('properties') ? properties.summary(orgId, ctx) : null,
    has('rent') ? rent.rentSummary(orgId, month) : null,
    has('rent') ? rent.listOverdue(orgId) : [],
    has('tasks') ? tasks.summary(orgId, { all: has('tasksAll'), personId: ctx.personId }) : null,
    has('overview') ? require('./overview.service').overview(orgId, ctx, { preset: 'fy' }) : null,
    has('overview') ? money.summary(orgId, money.monthStart(month), money.monthEnd(month), { includeSalaries: ctx.isAdmin }) : null,
  ]);
  return {
    month,
    range,
    leads: leadSummary,
    follow_ups: followUps,
    projects: projectSummary,
    properties: propertySummary,
    rent: rentSummary ? { ...rentSummary, overdue_items: rentOverdue.slice(0, 8) } : null,
    tasks: taskSummary,
    finance: overview ? { fy: overview.summary, month: monthSum, trend: overview.trend, by_service: overview.by_service, by_property: overview.by_property, unrealized: overview.unrealized, valuation: overview.valuation } : null,
  };
}

module.exports = { servicesQuerySchema, serviceReport, dashboard };
