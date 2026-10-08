// Lock audit trail for the three financial-lock stages:
//   timesheet   - an employee's month (or a whole day) of timesheets locked / reopened
//   calculation - billing, salary, resource revenue, vendor, expense calculations locked / recalculated / reopened
//   financial   - the month's financials finalized / reopened
// One row per affected record: a bulk action writes one row per employee / project / record, all
// sharing a bulk_id. Rows are append-only. Each row says who, when, which employee / project /
// month, which stage, the previous and new status, what changed and why.

const crypto = require('crypto');
const prisma = require('../../config/db');

const STAGES = ['timesheet', 'calculation', 'financial'];

// 'financials' finalizes the month; every other calculation kind is the calculation stage.
const stageOfKind = (kind) => (kind === 'financials' ? 'financial' : 'calculation');

const newBulkId = () => crypto.randomUUID();

async function record(db, orgId, row) {
  return db.lockAudit.create({
    data: {
      org_id: orgId,
      stage: row.stage,
      action: row.action,
      actor_id: row.actor_id,
      org_membership_id: row.org_membership_id || null,
      account_id: row.account_id || null,
      period_month: row.period_month || null,
      period_year: row.period_year || null,
      previous_status: row.previous_status || null,
      new_status: row.new_status || null,
      change: row.change ? String(row.change).slice(0, 500) : null,
      reason: row.reason || null,
      bulk_id: row.bulk_id || null,
    },
  });
}

// The employee / project a calculation scope refers to (salary_employee -> employee, billing / vendor_bill -> account).
function targetsOfCalc(calc) {
  if (calc.kind === 'salary_employee') return { org_membership_id: calc.scope_key };
  if (calc.kind === 'billing' || calc.kind === 'vendor_bill') return { account_id: calc.scope_key };
  return {};
}

const ACTION_OF = {
  calculation_review: 'review',
  calculation_lock: 'lock',
  calculation_recalculate: 'recalculate',
  calculation_reopen: 'reopen',
  calculation_change_dismiss: 'dismiss_change',
};

async function recordCalculation(db, orgId, actorId, auditAction, calc, reason, { previous_status = null, bulk_id = null, change = null } = {}) {
  const action = ACTION_OF[auditAction];
  if (!action || !actorId) return null;
  return record(db, orgId, {
    stage: stageOfKind(calc.kind),
    action,
    actor_id: actorId,
    ...targetsOfCalc(calc),
    period_month: calc.period_month,
    period_year: calc.period_year,
    previous_status,
    new_status: calc.status,
    change: change || `${calc.kind.replace(/_/g, ' ')}${calc.scope_label ? ` - ${calc.scope_label}` : ''}: ${action}`,
    reason,
    bulk_id,
  });
}

// A change to operational data inside an already locked period (raised by the change detector).
async function recordLockedChange(orgId, calc, { changed_by, description, org_membership_id, account_id }) {
  const actor = changed_by || calc.locked_by || calc.created_by;
  if (!actor) return null;
  return record(prisma, orgId, {
    stage: stageOfKind(calc.kind),
    action: 'change',
    actor_id: actor,
    org_membership_id: org_membership_id || targetsOfCalc(calc).org_membership_id || null,
    account_id: account_id || targetsOfCalc(calc).account_id || null,
    period_month: calc.period_month,
    period_year: calc.period_year,
    previous_status: calc.status,
    new_status: 'change_detected',
    change: description,
  });
}

async function list(orgId, { stage, year, month, org_membership_id, account_id, bulk_id, limit = 200 } = {}) {
  const rows = await prisma.lockAudit.findMany({
    where: {
      org_id: orgId,
      ...(stage ? { stage } : {}),
      ...(year ? { period_year: year } : {}),
      ...(month ? { period_month: month } : {}),
      ...(org_membership_id ? { org_membership_id } : {}),
      ...(account_id ? { account_id } : {}),
      ...(bulk_id ? { bulk_id } : {}),
    },
    orderBy: { created_at: 'desc' },
    take: Math.min(limit, 500),
  });
  const userIds = [...new Set(rows.map((r) => r.actor_id))];
  const memberIds = [...new Set(rows.map((r) => r.org_membership_id).filter(Boolean))];
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter(Boolean))];
  const [users, members, accounts] = await Promise.all([
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    memberIds.length ? prisma.orgMembership.findMany({ where: { id: { in: memberIds } }, select: { id: true, person: { select: { name: true } } } }) : [],
    accountIds.length ? prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, name: true, project_name: true } }) : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const memberName = new Map(members.map((m) => [m.id, m.person?.name || null]));
  const accountName = new Map(accounts.map((a) => [a.id, a.project_name || a.name]));
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    stage: r.stage,
    action: r.action,
    actor: { id: r.actor_id, name: userName.get(r.actor_id) || null },
    employee: r.org_membership_id ? { id: r.org_membership_id, name: memberName.get(r.org_membership_id) || null } : null,
    project: r.account_id ? { id: r.account_id, name: accountName.get(r.account_id) || null } : null,
    period_month: r.period_month,
    period_year: r.period_year,
    previous_status: r.previous_status,
    new_status: r.new_status,
    change: r.change,
    reason: r.reason,
    bulk_id: r.bulk_id,
  }));
}

module.exports = { STAGES, stageOfKind, newBulkId, record, recordCalculation, recordLockedChange, list };
