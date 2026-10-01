// Live Analytics queries (Billing & Sales, Salary, Resource Revenue, Vendor
// Payments, the month's Financials). Live Analytics is dynamic: an open month
// is always computed from the latest operational data. A LOCKED month is shown
// from its locked version (so it can't drift), with the live figure alongside
// only when a change has been detected since the lock.

const { z } = require('zod');
const prisma = require('../../config/db');
const exchangeRates = require('../billing/exchangeRates.service');
const billingEngine = require('./engines/billing.engine');
const salaryEngine = require('./engines/salary.engine');
const vendorEngine = require('./engines/vendorPayment.engine');
const resourceEngine = require('./engines/resourceRevenue.engine');
const calculations = require('./calculations.service');
const { round2, periodMonths, liveAsOf } = require('./period');

const bool = z.preprocess((v) => (v === undefined || v === '' ? undefined : v === true || v === 'true' || v === '1'), z.boolean().optional());
const uuid = z.string().uuid().optional();

const monthSchema = z.object({
  period_month: z.coerce.number().int().min(1).max(12),
  period_year: z.coerce.number().int().min(2000).max(2100),
});

const billingQuerySchema = monthSchema.extend({
  period: z.enum(['month', 'quarter']).default('month'),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
  project_type: z.enum(['all', 'managed_services', 'project', 'none']).default('all'),
  client_account_id: uuid,
  account_id: uuid,
  org_membership_id: uuid,
  status: z.enum(['all', 'approved', 'pending', 'rejected']).default('all'),
  include_overtime: bool.default(true),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
});

const salaryQuerySchema = monthSchema.extend({ org_membership_id: uuid, department_id: uuid, team_id: uuid });
const resourceQuerySchema = monthSchema.extend({
  org_membership_id: uuid,
  account_id: uuid,
  client_account_id: uuid,
  project_type: z.enum(['all', 'managed_services', 'project', 'none']).default('all'),
});
const vendorQuerySchema = monthSchema.extend({ vendor_account_id: uuid });

const STATUS_RANK = { rejected: 5, pending: 4, no_entry: 3, approved: 2, non_working: 1, outside_contract: 0 };

async function frozenCalcs(orgId, kind, months) {
  const rows = await prisma.financialCalculation.findMany({
    where: { org_id: orgId, kind, status: { in: calculations.FROZEN_STATUSES }, OR: months.map((m) => ({ period_month: m.period_month, period_year: m.period_year })) },
  });
  const versions = rows.length
    ? await prisma.financialCalculationVersion.findMany({ where: { OR: rows.map((r) => ({ calculation_id: r.id, version: r.current_version })) } })
    : [];
  const versionBy = new Map(versions.map((v) => [v.calculation_id, v]));
  const map = new Map();
  for (const r of rows) map.set(`${r.scope_key}|${r.period_year}-${r.period_month}`, { calc: r, version: versionBy.get(r.id) });
  return map;
}

function lockInfo(frozen) {
  if (!frozen) return { status: 'draft', version: 0 };
  return {
    status: frozen.calc.status,
    version: frozen.calc.current_version,
    locked_amount: frozen.version ? Number(frozen.version.amount) : null,
    locked_at: frozen.calc.locked_at,
    change_detected_at: frozen.calc.change_detected_at,
  };
}

async function draftStatuses(orgId, kind, months) {
  const rows = await prisma.financialCalculation.findMany({
    where: { org_id: orgId, kind, status: { in: calculations.LIVE_STATUSES }, OR: months.map((m) => ({ period_month: m.period_month, period_year: m.period_year })) },
    select: { scope_key: true, period_month: true, period_year: true, status: true, current_version: true, reviewed_at: true },
  });
  return new Map(rows.map((r) => [`${r.scope_key}|${r.period_year}-${r.period_month}`, r]));
}

// Billing & Sales — every matching project for the month (or the quarter's
// three months), date-wise rows (a date with nothing billable shows as zero),
// per-project totals, lock state and lock readiness.
async function billingOverview(orgId, q, now = new Date()) {
  const months = periodMonths(q);
  const [projects, fx, frozen, drafts] = await Promise.all([
    billingEngine.listProjects(orgId, q),
    exchangeRates.inrRates(orgId),
    frozenCalcs(orgId, 'billing', months),
    draftStatuses(orgId, 'billing', months),
  ]);
  const missing = new Set();
  const toInr = (amount, currency) => {
    const cur = currency || 'INR';
    if (!fx.has(cur)) { missing.add(cur); return null; }
    return round2(amount * fx.get(cur));
  };
  const filters = { org_membership_id: q.org_membership_id, include_overtime: q.include_overtime, status: q.status, date_from: q.date_from, date_to: q.date_to };

  const rows = [];
  const byDate = new Map();
  for (const m of months) {
    for (const account of projects) {
      const key = `${account.id}|${m.period_year}-${m.period_month}`;
      const lock = frozen.get(key);
      let raw;
      let liveAmount = null;
      if (lock?.version) {
        raw = lock.version.snapshot;
        if (lock.calc.status === 'change_detected') {
          const live = await billingEngine.computeProjectMonth(orgId, account, m, now);
          liveAmount = billingEngine.lockedAmount(live);
        }
      } else {
        raw = await billingEngine.computeProjectMonth(orgId, account, m, now);
      }
      const view = billingEngine.viewOf(raw, filters);
      if (q.org_membership_id && !view.days.some((d) => d.entries.length)) continue;
      // Approval filter: only projects with hours in the chosen state.
      if (q.status && q.status !== 'all' && !view.days.some((d) => d.entries.length)) continue;
      const draft = drafts.get(key);
      const estimate = billingEngine.estimateFor(account, raw, view.totals);
      rows.push({
        id: key,
        project: raw.project,
        period_month: m.period_month,
        period_year: m.period_year,
        engine: raw.engine,
        supported: raw.supported,
        note: raw.note,
        billing_type: raw.billing_type,
        rate: raw.rate,
        currency: raw.currency,
        working_days: raw.working_days,
        calendar: raw.calendar,
        overtime: raw.overtime,
        totals: view.totals,
        amount: view.totals.amount,
        amount_inr: toInr(view.totals.amount, raw.currency),
        estimate: estimate ? { ...estimate, amount_inr: toInr(estimate.amount, raw.currency) } : null,
        minimum: billingEngine.minimumFor(account, raw, view.totals),
        source: lock?.version ? 'locked' : 'live',
        live_amount: liveAmount,
        lock: lock ? lockInfo(lock) : { status: draft?.status || 'draft', version: draft?.current_version || 0, reviewed_at: draft?.reviewed_at || null },
        readiness: lock?.version ? null : raw.readiness,
        resources: view.resources,
      });
      for (const d of view.days) {
        if (!byDate.has(d.date)) {
          byDate.set(d.date, { date: d.date, is_working_day: d.is_working_day, holiday: d.holiday, status: d.status, hours: { approved: 0, overtime_approved: 0, pending: 0, rejected: 0 }, base_inr: 0, overtime_inr: 0, amount_inr: 0, approvers: [], projects: 0 });
        }
        const agg = byDate.get(d.date);
        if ((STATUS_RANK[d.status] ?? 0) > (STATUS_RANK[agg.status] ?? 0)) agg.status = d.status;
        agg.is_working_day = agg.is_working_day || d.is_working_day;
        for (const k of Object.keys(agg.hours)) agg.hours[k] = round2(agg.hours[k] + d.hours[k]);
        agg.base_inr = round2(agg.base_inr + (toInr(d.base_amount, raw.currency) || 0));
        agg.overtime_inr = round2(agg.overtime_inr + (toInr(d.overtime_amount, raw.currency) || 0));
        agg.amount_inr = round2(agg.amount_inr + (toInr(d.amount, raw.currency) || 0));
        if (d.entries.length) agg.projects += 1;
        for (const a of d.approvers) if (!agg.approvers.some((x) => x.id === a.id)) agg.approvers.push(a);
      }
    }
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const sum = (key) => round2(rows.reduce((s, r) => s + (r[key] || 0), 0));
  return {
    period: q.period,
    months,
    projects: rows,
    days,
    totals: {
      amount_inr: sum('amount_inr'),
      // Hourly projects with a client estimate only — a forecast, not billing.
      estimated_inr: round2(rows.reduce((s, r) => s + (r.estimate?.amount_inr || 0), 0)),
      estimated_projects: rows.filter((r) => r.estimate).length,
      base_inr: round2(days.reduce((s, d) => s + d.base_inr, 0)),
      overtime_inr: round2(days.reduce((s, d) => s + d.overtime_inr, 0)),
      approved_hours: round2(days.reduce((s, d) => s + d.hours.approved, 0)),
      overtime_hours: round2(days.reduce((s, d) => s + d.hours.overtime_approved, 0)),
      pending_hours: round2(days.reduce((s, d) => s + d.hours.pending, 0)),
      rejected_hours: round2(days.reduce((s, d) => s + d.hours.rejected, 0)),
      locked_projects: rows.filter((r) => r.source === 'locked').length,
      projects: rows.length,
    },
    missing_rates: [...missing],
  };
}

// One project's month: every date with its entries, approver and time.
async function billingProject(orgId, accountId, q, now = new Date()) {
  const period = { period_month: q.period_month, period_year: q.period_year };
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: billingEngine.PROJECT_SELECT });
  if (!account) return { error: 'not_found' };
  const locked = await calculations.lockedVersion(orgId, 'billing', accountId, period);
  const raw = locked ? locked.snapshot : await billingEngine.computeProjectMonth(orgId, account, period, now);
  const view = billingEngine.viewOf(raw, { org_membership_id: q.org_membership_id, include_overtime: q.include_overtime, status: q.status, date_from: q.date_from, date_to: q.date_to });
  const { state } = await calculations.getState(orgId, 'billing', accountId, period, { withLive: true });
  return {
    project: raw.project,
    engine: raw.engine,
    supported: raw.supported,
    note: raw.note,
    billing_type: raw.billing_type,
    rate: raw.rate,
    currency: raw.currency,
    benchmark_hours: raw.benchmark_hours,
    working_days: raw.working_days,
    calendar: raw.calendar,
    overtime: raw.overtime,
    agreement_start_date: raw.agreement_start_date,
    agreement_end_date: raw.agreement_end_date,
    source: locked ? 'locked' : 'live',
    estimate: billingEngine.estimateFor(account, raw, view.totals),
    minimum: billingEngine.minimumFor(account, raw, view.totals),
    ...view,
    calculation: state,
  };
}

function salaryTotals(result, lines) {
  const sum = (key) => round2(lines.reduce((s, l) => s + Number(l[key] || 0), 0));
  return { ...result.totals, employees: lines.length, ctc: sum('ctc'), deductions: sum('deductions'), net: sum('net'), earned_to_date: sum('earned_to_date'), projected_net: sum('projected_net'), pending_amount: sum('pending_amount'), ot_amount: sum('ot_amount') };
}

function filterSalary(result, { org_membership_id, department_id, team_id }) {
  const lines = result.lines.filter((l) => (!org_membership_id || l.org_membership_id === org_membership_id) && (!department_id || l.department_id === department_id) && (!team_id || l.team_id === team_id));
  return { ...result, lines, totals: salaryTotals(result, lines) };
}

// A record's lock for the Live Analytics tables.
function recordLock(rec, scope = 'record') {
  return rec ? { status: rec.status, version: rec.version, locked_at: rec.calc?.locked_at || null, scope } : { status: 'draft', version: 0, scope };
}

// Salary this month from approved timesheets — each employee lockable on
// their own (salary_employee); a locked employee shows their locked figures.
// An older whole-month lock still freezes everyone.
async function salaryLive(orgId, q, now = new Date()) {
  const period = { period_month: q.period_month, period_year: q.period_year };
  const locked = await calculations.lockedVersion(orgId, 'salary', 'org', period);
  const filters = { org_membership_id: q.org_membership_id, department_id: q.department_id, team_id: q.team_id };
  if (locked) {
    const result = filterSalary(locked.snapshot, filters);
    const lines = result.lines.map((l) => ({ ...l, lock: { status: locked.status, version: locked.version, scope: 'month' } }));
    return { ...result, lines, source: 'locked', locked_version: locked.version, lock_status: locked.status };
  }
  const [result, individual] = await Promise.all([
    salaryEngine.computeSalary(orgId, { ...period, asOf: liveAsOf(period.period_month, period.period_year, now), filters }),
    calculations.lockedRecords(orgId, 'salary_employee', period),
  ]);
  const lines = result.lines.map((l) => {
    const rec = individual.get(l.org_membership_id);
    const lockedLine = rec?.snapshot?.lines?.find((x) => x.org_membership_id === l.org_membership_id);
    return lockedLine ? { ...lockedLine, source: 'locked', lock: recordLock(rec) } : { ...l, source: 'live', lock: recordLock(null) };
  });
  return {
    ...result,
    lines,
    totals: { ...salaryTotals(result, lines), locked: lines.filter((l) => l.source === 'locked').length },
    source: 'live',
    locked_version: null,
    lock_status: null,
  };
}

async function resourceRevenueLive(orgId, q, now = new Date()) {
  const period = { period_month: q.period_month, period_year: q.period_year };
  const locked = await calculations.lockedVersion(orgId, 'resource_revenue', 'org', period);
  const filters = { org_membership_id: q.org_membership_id, account_id: q.account_id, client_account_id: q.client_account_id, project_type: q.project_type };
  if (locked) {
    const snap = locked.snapshot;
    const keep = (l) => (!filters.org_membership_id || l.org_membership_id === filters.org_membership_id)
      && (!filters.account_id || l.project.id === filters.account_id)
      && (!filters.project_type || filters.project_type === 'all' || (filters.project_type === 'none' ? !l.project.service_category : l.project.service_category === filters.project_type));
    const resources = snap.resources
      .map((r) => ({ ...r, projects: r.projects.filter(keep) }))
      .filter((r) => r.projects.length)
      .map((r) => ({ ...r, revenue: round2(r.projects.reduce((s, p) => s + p.revenue, 0)), cost: round2(r.projects.reduce((s, p) => s + p.cost, 0)), margin: round2(r.projects.reduce((s, p) => s + p.margin, 0)) }));
    const lines = resources.flatMap((r) => r.projects);
    return {
      ...snap,
      resources,
      lines,
      totals: { revenue: round2(lines.reduce((s, l) => s + l.revenue, 0)), cost: round2(lines.reduce((s, l) => s + l.cost, 0)), margin: round2(lines.reduce((s, l) => s + l.margin, 0)), resources: resources.length },
      source: 'locked',
      locked_version: locked.version,
      lock_status: locked.status,
    };
  }
  const result = await resourceEngine.computeResourceRevenue(
    orgId,
    { ...period, asOf: liveAsOf(period.period_month, period.period_year, now), filters },
    (acct) => calculations.resolveMonth(orgId, 'billing', acct.id, period, acct)
  );
  return { ...result, source: 'live' };
}

// Vendors this month — each vendor lockable on its own (vendor_bill); a
// locked vendor shows its locked lines. An older whole-month lock still
// freezes every vendor.
async function vendorPaymentsLive(orgId, q) {
  const period = { period_month: q.period_month, period_year: q.period_year };
  const locked = await calculations.lockedVersion(orgId, 'vendor_payment', 'org', period);
  if (locked) {
    const snap = locked.snapshot;
    const lines = q.vendor_account_id ? snap.lines.filter((l) => l.vendor?.id === q.vendor_account_id) : snap.lines;
    const vendors = (q.vendor_account_id ? snap.vendors.filter((v) => v.vendor?.id === q.vendor_account_id) : snap.vendors).map((v) => ({ ...v, lock: { status: locked.status, version: locked.version, scope: 'month' } }));
    return { ...snap, lines, vendors, source: 'locked', locked_version: locked.version, lock_status: locked.status };
  }
  const [result, individual] = await Promise.all([
    vendorEngine.computeVendorPayments(orgId, { ...period, vendor_account_id: q.vendor_account_id }),
    calculations.lockedRecords(orgId, 'vendor_bill', period),
  ]);
  const lockedIds = new Set([...individual.keys()].filter((id) => !q.vendor_account_id || id === q.vendor_account_id));
  const lines = [
    ...result.lines.filter((l) => !lockedIds.has(l.vendor?.id)).map((l) => ({ ...l, source: 'live' })),
    ...[...lockedIds].flatMap((id) => (individual.get(id).snapshot.lines || []).map((l) => ({ ...l, source: 'locked' }))),
  ];
  const vendors = [
    ...result.vendors.filter((v) => !lockedIds.has(v.vendor?.id)).map((v) => ({ ...v, source: 'live', lock: recordLock(null) })),
    ...[...lockedIds].map((id) => {
      const rec = individual.get(id);
      const v = rec.snapshot.vendors?.find((x) => x.vendor?.id === id) || { vendor: { id, name: rec.calc.scope_label }, contractors: [], amount_inr: rec.amount, by_currency: {} };
      return { ...v, source: 'locked', lock: recordLock(rec) };
    }),
  ].sort((a, b) => b.amount_inr - a.amount_inr);
  return {
    ...result,
    lines,
    vendors,
    totals: { ...result.totals, amount_inr: round2(vendors.reduce((s, v) => s + (v.amount_inr || 0), 0)), vendors: vendors.length, contractors: new Set(lines.map((l) => l.org_membership_id)).size, locked: lockedIds.size },
    source: 'live',
  };
}

// Vendor payments generated from locked calculations (the Vendors section).
async function vendorPaymentRecords(orgId, q) {
  return prisma.vendorPayment.findMany({
    where: { org_id: orgId, calculation_version_id: { not: null }, ...(q.period_month ? { period_month: q.period_month } : {}), ...(q.period_year ? { period_year: q.period_year } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }, { created_at: 'desc' }],
  });
}

async function financialMonthLive(orgId, q) {
  const period = { period_month: q.period_month, period_year: q.period_year };
  const month = await calculations.resolveMonth(orgId, 'financials', 'org', period);
  return { ...month.raw, source: month.locked ? 'locked' : 'live', locked_version: month.version };
}

const summaryQuerySchema = z.object({
  period_year: z.coerce.number().int().min(2000).max(2100),
  from_month: z.coerce.number().int().min(1).max(12).default(1),
  to_month: z.coerce.number().int().min(1).max(12).default(12),
});

// Adds tree `b` into tree `a` by category key (Financials across months).
function mergeCategories(into, add) {
  for (const node of add) {
    let target = into.find((n) => n.key === node.key);
    if (!target) {
      target = { key: node.key, label: node.label, amount: 0, children: [] };
      into.push(target);
    }
    target.amount = round2(target.amount + node.amount);
    mergeCategories(target.children, node.children || []);
  }
  return into;
}

// Financials — FINALIZED results only, organised by business category and
// summed over the chosen months of a year, with the per-month lock status and
// the "Latest Update" trail (recalculations and detected changes: what, who,
// when, old amount → new amount, why).
async function financialsSummary(orgId, { period_year, from_month, to_month }) {
  const calcs = await prisma.financialCalculation.findMany({
    where: { org_id: orgId, kind: 'financials', period_year, period_month: { gte: from_month, lte: to_month } },
    include: {
      versions: { orderBy: { version: 'desc' } },
      changes: { orderBy: { detected_at: 'desc' } },
    },
  });
  const byMonth = new Map(calcs.map((c) => [c.period_month, c]));
  const months = [];
  const categories = [];
  const totals = { revenue: 0, salaries: 0, expenses: 0, profit: 0 };
  const updates = [];
  const userIds = [];
  for (let m = from_month; m <= to_month; m += 1) {
    const calc = byMonth.get(m);
    const frozen = calc && calculations.FROZEN_STATUSES.includes(calc.status);
    const latest = calc?.versions.find((v) => v.version === calc.current_version);
    months.push({
      period_month: m,
      period_year,
      status: calc?.status || 'draft',
      finalized: Boolean(frozen && latest),
      version: calc?.current_version || 0,
      locked_at: calc?.locked_at || null,
      open_changes: calc ? calc.changes.filter((c) => c.status === 'open').length : 0,
      totals: frozen && latest ? latest.snapshot.totals : null,
    });
    if (!frozen || !latest) continue;
    mergeCategories(categories, latest.snapshot.categories || []);
    for (const k of Object.keys(totals)) totals[k] = round2(totals[k] + Number(latest.snapshot.totals?.[k] || 0));
    for (const v of calc.versions) {
      if (v.version === 1) continue;
      const prev = calc.versions.find((x) => x.version === v.version - 1);
      userIds.push(v.created_by);
      updates.push({
        type: 'recalculated',
        period_month: m,
        period_year,
        version: v.version,
        at: v.created_at,
        by: v.created_by,
        old_amount: prev ? Number(prev.amount) : null,
        new_amount: Number(v.amount),
        reason: v.reason,
        what: `Financials for ${m}/${period_year} re-finalized as version ${v.version}`,
      });
    }
  }
  // Changes detected on ANY locked component of these months (billing,
  // salary, vendor payments …), not only on the Financials rollup itself.
  const componentChanges = await prisma.financialCalculationChange.findMany({
    where: { calculation: { org_id: orgId, period_year, period_month: { gte: from_month, lte: to_month } } },
    orderBy: { detected_at: 'desc' },
    take: 200,
    include: { calculation: { select: { kind: true, scope_label: true, period_month: true, period_year: true } } },
  });
  for (const c of componentChanges) {
    userIds.push(c.changed_by, c.resolved_by);
    updates.push({
      type: 'change',
      id: c.id,
      kind: c.calculation.kind,
      scope_label: c.calculation.scope_label,
      period_month: c.calculation.period_month,
      period_year: c.calculation.period_year,
      at: c.detected_at,
      by: c.changed_by,
      status: c.status,
      old_amount: c.previous_amount !== null ? Number(c.previous_amount) : null,
      new_amount: c.potential_amount !== null ? Number(c.potential_amount) : null,
      reason: c.source_type,
      what: c.description,
      old_value: c.old_value,
      new_value: c.new_value,
      resolved_by: c.resolved_by,
      resolved_at: c.resolved_at,
      resolved_version: c.resolved_version,
    });
  }
  const { userNames } = require('../../lib/vertical');
  const names = await userNames(userIds);
  for (const u of updates) {
    u.by = u.by ? names.get(u.by) || { id: u.by } : null;
    if (u.resolved_by) u.resolved_by = names.get(u.resolved_by) || { id: u.resolved_by };
  }
  updates.sort((a, b) => new Date(b.at) - new Date(a.at));
  return { period_year, from_month, to_month, months, categories, totals, latest_updates: updates };
}

module.exports = {
  summaryQuerySchema,
  financialsSummary,
  monthSchema,
  billingQuerySchema,
  salaryQuerySchema,
  resourceQuerySchema,
  vendorQuerySchema,
  billingOverview,
  billingProject,
  salaryLive,
  resourceRevenueLive,
  vendorPaymentsLive,
  vendorPaymentRecords,
  financialMonthLive,
};
