const { z } = require('zod');
const prisma = require('../../config/db');
const { num, round2, monthKey } = require('../../lib/vertical');

const rangeSchema = z
  .object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() })
  .transform((v) => {
    const to = v.to || new Date();
    const from = v.from || new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    return { from, to };
  });

const liveQuerySchema = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) });
const monthsQuerySchema = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) });

const mappingSchema = z
  .object({
    face_membership_id: z.string().uuid(),
    working_membership_id: z.string().uuid(),
    account_id: z.string().uuid().optional().nullable(),
    effective_from: z.coerce.date(),
    effective_to: z.coerce.date().optional().nullable(),
  })
  .refine((v) => v.face_membership_id !== v.working_membership_id, {
    message: 'Face and working resource must be different people',
    path: ['working_membership_id'],
  })
  .refine((v) => !v.effective_to || v.effective_to >= v.effective_from, {
    message: 'effective_to must not be before effective_from',
    path: ['effective_to'],
  });

// --- Client billing & sales, live ---

async function liveSales(orgId, { days }, now = new Date()) {
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [daily, invoices, mtd] = await Promise.all([
    prisma.dailyProjectRevenue.groupBy({ by: ['date'], where: { org_id: orgId, date: { gte: since } }, _sum: { revenue: true, billable_hours: true } }),
    prisma.clientInvoice.groupBy({ by: ['status'], where: { org_id: orgId }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.dailyProjectRevenue.aggregate({ where: { org_id: orgId, date: { gte: monthStart } }, _sum: { revenue: true, billable_hours: true } }),
  ]);
  const byDay = new Map(daily.map((d) => [d.date.toISOString().slice(0, 10), d]));
  const series = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(since.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key);
    series.push({ date: key, revenue: round2(num(row?._sum.revenue) || 0), hours: round2(num(row?._sum.billable_hours) || 0) });
  }
  return {
    generated_at: now.toISOString(),
    series,
    month_to_date: { revenue: round2(num(mtd._sum.revenue) || 0), hours: round2(num(mtd._sum.billable_hours) || 0) },
    invoices: invoices.map((i) => ({ status: i.status, count: i._count._all, amount: round2(num(i._sum.amount) || 0) })),
  };
}

// Revenue per client with who brought it (immutable origin owner) and who
// owns it now. Every row carries account_id so the UI can open the record.
async function revenueByClient(orgId, { from, to }) {
  const rows = await prisma.dailyProjectRevenue.groupBy({
    by: ['account_id'],
    where: { org_id: orgId, date: { gte: from, lte: to } },
    _sum: { revenue: true, billable_hours: true },
  });
  const accounts = await prisma.account.findMany({
    where: { id: { in: rows.map((r) => r.account_id) }, org_id: orgId },
    select: {
      id: true,
      name: true,
      owner: { select: { id: true, name: true } },
      origin_owner: { select: { id: true, name: true } },
    },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const invoiced = await prisma.clientInvoice.groupBy({
    by: ['client_account_id'],
    where: { org_id: orgId, status: { in: ['sent', 'paid'] }, created_at: { gte: from, lte: new Date(to.getTime() + 86400000) } },
    _sum: { amount: true },
  });
  const invoicedBy = new Map(invoiced.map((i) => [i.client_account_id, num(i._sum.amount) || 0]));

  const data = rows
    .map((r) => {
      const account = byId.get(r.account_id);
      return {
        account_id: r.account_id,
        client_name: account?.name || 'Unknown client',
        brought_by: account?.origin_owner || null,
        owner: account?.owner || null,
        billable_hours: round2(num(r._sum.billable_hours) || 0),
        revenue: round2(num(r._sum.revenue) || 0),
        invoiced: round2(invoicedBy.get(r.account_id) || 0),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const rollup = (pick) => {
    const map = new Map();
    for (const row of data) {
      const person = pick(row);
      const key = person?.id || 'none';
      const entry = map.get(key) || { user: person, revenue: 0, clients: 0 };
      entry.revenue = round2(entry.revenue + row.revenue);
      entry.clients += 1;
      map.set(key, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  };
  return {
    from,
    to,
    total_revenue: round2(data.reduce((s, r) => s + r.revenue, 0)),
    clients: data,
    by_brought_by: rollup((r) => r.brought_by),
    by_owner: rollup((r) => r.owner),
  };
}

// --- Resource-wise revenue: working resource + the face resource fronting them ---

async function resourceRevenue(orgId, { from, to }) {
  const [rows, mappings, members] = await Promise.all([
    prisma.dailyEmployeeProfitability.groupBy({
      by: ['org_membership_id'],
      where: { org_id: orgId, date: { gte: from, lte: to } },
      _sum: { revenue: true, cost: true, margin: true },
    }),
    prisma.resourceMapping.findMany({ where: { org_id: orgId, effective_from: { lte: to }, OR: [{ effective_to: null }, { effective_to: { gte: from } }] } }),
    prisma.orgMembership.findMany({
      where: { org_id: orgId },
      select: { id: true, employee_code: true, person: { select: { id: true, name: true } }, designation: { select: { name: true } } },
    }),
  ]);
  const memberById = new Map(members.map((m) => [m.id, m]));
  const describe = (id) => {
    const m = memberById.get(id);
    return m ? { membership_id: id, name: m.person.name, employee_code: m.employee_code, designation: m.designation?.name || null } : { membership_id: id, name: 'Unknown' };
  };

  // Latest-starting mapping wins when several cover the range for one worker.
  const faceFor = new Map();
  for (const m of mappings.sort((a, b) => new Date(a.effective_from) - new Date(b.effective_from))) {
    faceFor.set(m.working_membership_id, m.face_membership_id);
  }

  const working = rows
    .map((r) => {
      const faceId = faceFor.get(r.org_membership_id) || null;
      return {
        ...describe(r.org_membership_id),
        face_resource: faceId ? describe(faceId) : null,
        revenue: round2(num(r._sum.revenue) || 0),
        cost: round2(num(r._sum.cost) || 0),
        margin: round2(num(r._sum.margin) || 0),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const faceMap = new Map();
  for (const row of working) {
    // Un-mapped workers are their own face: they front their own work.
    const face = row.face_resource || { membership_id: row.membership_id, name: row.name, employee_code: row.employee_code, designation: row.designation };
    const entry = faceMap.get(face.membership_id) || { ...face, revenue: 0, cost: 0, margin: 0, working_resources: 0 };
    entry.revenue = round2(entry.revenue + row.revenue);
    entry.cost = round2(entry.cost + row.cost);
    entry.margin = round2(entry.margin + row.margin);
    entry.working_resources += 1;
    faceMap.set(face.membership_id, entry);
  }
  return { from, to, working_resources: working, face_resources: Array.from(faceMap.values()).sort((a, b) => b.revenue - a.revenue) };
}

async function listMappings(orgId) {
  const rows = await prisma.resourceMapping.findMany({ where: { org_id: orgId }, orderBy: { effective_from: 'desc' } });
  const ids = Array.from(new Set(rows.flatMap((r) => [r.face_membership_id, r.working_membership_id])));
  const members = await prisma.orgMembership.findMany({ where: { id: { in: ids } }, select: { id: true, person: { select: { name: true } } } });
  const nameById = new Map(members.map((m) => [m.id, m.person.name]));
  const accountIds = rows.map((r) => r.account_id).filter(Boolean);
  const accounts = accountIds.length ? await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true } }) : [];
  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  return rows.map((r) => ({
    ...r,
    face_name: nameById.get(r.face_membership_id) || null,
    working_name: nameById.get(r.working_membership_id) || null,
    account_name: r.account_id ? accountName.get(r.account_id) || null : null,
  }));
}

async function createMapping(orgId, userId, body) {
  const members = await prisma.orgMembership.findMany({
    where: { org_id: orgId, id: { in: [body.face_membership_id, body.working_membership_id] } },
    select: { id: true },
  });
  if (members.length !== 2) return { error: 'membership_not_found' };
  if (body.account_id) {
    const account = await prisma.account.findFirst({ where: { id: body.account_id, org_id: orgId } });
    if (!account) return { error: 'account_not_found' };
  }
  const row = await prisma.resourceMapping.create({ data: { ...body, org_id: orgId, created_by: userId } });
  return { mapping: row };
}

async function deleteMapping(orgId, id) {
  const row = await prisma.resourceMapping.findFirst({ where: { id, org_id: orgId } });
  if (!row) return { error: 'not_found' };
  await prisma.resourceMapping.delete({ where: { id } });
  return { ok: true };
}

// --- Salary graphs ---

async function salaryTrend(orgId, { months }, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const [costRows, structures, memberships] = await Promise.all([
    prisma.dailyEmployeeProfitability.findMany({ where: { org_id: orgId, date: { gte: start } }, select: { date: true, cost: true, org_membership_id: true } }),
    prisma.salaryStructure.findMany({ where: { org_id: orgId }, orderBy: { effective_from: 'desc' }, select: { org_membership_id: true, ctc: true } }),
    prisma.orgMembership.findMany({
      where: { org_id: orgId, employment_status: { not: 'terminated' } },
      select: { id: true, person: { select: { name: true } }, department: { select: { id: true, name: true } } },
    }),
  ]);

  const byMonth = new Map();
  const byEmployeeMonth = new Map();
  for (const r of costRows) {
    const key = monthKey(r.date);
    byMonth.set(key, (byMonth.get(key) || 0) + Number(r.cost));
    byEmployeeMonth.set(r.org_membership_id, (byEmployeeMonth.get(r.org_membership_id) || 0) + Number(r.cost));
  }

  const latestCtc = new Map();
  for (const s of structures) if (!latestCtc.has(s.org_membership_id)) latestCtc.set(s.org_membership_id, Number(s.ctc));

  const series = [];
  for (let i = 0; i < months; i += 1) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = monthKey(d);
    series.push({ month: key, cost: round2(byMonth.get(key) || 0) });
  }

  const employees = memberships
    .map((m) => ({
      membership_id: m.id,
      name: m.person.name,
      department: m.department?.name || null,
      monthly_ctc: round2(latestCtc.get(m.id) || 0),
      accrued_cost: round2(byEmployeeMonth.get(m.id) || 0),
    }))
    .sort((a, b) => b.monthly_ctc - a.monthly_ctc);

  const byDept = new Map();
  for (const e of employees) {
    const key = e.department || 'Unassigned';
    const entry = byDept.get(key) || { department: key, headcount: 0, monthly_ctc: 0 };
    entry.headcount += 1;
    entry.monthly_ctc = round2(entry.monthly_ctc + e.monthly_ctc);
    byDept.set(key, entry);
  }
  return {
    series,
    employees,
    by_department: Array.from(byDept.values()).sort((a, b) => b.monthly_ctc - a.monthly_ctc),
    total_monthly_ctc: round2(employees.reduce((s, e) => s + e.monthly_ctc, 0)),
  };
}

// --- Expense analysis (office + company-wide) ---

async function expenseAnalysis(orgId, { months }, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const [claims, vendors, locations] = await Promise.all([
    prisma.expenseClaim.findMany({
      where: { org_id: orgId, status: { in: ['approved', 'reimbursed'] }, created_at: { gte: start } },
      select: { amount: true, category: true, location_id: true, created_at: true },
    }),
    prisma.vendorPayment.findMany({
      where: { org_id: orgId, status: { in: ['approved', 'paid'] } },
      select: { amount: true, vendor_type: true, period_month: true, period_year: true },
    }),
    prisma.location.findMany({ where: { org_id: orgId }, select: { id: true, name: true } }),
  ]);
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  const months_ = new Map();
  const bucket = (key) => {
    if (!months_.has(key)) months_.set(key, { month: key, office_expenses: 0, vendor_payments: 0, total: 0 });
    return months_.get(key);
  };
  const byCategory = new Map();
  const byLocation = new Map();
  for (const c of claims) {
    const amount = Number(c.amount);
    const b = bucket(monthKey(c.created_at));
    b.office_expenses += amount;
    b.total += amount;
    byCategory.set(c.category, (byCategory.get(c.category) || 0) + amount);
    const loc = locName.get(c.location_id) || 'Unknown';
    byLocation.set(loc, (byLocation.get(loc) || 0) + amount);
  }
  const byVendorType = new Map();
  for (const v of vendors) {
    const date = new Date(Date.UTC(v.period_year, v.period_month - 1, 1));
    if (date < start) continue;
    const amount = Number(v.amount);
    const b = bucket(monthKey(date));
    b.vendor_payments += amount;
    b.total += amount;
    byVendorType.set(v.vendor_type, (byVendorType.get(v.vendor_type) || 0) + amount);
  }

  const toList = (map, label) => Array.from(map, ([k, v]) => ({ [label]: k, amount: round2(v) })).sort((a, b) => b.amount - a.amount);
  return {
    series: Array.from(months_.values())
      .map((m) => ({ ...m, office_expenses: round2(m.office_expenses), vendor_payments: round2(m.vendor_payments), total: round2(m.total) }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    by_category: toList(byCategory, 'category'),
    by_location: toList(byLocation, 'location'),
    by_vendor_type: toList(byVendorType, 'vendor_type'),
    total: round2(Array.from(months_.values()).reduce((s, m) => s + m.total, 0)),
  };
}

// --- Vendor amounts ---

async function vendorSummary(orgId) {
  const rows = await prisma.vendorPayment.findMany({ where: { org_id: orgId }, orderBy: { created_at: 'desc' } });
  const map = new Map();
  for (const r of rows) {
    const key = `${r.vendor_name.trim().toLowerCase()}|${r.vendor_type}`;
    const entry = map.get(key) || { vendor_name: r.vendor_name, vendor_type: r.vendor_type, payments: 0, paid: 0, approved_unpaid: 0, pending: 0, rejected: 0, last_period: null };
    entry.payments += 1;
    const amount = Number(r.amount);
    if (r.status === 'paid') entry.paid += amount;
    else if (r.status === 'approved') entry.approved_unpaid += amount;
    else if (r.status === 'pending') entry.pending += amount;
    else entry.rejected += amount;
    const period = `${r.period_year}-${String(r.period_month).padStart(2, '0')}`;
    if (!entry.last_period || period > entry.last_period) entry.last_period = period;
    map.set(key, entry);
  }
  const vendors = Array.from(map.values())
    .map((v) => ({
      ...v,
      paid: round2(v.paid),
      approved_unpaid: round2(v.approved_unpaid),
      pending: round2(v.pending),
      rejected: round2(v.rejected),
      outstanding: round2(v.approved_unpaid + v.pending),
    }))
    .sort((a, b) => b.outstanding - a.outstanding || b.paid - a.paid);
  return {
    vendors,
    totals: {
      paid: round2(vendors.reduce((s, v) => s + v.paid, 0)),
      outstanding: round2(vendors.reduce((s, v) => s + v.outstanding, 0)),
    },
  };
}

module.exports = {
  rangeSchema,
  liveQuerySchema,
  monthsQuerySchema,
  mappingSchema,
  liveSales,
  revenueByClient,
  resourceRevenue,
  listMappings,
  createMapping,
  deleteMapping,
  salaryTrend,
  expenseAnalysis,
  vendorSummary,
};
