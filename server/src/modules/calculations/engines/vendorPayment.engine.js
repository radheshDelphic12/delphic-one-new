// Vendor payments — what the company owes each vendor for its contractors'
// approved work in a month. Same shape as a resource's salary / a project's
// billing, so the three can be read side by side:
//
//   contractor's monthly vendor_rate (People → user type Contractor), charged
//   to each project by its allocation share (ProjectMemberAssignment
//   .allocation_percent, else an even split across their projects) IN FORCE
//   THAT DAY (allocations are effective-dated — lib/allocations), then per
//   day on that PROJECT's calendar exactly like monthly client billing — the
//   contract, not timesheets (client decision 2026-10-01):
//     each working day inside the agreement = rate × share / working_days
//   plus approved overtime at the hourly equivalent (rate × share /
//   benchmark_hours) — only on a project whose overtime_billable is on (the
//   project setting is the one source of truth for overtime).
//
// Only overtime depends on APPROVED timesheet entries. A contractor is never
// on payroll.
// Amounts are in the vendor rate's currency and converted to INR with
// finance's exchange rates (a currency with no rate is listed, not guessed).

const prisma = require('../../../config/db');
const calendarsService = require('../../calendars/calendars.service');
const exchangeRates = require('../../billing/exchangeRates.service');
const { markResolved } = require('./billing.engine');
const { round2, ymd, monthBounds, monthDates, isWeekend } = require('../period');
const { overlaps, sharesOn, periodShares } = require('../../../lib/allocations');

const DEFAULT_BENCHMARK_HOURS = 160;

async function computeVendorPayments(orgId, { period_month, period_year, vendor_account_id, org_membership_id } = {}) {
  const { start, end } = monthBounds(period_month, period_year);
  const contractors = await prisma.orgMembership.findMany({
    where: {
      org_id: orgId,
      worker_type: 'contractor',
      ...(vendor_account_id ? { vendor_account_id } : {}),
      ...(org_membership_id ? { id: org_membership_id } : {}),
    },
    select: {
      id: true,
      vendor_rate: true,
      vendor_rate_currency: true,
      vendor_account: { select: { id: true, name: true } },
      person: { select: { name: true } },
      project_cost_rates: {
        select: {
          account_id: true,
          allocation_percent: true,
          start_date: true,
          end_date: true,
          account: { select: { id: true, name: true, project_name: true, project_code: true, client_name: true, client_account_id: true, client_account: { select: { id: true, name: true } }, benchmark_hours: true, overtime_billable: true, agreement_start_date: true, agreement_end_date: true } },
        },
      },
    },
  });
  const ids = contractors.map((c) => c.id);
  const [rawEntries, fx] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, org_membership_id: { in: ids }, date: { gte: start, lte: end }, account_id: { not: null } },
      select: { id: true, date: true, hours: true, overtime_hours: true, status: true, account_id: true, org_membership_id: true, approved_at: true, approver: { select: { id: true, name: true } } },
    }),
    exchangeRates.inrRates(orgId),
  ]);
  const entries = markResolved(rawEntries);
  const calendarCache = new Map();
  async function workingDaysFor(accountId) {
    if (!calendarCache.has(accountId)) calendarCache.set(accountId, await calendarsService.projectWorkingDays(orgId, accountId, period_year, period_month));
    return calendarCache.get(accountId);
  }

  const missingRates = new Set();
  const toInr = (amount, currency) => {
    const cur = currency || 'INR';
    if (!fx.has(cur)) { missingRates.add(cur); return 0; }
    return round2(amount * fx.get(cur));
  };

  const vendors = new Map();
  const lines = [];
  for (const c of contractors) {
    const monthlyRate = c.vendor_rate !== null ? Number(c.vendor_rate) : 0;
    const currency = c.vendor_rate_currency || 'INR';
    // Allocation periods in force at some point this month; one line per project.
    const spans = c.project_cost_rates.filter((a) => a.account && overlaps(a, start, end));
    const projects = [...new Map(spans.map((a) => [a.account.id, a.account])).values()];
    const monthShare = periodShares(spans, start, end);
    const mine = entries.filter((e) => e.org_membership_id === c.id);

    for (const account of projects) {
      const share = monthShare.get(account.id) || 0;
      const rateOn = (date) => monthlyRate * (sharesOn(spans, date).get(account.id) || 0);
      const benchmark = account.benchmark_hours || DEFAULT_BENCHMARK_HOURS;
      const { working_days, holiday_dates, working_dates } = await workingDaysFor(account.id);
      const projectEntries = mine.filter((e) => e.account_id === account.id);

      // Approved hours per day on this project.
      const perDay = new Map();
      for (const e of projectEntries) {
        if (e.status !== 'approved') continue;
        const key = ymd(e.date);
        const d = perDay.get(key) || { date: e.date, hours: 0, overtime: 0 };
        d.hours += Number(e.hours);
        d.overtime += Number(e.overtime_hours || 0);
        perDay.set(key, d);
      }
      const inContract = (date) => (!account.agreement_start_date || date >= account.agreement_start_date) && (!account.agreement_end_date || date <= account.agreement_end_date);
      const isWorking = (date) => working_dates?.has(ymd(date)) || (!isWeekend(date) && !holiday_dates.has(ymd(date)));
      // Contract share: every working day inside the agreement, by the
      // allocation in force that day.
      let base = 0;
      let contractDays = 0;
      for (const date of monthDates(period_month, period_year)) {
        if (!isWorking(date) || !inContract(date) || working_days <= 0) continue;
        const dayRate = rateOn(date);
        if (dayRate > 0) contractDays += 1;
        base += dayRate / working_days;
      }
      base = round2(base);
      let overtimeHours = 0;
      let overtimeAmountRaw = 0;
      let approvedHours = 0;
      for (const d of perDay.values()) {
        const dayRate = rateOn(d.date);
        approvedHours += d.hours;
        const otHours = isWorking(d.date) ? d.overtime : d.hours + d.overtime;
        overtimeHours += otHours;
        overtimeAmountRaw += otHours * (dayRate / benchmark);
      }
      const overtimeAmount = account.overtime_billable ? round2(overtimeAmountRaw) : 0;
      const amount = round2(base + overtimeAmount);
      // Unapproved time only holds up the amount where overtime is paid.
      const pending = account.overtime_billable ? projectEntries.filter((e) => e.status === 'submitted').length : 0;
      const rejected = account.overtime_billable ? projectEntries.filter((e) => e.status === 'rejected' && !e.resolved).length : 0;
      const approved = projectEntries.filter((e) => e.status === 'approved');
      const last = approved.sort((x, y) => new Date(y.approved_at || 0) - new Date(x.approved_at || 0))[0];
      const line = {
        vendor: c.vendor_account,
        org_membership_id: c.id,
        contractor: c.person.name,
        project: { id: account.id, code: account.project_code, name: calendarsService.projectName(account), ...calendarsService.clientFields(account), client_account: undefined },
        currency,
        monthly_vendor_rate: monthlyRate,
        allocation_percent: round2(share * 100),
        working_days,
        contract_working_days: contractDays,
        agreement_start_date: account.agreement_start_date ? ymd(account.agreement_start_date) : null,
        agreement_end_date: account.agreement_end_date ? ymd(account.agreement_end_date) : null,
        overtime_billable: Boolean(account.overtime_billable),
        approved_hours: round2(approvedHours),
        overtime_hours: round2(overtimeHours),
        base_amount: base,
        overtime_amount: overtimeAmount,
        amount,
        amount_inr: toInr(amount, currency),
        entries: { approved: approved.length, pending, rejected },
        approval_status: pending ? 'pending' : rejected ? 'rejected' : approved.length ? 'approved' : 'no_entries',
        last_approved_by: last?.approver || null,
        last_approved_at: last?.approved_at || null,
      };
      lines.push(line);
      const vendorKey = c.vendor_account?.id || 'none';
      if (!vendors.has(vendorKey)) vendors.set(vendorKey, { vendor: c.vendor_account, contractors: new Set(), amount_inr: 0, by_currency: {}, pending_entries: 0, rejected_entries: 0 });
      const v = vendors.get(vendorKey);
      v.contractors.add(c.person.name);
      v.amount_inr = round2(v.amount_inr + line.amount_inr);
      v.by_currency[currency] = round2((v.by_currency[currency] || 0) + amount);
      v.pending_entries += pending;
      v.rejected_entries += rejected;
    }
  }

  const vendorList = [...vendors.values()].map((v) => ({ ...v, contractors: [...v.contractors] })).sort((a, b) => b.amount_inr - a.amount_inr);
  const pending = vendorList.reduce((s, v) => s + v.pending_entries, 0);
  const rejected = vendorList.reduce((s, v) => s + v.rejected_entries, 0);
  const blockers = [];
  if (pending) blockers.push({ code: 'pending_entries', count: pending, message: `${pending} contractor timesheet ${pending === 1 ? 'entry is' : 'entries are'} still pending approval.` });
  if (rejected) blockers.push({ code: 'rejected_entries', count: rejected, message: `${rejected} rejected contractor ${rejected === 1 ? 'entry has' : 'entries have'} not been corrected.` });
  if (missingRates.size) blockers.push({ code: 'missing_exchange_rate', message: `Set the ${[...missingRates].join(', ')} exchange rate first.` });
  return {
    period_month,
    period_year,
    currency: 'INR',
    lines,
    vendors: vendorList,
    missing_rates: [...missingRates],
    totals: { amount_inr: round2(vendorList.reduce((s, v) => s + v.amount_inr, 0)), vendors: vendorList.length, contractors: new Set(lines.map((l) => l.org_membership_id)).size },
    readiness: { can_lock: blockers.length === 0, blockers, warnings: [] },
  };
}

module.exports = { computeVendorPayments };
