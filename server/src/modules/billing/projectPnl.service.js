// Finance → Projects: monthly project P&L for managed-services style
// contracts, plus the per-project vendor invoices that feed it.
//
//   Project Profit = Client Monthly Billing
//                  - (Internal Employee Salary Allocations + Vendor Contractor Cost)
//
// Revenue — the account-wide BillingRate in force for the month. A monthly
//   rate is the fixed monthly fee (prorated by calendar days in the months the
//   agreement starts or ends); an hourly rate is exactly what the billing
//   engine bills (calculations/engines/billing.engine — the locked snapshot
//   when the month is locked): approved, billable hours x the hourly rate in
//   force on each day, plus approved overtime only where the project bills
//   it. Nothing is billed outside agreement_start_date..agreement_end_date.
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
const { overlaps, periodShares, byMembership } = require('../../lib/allocations');
const { projectListWhere } = require('../../lib/projectScope');
const { contractState } = require('../../lib/contractState');

// Same default as the billing engine when a project has no benchmark set.
const DEFAULT_BENCHMARK_HOURS = 160;

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

  const agreementEnd = account.agreement_end_date;
  if (rate.rate_type === 'monthly') {
    if (agreementEnd && agreementEnd < start) {
      return { amount: 0, billing_type: 'monthly', rate: Number(rate.rate), currency: rate.currency, note: 'after_agreement_end' };
    }
    // Prorated by calendar days in the months the agreement starts or ends.
    const from = agreementStart && agreementStart > start ? agreementStart : start;
    const to = agreementEnd && agreementEnd < end ? agreementEnd : end;
    const billedDays = Math.round((to - from) / 86400000) + 1;
    const amount = billedDays >= days ? Number(rate.rate) : (Number(rate.rate) * billedDays) / days;
    return { amount: round2(amount), billing_type: 'monthly', rate: Number(rate.rate), currency: rate.currency, prorated_days: billedDays < days ? billedDays : null };
  }

  // Hourly: the SAME figure Billing & Sales, the billing lock and the invoice
  // use — the month's locked snapshot when locked, otherwise the billing
  // engine live (approved billable hours x the rate in force each day, inside
  // the agreement start AND end dates, plus approved overtime x rate x
  // multiplier only when the project bills overtime). Lazy-required: the
  // engine loads billing.service, which loads this file.
  const billingEngine = require('../calculations/engines/billing.engine');
  const calculations = require('../calculations/calculations.service');
  const period = { period_month: start.getUTCMonth() + 1, period_year: start.getUTCFullYear() };
  const locked = await calculations.lockedVersion(orgId, 'billing', account.id, period);
  const raw = locked ? locked.snapshot : await billingEngine.computeProjectMonth(orgId, account.id, period);
  const overtimeBilled = Boolean(raw.overtime?.enabled);
  // Hours logged but not billed are reported in `excluded` with the reason,
  // so no hours disappear silently.
  const excluded = { pending_approval: 0, non_billable: 0, outside_agreement: 0, no_hourly_rate: 0, overtime: 0, not_supported: 0 };
  let hours = 0;
  let overtimeHours = 0;
  for (const d of raw.days) {
    excluded.pending_approval += d.hours.pending;
    const regular = d.hours.approved;
    const ot = d.hours.overtime_approved;
    if (!raw.supported) { excluded.not_supported += regular + ot; continue; }
    if (!d.in_contract) { excluded.outside_agreement += regular + ot; continue; }
    if (d.rate_type !== 'hourly') { excluded.no_hourly_rate += regular + ot; continue; }
    hours += regular;
    if (overtimeBilled) overtimeHours += ot;
    else excluded.overtime += ot;
  }
  const nonBillable = await prisma.timesheetEntry.aggregate({
    where: { org_id: orgId, account_id: account.id, billable: false, status: { not: 'rejected' }, date: { gte: start, lte: end } },
    _sum: { hours: true, overtime_hours: true },
  });
  excluded.non_billable = Number(nonBillable._sum.hours || 0) + Number(nonBillable._sum.overtime_hours || 0);
  for (const k of Object.keys(excluded)) excluded[k] = round2(excluded[k]);
  const amount = billingEngine.lockedAmount(raw);
  const overtimeAmount = overtimeBilled ? round2(raw.days.reduce((s, d) => s + d.overtime_amount, 0)) : 0;
  return {
    amount,
    billing_type: 'hourly',
    rate: Number(rate.rate),
    currency: raw.currency || rate.currency,
    billable_hours: round2(hours),
    overtime_hours: round2(overtimeHours),
    overtime_amount: overtimeAmount,
    locked: Boolean(locked),
    excluded,
  };
}

async function computeProjectPnl(orgId, accountId, { period_month, period_year }, fx = null) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, org_id: orgId, type: 'client' },
    select: { id: true, name: true, project_name: true, project_code: true, client_name: true, client_account_id: true, client_account: { select: { name: true } }, agreement_start_date: true, agreement_end_date: true, client_billing_currency: true },
  });
  if (!account) return { error: 'account_not_found' };
  const bounds = periodBounds(period_month, period_year);

  // Allocation periods on this project in force during the month (effective-
  // dated: someone moved off mid-month is only charged for their days here).
  const spansHere = (await prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId, account_id: accountId },
    orderBy: { start_date: 'asc' },
    select: {
      org_membership_id: true,
      allocation_percent: true,
      cost_rate_per_hr: true,
      start_date: true,
      end_date: true,
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
  })).filter((a) => overlaps(a, bounds.start, bounds.end));
  // One row per person: their latest span here carries the cost rate.
  const assignments = [...new Map(spansHere.map((a) => [a.org_membership_id, a])).values()];
  const membershipIds = assignments.map((a) => a.org_membership_id);
  const [allSpans, salaries, invoices, revenue, rates, hoursRows] = await Promise.all([
    prisma.projectMemberAssignment.findMany({ where: { org_id: orgId, org_membership_id: { in: membershipIds } }, select: { org_membership_id: true, account_id: true, allocation_percent: true, start_date: true, end_date: true } }),
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
  const { toInr, missing } = exchangeRates.inrConverter(rates);
  // Each person's day-weighted share of the month on this project, across
  // all their allocations (an even split counts the projects active each day).
  const spansByPerson = byMembership(allSpans);
  const shareByPerson = new Map(membershipIds.map((id) => [id, periodShares(spansByPerson.get(id) || [], bounds.start, bounds.end).get(accountId) || 0]));
  const share = (a) => shareByPerson.get(a.org_membership_id) || 0;

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
  const where = projectListWhere(orgId);
  if (client_account_id) where.client_account_id = client_account_id;
  if (project_type === 'none') where.service_category = null;
  else if (project_type && project_type !== 'all') where.service_category = project_type;
  const [accounts, fx] = await Promise.all([
    prisma.account.findMany({
      where,
      select: { id: true, service_category: true, contract_status: true, agreement_start_date: true, agreement_end_date: true, minimum_monthly_hours: true },
      orderBy: { name: 'asc' },
    }),
    exchangeRates.inrRates(orgId),
  ]);
  const rows = [];
  for (const account of accounts) {
    const { id, service_category } = account;
    const { pnl } = await computeProjectPnl(orgId, id, period, fx);
    // Hourly projects with a committed minimum: the month's shortfall, if any.
    const minimumHours = account.minimum_monthly_hours !== null ? Number(account.minimum_monthly_hours) : null;
    const minimum = pnl.revenue.billing_type === 'hourly' && minimumHours !== null
      ? { hours: minimumHours, shortfall_hours: Math.round(Math.max(0, minimumHours - (pnl.revenue.billable_hours || 0)) * 100) / 100 }
      : null;
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
      overtime_hours: pnl.revenue.overtime_hours ?? null,
      minimum,
      contract: contractState(account),
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

// Admin edit of a vendor invoice row: number, date, notes, amount, currency
// (and the vendor). On a generated row an amount / currency change also
// refreshes its INR figure and is flagged in details.manual_override. Audited.
async function updateVendorInvoice(orgId, invoiceId, patch, actorUserId = null) {
  const existing = await prisma.projectVendorInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (patch.vendor_account_id && !(await findVendorAccount(orgId, patch.vendor_account_id))) return { error: 'vendor_not_found' };
  const { invoice_date: date, ...rest } = patch;
  const data = { ...rest, ...(date ? { invoice_date: new Date(date) } : {}) };
  const moneyChanged = (data.amount !== undefined && Number(data.amount) !== Number(existing.amount)) || (data.currency && data.currency !== existing.currency);
  if (moneyChanged && existing.details && !Array.isArray(existing.details)) {
    const currency = data.currency || existing.currency;
    const amount = data.amount !== undefined ? Number(data.amount) : Number(existing.amount);
    const fx = await exchangeRates.inrRates(orgId);
    const rate = fx.has(currency) ? fx.get(currency) : null;
    data.details = {
      ...existing.details,
      exchange_rate: rate,
      amount_inr: rate === null ? null : Math.round(amount * rate * 100) / 100,
      manual_override: { original_amount: existing.details.manual_override?.original_amount ?? Number(existing.amount), original_currency: existing.details.manual_override?.original_currency ?? existing.currency, by: actorUserId, at: new Date().toISOString() },
    };
  }
  const invoice = await prisma.projectVendorInvoice.update({ where: { id: invoiceId }, data, include: INVOICE_INCLUDE });
  await prisma.auditLog.create({
    data: {
      org_id: orgId,
      actor_id: actorUserId,
      action: 'vendor_invoice_edit',
      entity_type: 'vendor_invoice',
      entity_id: invoiceId,
      reason: `Vendor invoice ${invoice.invoice_number || invoiceId} edited`,
      snapshot: {
        before: { invoice_number: existing.invoice_number, invoice_date: existing.invoice_date, notes: existing.notes, amount: Number(existing.amount), currency: existing.currency },
        after: { invoice_number: invoice.invoice_number, invoice_date: invoice.invoice_date, notes: invoice.notes, amount: Number(invoice.amount), currency: invoice.currency },
      },
    },
  });
  return { invoice: serializeInvoice(invoice) };
}

async function removeVendorInvoice(orgId, invoiceId, reason = null, actorUserId = null) {
  const existing = await prisma.projectVendorInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  await prisma.projectVendorInvoice.delete({ where: { id: invoiceId } });
  if (actorUserId) {
    await prisma.auditLog.create({
      data: {
        org_id: orgId,
        actor_id: actorUserId,
        action: 'vendor_invoice_delete',
        entity_type: 'vendor_invoice',
        entity_id: invoiceId,
        reason: (reason || '').trim() || `Vendor invoice ${existing.invoice_number || invoiceId} deleted`,
        snapshot: { invoice_number: existing.invoice_number, amount: Number(existing.amount), currency: existing.currency, vendor_account_id: existing.vendor_account_id, account_id: existing.account_id, period_month: existing.period_month, period_year: existing.period_year },
      },
    });
  }
  return { deleted: true };
}

// Vendor companies for the contractor + invoice pickers (Accounts, type vendor).
async function listVendors(orgId) {
  return prisma.account.findMany({ where: { org_id: orgId, type: 'vendor' }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

// An hourly contract's hours per month: the client's committed minimum
// (Account.minimum_monthly_hours), else the project's monthly benchmark.
function contractHours(account) {
  if (account.minimum_monthly_hours !== null && account.minimum_monthly_hours !== undefined) return { hours: Number(account.minimum_monthly_hours), basis: 'minimum' };
  return { hours: Number(account.benchmark_hours) || DEFAULT_BENCHMARK_HOURS, basis: 'benchmark' };
}

// This month's CONTRACT billing for Finance -> Projects, per project, in INR:
// what the agreement says, not what was worked. A monthly rate is the fixed
// fee; an hourly rate is the contract hours x the rate (contractHours: the
// committed minimum, else the monthly benchmark). Both are prorated by
// calendar days in the months the agreement starts or ends, and 0 outside it.
// Actual approved hours are the Project P&L's job (projectRevenue above) —
// e.g. a 60h contract where 55h were worked shows 60h here and 55h in the P&L.
async function monthContractByProject(orgId, accounts, { period_month, period_year }, fx) {
  const bounds = periodBounds(period_month, period_year);
  const { start, end, days } = bounds;
  const { toInr, rateFor } = exchangeRates.inrConverter(fx);
  const rates = await prisma.billingRate.findMany({
    where: { org_id: orgId, account_id: { in: accounts.map((a) => a.id) }, requirement_id: null },
    select: { account_id: true, rate_type: true, rate: true, currency: true, effective_from: true, created_at: true },
  });
  const out = new Map();
  for (const account of accounts) {
    const rate = latestOnOrBefore(rates.filter((r) => r.account_id === account.id), end);
    const currency = rate ? rate.currency : account.client_billing_currency || 'INR';
    const hours = contractHours(account);
    const row = { period_month, period_year, billing_type: rate ? rate.rate_type : null, rate: rate ? Number(rate.rate) : null, currency, contract_hours: null, hours_basis: null, prorated_days: null, amount: null, amount_inr: null, note: null };
    const from = account.agreement_start_date && account.agreement_start_date > start ? account.agreement_start_date : start;
    const to = account.agreement_end_date && account.agreement_end_date < end ? account.agreement_end_date : end;
    if (!rate) row.note = 'no_billing_rate';
    else if (to < from) {
      row.note = account.agreement_start_date && account.agreement_start_date > end ? 'before_agreement_start' : 'after_agreement_end';
      row.amount = 0;
    } else {
      const billedDays = Math.round((to - from) / 86400000) + 1;
      const share = billedDays >= days ? 1 : billedDays / days;
      if (billedDays < days) row.prorated_days = billedDays;
      if (rate.rate_type === 'hourly') {
        row.contract_hours = round2(hours.hours * share);
        row.hours_basis = hours.basis;
      }
      const full = rate.rate_type === 'hourly' ? Number(rate.rate) * hours.hours : Number(rate.rate);
      row.amount = round2(full * share);
    }
    if (row.amount !== null && rateFor(currency) !== null) row.amount_inr = toInr(row.amount, currency);
    out.set(account.id, row);
  }
  return out;
}

module.exports = {
  contractHours,
  monthContractByProject,
  computeProjectPnl,
  listProjectsPnl,
  listVendorInvoices,
  createVendorInvoice,
  updateVendorInvoice,
  removeVendorInvoice,
  listVendors,
};
