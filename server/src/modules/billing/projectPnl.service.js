// Finance → Projects: monthly project P&L for managed-services style
// contracts, plus the per-project vendor invoices that feed it.
//
//   Project Profit = Client Monthly Billing
//                  - (Internal Employee Salary Allocations + Vendor Contractor Cost)
//
// Revenue — the account-wide BillingRate in force for the month. A monthly
//   rate is the fixed monthly fee (prorated by calendar days only in the month
//   the agreement starts); an hourly rate is the month's approved, billable
//   timesheet hours x the hourly rate in force on each day, worked out live so
//   a rate set or changed after approval still counts. Nothing is billed
//   before agreement_start_date.
// Internal cost — each full-time employee assigned to the project:
//   * cost rate set on the assignment (ProjectMemberAssignment.cost_rate_per_hr,
//     the resource's INTERNAL cost per hour on this contract): the month's
//     approved hours on this project x that rate — e.g. 8h x Rs 500 = Rs 4,000;
//   * otherwise their monthly salary (SalaryStructure.ctc is monthly) x their
//     allocation share.
//   Never both, and neither is ever used for client billing (that is the
//   project's BillingRate only).
// Vendor cost — each contractor assigned to the project: vendor_rate x share,
//   UNLESS their vendor has invoiced this project for the month, in which case
//   the vendor's actual invoices replace those estimates. Contractor cost is
//   payable to the vendor account, never payroll.
// Allocation share — ProjectMemberAssignment.allocation_percent when set,
//   otherwise an even split across all of that person's project assignments.
// Currency — everything is reported in INR: billing, contractor rates and
// vendor invoices convert with finance's exchange rates (salaries are INR). A
// currency with no rate set is listed in missing_rates and counts as 0, and
// profit / margin are left blank until it is set.

const prisma = require('../../config/db');
const calendarsService = require('../calendars/calendars.service');
const { findVendorAccount } = require('../../lib/workerType');
const exchangeRates = require('./exchangeRates.service');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function periodBounds(month, year) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end, days: end.getUTCDate() };
}

// Rates sharing an effective_from resolve to the one added last.
function latestOnOrBefore(rows, date) {
  return rows.filter((r) => r.effective_from <= date).sort((a, b) => b.effective_from - a.effective_from || b.created_at - a.created_at)[0] || null;
}

async function projectRevenue(orgId, account, { start, end, days }) {
  const agreementStart = account.agreement_start_date;
  if (agreementStart && agreementStart > end) {
    return { amount: 0, billing_type: null, rate: null, currency: account.client_billing_currency || 'INR', note: 'before_agreement_start' };
  }
  const rates = await prisma.billingRate.findMany({
    where: { org_id: orgId, account_id: account.id, requirement_id: null },
    select: { rate_type: true, rate: true, currency: true, effective_from: true, created_at: true },
  });
  const rate = latestOnOrBefore(rates, end);
  if (!rate) return { amount: 0, billing_type: null, rate: null, currency: account.client_billing_currency || 'INR', note: 'no_billing_rate' };

  if (rate.rate_type === 'monthly') {
    const from = agreementStart && agreementStart > start ? agreementStart : start;
    const billedDays = Math.round((end - from) / 86400000) + 1;
    const amount = billedDays >= days ? Number(rate.rate) : (Number(rate.rate) * billedDays) / days;
    return { amount: round2(amount), billing_type: 'monthly', rate: Number(rate.rate), currency: rate.currency, prorated_days: billedDays < days ? billedDays : null };
  }

  const from = agreementStart && agreementStart > start ? agreementStart : start;
  const entries = await prisma.timesheetEntry.findMany({
    where: { org_id: orgId, account_id: account.id, status: 'approved', billable: true, date: { gte: from, lte: end } },
    select: { date: true, hours: true },
  });
  let hours = 0;
  let amount = 0;
  for (const e of entries) {
    const onDay = latestOnOrBefore(rates, e.date);
    if (onDay?.rate_type !== 'hourly') continue;
    hours += Number(e.hours);
    amount += Number(e.hours) * Number(onDay.rate);
  }
  return { amount: round2(amount), billing_type: 'hourly', rate: Number(rate.rate), currency: rate.currency, billable_hours: round2(hours) };
}

// Converts to INR with the org's rates, recording any currency without one.
function inrConverter(fx) {
  const missing = new Set();
  const toInr = (amount, currency) => {
    const cur = currency || 'INR';
    if (!fx.has(cur)) { missing.add(cur); return 0; }
    return round2(Number(amount || 0) * fx.get(cur));
  };
  return { toInr, missing };
}

async function computeProjectPnl(orgId, accountId, { period_month, period_year }, fx = null) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, org_id: orgId, type: 'client' },
    select: { id: true, name: true, project_name: true, project_code: true, client_name: true, client_account_id: true, client_account: { select: { name: true } }, agreement_start_date: true, client_billing_currency: true },
  });
  if (!account) return { error: 'account_not_found' };
  const bounds = periodBounds(period_month, period_year);

  const assignments = await prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId, account_id: accountId },
    select: {
      org_membership_id: true,
      allocation_percent: true,
      cost_rate_per_hr: true,
      org_membership: {
        select: {
          id: true,
          worker_type: true,
          vendor_account_id: true,
          vendor_account: { select: { id: true, name: true } },
          vendor_rate: true,
          vendor_rate_currency: true,
          person: { select: { name: true } },
        },
      },
    },
  });
  const membershipIds = assignments.map((a) => a.org_membership_id);
  const [assignmentCounts, salaries, invoices, revenue, rates, hoursRows] = await Promise.all([
    prisma.projectMemberAssignment.groupBy({ by: ['org_membership_id'], where: { org_id: orgId, org_membership_id: { in: membershipIds } }, _count: { _all: true } }),
    prisma.salaryStructure.findMany({
      where: { org_id: orgId, org_membership_id: { in: membershipIds }, effective_from: { lte: bounds.end } },
      select: { org_membership_id: true, ctc: true, effective_from: true, created_at: true },
    }),
    listVendorInvoices(orgId, accountId, { period_month, period_year }),
    projectRevenue(orgId, account, bounds),
    fx || exchangeRates.inrRates(orgId),
    prisma.timesheetEntry.groupBy({
      by: ['org_membership_id'],
      where: { org_id: orgId, account_id: accountId, status: 'approved', date: { gte: bounds.start, lte: bounds.end } },
      _sum: { hours: true, overtime_hours: true },
    }),
  ]);
  const approvedHours = new Map(hoursRows.map((h) => [h.org_membership_id, Number(h._sum.hours || 0) + Number(h._sum.overtime_hours || 0)]));
  const { toInr, missing } = inrConverter(rates);
  const countByMembership = new Map(assignmentCounts.map((c) => [c.org_membership_id, c._count._all]));
  const share = (a) => (a.allocation_percent !== null ? Number(a.allocation_percent) / 100 : 1 / (countByMembership.get(a.org_membership_id) || 1));

  const internal = [];
  const contractors = [];
  for (const a of assignments) {
    const m = a.org_membership;
    const allocation = round2(share(a) * 100);
    if (m.worker_type === 'contractor') {
      const monthly = m.vendor_rate !== null ? Number(m.vendor_rate) : 0;
      contractors.push({
        org_membership_id: m.id,
        name: m.person.name,
        vendor: m.vendor_account,
        vendor_rate: monthly,
        currency: m.vendor_rate_currency || 'INR',
        allocation_percent: allocation,
        estimated_cost: toInr(monthly * share(a), m.vendor_rate_currency),
      });
    } else {
      const structure = latestOnOrBefore(salaries.filter((s) => s.org_membership_id === m.id), bounds.end);
      const monthly = structure ? Number(structure.ctc) : 0;
      const costRate = a.cost_rate_per_hr !== null ? Number(a.cost_rate_per_hr) : null;
      const hours = round2(approvedHours.get(m.id) || 0);
      internal.push({
        org_membership_id: m.id,
        name: m.person.name,
        monthly_salary: monthly,
        allocation_percent: allocation,
        cost_rate_per_hr: costRate,
        approved_hours: hours,
        cost_basis: costRate !== null ? 'cost_rate' : 'allocation',
        cost: costRate !== null ? round2(hours * costRate) : round2(monthly * share(a)),
        missing_salary: costRate === null && !structure,
      });
    }
  }

  // Vendors that invoiced this project for the month: actual invoices replace
  // the vendor_rate estimates of that vendor's contractors.
  const invoicedVendorIds = new Set(invoices.map((i) => i.vendor_account_id));
  const vendorsById = new Map();
  for (const c of contractors) {
    const key = c.vendor?.id || 'none';
    if (!vendorsById.has(key)) vendorsById.set(key, { vendor: c.vendor, estimated_cost: 0, invoiced_amount: 0, contractors: [] });
    const v = vendorsById.get(key);
    v.estimated_cost = round2(v.estimated_cost + c.estimated_cost);
    v.contractors.push(c.name);
  }
  for (const inv of invoices) {
    if (!vendorsById.has(inv.vendor_account_id)) vendorsById.set(inv.vendor_account_id, { vendor: inv.vendor_account, estimated_cost: 0, invoiced_amount: 0, contractors: [] });
    const v = vendorsById.get(inv.vendor_account_id);
    v.invoiced_amount = round2(v.invoiced_amount + toInr(inv.amount, inv.currency));
  }
  const vendorLines = [...vendorsById.values()].map((v) => {
    const invoiced = Boolean(v.vendor && invoicedVendorIds.has(v.vendor.id));
    return { ...v, basis: invoiced ? 'invoice' : 'vendor_rate', cost: invoiced ? v.invoiced_amount : v.estimated_cost };
  });

  const internalCost = round2(internal.reduce((s, r) => s + r.cost, 0));
  const vendorCost = round2(vendorLines.reduce((s, r) => s + r.cost, 0));
  const totalCost = round2(internalCost + vendorCost);
  const revenueInr = toInr(revenue.amount, revenue.currency);
  const missingRates = [...missing];
  const profit = missingRates.length ? null : round2(revenueInr - totalCost);

  return {
    pnl: {
      project: { id: account.id, code: account.project_code || null, name: calendarsService.projectName(account), client_account_id: account.client_account_id || null, client_name: account.client_account?.name || account.client_name || null },
      period_month,
      period_year,
      currency: 'INR',
      missing_rates: missingRates,
      // amount is INR; original_amount / original_currency are as billed.
      revenue: { ...revenue, amount: revenueInr, original_amount: revenue.amount, original_currency: revenue.currency, currency: 'INR' },
      internal: { cost: internalCost, employees: internal },
      vendor: { cost: vendorCost, vendors: vendorLines, contractors, invoices: invoices.map((i) => ({ ...i, amount_inr: toInr(i.amount, i.currency) })) },
      total_cost: totalCost,
      profit,
      margin_percent: profit !== null && revenueInr > 0 ? round2((profit / revenueInr) * 100) : null,
    },
  };
}

// Every active client project for one month — the Finance summary table,
// optionally narrowed to a project type (service category; 'none' = not set)
// and/or a client.
async function listProjectsPnl(orgId, { period_month, period_year, project_type = 'all', client_account_id } = {}) {
  const period = { period_month, period_year };
  const where = { org_id: orgId, type: 'client', stage: 'active' };
  if (client_account_id) where.client_account_id = client_account_id;
  if (project_type === 'none') where.service_category = null;
  else if (project_type && project_type !== 'all') where.service_category = project_type;
  const [accounts, fx] = await Promise.all([
    prisma.account.findMany({ where, select: { id: true, service_category: true }, orderBy: { name: 'asc' } }),
    exchangeRates.inrRates(orgId),
  ]);
  const rows = [];
  for (const { id, service_category } of accounts) {
    const { pnl } = await computeProjectPnl(orgId, id, period, fx);
    rows.push({
      project: pnl.project,
      service_category,
      currency: pnl.currency,
      missing_rates: pnl.missing_rates,
      revenue: pnl.revenue.amount,
      original_revenue: pnl.revenue.original_amount,
      original_currency: pnl.revenue.original_currency,
      billing_type: pnl.revenue.billing_type,
      billing_rate: pnl.revenue.rate,
      billable_hours: pnl.revenue.billable_hours ?? null,
      internal_cost: pnl.internal.cost,
      vendor_cost: pnl.vendor.cost,
      total_cost: pnl.total_cost,
      profit: pnl.profit,
      margin_percent: pnl.margin_percent,
    });
  }
  return rows;
}

// --- Vendor invoices ---------------------------------------------------------

const INVOICE_INCLUDE = { vendor_account: { select: { id: true, name: true } } };

function serializeInvoice(row) {
  return { ...row, amount: Number(row.amount) };
}

async function listVendorInvoices(orgId, accountId, { period_month, period_year } = {}) {
  const rows = await prisma.projectVendorInvoice.findMany({
    where: {
      org_id: orgId,
      account_id: accountId,
      ...(period_month ? { period_month } : {}),
      ...(period_year ? { period_year } : {}),
    },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }, { created_at: 'desc' }],
    include: INVOICE_INCLUDE,
  });
  return rows.map(serializeInvoice);
}

async function createVendorInvoice(orgId, actorUserId, accountId, body) {
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: { id: true } });
  if (!account) return { error: 'account_not_found' };
  if (!(await findVendorAccount(orgId, body.vendor_account_id))) return { error: 'vendor_not_found' };
  const invoice = await prisma.projectVendorInvoice.create({
    data: { ...body, org_id: orgId, account_id: accountId, created_by: actorUserId },
    include: INVOICE_INCLUDE,
  });
  return { invoice: serializeInvoice(invoice) };
}

async function updateVendorInvoice(orgId, invoiceId, patch) {
  const existing = await prisma.projectVendorInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (patch.vendor_account_id && !(await findVendorAccount(orgId, patch.vendor_account_id))) return { error: 'vendor_not_found' };
  const invoice = await prisma.projectVendorInvoice.update({ where: { id: invoiceId }, data: patch, include: INVOICE_INCLUDE });
  return { invoice: serializeInvoice(invoice) };
}

async function removeVendorInvoice(orgId, invoiceId) {
  const existing = await prisma.projectVendorInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  await prisma.projectVendorInvoice.delete({ where: { id: invoiceId } });
  return { deleted: true };
}

// Vendor companies for the contractor + invoice pickers (Accounts, type vendor).
async function listVendors(orgId) {
  return prisma.account.findMany({ where: { org_id: orgId, type: 'vendor' }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

module.exports = {
  computeProjectPnl,
  listProjectsPnl,
  listVendorInvoices,
  createVendorInvoice,
  updateVendorInvoice,
  removeVendorInvoice,
  listVendors,
};
