const prisma = require('../../config/db');
const logger = require('../../config/logger');
const { computeDayRevenue } = require('../billing/billing.service');

function round2(n) {
  return Math.round(n * 100) / 100;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function ym(date) {
  return ymd(date).slice(0, 7);
}

function yq(date) {
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${date.getUTCFullYear()}-Q${quarter}`;
}

function yr(date) {
  return String(date.getUTCFullYear());
}

function bucketKey(date, groupBy) {
  if (groupBy === 'day') return ymd(date);
  if (groupBy === 'quarter') return yq(date);
  if (groupBy === 'year') return yr(date);
  return ym(date);
}

function daysInMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

// One day, one org: allocates that day's project revenue (Phase 5) across
// everyone who logged approved+billable hours on each project, pro-rata by
// hours, nets it against salary cost prorated to the day, and upserts the
// DailyEmployeeProfitability fact row per membership. Ensures that day's
// DailyProjectRevenue is fresh first (calls billing's compute directly —
// these two batch steps are one logical pipeline, see schema.prisma's
// DailyEmployeeProfitability comment) rather than assuming it already ran.
async function computeDayForOrg(orgId, date) {
  const { computed: revenueRows } = await computeDayRevenue(orgId, date);

  const entries = await prisma.timesheetEntry.findMany({
    where: { org_id: orgId, date, status: 'approved', billable: true },
    select: { org_membership_id: true, account_id: true, requirement_id: true, hours: true },
  });

  // Module C: an ADDITIONAL cost layer on top of salary — a project-specific
  // hourly pay rate for the hours a member logged on that project, only
  // where an admin has explicitly set one (ProjectMemberAssignment). No
  // assignment for a given (account, member) means no project cost added,
  // same as before this feature existed.
  const costAssignments = await prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId },
    select: { account_id: true, org_membership_id: true, cost_rate_per_hr: true },
  });
  const costRateByKey = new Map(costAssignments.map((a) => [`${a.account_id}|${a.org_membership_id}`, Number(a.cost_rate_per_hr)]));
  const projectCostByMembership = new Map();
  for (const e of entries) {
    const rate = costRateByKey.get(`${e.account_id}|${e.org_membership_id}`);
    if (!rate) continue;
    const entry = projectCostByMembership.get(e.org_membership_id) || { cost: 0, allocations: [] };
    const cost = round2(Number(e.hours) * rate);
    entry.cost = round2(entry.cost + cost);
    entry.allocations.push({ account_id: e.account_id, hours: Number(e.hours), cost_rate_per_hr: rate, cost });
    projectCostByMembership.set(e.org_membership_id, entry);
  }

  // key = account_id|requirement_id -> { totalHours, byMembership: Map(membershipId -> hours) }
  const projectGroups = new Map();
  for (const e of entries) {
    const key = `${e.account_id}|${e.requirement_id || ''}`;
    const group = projectGroups.get(key) || { totalHours: 0, byMembership: new Map() };
    group.totalHours += Number(e.hours);
    group.byMembership.set(e.org_membership_id, (group.byMembership.get(e.org_membership_id) || 0) + Number(e.hours));
    projectGroups.set(key, group);
  }

  // membershipId -> { revenue, allocations: [...] }
  const revenueByMembership = new Map();
  for (const row of revenueRows) {
    const key = `${row.account_id}|${row.requirement_id || ''}`;
    const group = projectGroups.get(key);
    if (!group || group.totalHours === 0) continue;

    for (const [membershipId, hours] of group.byMembership.entries()) {
      const share = hours / group.totalHours;
      const allocated = round2(share * Number(row.revenue));
      const entry = revenueByMembership.get(membershipId) || { revenue: 0, allocations: [] };
      entry.revenue = round2(entry.revenue + allocated);
      entry.allocations.push({
        account_id: row.account_id,
        requirement_id: row.requirement_id,
        member_hours: hours,
        total_hours: group.totalHours,
        project_day_revenue: Number(row.revenue),
        allocated_revenue: allocated,
      });
      revenueByMembership.set(membershipId, entry);
    }
  }

  const memberships = await prisma.orgMembership.findMany({
    where: {
      org_id: orgId,
      joined_at: { lte: date },
      OR: [{ left_at: null }, { left_at: { gte: date } }],
    },
  });

  const computed = [];
  const skipped = [];

  for (const membership of memberships) {
    const structure = await prisma.salaryStructure.findFirst({
      where: { org_membership_id: membership.id, effective_from: { lte: date } },
      orderBy: { effective_from: 'desc' },
    });
    if (!structure) {
      skipped.push({ org_membership_id: membership.id, date: ymd(date), reason: 'no_salary_structure' });
      continue;
    }

    const salaryCost = round2(Number(structure.ctc) / daysInMonth(date));
    const projectCostEntry = projectCostByMembership.get(membership.id) || { cost: 0, allocations: [] };
    const cost = round2(salaryCost + projectCostEntry.cost);
    const revenueEntry = revenueByMembership.get(membership.id) || { revenue: 0, allocations: [] };
    const margin = round2(revenueEntry.revenue - cost);

    const breakdown = {
      ctc: Number(structure.ctc),
      days_in_month: daysInMonth(date),
      per_day_salary_cost: salaryCost,
      project_cost: projectCostEntry.cost,
      project_cost_allocations: projectCostEntry.allocations,
      revenue_allocations: revenueEntry.allocations,
    };

    const row = await prisma.dailyEmployeeProfitability.upsert({
      where: { org_membership_id_date: { org_membership_id: membership.id, date } },
      create: { org_id: orgId, org_membership_id: membership.id, date, revenue: revenueEntry.revenue, cost, margin, breakdown },
      update: { revenue: revenueEntry.revenue, cost, margin, breakdown },
    });
    computed.push(row);
  }

  return { computed, skipped };
}

async function computeRangeForOrg(orgId, dateFrom, dateTo) {
  const computed = [];
  const skipped = [];
  const days = Math.round((dateTo - dateFrom) / 86400000) + 1;
  for (let i = 0; i < days; i += 1) {
    const date = new Date(dateFrom.getTime() + i * 86400000);
    const result = await computeDayForOrg(orgId, date);
    computed.push(...result.computed);
    skipped.push(...result.skipped);
  }
  return { computed_count: computed.length, skipped };
}

// The "nightly batch job" entry point (jobs/profitabilityCompute.js) —
// every active org, one date. Per-org try/catch so one org's failure
// doesn't block the rest (mirrors jobs/interviewReminders.js).
async function computeAllOrgsForDate(date, orgGroupIds) {
  const orgs = await prisma.org.findMany({
    where: { status: 'active', org_group_id: { in: orgGroupIds } },
  });
  let orgsProcessed = 0;
  let membershipsComputed = 0;
  for (const org of orgs) {
    try {
      const { computed } = await computeDayForOrg(org.id, date);
      membershipsComputed += computed.length;
      orgsProcessed += 1;
    } catch (err) {
      logger.error('profitability_compute_org_failed', { org_id: org.id, date: ymd(date), err });
    }
  }
  return { orgs_processed: orgsProcessed, memberships_computed: membershipsComputed };
}

// Cross-org catch-up/testing trigger for the super dashboard — same shape as
// computeAllOrgsForDate but over a date range.
async function computeAllOrgsForDateRange(dateFrom, dateTo, orgGroupIds) {
  let orgsProcessed = 0;
  let membershipsComputed = 0;
  const days = Math.round((dateTo - dateFrom) / 86400000) + 1;
  for (let i = 0; i < days; i += 1) {
    const date = new Date(dateFrom.getTime() + i * 86400000);
    const result = await computeAllOrgsForDate(date, orgGroupIds);
    orgsProcessed = Math.max(orgsProcessed, result.orgs_processed);
    membershipsComputed += result.memberships_computed;
  }
  return { orgs_processed: orgsProcessed, memberships_computed: membershipsComputed };
}

async function listMine(orgMembershipId, { from, to, page, limit }) {
  const date = from || to ? { gte: from || undefined, lte: to || undefined } : undefined;
  const where = { org_membership_id: orgMembershipId, ...(date ? { date } : {}) };
  const [data, total] = await Promise.all([
    prisma.dailyEmployeeProfitability.findMany({
      where,
      orderBy: { date: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.dailyEmployeeProfitability.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

async function listTeam(orgId, { org_membership_id, from, to, page, limit }) {
  const date = from || to ? { gte: from || undefined, lte: to || undefined } : undefined;
  const where = { org_id: orgId, ...(org_membership_id ? { org_membership_id } : {}), ...(date ? { date } : {}) };
  const [data, total] = await Promise.all([
    prisma.dailyEmployeeProfitability.findMany({
      where,
      orderBy: [{ date: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: { org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
    }),
    prisma.dailyEmployeeProfitability.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

// Shared by the org-scoped `profitability` module and the cross-org
// `super-dashboard` module (HLD §7 — same rollup logic, just parameterized
// by an org filter instead of always "mine"). `orgId: undefined` reads
// across every org, exactly the fact table the super dashboard is meant to
// read from. `group_by: 'day'` still sums across every contributing
// membership for that day (a company/group total), not a raw row dump —
// pass `org_membership_id` to narrow to one person's trend instead.
async function rollup({ orgId, orgMembershipId, orgGroupIds, from, to, groupBy }) {
  const rows = await prisma.dailyEmployeeProfitability.findMany({
    where: {
      ...(orgId ? { org_id: orgId } : {}),
      ...(orgGroupIds?.length ? { org: { org_group_id: { in: orgGroupIds } } } : {}),
      ...(orgMembershipId ? { org_membership_id: orgMembershipId } : {}),
      date: { gte: from, lte: to },
    },
    select: { org_membership_id: true, date: true, revenue: true, cost: true, margin: true },
  });

  const buckets = new Map();
  for (const row of rows) {
    const key = bucketKey(row.date, groupBy);
    const bucket = buckets.get(key) || { period: key, revenue: 0, cost: 0, margin: 0, memberships: new Set() };
    bucket.revenue = round2(bucket.revenue + Number(row.revenue));
    bucket.cost = round2(bucket.cost + Number(row.cost));
    bucket.margin = round2(bucket.margin + Number(row.margin));
    bucket.memberships.add(row.org_membership_id);
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values())
    .map((b) => ({ period: b.period, revenue: b.revenue, cost: b.cost, margin: b.margin, headcount: b.memberships.size }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

module.exports = {
  computeDayForOrg,
  computeRangeForOrg,
  computeAllOrgsForDate,
  computeAllOrgsForDateRange,
  listMine,
  listTeam,
  rollup,
  bucketKey,
  round2,
};
