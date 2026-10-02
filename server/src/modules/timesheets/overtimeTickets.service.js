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
const lockAudit = require('../calculations/lockAudit.service');

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
    manager_approved_at: row.manager_approved_at || null,
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
    where: { org_membership_id: orgMembershipId, date, status: { in: ['pending', 'manager_approved', 'approved'] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { hours: true },
  });
  return rows.reduce((s, r) => s + Number(r.hours), 0);
}

// Append-only history of a ticket: submission, every approval / rejection step, cancellation, admin edits.
async function recordEvent(ticketId, action, { from = null, to = null, actorId = null, reason = null, detail = null } = {}) {
  await prisma.overtimeTicketEvent.create({ data: { ticket_id: ticketId, action, from_status: from, to_status: to, actor_id: actorId, reason, detail } });
}

async function approvalPolicy(orgId) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { timesheet_manager_approval: true, timesheet_admin_approval: true } });
  return { manager: org?.timesheet_manager_approval !== false, admin: org?.timesheet_admin_approval !== false };
}

async function createTicket(orgId, orgMembershipId, { date, hours, account_id, reason }) {
  if (!(await usesTickets(orgMembershipId))) return { error: 'tickets_not_applicable' };
  if (date > todayIst()) return { error: 'future_date' };
  if (account_id && !(await prisma.account.findFirst({ where: { id: account_id, org_id: orgId }, select: { id: true } }))) return { error: 'account_not_found' };
  if ((await dayTotal(orgMembershipId, date)) + hours > MAX_DAY_HOURS + 1e-9) return { error: 'exceeds_ticket_hours' };
  const row = await prisma.overtimeTicket.create({ data: { org_id: orgId, org_membership_id: orgMembershipId, date, hours, account_id: account_id || null, reason }, include: INCLUDE });
  await recordEvent(row.id, 'submitted', { to: 'pending', actorId: row.org_membership?.person_id || null, reason, detail: { date: ymd(row.date), hours: Number(row.hours) } });
  return { ticket: serialize(row) };
}

// scope: mine (own), to_decide (pending tickets of my direct reports; every pending one for an admin), all (admin).
async function listTickets(orgId, actor, { scope = 'mine', status, from, to } = {}) {
  const where = { org_id: orgId, ...(status ? { status } : {}), ...(from || to ? { date: { gte: from || undefined, lte: to || undefined } } : {}) };
  if (scope === 'mine') where.org_membership_id = actor.org_membership_id;
  else if (scope === 'to_decide') {
    if (actor.role === 'admin') where.status = { in: ['pending', 'manager_approved'] };
    else {
      where.status = 'pending';
      where.org_membership = { manager_id: actor.org_membership_id };
    }
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

// The ticket decision also goes on the shared lock / approval audit trail.
async function trail(orgId, actor, row, action, previous, next, change, reason) {
  await lockAudit.record(prisma, orgId, {
    stage: 'timesheet', action, actor_id: actor.id, org_membership_id: row.org_membership_id, account_id: row.account_id || null,
    period_month: row.date.getUTCMonth() + 1, period_year: row.date.getUTCFullYear(), previous_status: previous, new_status: next, change, reason: reason || null,
  });
}

// Manager of the employee, or an admin. A manager decides once; an admin may revise a decision.
async function decideTicket(orgId, ticketId, actor, { status, reason }) {
  const row = await prisma.overtimeTicket.findFirst({ where: { id: ticketId, org_id: orgId }, include: INCLUDE });
  if (!row) return { error: 'not_found' };
  if (!canDecideFor(actor, row.org_membership)) return { error: 'not_approver' };
  if (row.org_membership_id === actor.org_membership_id && actor.role !== 'admin') return { error: 'own_ticket' };
  if (row.status === 'cancelled') return { error: 'already_decided' };
  const isAdmin = actor.role === 'admin';
  if (row.status === 'manager_approved' && !isAdmin) return { error: 'awaiting_admin' };
  if (row.status !== 'pending' && !isAdmin) return { error: 'already_decided' };
  // Employee -> Manager (optional) -> Admin (mandatory): a manager's approval is only the first step.
  const policy = await approvalPolicy(orgId);
  if (!isAdmin && !policy.manager) return { error: 'manager_approval_disabled' };
  if (!isAdmin && status === 'approved' && policy.admin) {
    const stepped = await prisma.overtimeTicket.update({ where: { id: ticketId }, data: { status: 'manager_approved', manager_approved_by: actor.id, manager_approved_at: new Date(), decision_reason: reason || null }, include: INCLUDE });
    await recordEvent(ticketId, 'manager_approved', { from: row.status, to: 'manager_approved', actorId: actor.id, reason });
    await trail(orgId, actor, row, 'manager_approve', row.status, 'manager_approved', `Overtime ticket ${Number(row.hours)}h approved by the manager, waiting for the admin`, reason);
    return { ticket: serialize(stepped), awaiting_admin: true };
  }
  const updated = await prisma.overtimeTicket.update({ where: { id: ticketId }, data: { status, decided_by: actor.id, decided_at: new Date(), decision_reason: reason || null }, include: INCLUDE });
  await recordEvent(ticketId, status, { from: row.status, to: status, actorId: actor.id, reason });
  await trail(orgId, actor, row, status === 'rejected' ? 'reject' : 'approve', row.status, status, `Overtime ticket ${Number(row.hours)}h ${status}`, reason);
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
  await recordEvent(ticketId, 'cancelled', { from: 'pending', to: 'cancelled', actorId: updated.org_membership?.person_id || null });
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
  await recordEvent(ticketId, 'edited', { from: row.status, to: updated.status, actorId: adminUser.id, reason, detail: { before: { hours: Number(row.hours), date: ymd(row.date) }, after: { hours: Number(updated.hours), date: ymd(updated.date) } } });
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

// The full history of a ticket (who, what, when). Visible to the employee, their manager and admins.
async function ticketHistory(orgId, actor, ticketId) {
  const row = await prisma.overtimeTicket.findFirst({ where: { id: ticketId, org_id: orgId }, include: INCLUDE });
  if (!row) return { error: 'not_found' };
  if (actor.role !== 'admin' && row.org_membership_id !== actor.org_membership_id && row.org_membership?.manager_id !== actor.org_membership_id) return { error: 'not_approver' };
  const events = await prisma.overtimeTicketEvent.findMany({ where: { ticket_id: ticketId }, orderBy: { created_at: 'asc' } });
  const ids = [...new Set(events.map((e) => e.actor_id).filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return { ticket: serialize(row), events: events.map((e) => ({ id: e.id, action: e.action, from_status: e.from_status, to_status: e.to_status, actor: e.actor_id ? { id: e.actor_id, name: names.get(e.actor_id) || null } : null, reason: e.reason, detail: e.detail, created_at: e.created_at })) };
}

module.exports = { ticketHistory, createTicket, listTickets, decideTicket, cancelTicket, adminUpdateTicket, adminDeleteTicket, usesTickets, round2 };
