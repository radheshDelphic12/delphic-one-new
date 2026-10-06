const { z } = require('zod');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const prisma = require('../../config/db');
const { writeAudit } = require('./audit');
const money = require('./money.service');
const serviceTypes = require('./serviceTypes');

const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const amount = z.coerce.number().min(0).max(1e13);
const planSchema = z.object({
  month: monthStr,
  project_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
  planned_revenue: amount.default(0),
  planned_expense: amount.default(0),
  planned_salaries: amount.default(0),
  notes: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(500).nullable().optional()),
});
const rangeSchema = z.object({ from: monthStr.optional(), to: monthStr.optional(), project_id: z.string().uuid().optional() }).superRefine((v, ctx) => {
  if (v.from && v.to && v.to < v.from) ctx.addIssue({ code: 'custom', message: 'The end month must be on or after the start month', path: ['to'] });
  if (v.from && v.to && money.monthsBetween(v.from, v.to).length > 60) ctx.addIssue({ code: 'custom', message: 'Pick 60 months or fewer', path: ['to'] });
});
const closeSchema = z.object({ month: monthStr });
const reopenSchema = z.object({ month: monthStr, reason: z.string().trim().min(1).max(500) });
const statementSchema = z.object({
  group: z.enum(['month', 'project', 'party', 'service', 'property']).default('month'),
  from: monthStr.optional(),
  to: monthStr.optional(),
  service_type: z.string().optional(),
  property_id: z.string().uuid().optional(),
  party_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
});

const round2 = money.round2;
const num = money.num;

function defaultRange({ from, to }, back = 5) {
  const cm = money.currentMonth();
  return { from: from || money.addMonths(cm, -back), to: to || cm };
}

// ---- plans ----
async function listPlans(orgId, { from, to }) {
  const r = defaultRange({ from, to }, 2);
  const rows = await prisma.zxPlan.findMany({
    where: { org_id: orgId, month: { gte: r.from, lte: money.addMonths(r.to, 6) } },
    orderBy: [{ month: 'asc' }],
    include: { project: { select: { id: true, code: true, name: true } } },
  });
  return rows.map((p) => ({ ...p, planned_revenue: num(p.planned_revenue), planned_expense: num(p.planned_expense), planned_salaries: num(p.planned_salaries) }));
}

async function savePlan(orgId, actorId, input) {
  const projectId = input.project_id || null;
  if (projectId && !(await prisma.zxProject.findFirst({ where: { id: projectId, org_id: orgId, deleted_at: null }, select: { id: true } }))) return { error: 'project_not_found' };
  const existing = await prisma.zxPlan.findFirst({ where: { org_id: orgId, month: input.month, project_id: projectId } });
  const data = { planned_revenue: input.planned_revenue, planned_expense: input.planned_expense, planned_salaries: input.planned_salaries, notes: input.notes ?? null };
  const plan = existing
    ? await prisma.zxPlan.update({ where: { id: existing.id }, data })
    : await prisma.zxPlan.create({ data: { org_id: orgId, month: input.month, project_id: projectId, ...data } });
  await writeAudit(null, {
    orgId, actorId, entity: 'plan', entityId: plan.id, action: existing ? 'update' : 'create',
    before: existing ? { planned_revenue: num(existing.planned_revenue), planned_expense: num(existing.planned_expense), planned_salaries: num(existing.planned_salaries) } : undefined,
    after: { month: plan.month, project_id: projectId, ...data },
  });
  return { plan: { ...plan, planned_revenue: num(plan.planned_revenue), planned_expense: num(plan.planned_expense), planned_salaries: num(plan.planned_salaries) } };
}

async function deletePlan(orgId, actorId, id) {
  const plan = await prisma.zxPlan.findFirst({ where: { id, org_id: orgId } });
  if (!plan) return { error: 'not_found' };
  await prisma.zxPlan.delete({ where: { id } });
  await writeAudit(null, { orgId, actorId, entity: 'plan', entityId: id, action: 'delete', before: { month: plan.month, planned_revenue: num(plan.planned_revenue) } });
  return { ok: true };
}

// ---- actuals per month (company-wide or one project) ----
async function monthlyActuals(orgId, from, to, projectId) {
  if (!projectId) return money.monthly(orgId, from, to);
  return money.byProjectMonthly(orgId, from, to, projectId);
}

// Planned = the company-wide row for the month when there is one, otherwise the sum of project rows.
function plannedFor(plans, month, projectId) {
  const rows = plans.filter((p) => p.month === month);
  const pick = projectId ? rows.filter((p) => p.project_id === projectId) : rows.some((p) => !p.project_id) ? rows.filter((p) => !p.project_id) : rows;
  const sum = (k) => round2(pick.reduce((a, p) => a + p[k], 0));
  return { revenue: sum('planned_revenue'), expense: sum('planned_expense'), salaries: sum('planned_salaries'), has_plan: pick.length > 0 };
}

async function planVsActual(orgId, query) {
  const r = defaultRange(query, 5);
  const [actuals, plans, closes] = await Promise.all([
    monthlyActuals(orgId, r.from, r.to, query.project_id),
    prisma.zxPlan.findMany({ where: { org_id: orgId, month: { gte: r.from, lte: r.to } } }),
    prisma.zxPeriodClose.findMany({ where: { org_id: orgId, month: { gte: r.from, lte: r.to } } }),
  ]);
  const planRows = plans.map((p) => ({ ...p, planned_revenue: num(p.planned_revenue), planned_expense: num(p.planned_expense), planned_salaries: num(p.planned_salaries) }));
  const closeMap = new Map(closes.map((c) => [c.month, c]));
  const rows = actuals.map((a) => {
    const p = plannedFor(planRows, a.month, query.project_id);
    const plannedProfit = round2(p.revenue - p.expense - p.salaries);
    const close = closeMap.get(a.month);
    return {
      month: a.month,
      has_plan: p.has_plan,
      planned: { revenue: p.revenue, expense: p.expense, salaries: p.salaries, profit: plannedProfit },
      actual: { revenue: a.revenue, expense: a.expense, salaries: a.salaries, profit: a.profit },
      variance: { revenue: round2(a.revenue - p.revenue), expense: round2(a.expense - p.expense), salaries: round2(a.salaries - p.salaries), profit: round2(a.profit - plannedProfit) },
      status: close?.status === 'closed' ? 'closed' : 'open',
      stale: Boolean(close?.stale),
    };
  });
  const total = (side, key) => round2(rows.reduce((s, row) => s + row[side][key], 0));
  return {
    from: r.from,
    to: r.to,
    project_id: query.project_id || null,
    rows,
    totals: { planned: { revenue: total('planned', 'revenue'), expense: total('planned', 'expense'), salaries: total('planned', 'salaries'), profit: total('planned', 'profit') }, actual: { revenue: total('actual', 'revenue'), expense: total('actual', 'expense'), salaries: total('actual', 'salaries'), profit: total('actual', 'profit') } },
  };
}

// ---- projection: ordinary least squares over up to the last 12 closed-or-open months ----
function regress(values) {
  const n = values.length;
  const xs = values.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = values.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const sxy = xs.reduce((a, x, i) => a + (x - mx) * (values[i] - my), 0);
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const ssTot = values.reduce((a, v) => a + (v - my) ** 2, 0);
  const ssRes = values.reduce((a, v, i) => a + (v - (intercept + slope * i)) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}
function confidenceOf(n, r2) {
  if (n < 3) return 'insufficient';
  if (n < 6) return 'low';
  if (n < 9) return r2 >= 0.5 ? 'medium' : 'low';
  return r2 >= 0.7 ? 'high' : 'medium';
}

async function projection(orgId, horizon = 6) {
  const cm = money.currentMonth();
  // The running month is partial, so the fit uses completed months only.
  const to = money.addMonths(cm, -1);
  const history = await money.monthly(orgId, money.addMonths(to, -11), to);
  const firstActive = history.findIndex((h) => h.revenue || h.expense || h.salaries);
  const used = firstActive < 0 ? [] : history.slice(firstActive);
  const months = Array.from({ length: horizon }, (_, i) => money.addMonths(cm, i));
  const series = {};
  let weakest = 'high';
  const order = ['insufficient', 'low', 'medium', 'high'];
  for (const key of ['revenue', 'expense', 'salaries']) {
    const values = used.map((h) => h[key]);
    if (values.length < 3) {
      series[key] = { confidence: 'insufficient', r2: null, points: months.map((m) => ({ month: m, value: null })) };
      weakest = 'insufficient';
      continue;
    }
    const fit = regress(values);
    const confidence = confidenceOf(values.length, fit.r2);
    if (order.indexOf(confidence) < order.indexOf(weakest)) weakest = confidence;
    series[key] = {
      confidence,
      r2: Math.round(fit.r2 * 100) / 100,
      points: months.map((m, i) => ({ month: m, value: round2(Math.max(0, fit.intercept + fit.slope * (values.length + i))) })),
    };
  }
  const profit = months.map((m, i) => ({ month: m, value: weakest === 'insufficient' ? null : round2(series.revenue.points[i].value - series.expense.points[i].value - series.salaries.points[i].value) }));
  return { basis_months: used.length, from: used[0]?.month || null, to, confidence: weakest, series: { ...series, profit: { confidence: weakest, r2: null, points: profit } } };
}

// ---- month close ----
async function listCloses(orgId, query) {
  const r = defaultRange(query, 11);
  const rows = await prisma.zxPeriodClose.findMany({ where: { org_id: orgId, month: { gte: r.from, lte: r.to } }, orderBy: { month: 'desc' } });
  const live = await money.monthly(orgId, r.from, r.to);
  const liveMap = new Map(live.map((m) => [m.month, m]));
  const closeMap = new Map(rows.map((c) => [c.month, c]));
  return money.monthsBetween(r.from, r.to).reverse().map((month) => {
    const c = closeMap.get(month);
    return {
      month,
      status: c?.status === 'closed' ? 'closed' : 'open',
      stale: Boolean(c?.stale),
      closed_at: c?.closed_at || null,
      reopen_reason: c?.reopen_reason || null,
      snapshot: c?.status === 'closed' ? c.snapshot : null,
      live: liveMap.get(month),
    };
  });
}

async function closeMonth(orgId, actorId, month) {
  if (month >= money.currentMonth()) return { error: 'month_not_over' };
  const existing = await prisma.zxPeriodClose.findFirst({ where: { org_id: orgId, month } });
  if (existing?.status === 'closed') return { error: 'already_closed' };
  if ((await prisma.zxSalaryRecord.count({ where: { org_id: orgId, month, status: 'draft' } })) > 0) return { error: 'draft_slips' };
  const from = money.monthStart(month);
  const to = money.monthEnd(month);
  const [sum, projects] = await Promise.all([money.summary(orgId, from, to), money.byProject(orgId, from, to)]);
  const snapshot = { summary: sum, by_project: projects };
  const data = { status: 'closed', snapshot, closed_by: actorId, closed_at: new Date(), stale: false, stale_at: null };
  const row = existing ? await prisma.zxPeriodClose.update({ where: { id: existing.id }, data }) : await prisma.zxPeriodClose.create({ data: { org_id: orgId, month, ...data } });
  await writeAudit(null, { orgId, actorId, entity: 'period', entityId: row.id, action: 'close', after: { month, revenue: sum.revenue, expense: sum.expense, salaries: sum.salaries, profit: sum.profit } });
  return { close: { month, status: 'closed', snapshot } };
}

async function reopenMonth(orgId, actorId, month, reason) {
  const existing = await prisma.zxPeriodClose.findFirst({ where: { org_id: orgId, month } });
  if (!existing || existing.status !== 'closed') return { error: 'not_closed' };
  await prisma.zxPeriodClose.update({ where: { id: existing.id }, data: { status: 'open', reopen_reason: reason, reopened_at: new Date(), stale: false, stale_at: null } });
  await writeAudit(null, { orgId, actorId, entity: 'period', entityId: existing.id, action: 'reopen', before: { month, stale: existing.stale }, reason });
  return { close: { month, status: 'open' } };
}

// ---- statements (P&L by month / project / party) ----
async function partyRows(orgId, from, to, filters = {}) {
  const entries = await money.actualEntries(orgId, from, to, {}, filters);
  const parties = await prisma.zxParty.findMany({ where: { org_id: orgId }, select: { id: true, name: true } });
  const names = new Map(parties.map((p) => [p.id, p.name]));
  const acc = new Map();
  for (const e of entries) {
    const id = e.party_id || null;
    if (!acc.has(id)) acc.set(id, { name: id ? names.get(id) || 'Removed party' : 'No client / vendor', revenue: 0, expense: 0 });
    acc.get(id)[e.type === 'revenue' ? 'revenue' : 'expense'] += num(e.amount);
  }
  return [...acc.values()].map((r) => ({ name: r.name, revenue: round2(r.revenue), expense: round2(r.expense), salaries: null, profit: round2(r.revenue - r.expense) })).sort((a, b) => b.revenue + b.expense - (a.revenue + a.expense));
}

async function statement(orgId, query) {
  const r = defaultRange(query, 11);
  const from = money.monthStart(r.from);
  const to = money.monthEnd(r.to);
  const filters = Object.fromEntries(['service_type', 'property_id', 'party_id', 'project_id'].filter((k) => query[k]).map((k) => [k, query[k]]));
  let rows;
  if (query.group === 'service' || query.group === 'property') {
    const dim = await money.byDimension(orgId, from, to, query.group, { filters });
    const labels = query.group === 'service' ? await serviceTypes.labels(orgId) : new Map((await prisma.zxProperty.findMany({ where: { org_id: orgId }, select: { id: true, code: true, name: true } })).map((p) => [p.id, `${p.code} ${p.name}`]));
    rows = dim.map((r) => ({ name: r.key ? labels.get(r.key) || r.key : query.group === 'service' ? 'No service' : 'No property', revenue: r.revenue, expense: r.expense, salaries: r.salaries, profit: r.profit })).sort((x, y) => y.profit - x.profit);
  } else if (query.group === 'project') rows = (await money.byProject(orgId, from, to, { filters })).map((p) => ({ name: p.code ? `${p.code} ${p.name}` : p.name, revenue: p.revenue, expense: p.expense, salaries: p.salaries, profit: p.profit }));
  else if (query.group === 'party') rows = await partyRows(orgId, from, to, filters);
  else rows = (await money.monthly(orgId, r.from, r.to, { filters })).map((m) => ({ name: m.month, revenue: m.revenue, expense: m.expense, salaries: m.salaries, profit: m.profit }));
  const t = (k) => round2(rows.reduce((a, row) => a + (row[k] || 0), 0));
  return { group: query.group, from: r.from, to: r.to, rows, totals: { name: 'Total', revenue: t('revenue'), expense: t('expense'), salaries: ['party', 'property'].includes(query.group) ? null : t('salaries'), profit: t('profit') } };
}

const GROUP_LABEL = { month: 'Month', project: 'Project', party: 'Client / vendor', service: 'Service', property: 'Property' };

async function exportXlsx(stmt) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Zephyr Infrastructure';
  const ws = wb.addWorksheet('Profit & loss');
  ws.addRow([`Zephyr Infrastructure - Profit & loss by ${GROUP_LABEL[stmt.group].toLowerCase()}, ${stmt.from} to ${stmt.to}`]).font = { bold: true, size: 13 };
  ws.addRow([]);
  ws.addRow([GROUP_LABEL[stmt.group], 'Revenue', 'Expense', 'Salaries', 'Profit']).font = { bold: true };
  for (const row of [...stmt.rows, stmt.totals]) ws.addRow([row.name, row.revenue, row.expense, row.salaries ?? '', row.profit]);
  ws.lastRow.font = { bold: true };
  ws.columns = [{ width: 34 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }];
  for (const col of [2, 3, 4, 5]) ws.getColumn(col).numFmt = '#,##0.00';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function exportPdf(stmt) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(15).text('Zephyr Infrastructure', { continued: false });
    doc.fontSize(10).fillColor('#555').text(`Profit & loss by ${GROUP_LABEL[stmt.group].toLowerCase()}, ${stmt.from} to ${stmt.to}`).moveDown();
    const cols = [40, 230, 310, 390, 470];
    const money0 = (v) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }));
    const line = (cells, bold) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#111').fontSize(9);
      cells.forEach((c, i) => doc.text(String(c), cols[i], y, { width: i === 0 ? 180 : 70, align: i === 0 ? 'left' : 'right', lineBreak: false }));
      doc.moveDown(0.9);
    };
    line([GROUP_LABEL[stmt.group], 'Revenue', 'Expense', 'Salaries', 'Profit'], true);
    for (const row of stmt.rows) {
      if (doc.y > 760) doc.addPage();
      line([row.name, money0(row.revenue), money0(row.expense), money0(row.salaries), money0(row.profit)], false);
    }
    line([stmt.totals.name, money0(stmt.totals.revenue), money0(stmt.totals.expense), money0(stmt.totals.salaries), money0(stmt.totals.profit)], true);
    doc.end();
  });
}

module.exports = {
  planSchema, rangeSchema, closeSchema, reopenSchema, statementSchema,
  listPlans, savePlan, deletePlan, planVsActual, projection, listCloses, closeMonth, reopenMonth, statement, exportXlsx, exportPdf,
};
