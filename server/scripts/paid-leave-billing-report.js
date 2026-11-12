/**
 * READ ONLY. For each project and month: how much of the client billing currently comes from approved LEAVE days.
 * It runs the real billing engine (computeProjectMonth), so the figures are exactly what Billing & Sales would bill,
 * and changes nothing. Used to decide, project by project, whether the leave rules (Account.billing_leave_rules) should change.
 *
 *   resource_leave_*   resources with their OWN monthly rate: days billed with a leave status (paid leave pl, comp off,
 *                      first / second half, non-paid npl) and the amount billed for those days, from the project's leave rules.
 *   contract_*         projects billed on the monthly contract: working days on which allocated people are on approved leave.
 *                      `all_on_leave_days` = days where EVERY allocated person is on full leave but the day was still billed;
 *                      `all_on_leave_amount` is what those days earned. A fixed monthly fee may legitimately bill this.
 *   lock               the billing record's lock state for the month (a locked month is never changed by this report either).
 *
 * Nothing here changes money logic; Paras decides per project.
 *
 * Usage:  node server/scripts/paid-leave-billing-report.js [--from 2026-10] [--to 2026-10] [--org <org_id>] [--csv <file>]
 */
const fs = require('fs');

const round2 = (n) => Math.round(n * 100) / 100;
const LEAVE_STATUSES = new Set(['pl', 'npl', 'comp_off', 'first_half', 'second_half']);

function monthsBetween(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push({ year: y, month: m }); m === 12 ? (y += 1, m = 1) : (m += 1); }
  return out;
}

async function reportForOrg(prisma, orgId, months) {
  const billing = require('../src/modules/calculations/engines/billing.engine');
  const projects = await billing.listProjects(orgId, {});
  const rows = [];
  for (const { year, month } of months) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    const calcs = await prisma.financialCalculation.findMany({ where: { org_id: orgId, kind: 'billing', period_month: month, period_year: year }, select: { scope_key: true, status: true } });
    const lockOf = new Map(calcs.map((c) => [c.scope_key, c.status]));
    for (const account of projects) {
      if (!billing.overlapsMonth(account, start, end)) continue;
      const raw = await billing.computeProjectMonth(orgId, account, { period_month: month, period_year: year });
      if (!raw?.days?.length) continue;

      // own-rate resources billed on a leave status
      const byStatus = {};
      let resourceAmount = 0;
      let resourceDays = 0;
      for (const d of raw.days) {
        for (const r of d.resources) {
          if (!r.own_rate || r.rate_type !== 'monthly' || !LEAVE_STATUSES.has(r.billing_status) || !(r.base_amount > 0)) continue;
          byStatus[r.billing_status] = (byStatus[r.billing_status] || 0) + 1;
          resourceAmount += r.base_amount;
          resourceDays += 1;
        }
      }

      // contract-billed days on which allocated people are on leave
      let contractLeaveDays = 0;
      let allOnLeaveDays = 0;
      let allOnLeaveAmount = 0;
      if (raw.billing_type === 'monthly' && raw.billing_basis === 'contract') {
        const assigned = await prisma.projectMemberAssignment.findMany({
          where: { org_id: orgId, account_id: account.id, AND: [{ OR: [{ start_date: null }, { start_date: { lte: end } }] }, { OR: [{ end_date: null }, { end_date: { gte: start } }] }] },
          select: { org_membership_id: true, start_date: true, end_date: true },
        });
        const ids = [...new Set(assigned.map((a) => a.org_membership_id))];
        const leaves = ids.length
          ? await prisma.leaveRequest.findMany({ where: { org_id: orgId, org_membership_id: { in: ids }, status: 'approved', from_date: { lte: end }, to_date: { gte: start } }, select: { org_membership_id: true, from_date: true, to_date: true, is_half_day: true } })
          : [];
        for (const d of raw.days) {
          if (!d.in_contract || !d.is_working_day || !(d.base_amount > 0)) continue;
          const date = new Date(`${d.date}T00:00:00.000Z`);
          const team = [...new Set(assigned.filter((a) => (!a.start_date || a.start_date <= date) && (!a.end_date || a.end_date >= date)).map((a) => a.org_membership_id))];
          if (!team.length) continue;
          const offFull = team.filter((id) => {
            const l = leaves.filter((x) => x.org_membership_id === id && x.from_date <= date && x.to_date >= date);
            return l.some((x) => !x.is_half_day) || l.length >= 2;
          });
          if (offFull.length) contractLeaveDays += 1;
          if (offFull.length === team.length) { allOnLeaveDays += 1; allOnLeaveAmount += d.base_amount; }
        }
      }

      if (!resourceDays && !contractLeaveDays) continue;
      rows.push({
        org_id: orgId,
        project: account.project_name || account.name,
        client: account.client_name || '',
        month: `${year}-${String(month).padStart(2, '0')}`,
        currency: raw.currency,
        billing: `${raw.billing_type || '-'}/${raw.billing_basis}`,
        leave_rules: JSON.stringify(require('../src/modules/calculations/engines/resourceBilling').rulesFor(account)),
        resource_leave_days: resourceDays,
        resource_leave_by_status: JSON.stringify(byStatus),
        resource_leave_amount: round2(resourceAmount),
        contract_days_with_leave: contractLeaveDays,
        all_on_leave_days: allOnLeaveDays,
        all_on_leave_amount: round2(allOnLeaveAmount),
        lock: lockOf.get(account.id) || 'draft',
      });
    }
  }
  return rows;
}

async function report(prisma, { from, to, orgId = null }) {
  const orgs = orgId ? [{ id: orgId }] : await prisma.org.findMany({ select: { id: true } });
  const months = monthsBetween(from, to);
  const rows = [];
  for (const org of orgs) rows.push(...(await reportForOrg(prisma, org.id, months)));
  return rows;
}

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
  try {
    const from = arg('from', '2026-10');
    const rows = await report(prisma, { from, to: arg('to', from), orgId: arg('org', null) });
    if (!rows.length) console.log('No project bills any leave day in this range.');
    else console.table(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'org_id' && k !== 'leave_rules'))));
    const csv = arg('csv', null);
    if (csv && rows.length) {
      const cols = Object.keys(rows[0]);
      fs.writeFileSync(csv, [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(','))].join('\n'));
      console.log(`Wrote ${rows.length} rows to ${csv}`);
    }
    console.log('\nA fixed monthly-fee contract may legitimately bill leave days. Nothing was changed.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { report };
