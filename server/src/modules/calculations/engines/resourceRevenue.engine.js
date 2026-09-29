// Resource Revenue — per resource, per project/contract, for one month:
//
//   revenue = the resource's share of that project's Billing & Sales amount
//             (approved hours only; the share is pro-rata by the hours they
//             worked each day — see billing.engine). A LOCKED project month
//             contributes its locked figures, never a live recompute.
//   cost    = employee: attendance-based salary earned in the month
//             (salary.engine: monthly ctc / the employee's calendar working
//             days × days present or on paid leave) × their allocation share
//             of this project (allocation_percent, else an even split).
//             contractor: the vendor-payment line for this project
//             (vendorPayment.engine).
//   margin  = revenue − cost
//
// A resource on several contracts gets one line per contract; the rows are
// only AGGREGATED per resource for the report, never merged underneath.
// Approval status per line comes from that resource's timesheet entries on
// that project: Approved (all approved), Pending, Rejected, or No entries.

const prisma = require('../../../config/db');
const salaryEngine = require('./salary.engine');
const vendorEngine = require('./vendorPayment.engine');
const billingEngine = require('./billing.engine');
const exchangeRates = require('../../billing/exchangeRates.service');
const { round2, monthBounds } = require('../period');

// `billingMonth(account)` returns the project's month (locked snapshot or
// live) — supplied by calculations.service so locks are honoured.
async function computeResourceRevenue(orgId, { period_month, period_year, asOf = null, filters = {} }, billingMonth) {
  const { start, end } = monthBounds(period_month, period_year);
  const projects = await billingEngine.listProjects(orgId, { project_type: filters.project_type, client_account_id: filters.client_account_id, account_id: filters.account_id });
  const [fx, assignments, salary, vendor] = await Promise.all([
    exchangeRates.inrRates(orgId),
    prisma.projectMemberAssignment.findMany({
      where: { org_id: orgId, ...(filters.org_membership_id ? { org_membership_id: filters.org_membership_id } : {}) },
      select: { account_id: true, org_membership_id: true, allocation_percent: true },
    }),
    salaryEngine.computeSalary(orgId, { period_month, period_year, asOf, filters: filters.org_membership_id ? { org_membership_id: filters.org_membership_id } : {} }),
    vendorEngine.computeVendorPayments(orgId, { period_month, period_year, org_membership_id: filters.org_membership_id }),
  ]);
  const toInr = (amount, currency) => (fx.has(currency || 'INR') ? round2(amount * fx.get(currency || 'INR')) : null);

  const assignmentCount = new Map();
  const allAssignments = await prisma.projectMemberAssignment.groupBy({ by: ['org_membership_id'], where: { org_id: orgId }, _count: { _all: true } });
  for (const a of allAssignments) assignmentCount.set(a.org_membership_id, a._count._all);
  const shareOf = new Map(assignments.map((a) => [
    `${a.org_membership_id}|${a.account_id}`,
    a.allocation_percent !== null ? Number(a.allocation_percent) / 100 : 1 / (assignmentCount.get(a.org_membership_id) || 1),
  ]));
  const salaryBy = new Map(salary.lines.map((l) => [l.org_membership_id, l]));
  const vendorBy = new Map(vendor.lines.map((l) => [`${l.org_membership_id}|${l.project.id}`, l]));

  const lines = new Map();
  const lineFor = (membershipId, name, workerType, project) => {
    const key = `${membershipId}|${project.id}`;
    if (!lines.has(key)) {
      lines.set(key, {
        org_membership_id: membershipId,
        name,
        worker_type: workerType,
        project: { id: project.id, code: project.code, name: project.name, client_name: project.client_name, service_category: project.service_category },
        currency: 'INR',
        revenue: 0,
        revenue_original: 0,
        revenue_currency: 'INR',
        cost: 0,
        approved_hours: 0,
        overtime_hours: 0,
        entries: { approved: 0, pending: 0, rejected: 0 },
        last_approved_by: null,
        last_approved_at: null,
        billing_locked: false,
        missing_rate: false,
      });
    }
    return lines.get(key);
  };

  const missingRates = new Set();
  for (const account of projects) {
    const month = await billingMonth(account);
    if (!month) continue;
    const project = month.raw.project;
    for (const day of month.raw.days) {
      for (const r of day.resources) {
        if (filters.org_membership_id && r.org_membership_id !== filters.org_membership_id) continue;
        const line = lineFor(r.org_membership_id, r.name, r.worker_type, project);
        const amount = r.base_amount + (month.raw.overtime.enabled ? r.overtime_amount : 0);
        line.revenue_original = round2(line.revenue_original + amount);
        line.revenue_currency = month.raw.currency;
        line.approved_hours = round2(line.approved_hours + r.regular_hours);
        line.overtime_hours = round2(line.overtime_hours + r.overtime_hours);
        line.billing_locked = month.locked;
      }
      for (const e of day.entries) {
        if (filters.org_membership_id && e.org_membership_id !== filters.org_membership_id) continue;
        const line = lineFor(e.org_membership_id, e.name, null, project);
        if (e.status === 'approved') {
          line.entries.approved += 1;
          if (!line.last_approved_at || new Date(e.approved_at) > new Date(line.last_approved_at)) {
            line.last_approved_at = e.approved_at;
            line.last_approved_by = e.approved_by;
          }
        } else if (e.status === 'submitted') line.entries.pending += 1;
        else if (!e.resolved) line.entries.rejected += 1;
      }
    }
    // Assigned people with no hours this month still carry their cost.
    for (const a of assignments.filter((x) => x.account_id === account.id)) {
      const s = salaryBy.get(a.org_membership_id);
      const v = vendorBy.get(`${a.org_membership_id}|${account.id}`);
      if (s) lineFor(a.org_membership_id, s.name, 'full_time_employee', project);
      else if (v) lineFor(a.org_membership_id, v.contractor, 'contractor', project);
    }
  }

  const out = [];
  for (const line of lines.values()) {
    const inr = toInr(line.revenue_original, line.revenue_currency);
    if (inr === null) { missingRates.add(line.revenue_currency); line.missing_rate = true; }
    line.revenue = inr ?? 0;
    const s = salaryBy.get(line.org_membership_id);
    const v = vendorBy.get(`${line.org_membership_id}|${line.project.id}`);
    if (v) {
      line.worker_type = 'contractor';
      line.cost = v.amount_inr;
      line.cost_basis = 'vendor_rate';
    } else if (s) {
      line.worker_type = line.worker_type || 'full_time_employee';
      const share = shareOf.get(`${line.org_membership_id}|${line.project.id}`) ?? 0;
      line.allocation_percent = round2(share * 100);
      line.cost = round2((asOf ? s.earned_to_date : s.net) * share);
      line.cost_basis = 'attendance_salary';
      line.per_day_salary = s.per_day;
      line.paid_days = s.breakdown.paid_days;
    } else {
      line.cost_basis = 'none';
    }
    line.margin = round2(line.revenue - line.cost);
    line.approval_status = line.entries.pending ? 'pending' : line.entries.rejected ? 'rejected' : line.entries.approved ? 'approved' : 'no_entries';
    out.push(line);
  }

  // Group by resource (the rows underneath stay per contract).
  const byResource = new Map();
  for (const line of out) {
    if (!byResource.has(line.org_membership_id)) {
      byResource.set(line.org_membership_id, { org_membership_id: line.org_membership_id, name: line.name, worker_type: line.worker_type, projects: [], revenue: 0, cost: 0, margin: 0 });
    }
    const r = byResource.get(line.org_membership_id);
    r.projects.push(line);
    r.revenue = round2(r.revenue + line.revenue);
    r.cost = round2(r.cost + line.cost);
    r.margin = round2(r.margin + line.margin);
  }
  const resources = [...byResource.values()]
    .map((r) => ({
      ...r,
      approval_status: r.projects.some((p) => p.approval_status === 'pending') ? 'pending'
        : r.projects.some((p) => p.approval_status === 'rejected') ? 'rejected'
          : r.projects.some((p) => p.approval_status === 'approved') ? 'approved' : 'no_entries',
      projects: r.projects.sort((a, b) => b.revenue - a.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));

  const pending = out.reduce((s, l) => s + l.entries.pending, 0);
  const rejected = out.reduce((s, l) => s + l.entries.rejected, 0);
  const blockers = [];
  if (pending) blockers.push({ code: 'pending_entries', count: pending, message: `${pending} timesheet ${pending === 1 ? 'entry is' : 'entries are'} still pending approval.` });
  if (rejected) blockers.push({ code: 'rejected_entries', count: rejected, message: `${rejected} rejected ${rejected === 1 ? 'entry has' : 'entries have'} not been corrected.` });
  if (missingRates.size) blockers.push({ code: 'missing_exchange_rate', message: `Set the ${[...missingRates].join(', ')} exchange rate first.` });

  return {
    period_month,
    period_year,
    period_start: start.toISOString().slice(0, 10),
    period_end: end.toISOString().slice(0, 10),
    as_of: asOf ? asOf.toISOString().slice(0, 10) : null,
    currency: 'INR',
    resources,
    lines: out,
    missing_rates: [...missingRates],
    totals: {
      revenue: round2(out.reduce((s, l) => s + l.revenue, 0)),
      cost: round2(out.reduce((s, l) => s + l.cost, 0)),
      margin: round2(out.reduce((s, l) => s + l.margin, 0)),
      resources: resources.length,
    },
    readiness: { can_lock: blockers.length === 0, blockers, warnings: [] },
  };
}

module.exports = { computeResourceRevenue };
