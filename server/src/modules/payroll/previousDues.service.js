// A previous month's salary that was not (fully) paid: an employee who joined late in a month and is missing days from that
// month's payslip, or has no payslip. When a payroll month is prepared the admin sees them and chooses, one by one, to add
// them into this month. Nothing is added automatically; what is not added is offered again every following month.
const prisma = require('../../config/db');
const adjustments = require('./salaryAdjustments.service');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const LOOKBACK_MONTHS = 3;
const MIN_DUE = 1; // rupees; smaller differences are rounding, not unpaid days

function monthsBefore(month, year, count) {
  const out = [];
  let m = month;
  let y = year;
  for (let i = 0; i < count; i += 1) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    out.push({ month: m, year: y });
  }
  return out;
}

/** The dues still open when `run` (a payroll month) is prepared: people who joined in an earlier month, short-paid there. */
async function pending(orgId, run) {
  // Lazy: payroll.service pulls in the salary engine.
  const payroll = require('./payroll.service');
  const added = await prisma.previousMonthDue.findMany({ where: { org_id: orgId }, select: { org_membership_id: true, due_year: true, due_month: true } });
  const done = new Set(added.map((a) => `${a.org_membership_id}|${a.due_year}|${a.due_month}`));
  const out = [];
  for (const { month, year } of monthsBefore(run.period_month, run.period_year, LOOKBACK_MONTHS)) {
    const prev = await prisma.payrollRun.findUnique({
      where: { org_id_period_month_period_year: { org_id: orgId, period_month: month, period_year: year } },
      include: { payslips: { select: { org_membership_id: true, net: true } } },
    });
    if (!prev || prev.status !== 'processed') continue; // that month is not paid yet: it will be paid in its own run
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    const joined = await prisma.orgMembership.findMany({
      where: { org_id: orgId, worker_type: { not: 'contractor' }, joined_at: { gte: start, lte: end } },
      select: { id: true, joined_at: true, employee_code: true, person: { select: { name: true } } },
    });
    if (!joined.length) continue;
    const { rows } = await payroll.runLines(orgId, prev);
    const owed = new Map(rows.map((r) => [r.org_membership_id, Number(r.net)]));
    const paid = new Map(prev.payslips.map((p) => [p.org_membership_id, Number(p.net)]));
    for (const person of joined) {
      if (!owed.has(person.id) || done.has(`${person.id}|${year}|${month}`)) continue;
      const amount = round2(owed.get(person.id) - (paid.get(person.id) || 0));
      if (amount < MIN_DUE) continue;
      out.push({
        org_membership_id: person.id,
        name: person.person?.name || null,
        employee_code: person.employee_code,
        joined_at: person.joined_at.toISOString().slice(0, 10),
        due_month: month,
        due_year: year,
        due_label: `${MONTHS[month - 1]} ${year}`,
        owed: round2(owed.get(person.id)),
        paid: round2(paid.get(person.id) || 0),
        amount,
        had_payslip: paid.has(person.id),
      });
    }
  }
  return out;
}

async function forRun(orgId, runId) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, org_id: orgId } });
  if (!run) return { error: 'not_found' };
  return { run: { id: run.id, period_month: run.period_month, period_year: run.period_year, status: run.status }, dues: await pending(orgId, run) };
}

/**
 * The admin adds one due into this run's month as a salary addition (a normal, audited salary adjustment). Only a due that is
 * currently open can be added, and only once.
 */
async function add(orgId, admin, runId, { org_membership_id, due_month, due_year }) {
  const run = await prisma.payrollRun.findFirst({ where: { id: runId, org_id: orgId } });
  if (!run) return { error: 'not_found' };
  const open = (await pending(orgId, run)).find((d) => d.org_membership_id === org_membership_id && d.due_month === due_month && d.due_year === due_year);
  if (!open) return { error: 'not_due' };
  const created = await adjustments.create(orgId, admin, {
    org_membership_id,
    period_month: run.period_month,
    period_year: run.period_year,
    kind: 'addition',
    amount: open.amount,
    note: `Previous month (${open.due_label}) unpaid salary`,
  });
  if (created.error) return { error: created.error };
  const row = await prisma.previousMonthDue.create({
    data: { org_id: orgId, org_membership_id, due_month, due_year, amount: open.amount, added_in_month: run.period_month, added_in_year: run.period_year, adjustment_id: created.adjustment?.id || null, added_by: admin.id },
  });
  return { due: row, needs_refresh: run.status === 'processed' };
}

module.exports = { pending, forRun, add };
