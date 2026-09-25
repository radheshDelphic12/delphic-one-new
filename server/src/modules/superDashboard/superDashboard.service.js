const prisma = require('../../config/db');
const profitabilityService = require('../profitability/profitability.service');

const TRAILING_DAYS = 30;

function trailingSince() {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - TRAILING_DAYS);
  since.setUTCHours(0, 0, 0, 0);
  return since;
}

// Subsidiary tiles for the Group Overview dashboard — one row per org in the
// caller's holding group(s), with a trailing-30-day snapshot so the tile has
// something to show without requiring the viewer to pick a date range first.
async function listSubsidiaries(orgGroupIds) {
  const orgs = await prisma.org.findMany({
    where: { org_group_id: { in: orgGroupIds } },
    select: {
      id: true,
      name: true,
      slug: true,
      logo_url: true,
      status: true,
      valuation: true,
      default_currency: true,
    },
    orderBy: { name: 'asc' },
  });

  const since = trailingSince();
  return Promise.all(
    orgs.map(async (org) => {
      const [headcount, profitAgg, expenseAgg, vendorAgg] = await Promise.all([
        prisma.orgMembership.count({ where: { org_id: org.id, employment_status: { not: 'terminated' } } }),
        prisma.dailyEmployeeProfitability.aggregate({
          where: { org_id: org.id, date: { gte: since } },
          _sum: { revenue: true, cost: true, margin: true },
        }),
        prisma.expenseClaim.aggregate({
          where: { org_id: org.id, status: { in: ['approved', 'reimbursed'] }, created_at: { gte: since } },
          _sum: { amount: true },
        }),
        prisma.vendorPayment.aggregate({
          where: { org_id: org.id, status: { in: ['approved', 'paid'] }, created_at: { gte: since } },
          _sum: { amount: true },
        }),
      ]);
      return {
        org: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          logo_url: org.logo_url,
          status: org.status,
          default_currency: org.default_currency,
        },
        valuation: org.valuation,
        headcount,
        trailing_30d: {
          revenue: Number(profitAgg._sum.revenue || 0),
          cost: Number(profitAgg._sum.cost || 0),
          margin: Number(profitAgg._sum.margin || 0),
          expenses: Number(expenseAgg._sum.amount || 0),
          vendor_payments: Number(vendorAgg._sum.amount || 0),
        },
      };
    })
  );
}

// Group-dashboard revenue-vs-expense chart: layers approved expenses +
// vendor payments on top of the existing profitability rollup (revenue/cost/
// margin), bucketed the same way. Vendor payments only carry month/year
// granularity (schema.prisma's `period_month`/`period_year`, no day column),
// so on a `day` bucket they're deliberately left out rather than smeared
// across days they weren't actually paid on — a documented gap, same style
// as this codebase's other known-thin spots.
async function financialsRollup({ orgId, orgGroupIds, from, to, groupBy }) {
  const profitRows = await profitabilityService.rollup({
    orgId,
    orgGroupIds: orgId ? undefined : orgGroupIds,
    from,
    to,
    groupBy,
  });

  const buckets = new Map();
  function bucket(key) {
    if (!buckets.has(key)) {
      buckets.set(key, { period: key, revenue: 0, cost: 0, margin: 0, headcount: 0, expenses: 0, vendor_payments: 0 });
    }
    return buckets.get(key);
  }

  for (const row of profitRows) {
    const b = bucket(row.period);
    b.revenue = row.revenue;
    b.cost = row.cost;
    b.margin = row.margin;
    b.headcount = row.headcount;
  }

  const orgScope = orgId ? { org_id: orgId } : { org: { org_group_id: { in: orgGroupIds } } };

  const expenses = await prisma.expenseClaim.findMany({
    where: { ...orgScope, status: { in: ['approved', 'reimbursed'] }, created_at: { gte: from, lte: to } },
    select: { amount: true, created_at: true },
  });
  for (const claim of expenses) {
    const b = bucket(profitabilityService.bucketKey(claim.created_at, groupBy));
    b.expenses = profitabilityService.round2(b.expenses + Number(claim.amount));
  }

  if (groupBy !== 'day') {
    const vendorPayments = await prisma.vendorPayment.findMany({
      where: { ...orgScope, status: { in: ['approved', 'paid'] } },
      select: { amount: true, period_month: true, period_year: true },
    });
    for (const payment of vendorPayments) {
      const periodDate = new Date(Date.UTC(payment.period_year, payment.period_month - 1, 1));
      if (periodDate < from || periodDate > to) continue;
      const b = bucket(profitabilityService.bucketKey(periodDate, groupBy));
      b.vendor_payments = profitabilityService.round2(b.vendor_payments + Number(payment.amount));
    }
  }

  return Array.from(buckets.values())
    .map((b) => ({ ...b, net: profitabilityService.round2(b.margin - b.expenses - b.vendor_payments) }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

module.exports = { listSubsidiaries, financialsRollup };
