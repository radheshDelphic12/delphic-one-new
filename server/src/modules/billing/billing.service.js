const prisma = require('../../config/db');
const { contractState } = require('../../lib/contractState');
const calendarsService = require('../calendars/calendars.service');
const allocations = require('../../lib/allocations');
const { projectListWhere } = require('../../lib/projectScope');
const exchangeRates = require('./exchangeRates.service');

const { activeOn } = allocations;

const DEFAULT_BENCHMARK_HOURS = 160;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function periodBounds(period_month, period_year) {
  const period_start = new Date(Date.UTC(period_year, period_month - 1, 1));
  const period_end = new Date(Date.UTC(period_year, period_month, 0));
  return { period_start, period_end };
}

async function createRate(orgId, createdByUserId, { account_id, requirement_id, rate_type, rate, currency, effective_from }) {
  const account = await prisma.account.findFirst({ where: { id: account_id, org_id: orgId } });
  if (!account) return { error: 'account_not_found' };
  if (requirement_id) {
    const requirement = await prisma.requirement.findFirst({ where: { id: requirement_id, account_id, org_id: orgId } });
    if (!requirement) return { error: 'requirement_not_found' };
  }

  const billingRate = await prisma.billingRate.create({
    data: { org_id: orgId, account_id, requirement_id, rate_type, rate, currency, effective_from, created_by: createdByUserId },
  });
  return { billingRate };
}

async function listRates(orgId, { account_id, requirement_id }) {
  return prisma.billingRate.findMany({
    where: { org_id: orgId, ...(account_id ? { account_id } : {}), ...(requirement_id ? { requirement_id } : {}) },
    orderBy: [{ account_id: 'asc' }, { effective_from: 'desc' }],
  });
}

// Most-specific-wins: a requirement-specific rate beats the account-wide
// default (requirement_id: null) when both apply on the given date.
async function resolveRate(orgId, accountId, requirementId, date) {
  if (requirementId) {
    const specific = await prisma.billingRate.findFirst({
      where: { org_id: orgId, account_id: accountId, requirement_id: requirementId, effective_from: { lte: date } },
      orderBy: [{ effective_from: 'desc' }, { created_at: 'desc' }],
    });
    if (specific) return specific;
  }
  return prisma.billingRate.findFirst({
    where: { org_id: orgId, account_id: accountId, requirement_id: null, effective_from: { lte: date } },
    orderBy: [{ effective_from: 'desc' }, { created_at: 'desc' }],
  });
}

// Monthly billing. The monthly rate covers a benchmark of `benchmarkHours`
// (160 unless the project overrides it) spread over the calendar month's ACTUAL
// working days — Mon–Fri less the holidays of the calendar the project follows.
// Each working day is therefore worth rate / workingDays, earned in proportion
// to the hours logged against the daily share of the benchmark
// (benchmark / workingDays), and never more than that one day's share, so the
// month can't bill above the monthly rate. Work on a weekend or holiday is
// inside the retainer and adds nothing. Written as one expression:
//   revenue = rate × min(hours / benchmark, 1 / workingDays)
function monthlyDayRevenue({ rate, hours, benchmarkHours, workingDays, isWorkingDay }) {
  if (!isWorkingDay || workingDays <= 0 || benchmarkHours <= 0) return 0;
  return round2(rate * Math.min(hours / benchmarkHours, 1 / workingDays));
}

// Computes/upserts DailyProjectRevenue for one day from that day's APPROVED
// + billable TimesheetEntry hours, grouped by (account_id, requirement_id).
// Idempotent — re-running a date updates the existing row instead of
// duplicating (see schema.prisma's DailyProjectRevenue comment for why this
// isn't a DB unique constraint).
async function computeDayRevenue(orgId, date) {
  const entries = await prisma.timesheetEntry.findMany({
    // account_id is null for general (non-project) time, which is never billed.
    where: { org_id: orgId, date, status: 'approved', billable: true, account_id: { not: null } },
    select: { account_id: true, requirement_id: true, hours: true },
  });

  const grouped = new Map();
  for (const e of entries) {
    const key = `${e.account_id}|${e.requirement_id || ''}`;
    const bucket = grouped.get(key) || { account_id: e.account_id, requirement_id: e.requirement_id, hours: 0 };
    bucket.hours += Number(e.hours);
    grouped.set(key, bucket);
  }

  const accounts = new Map(
    (
      await prisma.account.findMany({
        where: { id: { in: Array.from(new Set(Array.from(grouped.values()).map((b) => b.account_id))) } },
        select: { id: true, agreement_start_date: true, benchmark_hours: true },
      })
    ).map((a) => [a.id, a])
  );
  const workingDaysCache = new Map();

  const computed = [];
  const skipped = [];
  // Keys that still have revenue to show after this run; everything else on
  // the day (stale rows, or projects not yet under agreement) is cleared below.
  const supported = new Set();

  for (const { account_id, requirement_id, hours } of grouped.values()) {
    // Nothing is billed before the client agreement starts.
    const agreementStart = accounts.get(account_id)?.agreement_start_date;
    if (agreementStart && date < agreementStart) {
      skipped.push({ account_id, requirement_id, date: ymd(date), reason: 'before_agreement_start' });
      continue;
    }

    const rateRow = await resolveRate(orgId, account_id, requirement_id, date);
    if (!rateRow) {
      skipped.push({ account_id, requirement_id, date: ymd(date), reason: 'no_billing_rate' });
      continue;
    }

    let revenue;
    if (rateRow.rate_type === 'hourly') {
      revenue = round2(hours * Number(rateRow.rate));
    } else {
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() + 1;
      const cacheKey = `${account_id}|${year}-${month}`;
      if (!workingDaysCache.has(cacheKey)) workingDaysCache.set(cacheKey, await calendarsService.projectWorkingDays(orgId, account_id, year, month));
      const { working_days, holiday_dates, working_dates } = workingDaysCache.get(cacheKey);
      const weekday = date.getUTCDay();
      revenue = monthlyDayRevenue({
        rate: Number(rateRow.rate),
        hours,
        benchmarkHours: accounts.get(account_id)?.benchmark_hours || DEFAULT_BENCHMARK_HOURS,
        workingDays: working_days,
        isWorkingDay: working_dates.has(ymd(date)) || (weekday !== 0 && weekday !== 6 && !holiday_dates.has(ymd(date))),
      });
    }
    supported.add(`${account_id}|${requirement_id || ''}`);

    const existing = await prisma.dailyProjectRevenue.findFirst({
      where: { org_id: orgId, account_id, requirement_id: requirement_id ?? null, date },
    });
    const data = { org_id: orgId, account_id, requirement_id, date, billable_hours: hours, rate: rateRow.rate, revenue };
    const row = existing
      ? await prisma.dailyProjectRevenue.update({ where: { id: existing.id }, data })
      : await prisma.dailyProjectRevenue.create({ data });
    computed.push(row);
  }

  // Keep the recompute truly idempotent: a revenue row whose approved billable
  // hours have since gone (e.g. a regularization ticket flipped the entry to
  // non-billable) must not linger and overstate revenue.
  const stillSupported = supported;
  const dayRows = await prisma.dailyProjectRevenue.findMany({
    where: { org_id: orgId, date },
    select: { id: true, account_id: true, requirement_id: true },
  });
  const staleIds = dayRows.filter((r) => !stillSupported.has(`${r.account_id}|${r.requirement_id || ''}`)).map((r) => r.id);
  if (staleIds.length) await prisma.dailyProjectRevenue.deleteMany({ where: { id: { in: staleIds } } });

  return { computed, skipped };
}

async function computeRevenueRange(orgId, dateFrom, dateTo) {
  const computed = [];
  const skipped = [];
  const days = Math.round((dateTo - dateFrom) / 86400000) + 1;
  for (let i = 0; i < days; i += 1) {
    const date = new Date(dateFrom.getTime() + i * 86400000);
    const result = await computeDayRevenue(orgId, date);
    computed.push(...result.computed);
    skipped.push(...result.skipped);
  }
  return { computed_count: computed.length, skipped };
}

async function listDailyRevenue(orgId, { account_id, requirement_id, from, to }) {
  const date = from || to ? { gte: from || undefined, lte: to || undefined } : undefined;
  return prisma.dailyProjectRevenue.findMany({
    where: {
      org_id: orgId,
      ...(account_id ? { account_id } : {}),
      ...(requirement_id ? { requirement_id } : {}),
      ...(date ? { date } : {}),
    },
    orderBy: [{ date: 'desc' }],
    include: { account: { select: { id: true, name: true } }, requirement: { select: { id: true, title: true } } },
  });
}

async function createInvoice(orgId, createdByUserId, { client_account_id, period_month, period_year }) {
  const existing = await prisma.clientInvoice.findUnique({
    where: { client_account_id_period_month_period_year: { client_account_id, period_month, period_year } },
  });
  if (existing) return { error: 'invoice_exists', invoice: existing };

  const account = await prisma.account.findFirst({ where: { id: client_account_id, org_id: orgId } });
  if (!account) return { error: 'account_not_found' };

  const { period_start, period_end } = periodBounds(period_month, period_year);
  // Invoices only cover time from the agreement start date on: a period that
  // ends before it can't be invoiced, and the first period is cut at the start.
  const agreementStart = account.agreement_start_date;
  if (agreementStart && period_end < agreementStart) return { error: 'before_agreement_start', agreement_start: ymd(agreementStart) };
  const from = agreementStart && agreementStart > period_start ? agreementStart : period_start;
  const rows = await prisma.dailyProjectRevenue.findMany({
    where: { org_id: orgId, account_id: client_account_id, date: { gte: from, lte: period_end } },
    include: { requirement: { select: { id: true, title: true } } },
  });
  if (!rows.length) return { error: 'no_revenue_computed' };

  const byRequirement = new Map();
  for (const row of rows) {
    const key = row.requirement_id || '__account_level__';
    const bucket = byRequirement.get(key) || {
      requirement_id: row.requirement_id,
      requirement_title: row.requirement?.title || null,
      hours: 0,
      revenue: 0,
    };
    bucket.hours += Number(row.billable_hours);
    bucket.revenue += Number(row.revenue);
    byRequirement.set(key, bucket);
  }
  const line_items = Array.from(byRequirement.values()).map((li) => ({ ...li, hours: round2(li.hours), revenue: round2(li.revenue) }));
  const amount = round2(line_items.reduce((sum, li) => sum + li.revenue, 0));

  const invoice = await prisma.clientInvoice.create({
    data: { org_id: orgId, client_account_id, period_month, period_year, amount, line_items, created_by: createdByUserId },
  });
  return { invoice };
}

async function listInvoices(orgId, { client_account_id, status }) {
  return prisma.clientInvoice.findMany({
    where: { org_id: orgId, ...(client_account_id ? { client_account_id } : {}), ...(status ? { status } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }],
    include: { client_account: { select: { id: true, name: true } } },
  });
}

async function getInvoice(orgId, invoiceId) {
  const invoice = await prisma.clientInvoice.findFirst({
    where: { id: invoiceId, org_id: orgId },
    include: { client_account: { select: { id: true, name: true } } },
  });
  if (!invoice) return { error: 'not_found' };
  return { invoice };
}

// draft -> sent -> paid, forward only (see schema.prisma's ClientInvoice comment).
const FORWARD_TRANSITIONS = { draft: 'sent', sent: 'paid' };

async function transitionInvoice(orgId, invoiceId, status) {
  const invoice = await prisma.clientInvoice.findFirst({ where: { id: invoiceId, org_id: orgId } });
  if (!invoice) return { error: 'not_found' };
  if (FORWARD_TRANSITIONS[invoice.status] !== status) return { error: 'invalid_transition' };

  const data = { status };
  if (status === 'sent') data.sent_at = new Date();
  if (status === 'paid') data.paid_at = new Date();
  const updated = await prisma.clientInvoice.update({ where: { id: invoiceId }, data });
  return { invoice: updated };
}

const GROUP_CHARGE_INCLUDE = {
  category: { select: { id: true, name: true } },
  location: { select: { id: true, name: true } },
  // Lets the UI tell group-raised charges (group superadmin edits only) apart.
  raiser: { select: { is_group_superadmin: true } },
};

async function createGroupCharge(raisedByUserId, { org_id, period_month, period_year, payment_date, kind, category_id, location_id, notes, amount, currency }) {
  const org = await prisma.org.findUnique({ where: { id: org_id } });
  if (!org) return { error: 'org_not_found' };

  let categoryName = kind || null;
  if (category_id) {
    const category = await prisma.financeCategory.findFirst({ where: { id: category_id, org_id, kind: 'group_charge', is_active: true }, select: { id: true, name: true } });
    if (!category) return { error: 'category_not_found' };
    categoryName = category.name;
  }
  if (location_id) {
    const location = await prisma.location.findFirst({ where: { id: location_id, org_id }, select: { id: true } });
    if (!location) return { error: 'location_not_found' };
  }

  const charge = await prisma.groupBillingCharge.create({
    data: {
      org_group_id: org.org_group_id,
      org_id,
      period_month,
      period_year,
      payment_date: payment_date || null,
      kind: categoryName,
      category_id: category_id || null,
      location_id: location_id || null,
      notes: notes || null,
      amount,
      currency,
      raised_by: raisedByUserId,
    },
    include: GROUP_CHARGE_INCLUDE,
  });
  return { charge };
}

// Company admins edit their own company's group charges, but a charge the
// group raised against the company (raised by a group superadmin) can only be
// changed by a group superadmin. Keeping the charge's current category is
// allowed even if it has since been deactivated.
async function updateGroupCharge(orgId, editorUserId, chargeId, { payment_date, category_id, location_id, notes, amount, currency }) {
  const charge = await prisma.groupBillingCharge.findFirst({
    where: { id: chargeId, org_id: orgId },
    include: { raiser: { select: { is_group_superadmin: true } } },
  });
  if (!charge) return { error: 'not_found' };
  if (charge.raiser?.is_group_superadmin && charge.raised_by !== editorUserId) {
    // The group superadmin who raised it, or this company's superadmin.
    const editor = await prisma.user.findUnique({ where: { id: editorUserId }, select: { is_group_superadmin: true, is_superadmin: true } });
    if (!editor?.is_group_superadmin && !editor?.is_superadmin) return { error: 'charge_raised_by_group' };
  }

  const data = {};
  if (category_id !== undefined && category_id !== charge.category_id) {
    const category = await prisma.financeCategory.findFirst({ where: { id: category_id, org_id: orgId, kind: 'group_charge', is_active: true }, select: { id: true, name: true } });
    if (!category) return { error: 'category_not_found' };
    data.category_id = category.id;
    data.kind = category.name;
  }
  if (location_id !== undefined) {
    if (location_id) {
      const location = await prisma.location.findFirst({ where: { id: location_id, org_id: orgId }, select: { id: true } });
      if (!location) return { error: 'location_not_found' };
    }
    data.location_id = location_id || null;
  }
  if (payment_date !== undefined) {
    data.payment_date = payment_date;
    data.period_month = payment_date.getUTCMonth() + 1;
    data.period_year = payment_date.getUTCFullYear();
  }
  if (notes !== undefined) data.notes = notes || null;
  if (amount !== undefined) data.amount = amount;
  if (currency !== undefined) data.currency = currency;

  const updated = await prisma.groupBillingCharge.update({ where: { id: charge.id }, data, include: GROUP_CHARGE_INCLUDE });
  return { charge: updated };
}

// Superadmin delete of a group charge entered by mistake (this company's only).
async function deleteGroupCharge(orgId, chargeId) {
  const charge = await prisma.groupBillingCharge.findFirst({ where: { id: chargeId, org_id: orgId }, select: { id: true } });
  if (!charge) return { error: 'not_found' };
  await prisma.groupBillingCharge.delete({ where: { id: charge.id } });
  return { deleted: true };
}

// Month filter: a charge with a payment date is in the month it was paid;
// one without (raised before payment dates existed, or by the group) is in
// its period month. Date filters only match charges that have a payment date.
async function listMyGroupCharges(orgId, { period_month, period_year, date, date_from, date_to, category_id, location_id }) {
  const and = [];
  if (period_month && period_year) {
    const start = new Date(Date.UTC(period_year, period_month - 1, 1));
    const end = new Date(Date.UTC(period_year, period_month, 0));
    and.push({ OR: [{ payment_date: { gte: start, lte: end } }, { payment_date: null, period_month, period_year }] });
  } else {
    if (period_month) and.push({ period_month });
    if (period_year) and.push({ period_year });
  }
  if (date) and.push({ payment_date: date });
  if (date_from || date_to) and.push({ payment_date: { ...(date_from ? { gte: date_from } : {}), ...(date_to ? { lte: date_to } : {}) } });
  if (category_id) {
    const category = await prisma.financeCategory.findFirst({ where: { id: category_id, org_id: orgId }, select: { name: true } });
    // Older charges carry only the category's name as text.
    and.push({ OR: [{ category_id }, ...(category ? [{ category_id: null, kind: { equals: category.name, mode: 'insensitive' } }] : [])] });
  }
  if (location_id) and.push({ location_id });
  return prisma.groupBillingCharge.findMany({
    where: { org_id: orgId, ...(and.length ? { AND: and } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }, { payment_date: 'desc' }, { created_at: 'desc' }],
    include: GROUP_CHARGE_INCLUDE,
  });
}

async function listAllGroupCharges({ org_id }) {
  return prisma.groupBillingCharge.findMany({
    where: { ...(org_id ? { org_id } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }],
    include: { org: { select: { id: true, name: true } } },
  });
}

// Project team allocations (create / change / end) live in
// modules/allocations — they are effective-dated spans now.

// Remaining budget is computed live from approved+billable TimesheetEntry
// hours × this project's ProjectMemberAssignment rates — never stored, so it
// can't drift from the entries actually logged (schema.prisma's own comment
// on Account.budget_amount).
async function getAccountBudgetSummary(orgId, accountId) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, org_id: orgId },
    select: { budget_amount: true, client_billing_currency: true },
  });
  if (!account) return { error: 'account_not_found' };

  const [assignments, entries] = await Promise.all([
    prisma.projectMemberAssignment.findMany({ where: { org_id: orgId, account_id: accountId }, select: { org_membership_id: true, cost_rate_per_hr: true, start_date: true, end_date: true } }),
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, account_id: accountId, status: 'approved', billable: true },
      select: { org_membership_id: true, hours: true, date: true },
    }),
  ]);
  // Each entry is costed at the rate of the allocation in force on its date.
  let costIncurred = 0;
  for (const entry of entries) {
    const span = assignments.find((a) => a.org_membership_id === entry.org_membership_id && activeOn(a, entry.date));
    const rate = span?.cost_rate_per_hr !== null && span?.cost_rate_per_hr !== undefined ? Number(span.cost_rate_per_hr) : 0;
    if (rate) costIncurred += Number(entry.hours) * rate;
  }
  costIncurred = round2(costIncurred);

  const budgetAmount = account.budget_amount !== null ? Number(account.budget_amount) : null;
  return {
    budget_amount: budgetAmount,
    currency: account.client_billing_currency || 'INR',
    cost_incurred: costIncurred,
    remaining_budget: budgetAmount !== null ? round2(budgetAmount - costIncurred) : null,
  };
}

// ---------------------------------------------------------------------------
// Project profile — Finance → Projects. A project is an active client Account:
// Project Name = account.name, Client Name = account.client_name, Requirement is
// intentionally blank for now, Billing Type is derived from the billing rate in
// force today (one source of truth — BillingRate — so it can't drift).
// ---------------------------------------------------------------------------

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// The account-wide rate in force on `asOf`, else (a rate set to start later)
// the soonest upcoming one so a freshly created project still shows its type.
// Rates sharing an effective_from (e.g. Monthly → Hourly from the same agreement
// start date) resolve to the one added last.
function currentAccountRate(rates, asOf) {
  const accountWide = rates.filter((r) => r.requirement_id === null).sort((a, b) => b.effective_from - a.effective_from || b.created_at - a.created_at);
  const inForce = accountWide.find((r) => r.effective_from <= asOf);
  if (inForce) return inForce;
  // All upcoming: the soonest date, and on that date the rate added last.
  const soonest = accountWide[accountWide.length - 1];
  return soonest ? accountWide.find((r) => +r.effective_from === +soonest.effective_from) : null;
}

function serializeProfile(account, rates, calendar, { editable = Boolean(account.is_project), fx = null } = {}) {
  const rate = currentAccountRate(rates, todayUtc());
  const currency = rate ? rate.currency : account.client_billing_currency || 'INR';
  const estimatedHours = account.estimated_monthly_hours !== null && account.estimated_monthly_hours !== undefined ? Number(account.estimated_monthly_hours) : null;
  // INR figures use the same converter as Project P&L. null = this currency
  // has no exchange rate yet (or there's no rate to convert).
  const { toInr, rateFor } = exchangeRates.inrConverter(fx || new Map([['INR', 1]]));
  const exchangeRate = rateFor(currency);
  const inr = (amount) => (amount === null || exchangeRate === null ? null : toInr(amount, currency));
  const monthlyAmount = !rate ? null : rate.rate_type === 'monthly' ? Number(rate.rate) : estimatedHours !== null ? Number(rate.rate) * estimatedHours : null;
  return {
    id: account.id,
    project_code: account.project_code || null,
    project_name: calendarsService.projectName(account),
    ...calendarsService.clientFields(account),
    // Left blank on purpose (client brief) — linking a requirement comes later.
    requirement: '',
    service_category: account.service_category,
    billing_type: rate ? rate.rate_type : null,
    rate: rate ? Number(rate.rate) : null,
    currency,
    // INR per 1 unit of `currency` (1 for INR); null when finance hasn't set it.
    exchange_rate: exchangeRate,
    rate_inr: rate ? inr(Number(rate.rate)) : null,
    // Fixed monthly fee, or hourly rate x estimated hours, in INR.
    monthly_amount_inr: inr(monthlyAmount),
    agreement_start_date: account.agreement_start_date ? ymd(account.agreement_start_date) : null,
    agreement_end_date: account.agreement_end_date ? ymd(account.agreement_end_date) : null,
    contract_status: account.contract_status,
    contract: contractState(account),
    benchmark_hours: account.benchmark_hours,
    overtime_billable: account.overtime_billable,
    overtime_multiplier: Number(account.overtime_multiplier ?? 1),
    estimated_monthly_hours: account.estimated_monthly_hours !== null && account.estimated_monthly_hours !== undefined ? Number(account.estimated_monthly_hours) : null,
    minimum_monthly_hours: account.minimum_monthly_hours !== null && account.minimum_monthly_hours !== undefined ? Number(account.minimum_monthly_hours) : null,
    // Editable when the row is a project: made by Add Project, or an older
    // client row already used as one (billing, team, timesheets…) — see
    // lib/projectScope. A plain catalogue client stays read-only. Edits only
    // write project fields, never the account's own name.
    is_project: Boolean(account.is_project),
    editable,
    calendar: calendar?.calendar || null,
    calendar_is_default: !calendar?.calendar,
  };
}

const PROFILE_SELECT = {
  id: true,
  name: true,
  project_name: true,
  project_code: true,
  overtime_billable: true,
  overtime_multiplier: true,
  estimated_monthly_hours: true,
  minimum_monthly_hours: true,
  is_project: true,
  client_name: true,
  client_account_id: true,
  client_account: calendarsService.CLIENT_ACCOUNT_SELECT,
  service_category: true,
  agreement_start_date: true,
  agreement_end_date: true,
  contract_status: true,
  benchmark_hours: true,
  client_billing_currency: true,
  project_calendar: { select: { calendar: { select: { id: true, name: true, kind: true } } } },
};

async function isProjectRow(orgId, accountId) {
  return (await prisma.account.count({ where: { id: accountId, ...projectListWhere(orgId) } })) > 0;
}

async function listProjectProfiles(orgId) {
  await calendarsService.ensureProjectCodes(orgId);
  const [accounts, rates, fallback, fx] = await Promise.all([
    prisma.account.findMany({ where: projectListWhere(orgId), select: PROFILE_SELECT, orderBy: { name: 'asc' } }),
    prisma.billingRate.findMany({ where: { org_id: orgId, requirement_id: null }, select: { account_id: true, requirement_id: true, rate_type: true, rate: true, currency: true, effective_from: true, created_at: true } }),
    calendarsService.defaultCalendar(orgId),
    exchangeRates.inrRates(orgId),
  ]);
  const ratesByAccount = new Map();
  for (const r of rates) ratesByAccount.set(r.account_id, [...(ratesByAccount.get(r.account_id) || []), r]);
  // This month's billing (monthly fee, or approved billable hours x rate) —
  // the P&L's own revenue rule, so hourly projects are included, not skipped.
  const now = todayUtc();
  const { monthBillingByProject } = require('./projectPnl.service');
  const billing = await monthBillingByProject(orgId, accounts, { period_month: now.getUTCMonth() + 1, period_year: now.getUTCFullYear() }, fx);
  return accounts.map((a) => {
    // Every row listed here matches projectListWhere, so all are editable.
    const profile = serializeProfile(a, ratesByAccount.get(a.id) || [], a.project_calendar, { editable: true, fx });
    if (!profile.calendar && fallback) profile.calendar = { id: fallback.id, name: fallback.name, kind: fallback.kind };
    profile.this_month = billing.get(a.id) || null;
    return profile;
  });
}

async function getProjectProfile(orgId, accountId) {
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: PROFILE_SELECT });
  if (!account) return { error: 'account_not_found' };
  const [rates, fallback, editable, fx] = await Promise.all([
    prisma.billingRate.findMany({ where: { org_id: orgId, account_id: accountId, requirement_id: null }, select: { account_id: true, requirement_id: true, rate_type: true, rate: true, currency: true, effective_from: true, created_at: true } }),
    calendarsService.defaultCalendar(orgId),
    isProjectRow(orgId, accountId),
    exchangeRates.inrRates(orgId),
  ]);
  const profile = serializeProfile(account, rates, account.project_calendar, { editable, fx });
  if (!profile.calendar && fallback) profile.calendar = { id: fallback.id, name: fallback.name, kind: fallback.kind };
  return { profile };
}

// Edits the profile fields and/or the billing terms. Changing billing type or
// rate adds a NEW BillingRate version (rates are versioned by effective_from,
// never overwritten) starting on the agreement start date — or today, if no
// agreement date is set — so nothing already billed is rewritten.
async function updateProjectProfile(orgId, actorUserId, accountId, patch) {
  const existing = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: { id: true, name: true, project_name: true, agreement_start_date: true, agreement_end_date: true, client_account_id: true, is_project: true } });
  if (!existing) return { error: 'account_not_found' };
  // Finance never edits a plain Accounts-catalogue client. An older client row
  // already worked on as a project (predates is_project) is a project here —
  // only its project fields are written below, never the account's name.
  if (!(await isProjectRow(orgId, accountId))) return { error: 'catalogue_account_read_only' };

  let client;
  if (patch.client_account_id) {
    const resolved = await calendarsService.resolveLeadClient(orgId, patch.client_account_id, existing.client_account_id);
    if (resolved.error) return resolved;
    client = resolved.account;
  }

  // The project name is only a label: another contract may carry the same
  // name (the same client taking a second resource later is a separate
  // project). Projects are told apart by their id / project_code.
  const currentName = calendarsService.projectName(existing);
  const renamed = patch.project_name !== undefined && patch.project_name !== currentName;

  // Only project fields are written — never the account's own name, which the
  // Accounts section owns and linked projects show as their client name.
  const data = {};
  if (renamed) data.project_name = patch.project_name;
  // null clears the client; an id links the client account and snapshots its name.
  if (patch.client_account_id !== undefined) {
    data.client_account_id = client?.id || null;
    data.client_name = client?.name || null;
  }
  if (patch.service_category !== undefined) data.service_category = patch.service_category;
  if (patch.agreement_start_date !== undefined) data.agreement_start_date = patch.agreement_start_date;
  if (patch.agreement_end_date !== undefined) data.agreement_end_date = patch.agreement_end_date;
  if (patch.contract_status !== undefined) data.contract_status = patch.contract_status;
  const start = patch.agreement_start_date !== undefined ? patch.agreement_start_date : existing.agreement_start_date;
  const end = patch.agreement_end_date !== undefined ? patch.agreement_end_date : existing.agreement_end_date;
  if (start && end && end < start) return { error: 'end_before_start' };
  if (patch.benchmark_hours !== undefined) data.benchmark_hours = patch.benchmark_hours;
  if (patch.overtime_billable !== undefined) data.overtime_billable = patch.overtime_billable;
  if (patch.overtime_multiplier !== undefined) data.overtime_multiplier = patch.overtime_multiplier;
  if (patch.estimated_monthly_hours !== undefined) data.estimated_monthly_hours = patch.estimated_monthly_hours;
  if (patch.minimum_monthly_hours !== undefined) data.minimum_monthly_hours = patch.minimum_monthly_hours;

  const effectiveStart = patch.agreement_start_date !== undefined ? patch.agreement_start_date : existing.agreement_start_date;
  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.account.update({ where: { id: accountId }, data });
    if (patch.billing) {
      const { rate_type, rate, currency } = patch.billing;
      await tx.billingRate.create({
        data: {
          org_id: orgId,
          account_id: accountId,
          rate_type,
          rate,
          currency,
          effective_from: patch.billing.effective_from || effectiveStart || todayUtc(),
          created_by: actorUserId,
        },
      });
    }
  });
  return getProjectProfile(orgId, accountId);
}

module.exports = {
  deleteGroupCharge,
  createRate,
  listRates,
  resolveRate,
  computeDayRevenue,
  computeRevenueRange,
  listDailyRevenue,
  createInvoice,
  listInvoices,
  getInvoice,
  transitionInvoice,
  createGroupCharge,
  updateGroupCharge,
  listMyGroupCharges,
  listAllGroupCharges,
  getAccountBudgetSummary,
  listProjectProfiles,
  getProjectProfile,
  updateProjectProfile,
  monthlyDayRevenue,
};
