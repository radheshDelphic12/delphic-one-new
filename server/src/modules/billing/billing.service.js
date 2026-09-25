const prisma = require('../../config/db');
const calendarsService = require('../calendars/calendars.service');

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
      orderBy: { effective_from: 'desc' },
    });
    if (specific) return specific;
  }
  return prisma.billingRate.findFirst({
    where: { org_id: orgId, account_id: accountId, requirement_id: null, effective_from: { lte: date } },
    orderBy: { effective_from: 'desc' },
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
      const { working_days, holiday_dates } = workingDaysCache.get(cacheKey);
      const weekday = date.getUTCDay();
      revenue = monthlyDayRevenue({
        rate: Number(rateRow.rate),
        hours,
        benchmarkHours: accounts.get(account_id)?.benchmark_hours || DEFAULT_BENCHMARK_HOURS,
        workingDays: working_days,
        isWorkingDay: weekday !== 0 && weekday !== 6 && !holiday_dates.has(ymd(date)),
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

async function createGroupCharge(raisedByUserId, { org_id, period_month, period_year, kind, amount, currency }) {
  const org = await prisma.org.findUnique({ where: { id: org_id } });
  if (!org) return { error: 'org_not_found' };

  const charge = await prisma.groupBillingCharge.create({
    data: { org_group_id: org.org_group_id, org_id, period_month, period_year, kind, amount, currency, raised_by: raisedByUserId },
  });
  return { charge };
}

async function listMyGroupCharges(orgId, { period_month, period_year }) {
  return prisma.groupBillingCharge.findMany({
    where: { org_id: orgId, ...(period_month ? { period_month } : {}), ...(period_year ? { period_year } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }],
  });
}

async function listAllGroupCharges({ org_id }) {
  return prisma.groupBillingCharge.findMany({
    where: { ...(org_id ? { org_id } : {}) },
    orderBy: [{ period_year: 'desc' }, { period_month: 'desc' }],
    include: { org: { select: { id: true, name: true } } },
  });
}

// Module C — per-project developer cost rate. Upsert: re-posting for the
// same (account, org_membership) updates the rate instead of erroring, since
// admins will naturally revise a rate over a project's lifetime.
async function upsertCostAssignment(orgId, createdByUserId, { account_id, org_membership_id, cost_rate_per_hr, resource_type }) {
  const account = await prisma.account.findFirst({ where: { id: account_id, org_id: orgId } });
  if (!account) return { error: 'account_not_found' };
  const membership = await prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId } });
  if (!membership) return { error: 'membership_not_found' };

  const assignment = await prisma.projectMemberAssignment.upsert({
    where: { account_id_org_membership_id: { account_id, org_membership_id } },
    create: { org_id: orgId, account_id, org_membership_id, cost_rate_per_hr, resource_type, created_by: createdByUserId },
    update: cost_rate_per_hr !== undefined ? { cost_rate_per_hr } : {},
    include: { org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
  });
  return { assignment };
}

async function listCostAssignments(orgId, accountId) {
  return prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId, account_id: accountId },
    orderBy: { created_at: 'desc' },
    include: { org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
  });
}

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
    prisma.projectMemberAssignment.findMany({ where: { org_id: orgId, account_id: accountId }, select: { org_membership_id: true, cost_rate_per_hr: true } }),
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, account_id: accountId, status: 'approved', billable: true },
      select: { org_membership_id: true, hours: true },
    }),
  ]);
  const rateByMembership = new Map(assignments.map((a) => [a.org_membership_id, Number(a.cost_rate_per_hr)]));

  let costIncurred = 0;
  for (const entry of entries) {
    const rate = rateByMembership.get(entry.org_membership_id);
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
function currentAccountRate(rates, asOf) {
  const accountWide = rates.filter((r) => r.requirement_id === null).sort((a, b) => b.effective_from - a.effective_from);
  return accountWide.find((r) => r.effective_from <= asOf) || accountWide[accountWide.length - 1] || null;
}

function serializeProfile(account, rates, calendar) {
  const rate = currentAccountRate(rates, todayUtc());
  return {
    id: account.id,
    project_name: account.name,
    ...calendarsService.clientFields(account),
    // Left blank on purpose (client brief) — linking a requirement comes later.
    requirement: '',
    service_category: account.service_category,
    billing_type: rate ? rate.rate_type : null,
    rate: rate ? Number(rate.rate) : null,
    currency: rate ? rate.currency : account.client_billing_currency || 'INR',
    agreement_start_date: account.agreement_start_date ? ymd(account.agreement_start_date) : null,
    benchmark_hours: account.benchmark_hours,
    calendar: calendar?.calendar || null,
    calendar_is_default: !calendar?.calendar,
  };
}

const PROFILE_SELECT = {
  id: true,
  name: true,
  client_name: true,
  client_account_id: true,
  client_account: calendarsService.CLIENT_ACCOUNT_SELECT,
  service_category: true,
  agreement_start_date: true,
  benchmark_hours: true,
  client_billing_currency: true,
  project_calendar: { select: { calendar: { select: { id: true, name: true, kind: true } } } },
};

async function listProjectProfiles(orgId) {
  const [accounts, rates, fallback] = await Promise.all([
    prisma.account.findMany({ where: { org_id: orgId, type: 'client', stage: 'active' }, select: PROFILE_SELECT, orderBy: { name: 'asc' } }),
    prisma.billingRate.findMany({ where: { org_id: orgId, requirement_id: null }, select: { account_id: true, requirement_id: true, rate_type: true, rate: true, currency: true, effective_from: true } }),
    calendarsService.defaultCalendar(orgId),
  ]);
  const ratesByAccount = new Map();
  for (const r of rates) ratesByAccount.set(r.account_id, [...(ratesByAccount.get(r.account_id) || []), r]);
  return accounts.map((a) => {
    const profile = serializeProfile(a, ratesByAccount.get(a.id) || [], a.project_calendar);
    if (!profile.calendar && fallback) profile.calendar = { id: fallback.id, name: fallback.name, kind: fallback.kind };
    return profile;
  });
}

async function getProjectProfile(orgId, accountId) {
  const account = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: PROFILE_SELECT });
  if (!account) return { error: 'account_not_found' };
  const [rates, fallback] = await Promise.all([
    prisma.billingRate.findMany({ where: { org_id: orgId, account_id: accountId, requirement_id: null }, select: { account_id: true, requirement_id: true, rate_type: true, rate: true, currency: true, effective_from: true } }),
    calendarsService.defaultCalendar(orgId),
  ]);
  const profile = serializeProfile(account, rates, account.project_calendar);
  if (!profile.calendar && fallback) profile.calendar = { id: fallback.id, name: fallback.name, kind: fallback.kind };
  return { profile };
}

// Edits the profile fields and/or the billing terms. Changing billing type or
// rate adds a NEW BillingRate version (rates are versioned by effective_from,
// never overwritten) starting on the agreement start date — or today, if no
// agreement date is set — so nothing already billed is rewritten.
async function updateProjectProfile(orgId, actorUserId, accountId, patch) {
  const existing = await prisma.account.findFirst({ where: { id: accountId, org_id: orgId, type: 'client' }, select: { id: true, name: true, agreement_start_date: true, client_account_id: true } });
  if (!existing) return { error: 'account_not_found' };

  let client;
  if (patch.client_account_id) {
    const resolved = await calendarsService.resolveLeadClient(orgId, patch.client_account_id, existing.client_account_id);
    if (resolved.error) return resolved;
    client = resolved.account;
  }

  if (patch.project_name && patch.project_name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await prisma.account.findFirst({ where: { org_id: orgId, type: 'client', name: { equals: patch.project_name, mode: 'insensitive' }, NOT: { id: accountId } }, select: { id: true } });
    if (clash) return { error: 'name_taken' };
  }

  const data = {};
  if (patch.project_name !== undefined) data.name = patch.project_name;
  // null clears the client; an id links the lead and snapshots its name.
  if (patch.client_account_id !== undefined) {
    data.client_account_id = client?.id || null;
    data.client_name = client?.name || null;
  }
  if (patch.service_category !== undefined) data.service_category = patch.service_category;
  if (patch.agreement_start_date !== undefined) data.agreement_start_date = patch.agreement_start_date;
  if (patch.benchmark_hours !== undefined) data.benchmark_hours = patch.benchmark_hours;

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

async function removeCostAssignment(orgId, assignmentId) {
  const existing = await prisma.projectMemberAssignment.findFirst({ where: { id: assignmentId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  await prisma.projectMemberAssignment.delete({ where: { id: assignmentId } });
  return { deleted: true };
}

module.exports = {
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
  listMyGroupCharges,
  listAllGroupCharges,
  upsertCostAssignment,
  removeCostAssignment,
  listCostAssignments,
  getAccountBudgetSummary,
  listProjectProfiles,
  getProjectProfile,
  updateProjectProfile,
  monthlyDayRevenue,
};
