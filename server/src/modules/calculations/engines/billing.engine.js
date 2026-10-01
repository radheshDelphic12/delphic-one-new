// Billing & Sales — what each project/contract bills its client for a month,
// date by date, from its CONTRACT (billing rate + agreement dates); hours
// only matter where the contract is priced by the hour.
//
// The project's type picks the engine:
//   managed_services (and legacy projects with no type) — active, below.
//   project (fixed price) — recognised, but its calculation is not built yet:
//     a fixed amount must never be run through hour/day billing, so it
//     returns `supported: false` and bills nothing here.
//
// Managed services, per day, on the project's OWN calendar:
//   monthly rate: every working day inside the agreement earns
//     rate / working_days (the calendar's actual working days: 19, 20, 21,
//     22 …), whatever hours were logged — billing follows the contract, not
//     timesheets (client decision 2026-10-01). A full month bills exactly the
//     rate; a month the agreement starts or ends in bills
//     rate × contract working days / working days. Weekends and calendar
//     holidays earn nothing as base billing.
//   hourly rate:  day = approved regular hours × rate.
//   overtime:     approved `overtime_hours` (plus, on a monthly contract,
//     hours worked on a weekend / holiday) × the hourly-equivalent rate
//     (hourly rate, or monthly rate / benchmark_hours) × the project's
//     overtime_multiplier — ONLY when the project has overtime_billable on.
//     The project's setting is the source of truth; the Billing & Sales
//     "include overtime" toggle only chooses whether to show it.
// Nothing bills before agreement_start_date or after agreement_end_date.
// A day's amount is split across the resources who worked it pro-rata by
// hours, so one resource on several projects gets a line per project.

const prisma = require('../../../config/db');
const calendarsService = require('../../calendars/calendars.service');
const { round2, ymd, monthBounds, monthDates, isWeekend, todayIst } = require('../period');
const { projectListWhere } = require('../../../lib/projectScope');

const DEFAULT_BENCHMARK_HOURS = 160;

const PROJECT_SELECT = {
  id: true,
  name: true,
  project_name: true,
  project_code: true,
  client_name: true,
  client_account_id: true,
  client_account: { select: { id: true, name: true } },
  service_category: true,
  agreement_start_date: true,
  agreement_end_date: true,
  benchmark_hours: true,
  client_billing_currency: true,
  overtime_billable: true,
  overtime_multiplier: true,
  estimated_monthly_hours: true,
  minimum_monthly_hours: true,
  client_billing_basis: true,
  vendor_payout_basis: true,
  billable_day_hours: true,
};

function engineFor(serviceCategory) {
  if (serviceCategory === 'project') return { engine: 'fixed_price', supported: false, note: 'Fixed-price calculation is not enabled yet — a fixed amount is never billed by hours or days.' };
  if (serviceCategory === 'recruitment') return { engine: 'recruitment', supported: false, note: 'Recruitment billing is not part of Billing & Sales yet.' };
  return { engine: 'managed_services', supported: true, note: null };
}

function describeProject(account) {
  return {
    id: account.id,
    code: account.project_code || null,
    name: calendarsService.projectName(account),
    client_account_id: account.client_account_id || null,
    client_name: account.client_account?.name || account.client_name || null,
    service_category: account.service_category || null,
  };
}

// Rates sharing an effective_from resolve to the one added last.
function rateOn(rates, date) {
  return rates
    .filter((r) => r.effective_from <= date)
    .sort((a, b) => b.effective_from - a.effective_from || b.created_at - a.created_at)[0] || null;
}

// A rejected entry is resolved once the same person has logged a non-rejected
// entry for the same project and day (they re-submitted the corrected time).
function markResolved(entries) {
  const liveKeys = new Set(entries.filter((e) => e.status !== 'rejected').map((e) => `${e.org_membership_id}|${ymd(e.date)}`));
  return entries.map((e) => ({ ...e, resolved: e.status !== 'rejected' || liveKeys.has(`${e.org_membership_id}|${ymd(e.date)}`) }));
}

function dayStatus(entries, { inContract, isWorkingDay }) {
  if (entries.some((e) => e.status === 'submitted')) return 'pending';
  if (entries.some((e) => e.status === 'rejected' && !e.resolved)) return 'rejected';
  if (entries.some((e) => e.status === 'approved')) return 'approved';
  if (!inContract) return 'outside_contract';
  return isWorkingDay ? 'no_entry' : 'non_working';
}

async function projectCalendar(orgId, accountId, month, year) {
  const mapped = await prisma.projectCalendar.findFirst({ where: { org_id: orgId, account_id: accountId }, select: { calendar: { select: { id: true, name: true } } } });
  const calendar = mapped?.calendar || (await calendarsService.defaultCalendar(orgId));
  const { start, end } = monthBounds(month, year);
  const holidays = calendar
    ? await prisma.calendarHoliday.findMany({ where: { calendar_id: calendar.id, date: { gte: start, lte: end } }, select: { date: true, label: true, is_working_day: true } })
    : [];
  const holidayLabels = new Map(holidays.filter((h) => !h.is_working_day).map((h) => [ymd(h.date), h.label]));
  // Client working-day exceptions (e.g. a working Sunday) count as working days.
  const workingDates = new Set(holidays.filter((h) => h.is_working_day).map((h) => ymd(h.date)));
  const working_days = calendarsService.countWorkingDays(year, month, new Set(holidayLabels.keys()), workingDates);
  return { calendar: calendar ? { id: calendar.id, name: calendar.name } : null, holidayLabels, workingDates, working_days };
}

// Monthly contract days carry an unrounded rate / working_days share. Round
// each to the cent and put the rounding remainder on the last such day, so
// the month totals exactly rate × contract working days / working days (a
// full month = exactly the rate). Resource lines follow their day.
function settleMonthlyDays(days) {
  const monthly = days.filter((d) => d.rate_type === 'monthly' && d.base_amount > 0);
  if (!monthly.length) return;
  const exact = monthly.reduce((s, d) => s + d.base_amount, 0);
  let rounded = 0;
  monthly.forEach((d, i) => {
    d.base_amount = i === monthly.length - 1 ? round2(round2(exact) - rounded) : round2(d.base_amount);
    rounded = round2(rounded + d.base_amount);
    const regular = d.resources.reduce((s, r) => s + r.regular_hours, 0);
    for (const r of d.resources) r.base_amount = regular > 0 ? round2((d.base_amount * r.regular_hours) / regular) : 0;
  });
}

// The full, unfiltered month for one project — exactly what a lock stores.
async function computeProjectMonth(orgId, accountOrId, { period_month, period_year }, now = new Date()) {
  const account = typeof accountOrId === 'string'
    ? await prisma.account.findFirst({ where: { id: accountOrId, org_id: orgId }, select: PROJECT_SELECT })
    : accountOrId;
  if (!account) return null;
  const { start, end } = monthBounds(period_month, period_year);
  const { engine, supported, note } = engineFor(account.service_category);
  const project = describeProject(account);

  const [rates, rawEntries, cal, adjustmentRows] = await Promise.all([
    prisma.billingRate.findMany({
      where: { org_id: orgId, account_id: account.id, requirement_id: null },
      select: { id: true, rate_type: true, rate: true, currency: true, effective_from: true, created_at: true },
    }),
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, account_id: account.id, billable: true, date: { gte: start, lte: end } },
      orderBy: [{ date: 'asc' }, { created_at: 'asc' }],
      select: {
        id: true,
        date: true,
        hours: true,
        overtime_hours: true,
        status: true,
        approved_at: true,
        decision_reason: true,
        org_membership_id: true,
        org_membership: { select: { worker_type: true, person: { select: { name: true } } } },
        approver: { select: { id: true, name: true } },
      },
    }),
    projectCalendar(orgId, account.id, period_month, period_year),
    prisma.billingAdjustment.findMany({
      where: { org_id: orgId, account_id: account.id, period_month, period_year },
      orderBy: { created_at: 'asc' },
      select: { id: true, amount: true, reason: true, created_at: true, creator: { select: { id: true, name: true } } },
    }),
  ]);
  const entries = markResolved(rawEntries);
  const monthRate = rateOn(rates, end);
  const benchmark = account.benchmark_hours || DEFAULT_BENCHMARK_HOURS;
  const overtimeEnabled = Boolean(account.overtime_billable);
  const multiplier = Number(account.overtime_multiplier ?? 1) || 1;
  // Monthly rate billed by the contract (retainer) or by approved hours per day.
  const billingBasis = account.client_billing_basis === 'approved_hours' ? 'approved_hours' : 'contract';
  const dayHours = Number(account.billable_day_hours ?? 8) || 8;
  const adjustmentItems = adjustmentRows.map((a) => ({ id: a.id, amount: round2(Number(a.amount)), reason: a.reason, created_at: a.created_at, by: a.creator ? { id: a.creator.id, name: a.creator.name } : null }));
  const adjustmentTotal = round2(adjustmentItems.reduce((sum, a) => sum + a.amount, 0));
  const agreementStart = account.agreement_start_date;
  const agreementEnd = account.agreement_end_date;

  const byDate = new Map();
  for (const e of entries) {
    const key = ymd(e.date);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(e);
  }

  const days = [];
  for (const date of monthDates(period_month, period_year)) {
    const key = ymd(date);
    const holiday = cal.holidayLabels.get(key) || null;
    const isWorkingDay = cal.workingDates.has(key) || (!isWeekend(date) && !holiday);
    const inContract = (!agreementStart || date >= agreementStart) && (!agreementEnd || date <= agreementEnd);
    const dayEntries = byDate.get(key) || [];
    const rate = rateOn(rates, date);

    // Per resource, approved hours only.
    const perResource = new Map();
    for (const e of dayEntries) {
      if (!perResource.has(e.org_membership_id)) {
        perResource.set(e.org_membership_id, {
          org_membership_id: e.org_membership_id,
          name: e.org_membership.person.name,
          worker_type: e.org_membership.worker_type,
          regular_hours: 0,
          overtime_hours: 0,
          pending_hours: 0,
          rejected_hours: 0,
          base_amount: 0,
          overtime_amount: 0,
        });
      }
      const r = perResource.get(e.org_membership_id);
      const hours = Number(e.hours);
      const ot = Number(e.overtime_hours || 0);
      if (e.status === 'approved') {
        // On a monthly contract, time on a weekend/holiday is outside the
        // retainer: it's overtime (billed only if the project allows it).
        if (rate?.rate_type === 'monthly' && !isWorkingDay) r.overtime_hours += hours + ot;
        else { r.regular_hours += hours; r.overtime_hours += ot; }
      } else if (e.status === 'submitted') r.pending_hours += hours + ot;
      else if (!e.resolved) r.rejected_hours += hours + ot;
    }
    const resources = [...perResource.values()];
    const regular = resources.reduce((s, r) => s + r.regular_hours, 0);
    const overtime = resources.reduce((s, r) => s + r.overtime_hours, 0);

    let base = 0;
    let otRate = 0;
    let payable = 0;
    if (supported && inContract && rate) {
      if (rate.rate_type === 'hourly') {
        base = round2(regular * Number(rate.rate));
        otRate = Number(rate.rate) * multiplier;
      } else {
        // Contract share of the day; settled to the cent after the loop. On the
        // approved_hours basis the day counts for the approved hours logged on it.
        payable = billingBasis === 'approved_hours' ? Math.min(1, regular / dayHours) : 1;
        base = isWorkingDay && cal.working_days > 0 ? (Number(rate.rate) / cal.working_days) * payable : 0;
        otRate = (Number(rate.rate) / benchmark) * multiplier;
      }
    }
    const overtimeAmount = supported && inContract && overtimeEnabled ? round2(overtime * otRate) : 0;
    if (rate?.rate_type !== 'monthly') base = round2(base);
    for (const r of resources) {
      r.base_amount = regular > 0 ? round2((base * r.regular_hours) / regular) : 0;
      r.overtime_amount = overtime > 0 ? round2((overtimeAmount * r.overtime_hours) / overtime) : 0;
      r.regular_hours = round2(r.regular_hours);
      r.overtime_hours = round2(r.overtime_hours);
    }

    days.push({
      date: key,
      is_working_day: isWorkingDay,
      holiday,
      in_contract: inContract,
      rate_type: rate?.rate_type || null,
      payable_fraction: supported && inContract && rate?.rate_type === 'monthly' && isWorkingDay ? round2(payable) : null,
      status: dayStatus(dayEntries, { inContract, isWorkingDay }),
      hours: {
        approved: round2(regular),
        overtime_approved: round2(overtime),
        pending: round2(resources.reduce((s, r) => s + r.pending_hours, 0)),
        rejected: round2(resources.reduce((s, r) => s + r.rejected_hours, 0)),
      },
      base_amount: base,
      overtime_amount: overtimeAmount,
      resources,
      entries: dayEntries.map((e) => ({
        id: e.id,
        org_membership_id: e.org_membership_id,
        name: e.org_membership.person.name,
        hours: Number(e.hours),
        overtime_hours: Number(e.overtime_hours || 0),
        status: e.status,
        resolved: e.resolved,
        approved_by: e.approver ? { id: e.approver.id, name: e.approver.name } : null,
        approved_at: e.approved_at,
        decision_reason: e.decision_reason,
      })),
    });
  }

  settleMonthlyDays(days);

  // Hours only move the amount on hourly days or where overtime is billed;
  // a monthly contract without billable overtime doesn't wait on approvals.
  const hoursMatter = days.some((d) => d.in_contract && d.rate_type === 'hourly') || overtimeEnabled || billingBasis === 'approved_hours';
  const pending = entries.filter((e) => e.status === 'submitted').length;
  const rejected = entries.filter((e) => e.status === 'rejected' && !e.resolved).length;
  const missing = days.filter((d) => d.status === 'no_entry').length;
  const today = todayIst(now);
  const lastBillableDay = agreementEnd && agreementEnd < end ? agreementEnd : end;
  const blockers = [];
  if (!supported) blockers.push({ code: 'engine_not_supported', message: note });
  else if (!monthRate) blockers.push({ code: 'no_billing_rate', message: 'No billing rate is set for this project.' });
  if (hoursMatter && pending) blockers.push({ code: 'pending_entries', count: pending, message: `${pending} timesheet ${pending === 1 ? 'entry is' : 'entries are'} still pending approval.` });
  if (hoursMatter && rejected) blockers.push({ code: 'rejected_entries', count: rejected, message: `${rejected} rejected ${rejected === 1 ? 'entry has' : 'entries have'} not been corrected and re-submitted.` });
  if (today <= lastBillableDay && today >= start) blockers.push({ code: 'period_open', message: 'The billing period has not ended yet.' });
  const warnings = hoursMatter && missing ? [{ code: 'missing_days', count: missing, message: `${missing} working ${missing === 1 ? 'day has' : 'days have'} no timesheet entry.` }] : [];

  return {
    project,
    engine,
    supported,
    note,
    period_month,
    period_year,
    billing_type: monthRate?.rate_type || null,
    rate: monthRate ? Number(monthRate.rate) : null,
    currency: monthRate?.currency || account.client_billing_currency || 'INR',
    billing_basis: billingBasis,
    day_hours: dayHours,
    adjustments: { items: adjustmentItems, total: adjustmentTotal },
    benchmark_hours: benchmark,
    working_days: cal.working_days,
    calendar: cal.calendar,
    agreement_start_date: agreementStart ? ymd(agreementStart) : null,
    agreement_end_date: agreementEnd ? ymd(agreementEnd) : null,
    overtime: { enabled: overtimeEnabled, multiplier },
    days,
    source_entry_ids: entries.map((e) => e.id),
    readiness: { can_lock: blockers.length === 0, blockers, warnings },
  };
}

// Pure projection of a (live or locked) month onto the Billing & Sales
// filters. Never changes amounts, only which part of the month is shown.
function viewOf(raw, { org_membership_id, include_overtime = true, status = 'all', date_from, date_to } = {}) {
  const from = date_from ? ymd(new Date(date_from)) : null;
  const to = date_to ? ymd(new Date(date_to)) : null;
  const days = [];
  const resources = new Map();
  for (const day of raw.days) {
    if ((from && day.date < from) || (to && day.date > to)) continue;
    const dayResources = org_membership_id ? day.resources.filter((r) => r.org_membership_id === org_membership_id) : day.resources;
    const dayEntries = org_membership_id ? day.entries.filter((e) => e.org_membership_id === org_membership_id) : day.entries;
    const sum = (key) => round2(dayResources.reduce((s, r) => s + r[key], 0));
    const base = org_membership_id ? sum('base_amount') : day.base_amount;
    const overtime = org_membership_id ? sum('overtime_amount') : day.overtime_amount;
    const allHours = {
      approved: org_membership_id ? sum('regular_hours') : day.hours.approved,
      overtime_approved: org_membership_id ? sum('overtime_hours') : day.hours.overtime_approved,
      pending: org_membership_id ? sum('pending_hours') : day.hours.pending,
      rejected: org_membership_id ? sum('rejected_hours') : day.hours.rejected,
    };
    // Approval filter: only the chosen state's hours and entries (a pending
    // entry is 'submitted'). Every date still shows, zero when nothing matches.
    const hours = status === 'all' ? allHours : {
      approved: status === 'approved' ? allHours.approved : 0,
      overtime_approved: status === 'approved' ? allHours.overtime_approved : 0,
      pending: status === 'pending' ? allHours.pending : 0,
      rejected: status === 'rejected' ? allHours.rejected : 0,
    };
    const entryStatus = status === 'pending' ? 'submitted' : status;
    const shownEntries = status === 'all' ? dayEntries : dayEntries.filter((e) => e.status === entryStatus);
    const rowStatus = org_membership_id
      ? dayStatus(dayEntries, { inContract: day.in_contract, isWorkingDay: day.is_working_day })
      : day.status;
    // The status filter never drops a date (a day with nothing in that state
    // shows as zero); it narrows the amounts to the chosen state. Only
    // approved hours are ever billed.
    const matches = status === 'all' || rowStatus === status;
    const approvers = [];
    for (const e of shownEntries) {
      if (e.status === 'approved' && e.approved_by && !approvers.some((a) => a.id === e.approved_by.id)) approvers.push({ ...e.approved_by, at: e.approved_at });
    }
    const billed = status === 'all' || status === 'approved';
    const row = {
      date: day.date,
      is_working_day: day.is_working_day,
      holiday: day.holiday,
      in_contract: day.in_contract,
      status: rowStatus,
      matches_status: matches,
      hours,
      base_amount: billed ? base : 0,
      overtime_amount: billed && include_overtime ? overtime : 0,
      amount: billed ? round2(base + (include_overtime ? overtime : 0)) : 0,
      approvers,
      entries: shownEntries,
    };
    days.push(row);
    for (const r of dayResources) {
      if (!resources.has(r.org_membership_id)) {
        resources.set(r.org_membership_id, { org_membership_id: r.org_membership_id, name: r.name, worker_type: r.worker_type, regular_hours: 0, overtime_hours: 0, pending_hours: 0, rejected_hours: 0, base_amount: 0, overtime_amount: 0 });
      }
      const acc = resources.get(r.org_membership_id);
      for (const k of ['regular_hours', 'overtime_hours', 'pending_hours', 'rejected_hours', 'base_amount', 'overtime_amount']) acc[k] = round2(acc[k] + r[k]);
    }
  }
  const resourceList = [...resources.values()].map((r) => ({ ...r, amount: round2(r.base_amount + (include_overtime ? r.overtime_amount : 0)) }));
  const total = (key) => round2(days.reduce((s, d) => s + d[key], 0));
  const statusCount = (s) => days.filter((d) => d.status === s).length;
  // Admin adjustments belong to the whole month: shown only when the view isn't narrowed to a person, dates or one approval state.
  const wholeMonth = !org_membership_id && !from && !to && (status === 'all' || !status);
  const adjustments = wholeMonth ? raw.adjustments || { items: [], total: 0 } : { items: [], total: 0 };
  return {
    days,
    resources: resourceList,
    adjustments,
    totals: {
      base_amount: total('base_amount'),
      overtime_amount: total('overtime_amount'),
      amount: total('amount'),
      adjustment_amount: adjustments.total,
      final_amount: round2(total('amount') + adjustments.total),
      approved_hours: round2(days.reduce((s, d) => s + d.hours.approved, 0)),
      overtime_hours: round2(days.reduce((s, d) => s + d.hours.overtime_approved, 0)),
      pending_hours: round2(days.reduce((s, d) => s + d.hours.pending, 0)),
      rejected_hours: round2(days.reduce((s, d) => s + d.hours.rejected, 0)),
      approved_days: statusCount('approved'),
      pending_days: statusCount('pending'),
      rejected_days: statusCount('rejected'),
      missing_days: statusCount('no_entry'),
    },
  };
}

// Hourly projects only: what the month should bill if the client uses the
// hours they told us to expect (Account.estimated_monthly_hours × the month's
// hourly rate), next to the actual approved hours and base billing. A
// forecast: read from the project's CURRENT setting (not the lock snapshot)
// and never part of a lock, invoice or total. Null when there's nothing to estimate.
function estimateFor(account, raw, totals) {
  const hours = account?.estimated_monthly_hours;
  if (hours === null || hours === undefined || raw.billing_type !== 'hourly' || !raw.rate) return null;
  const estimatedHours = Number(hours);
  const amount = round2(estimatedHours * raw.rate);
  return {
    hours: estimatedHours,
    amount,
    actual_hours: totals.approved_hours,
    actual_amount: totals.base_amount,
    hours_variance: round2(totals.approved_hours - estimatedHours),
    amount_variance: round2(totals.base_amount - amount),
  };
}

// The amount a lock finalizes: approved base + (only if the project allows
// it) approved overtime. Used for the lock's version amount and the invoice.
function lockedAmount(raw) {
  return round2(raw.days.reduce((s, d) => s + d.base_amount + (raw.overtime.enabled ? d.overtime_amount : 0), 0) + (raw.adjustments?.total || 0));
}

// How a month's amount was worked out, for an invoice or a locked record:
// monthly — rate, the month's working days, the contract working days and
// the billed period; hourly — rate × approved billable hours. Overtime only
// where the project bills it. `amount` is exactly lockedAmount(raw).
function invoiceDetails(raw) {
  const contractDays = raw.days.filter((d) => d.in_contract);
  const billedDays = contractDays.filter((d) => d.rate_type);
  const sum = (list, pick) => round2(list.reduce((s, d) => s + pick(d), 0));
  const overtimeBilled = Boolean(raw.overtime?.enabled);
  return {
    billing_type: raw.billing_type,
    rate: raw.rate,
    currency: raw.currency,
    period_from: billedDays[0]?.date || null,
    period_to: billedDays[billedDays.length - 1]?.date || null,
    days_in_month: raw.days.length,
    working_days: raw.working_days,
    contract_working_days: billedDays.filter((d) => d.is_working_day).length,
    billable_hours: sum(billedDays.filter((d) => d.rate_type === 'hourly'), (d) => d.hours.approved),
    overtime_billed: overtimeBilled,
    overtime_multiplier: raw.overtime?.multiplier ?? 1,
    overtime_hours: overtimeBilled ? sum(billedDays, (d) => d.hours.overtime_approved) : 0,
    billing_basis: raw.billing_basis || 'contract',
    day_hours: raw.day_hours ?? null,
    payable_days: round2(billedDays.reduce((s, d) => s + (d.payable_fraction ?? (d.is_working_day ? 1 : 0)), 0)),
    base_amount: sum(raw.days, (d) => d.base_amount),
    overtime_amount: overtimeBilled ? sum(raw.days, (d) => d.overtime_amount) : 0,
    adjustment_amount: raw.adjustments?.total || 0,
    adjustments: (raw.adjustments?.items || []).map((a) => ({ amount: a.amount, reason: a.reason })),
    amount: lockedAmount(raw),
    calendar: raw.calendar?.name || null,
  };
}

// Active client projects matching the Billing & Sales / P&L filters.
// project_type: managed_services | project | none | all.
async function listProjects(orgId, { project_type = 'all', client_account_id, account_id } = {}) {
  const where = projectListWhere(orgId);
  if (account_id) where.id = account_id;
  if (client_account_id) where.client_account_id = client_account_id;
  if (project_type === 'none') where.service_category = null;
  else if (project_type && project_type !== 'all') where.service_category = project_type;
  return prisma.account.findMany({ where, select: PROJECT_SELECT, orderBy: [{ project_name: 'asc' }, { name: 'asc' }] });
}

// Hourly projects with a committed minimum (Account.minimum_monthly_hours):
// approved hours against it and the shortfall. Informational — the billed
// amount is still approved hours × rate. Null when no minimum applies.
function minimumFor(account, raw, totals) {
  const hours = account?.minimum_monthly_hours;
  if (hours === null || hours === undefined || raw.billing_type !== 'hourly') return null;
  const minimumHours = Number(hours);
  const shortfall = round2(Math.max(0, minimumHours - totals.approved_hours));
  return { hours: minimumHours, actual_hours: totals.approved_hours, shortfall_hours: shortfall, met: shortfall === 0 };
}

module.exports = { invoiceDetails, PROJECT_SELECT, estimateFor, minimumFor, engineFor, describeProject, computeProjectMonth, viewOf, lockedAmount, listProjects, rateOn, markResolved, dayStatus };
