const { z } = require('zod');
const prisma = require('../../config/db');
const money = require('./money.service');

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const querySchema = z
  .object({
    preset: z.enum(['month', 'last_month', 'quarter', 'fy', 't12', 'custom']).default('month'),
    from: dateStr.optional(),
    to: dateStr.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.preset !== 'custom') return;
    if (!v.from || !v.to) ctx.addIssue({ code: 'custom', message: 'Pick both a from and a to date', path: ['from'] });
    else if (v.to < v.from) ctx.addIssue({ code: 'custom', message: 'The end date must be on or after the start date', path: ['to'] });
    else if ((Date.parse(v.to) - Date.parse(v.from)) / 86400000 > 366 * 5) ctx.addIssue({ code: 'custom', message: 'Pick a range of five years or less', path: ['to'] });
  });
const drillSchema = z.object({ from: dateStr, to: dateStr, project_id: z.string().uuid().optional(), unallocated: z.coerce.boolean().optional() });

const dayMs = 86400000;
function previousRange(from, to) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / dayMs) + 1;
  const prevTo = new Date(Date.parse(from) - dayMs).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(from) - days * dayMs).toISOString().slice(0, 10);
  return { from: prevFrom, to: prevTo };
}

async function byCategory(orgId, from, to) {
  const entries = await money.actualEntries(orgId, from, to);
  const cats = await prisma.zxCategory.findMany({ where: { org_id: orgId }, select: { id: true, name: true } });
  const names = new Map(cats.map((c) => [c.id, c.name]));
  const acc = new Map();
  for (const e of entries) {
    const key = `${e.type}:${e.category_id}`;
    acc.set(key, (acc.get(key) || 0) + money.num(e.amount));
  }
  return [...acc.entries()]
    .map(([k, amount]) => ({ type: k.split(':')[0], category_id: k.split(':')[1], category: names.get(k.split(':')[1]) || 'Removed category', amount: money.round2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

// Everything the Overview page shows. Managers get revenue / expense / profit per project, without
// salaries or valuation; admins get the full picture.
async function overview(orgId, ctx, query) {
  const range = money.resolveRange(query.preset, query.from, query.to);
  const includeSalaries = ctx.isAdmin;
  const endMonth = range.to.slice(0, 7);
  const prev = previousRange(range.from, range.to);
  const [current, previous, trend, projects, categories, valuation] = await Promise.all([
    money.summary(orgId, range.from, range.to, { includeSalaries }),
    money.summary(orgId, prev.from, prev.to, { includeSalaries }),
    money.monthly(orgId, money.addMonths(endMonth, -11), endMonth, { includeSalaries }),
    money.byProject(orgId, range.from, range.to, { includeSalaries }),
    byCategory(orgId, range.from, range.to),
    ctx.isAdmin ? money.valuation(orgId) : null,
  ]);
  return { range, summary: current, previous: { ...prev, revenue: previous.revenue, expense: previous.expense, salaries: previous.salaries, profit: previous.profit }, trend, by_project: projects, by_category: categories, valuation };
}

// Pay slips behind the Salaries tile (admin only).
async function salaryRows(orgId, query) {
  const rows = await prisma.zxSalaryRecord.findMany({
    where: { org_id: orgId, status: { in: ['approved', 'paid'] }, month: { gte: query.from.slice(0, 7), lte: query.to.slice(0, 7) } },
    include: { person: { select: { id: true, name: true, kind: true } } },
    orderBy: [{ month: 'desc' }, { person: { name: 'asc' } }],
  });
  const out = [];
  for (const r of rows) {
    const split = Array.isArray(r.project_split) ? r.project_split : [];
    let amount = money.num(r.net);
    if (query.project_id) {
      amount = split.filter((s) => s.project_id === query.project_id).reduce((a, s) => a + money.num(s.amount), 0);
      if (amount === 0) continue;
    } else if (query.unallocated && split.length > 0) continue;
    out.push({ id: r.id, month: r.month, person: r.person, status: r.status, net: money.num(r.net), amount: money.round2(amount) });
  }
  return out;
}

module.exports = { querySchema, drillSchema, overview, salaryRows };
