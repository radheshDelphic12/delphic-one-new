// Overtime tickets - how overtime works for attendance-paid people (OrgMembership.pay_basis = 'attendance').
//
//   The employee raises a ticket (day, hours, optional project, reason); the reporting manager
//   (or an admin) approves or rejects it. Approved hours are paid as OT by payroll
//   (hours x hourly rate x multiplier) and, when the ticket names a project that bills overtime,
//   billed to the client by the billing engine. Overtime is NEVER derived from project timesheet
//   hours (8h + 8h on two projects is normal billing time, not overtime).
//   People paid from timesheet hours (and contractors) keep the timesheet overtime flow.
//
// Admins can edit or delete any ticket with a reason (audited); every decision raises a finance
// change so a locked month is flagged for review instead of silently rewritten.

const prisma = require('../../config/db');
const { detectFinanceChange } = require('../../lib/financeChanges');
const { todayIst } = require('../../lib/istDate');

const MAX_DAY_HOURS = 12;
const ymd = (date) => date.toISOString().slice(0, 10);
const round2 = (n) => Math.round(n * 100) / 100;

const INCLUDE = {
  org_membership: { select: { id: true, manager_id: true, person_id: true, person: { select: { name: true } } } },
  account: { select: { id: true, name: true, project_name: true } },
  decider: { select: { id: true, name: true } },
};

function serialize(row) {
  return {
    id: row.id,
    org_membership_id: row.org_membership_id,
    employee: row.org_membership?.person?.name || null,
    date: ymd(row.date),
    hours: Number(row.hours),
    account_id: row.account_id,
    project: row.account ? row.account.project_name || row.account.name : null,
    reason: row.reason,
    status: row.status,
    decided_by: row.decider ? { id: row.decider.id, name: row.decider.name } : null,
    decided_at: row.decided_at,
    decision_reason: row.decision_reason,
    created_at: row.created_at,
  };
}

function canDecideFor(actor, target) {
  return actor.role === 'admin' || target?.manager_id === actor.org_membership_id;
}

async function usesTickets(orgMembershipId) {
  const m = await prisma.orgMembership.findUnique({ where: { id: orgMembershipId }, select: { pay_basis: true, worker_type: true } });
  return Boolean(m && m.worker_type !== 'contractor' && m.pay_basis === 'attendance');
}

async function dayTotal(orgMembershipId, date, excludeId = null) {
  const rows = await prisma.overtimeTicket.findMany({
    where: { org_membership_id: orgMembershipId, date, status: { in: ['pending', 'approved'] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { hours: true },
  });
  return rows.reduce((s, r) => s + Number(r.hours), 0);
}

async function createTicket(orgId, orgMembershipId, { date, hours, account_id, reason }) {
  if (!(await usesTickets(orgMembershipId))) return { error: 'tickets_not_applicable' };
  if (date > todayIst()) return { error: 'future_date' };
  if (account_id && !(await prisma.account.findFirst({ where: { id: account_id, org_id: orgId }, select: { id: true } }))) return { error: 'account_not_found' };
  if ((await dayTotal(orgMembershipId, date)) + hours > MAX_DAY_HOURS + 1e-9) return { error: 'exceeds_ticket_hours' };
  const row = await prisma.overtimeTicket.create({ data: { org_id: orgId, org_membership_id: orgMembershipId, date, hours, account_id: account_id || null, reason }, include: INCLUDE });
  return { ticket: serialize(row) };
}

// scope: mine (own), to_decide (pending tickets of my direct reports; every pending one for an admin), all (admin).
async function listTickets(orgId, actor, { scope = 'mine', status, from, to } = {}) {
  const where = { org_id: orgId, ...(status ? { status } : {}), ...(from || to ? { date: { gte: from || undefined, lte: to || undefined } } : {}) };
  if (scope === 'mine') where.org_membership_id = actor.org_membership_id;
  else if (scope === 'to_decide') {
    where.status = 'pending';
    if (actor.role !== 'admin') where.org_membership = { manager_id: actor.org_membership_id };
  } else if (actor.role !== 'admin') return { error: 'not_approver' };
  const rows = await prisma.overtimeTicket.findMany({ where, include: INCLUDE, orderBy: [{ date: 'desc' }, { created_at: 'desc' }], take: 300 });
  return { tickets: rows.map(serialize), uses_tickets: await usesTickets(actor.org_membership_id) };
}

async function raiseFinanceChange(orgId, actorUserId, row, description, oldValue, newValue) {
  await detectFinanceChange(orgId, {
    source_type: 'timesheet',
    source_id: row.id,
    date: row.date,
    org_membership_id: row.org_membership_id,
    account_id: row.account_id || null,
    changed_by: actorUserId,
    description,
    old_value: oldValue,
    new_value: newValue,
  });
}

// Manager of the employee, or an admin. A manager decides once; an admin may revise a decision.
async function decideTicket(orgId, ticketId, actor, { status, reason }) {
  const row = await prisma.overtimeTicket.findFirst({ where: { id: ticketId, org_id: orgId }, include: INCLUDE });
  if (!row) return { error: 'not_found' };
  if (!canDecideFor(actor, row.org_membership)) return { error: 'not_approver' };
  if (row.org_membership_id === actor.org_membership_id && actor.role !== 'admin') return { error: 'own_ticket' };
  if (row.status === 'cancelled') return { error: 'already_decided' };
  if (row.status !== 'pending' && actor.role !== 'admin') return { error: 'already_decided' };
  const updated = await prisma.overtimeTicket.update({ where: { id: ticketId }, data: { status, decided_by: actor.id, decided_at: new Date(), decision_reason: reason || null }, include: INCLUDE });
  if (status === 'approved' || row.status === 'approved') {
    await raiseFinanceChange(orgId, actor.id, row, `Overtime ticket ${status} (${Number(row.hours)}h)`, { status: row.status, hours: Number(row.hours) }, { status, hours: Number(row.hours) });
  }
  return { ticket: serialize(updated) };
}

// The employee withdraws a ticket that has not been decided yet.
async function cancelTicket(orgId, orgMembershipId, ticketId) {
  const row = await prisma.overtimeTicket.findFirst({ where: { id: ticketId, org_id: orgId, org_membership_id: orgMembershipId } });
  if (!row) return { error: 'not_found' };
  if (row.status !== 'pending') return { error: 'already_decided' };
  const updated = await prisma.overtimeTicket.update({ where: { id: ticketId }, data: { status: 'cancelled' }, include: INCLUDE });
  return { ticket: serialize(updated) };
}

// Admin correction: hours, day, project, reason, status. A reason is required and audited.
async function adminUpdateTicket(orgId, adminUser, ticketId, { reason, ticket_reason, ...patch }) {
  const row = await prisma.overtimeTicket.findFirst({ where: { id: ticketId, org_id: orgId }, include: INCLUDE });
  if (!row) return { error: 'not_found' };
  const next = { hours: patch.hours ?? Number(row.hours), date: patch.date ?? row.date };
  if ((await dayTotal(row.org_membership_id, next.date, row.id)) + next.hours > MAX_DAY_HOURS + 1e-9 && ['pending', 'approved'].includes(patch.status || row.status)) return { error: 'exceeds_ticket_hours' };
  if (patch.account_id && !(await prisma.account.findFirst({ where: { id: patch.account_id, org_id: orgId }, select: { id: true } }))) return { error: 'account_not_found' };
  const data = { ...patch, ...(ticket_reason !== undefined ? { reason: ticket_reason } : {}) };
  if (patch.status && patch.status !== row.status) Object.assign(data, { decided_by: adminUser.id, decided_at: new Date(), decision_reason: reason });
  const updated = await prisma.overtimeTicket.update({ where: { id: ticketId }, data, include: INCLUDE });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: adminUser.id, action: 'overtime_ticket_edit', entity_type: 'overtime_ticket', entity_id: ticketId, reason, snapshot: { before: serialize(row), after: serialize(updated) } },
  });
  await raiseFinanceChange(orgId, adminUser.id, row, `Overtime ticket edited by admin (${Number(row.hours)}h -> ${Number(updated.hours)}h, ${row.status} -> ${updated.status})`, { hours: Number(row.hours), status: row.status }, { hours: Number(updated.hours), status: updated.status });
  return { ticket: serialize(updated) };
}

async function adminDeleteTicket(orgId, adminUser, ticketId, { reason }) {
  const row = await prisma.overtimeTicket.findFirst({ where: { id: ticketId, org_id: orgId }, include: INCLUDE });
  if (!row) return { error: 'not_found' };
  await prisma.overtimeTicket.delete({ where: { id: ticketId } });
  await prisma.auditLog.create({
    data: { org_id: orgId, actor_id: adminUser.id, action: 'overtime_ticket_delete', entity_type: 'overtime_ticket', entity_id: ticketId, reason, snapshot: serialize(row) },
  });
  await raiseFinanceChange(orgId, adminUser.id, row, `Overtime ticket deleted by admin (${Number(row.hours)}h, was ${row.status})`, { hours: Number(row.hours), status: row.status }, null);
  return { deleted: true };
}

module.exports = { createTicket, listTickets, decideTicket, cancelTicket, adminUpdateTicket, adminDeleteTicket, usesTickets, round2 };
