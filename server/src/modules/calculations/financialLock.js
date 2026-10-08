// Stage 3 - the financial lock freezes a month's billing / invoice / payment records, and the stages
// run in order (timesheets -> calculations -> financials).
//
//  * assertOpen(): once the month's `financials` calculation is locked, invoices, vendor invoices and
//    vendor payments of that month cannot be changed - an admin reopens the financial lock first
//    (audited, with a reason). Used by every invoice / payment mutation.
//  * lockOrderBlockers(): when Org.enforce_lock_order is on, a calculation cannot be locked while the
//    timesheets it is built from are still open, and the month's financials cannot be locked while
//    timesheets or started calculations are still open.

const prisma = require('../../config/db');
const { monthBounds } = require('./period');

const FROZEN = ['locked', 'change_detected'];
const STARTED_KINDS = ['billing', 'salary', 'salary_employee', 'vendor_bill', 'vendor_payment', 'resource_revenue', 'expense'];

// null when the month is open for changes; otherwise the error to return.
async function assertOpen(orgId, month, year) {
  if (!month || !year) return null;
  const calc = await prisma.financialCalculation.findFirst({
    where: { org_id: orgId, kind: 'financials', period_month: month, period_year: year, status: { in: FROZEN } },
    select: { id: true },
  });
  return calc ? { error: 'financial_locked' } : null;
}

// Memberships with timesheet entries in the month that are not locked (month lock, or every day locked).
async function unlockedMembers(orgId, period, entryWhere) {
  const { start, end } = monthBounds(period.period_month, period.period_year);
  const [entries, monthLocks, dayLocks] = await Promise.all([
    prisma.timesheetEntry.findMany({ where: { org_id: orgId, date: { gte: start, lte: end }, status: { not: 'rejected' }, ...entryWhere }, select: { org_membership_id: true }, distinct: ['org_membership_id'] }),
    prisma.timesheetMonthLock.findMany({ where: { org_id: orgId, period_month: period.period_month, period_year: period.period_year }, select: { org_membership_id: true } }),
    prisma.timesheetLock.count({ where: { org_id: orgId, date: { gte: start, lte: end } } }),
  ]);
  if (dayLocks >= end.getUTCDate()) return [];
  const locked = new Set(monthLocks.map((l) => l.org_membership_id));
  return entries.map((e) => e.org_membership_id).filter((id) => !locked.has(id));
}

async function lockOrderBlockers(orgId, kind, scopeKey, period) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { enforce_lock_order: true } });
  if (!org || org.enforce_lock_order === false) return [];
  const blockers = [];
  const where = {
    billing: { account_id: scopeKey },
    salary_employee: { org_membership_id: scopeKey },
    vendor_bill: { org_membership: { vendor_account_id: scopeKey } },
    vendor_payment: { org_membership: { worker_type: 'contractor' } },
  }[kind];
  if (where !== undefined || ['salary', 'resource_revenue', 'financials'].includes(kind)) {
    const open = await unlockedMembers(orgId, period, where || {});
    if (open.length) {
      blockers.push({ code: 'timesheets_not_locked', count: open.length, message: `Stage 1 first: ${open.length} timesheet${open.length === 1 ? ' is' : 's are'} not locked for this month (Time & Attendance > Timesheet Locks).` });
    }
  }
  if (kind === 'financials') {
    const open = await prisma.financialCalculation.count({
      where: { org_id: orgId, period_month: period.period_month, period_year: period.period_year, kind: { in: STARTED_KINDS }, status: { notIn: FROZEN } },
    });
    if (open) blockers.push({ code: 'calculations_not_locked', count: open, message: `Stage 2 first: ${open} calculation${open === 1 ? ' is' : 's are'} started but not locked for this month.` });
  }
  return blockers;
}

module.exports = { assertOpen, lockOrderBlockers, unlockedMembers };
