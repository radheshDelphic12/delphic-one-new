const prisma = require('../../config/db');
const logger = require('../../config/logger');
const calendarsService = require('../calendars/calendars.service');
const leaveService = require('../leave/leave.service');
const { computeDayRevenue } = require('../billing/billing.service');
const { notify } = require('../../lib/notifications');
const { asIst, todayIst } = require('../../lib/istDate');

const ymd = (date) => date.toISOString().slice(0, 10);

// IT staff log against a fixed set of assigned projects only; everyone else
// logs plain Date/Hours/Notes with no project (see createEntry).
async function isItMember(orgMembershipId) {
  const m = await prisma.orgMembership.findUnique({
    where: { id: orgMembershipId },
    select: { person: { select: { department: { select: { name: true } } } } },
  });
  return m?.person?.department?.name?.toLowerCase() === 'it';
}

async function isAssignedToProject(orgId, orgMembershipId, accountId) {
  const row = await prisma.projectMemberAssignment.findFirst({
    where: { org_id: orgId, org_membership_id: orgMembershipId, account_id: accountId },
    select: { id: true },
  });
  return Boolean(row);
}

// Approver routing: the employee's reporting manager (OrgMembership.manager_id),
// resolved live so a reporting-line change applies to the very next submission.
// No manager set -> admins are the fallback approvers (they can always decide).
async function managerPersonId(orgMembershipId) {
  const m = await prisma.orgMembership.findUnique({
    where: { id: orgMembershipId },
    select: { manager: { select: { person_id: true } } },
  });
  return m?.manager?.person_id || null;
}

async function notifyManager(orgId, orgMembershipId, type, actorId, context) {
  const managerId = await managerPersonId(orgMembershipId);
  if (!managerId) return;
  await notify(prisma, { type, actorId, recipientIds: [managerId], context: { ...context, orgId, skipAdmins: true } });
}

function canDecideFor(actor, targetMembership) {
  return actor.role === 'admin' || targetMembership?.manager_id === actor.org_membership_id;
}

// Total hours the employee has on a date across every project, ignoring
// rejected entries and (when editing) the entry being changed — the single
// place the 24h/day rule is computed so create, edit, and ticket-approval
// can't drift apart.
async function otherHoursOnDay(orgMembershipId, date, excludeEntryId) {
  const rows = await prisma.timesheetEntry.findMany({
    where: {
      org_membership_id: orgMembershipId,
      date,
      status: { not: 'rejected' },
      ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
    },
    select: { hours: true },
  });
  return rows.reduce((sum, e) => sum + Number(e.hours), 0);
}

// Revenue is derived from approved billable hours, so approving an entry (or
// changing an approved one) refreshes that day's DailyProjectRevenue at once
// instead of waiting for the nightly job. Best-effort: a billing hiccup must
// never fail or roll back the timesheet decision — the nightly profitability
// job recomputes yesterday regardless.
async function refreshRevenue(orgId, date) {
  try {
    await computeDayRevenue(orgId, date);
  } catch (err) {
    logger.error('timesheet_revenue_refresh_failed', { org_id: orgId, date: date.toISOString().slice(0, 10), err });
  }
}

async function isLocked(orgId, date) {
  const lock = await prisma.timesheetLock.findUnique({ where: { org_id_date: { org_id: orgId, date } } });
  return Boolean(lock);
}

async function createEntry(orgId, orgMembershipId, { date, account_id, requirement_id, hours, billable, notes }, actorUserId = null) {
  if (await isLocked(orgId, date)) return { error: 'day_locked' };

  // Approved Leave Day = no timesheet, no project hours.
  const leave = await leaveService.leaveDayFor(orgId, orgMembershipId, date);
  if (leave) return { error: 'leave_day', leave };

  const it = await isItMember(orgMembershipId);
  if (it && !account_id) return { error: 'project_required' };

  let account = null;
  if (account_id) {
    account = await prisma.account.findFirst({ where: { id: account_id, org_id: orgId } });
    if (!account) return { error: 'account_not_found' };
    if (it && !(await isAssignedToProject(orgId, orgMembershipId, account_id))) return { error: 'project_not_assigned' };
    if (requirement_id) {
      const requirement = await prisma.requirement.findFirst({ where: { id: requirement_id, account_id, org_id: orgId } });
      if (!requirement) return { error: 'requirement_not_found' };
    }
  }

  // Timesheets follow the PROJECT's calendar (or the employee's own default
  // calendar when there is no project). A holiday no longer blocks the log —
  // it's allowed and flagged as overtime/holiday work for that entry only.
  const holiday = await calendarsService.holidayFor(orgId, orgMembershipId, account_id || null, date);

  // Multi-project allocation (4h Project A + 4h Project B in one day) is
  // fine; the total for the day still can't exceed 24h.
  if ((await otherHoursOnDay(orgMembershipId, date)) + hours > 24) return { error: 'exceeds_day_hours' };

  const alreadyPendingToday = await prisma.timesheetEntry.count({ where: { org_membership_id: orgMembershipId, date, status: 'submitted' } });

  const entry = await prisma.timesheetEntry.create({
    data: {
      org_id: orgId,
      org_membership_id: orgMembershipId,
      date,
      account_id: account_id || null,
      requirement_id,
      hours,
      // A no-project entry is general time — never billable, so it can't
      // leak into revenue / project cost / budget.
      billable: account_id ? billable : false,
      notes,
      is_holiday_overtime: Boolean(holiday),
      holiday_label: holiday ? `${holiday.label}, ${holiday.calendar_name}` : null,
    },
  });

  // Route to the reporting manager — one ping per employee per day, not per row.
  if (alreadyPendingToday === 0) {
    const person = await prisma.orgMembership.findUnique({ where: { id: orgMembershipId }, select: { person: { select: { name: true } } } });
    await notifyManager(orgId, orgMembershipId, 'timesheet_submitted', actorUserId, {
      employeeName: person?.person?.name, hours, dateLabel: ymd(date), accountName: account?.name,
    });
  }
  return { entry };
}

function dateRangeWhere({ from, to }) {
  if (!from && !to) return undefined;
  return { gte: from || undefined, lte: to || undefined };
}

async function listMine(orgMembershipId, { from, to, account_id, status, page, limit }) {
  const date = dateRangeWhere({ from, to });
  const where = {
    org_membership_id: orgMembershipId,
    ...(date ? { date } : {}),
    ...(account_id ? { account_id } : {}),
    ...(status ? { status } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: { account: { select: { id: true, name: true } }, requirement: { select: { id: true, title: true } } },
    }),
    prisma.timesheetEntry.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

async function listTeam(orgId, { from, to, org_membership_id, account_id, status, department_id, page, limit }) {
  const date = dateRangeWhere({ from, to });
  const where = {
    org_id: orgId,
    ...(org_membership_id ? { org_membership_id } : {}),
    ...(account_id ? { account_id } : {}),
    ...(status ? { status } : {}),
    ...(date ? { date } : {}),
    // Legacy User.department_id (same field GET /users/me already returns),
    // not OrgMembership.department_id — see requireItDepartment's own note.
    ...(department_id ? { org_membership: { person: { department_id } } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        org_membership: { select: { id: true, person: { select: { id: true, name: true } } } },
        account: { select: { id: true, name: true } },
        requirement: { select: { id: true, title: true } },
      },
    }),
    prisma.timesheetEntry.count({ where }),
  ]);
  return { data, pagination: { page, limit, total } };
}

// Itemized month view for the IT timesheet: every entry for the member in
// [year, month], grouped by date with a running daily total — the exact
// shape both the "My IT timesheet" grid and the Excel export read from, so
// the two can never drift apart.
async function monthlyGrouped(orgId, orgMembershipId, year, month) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const rows = await prisma.timesheetEntry.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId, date: { gte: from, lt: to } },
    orderBy: [{ date: 'asc' }, { created_at: 'asc' }],
    include: { account: { select: { id: true, name: true } } },
  });

  const byDate = new Map();
  for (const row of rows) {
    const key = row.date.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, { date: key, total_hours: 0, entries: [] });
    const day = byDate.get(key);
    day.total_hours += Number(row.hours);
    day.entries.push({
      id: row.id,
      account: row.account,
      hours: Number(row.hours),
      billable: row.billable,
      notes: row.notes,
      status: row.status,
      decision_reason: row.decision_reason,
      is_holiday_overtime: row.is_holiday_overtime,
      holiday_label: row.holiday_label,
    });
  }
  for (const day of byDate.values()) day.total_hours = Math.round(day.total_hours * 100) / 100;
  return Array.from(byDate.values());
}

// Owner-only, and only while still 'submitted' (not yet decided) and the
// day isn't locked — a locked/decided entry can only change via a
// regularization ticket.
async function updateEntry(orgId, orgMembershipId, entryId, patch) {
  const existing = await prisma.timesheetEntry.findFirst({ where: { id: entryId, org_id: orgId, org_membership_id: orgMembershipId } });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'submitted') return { error: 'already_decided' };
  if (await isLocked(orgId, existing.date)) return { error: 'day_locked' };

  if (patch.hours !== undefined && (await otherHoursOnDay(orgMembershipId, existing.date, entryId)) + Number(patch.hours) > 24) {
    return { error: 'exceeds_day_hours' };
  }

  const entry = await prisma.timesheetEntry.update({ where: { id: entryId }, data: patch });
  return { entry };
}

// The reporting manager decides their own direct reports' entries; admins can
// decide anyone's. Nobody (but an admin) approves their own hours. A rejection
// always carries the manager's reason (enforced in the validation schema).
async function decideEntry(orgId, entryId, actor, { status, reason }) {
  const existing = await prisma.timesheetEntry.findFirst({
    where: { id: entryId, org_id: orgId },
    include: { org_membership: { select: { id: true, manager_id: true, person_id: true } } },
  });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'submitted') return { error: 'already_decided' };
  if (!canDecideFor(actor, existing.org_membership)) return { error: 'not_approver' };
  if (existing.org_membership_id === actor.org_membership_id && actor.role !== 'admin') return { error: 'own_entry' };

  const entry = await prisma.timesheetEntry.update({
    where: { id: entryId },
    data: { status, approved_by: actor.id, approved_at: new Date(), decision_reason: reason },
  });
  if (status === 'approved') await refreshRevenue(orgId, existing.date);
  await notify(prisma, {
    type: 'timesheet_entry_decided',
    actorId: actor.id,
    recipientIds: [existing.org_membership.person_id],
    context: { orgId, skipAdmins: true, status, reason, hours: Number(existing.hours), dateLabel: ymd(existing.date) },
  });
  return { entry };
}

// Org-wide daily lock — freezes every TimesheetEntry for that date.
async function lockDay(orgId, date, adminUserId) {
  const existing = await prisma.timesheetLock.findUnique({ where: { org_id_date: { org_id: orgId, date } } });
  if (existing) return { error: 'already_locked', lock: existing };
  const lock = await prisma.timesheetLock.create({ data: { org_id: orgId, date, locked_by: adminUserId } });
  return { lock };
}

async function listLocks(orgId) {
  return prisma.timesheetLock.findMany({ where: { org_id: orgId }, orderBy: { date: 'desc' } });
}

// Post-lock change request on an EXISTING entry — the ORIGINAL flow, kept
// as-is. (New "I missed the weekly deadline" requests, where no entry exists
// yet, go through createRegularizationRequest below.)
async function createTicket(orgId, entryId, requestedByUserId, { requested_change, reason }) {
  const entry = await prisma.timesheetEntry.findFirst({ where: { id: entryId, org_id: orgId } });
  if (!entry) return { error: 'not_found' };
  if (!(await isLocked(orgId, entry.date))) return { error: 'not_locked' };

  const ticket = await prisma.timesheetRegularizationTicket.create({
    data: { timesheet_entry_id: entryId, org_id: orgId, org_membership_id: entry.org_membership_id, requested_by: requestedByUserId, requested_change, reason },
  });
  return { ticket };
}

// "Timesheet Regularisation": the employee missed the weekly lock and asks
// for a specific correction (date, project, target hours, reason). The
// reporting manager is notified; on approval the entry is created/updated
// even though the day is locked.
async function createRegularizationRequest(orgId, orgMembershipId, userId, { date, account_id, hours, reason }) {
  if (date > todayIst()) return { error: 'future_date' };
  if (!(await isLocked(orgId, date))) return { error: 'not_locked' };

  const leave = await leaveService.leaveDayFor(orgId, orgMembershipId, date);
  if (leave) return { error: 'leave_day', leave };

  const it = await isItMember(orgMembershipId);
  if (it && !account_id) return { error: 'project_required' };
  let account = null;
  if (account_id) {
    account = await prisma.account.findFirst({ where: { id: account_id, org_id: orgId } });
    if (!account) return { error: 'account_not_found' };
    if (it && !(await isAssignedToProject(orgId, orgMembershipId, account_id))) return { error: 'project_not_assigned' };
  }

  const duplicate = await prisma.timesheetRegularizationTicket.findFirst({
    where: { org_membership_id: orgMembershipId, date, account_id: account_id || null, status: 'pending' },
  });
  if (duplicate) return { error: 'duplicate_pending' };

  const existingEntry = await prisma.timesheetEntry.findFirst({
    where: { org_membership_id: orgMembershipId, date, account_id: account_id || null, status: { not: 'rejected' } },
  });

  const ticket = await prisma.timesheetRegularizationTicket.create({
    data: {
      org_id: orgId,
      org_membership_id: orgMembershipId,
      timesheet_entry_id: existingEntry?.id || null,
      date,
      account_id: account_id || null,
      target_hours: hours,
      requested_by: userId,
      requested_change: { hours, date: ymd(date), account_id: account_id || null },
      reason,
    },
  });

  const person = await prisma.orgMembership.findUnique({ where: { id: orgMembershipId }, select: { person: { select: { name: true } } } });
  await notifyManager(orgId, orgMembershipId, 'timesheet_regularization_requested', userId, {
    employeeName: person?.person?.name, hours, dateLabel: ymd(date), reason, accountName: account?.name,
  });
  return { ticket };
}

const TICKET_INCLUDE = {
  timesheet_entry: { include: { account: { select: { id: true, name: true } } } },
  account: { select: { id: true, name: true } },
  requester: { select: { id: true, name: true } },
  org_membership: { select: { id: true, person: { select: { id: true, name: true } } } },
};

async function listTickets(orgId, { status } = {}) {
  return prisma.timesheetRegularizationTicket.findMany({
    where: { status, OR: [{ org_id: orgId }, { timesheet_entry: { org_id: orgId } }] },
    orderBy: { created_at: 'desc' },
    include: TICKET_INCLUDE,
  });
}

async function listMyTickets(orgId, orgMembershipId) {
  return prisma.timesheetRegularizationTicket.findMany({
    where: { OR: [{ org_membership_id: orgMembershipId }, { timesheet_entry: { org_membership_id: orgMembershipId } }] },
    orderBy: { created_at: 'desc' },
    include: TICKET_INCLUDE,
  });
}

// Approving applies the correction even though the day is locked. New-style
// requests create the entry (or update the one already there); old-style
// tickets patch the linked entry field-by-field (requested_change was
// validated to hours/billable/notes only). Both honour the 24h/day cap.
async function decideTicket(orgId, ticketId, actor, { status, decision_reason }) {
  const ownerSelect = { select: { id: true, manager_id: true, person_id: true } };
  const ticket = await prisma.timesheetRegularizationTicket.findFirst({
    where: { id: ticketId, OR: [{ org_id: orgId }, { timesheet_entry: { org_id: orgId } }] },
    include: { timesheet_entry: { include: { org_membership: ownerSelect } }, org_membership: ownerSelect },
  });
  if (!ticket) return { error: 'not_found' };
  if (ticket.status !== 'pending') return { error: 'already_decided' };

  const owner = ticket.org_membership || ticket.timesheet_entry?.org_membership;
  if (!canDecideFor(actor, owner)) return { error: 'not_approver' };
  if (owner?.id === actor.org_membership_id && actor.role !== 'admin') return { error: 'own_entry' };

  const isNewStyle = Boolean(ticket.date) && ticket.target_hours !== null;
  const targetDate = isNewStyle ? ticket.date : ticket.timesheet_entry.date;
  const targetMembershipId = owner.id;

  if (status === 'approved') {
    const requestedHours = isNewStyle ? Number(ticket.target_hours) : ticket.requested_change?.hours;
    if (requestedHours !== undefined) {
      const others = await otherHoursOnDay(targetMembershipId, targetDate, ticket.timesheet_entry_id || undefined);
      if (others + Number(requestedHours) > 24) return { error: 'exceeds_day_hours' };
    }
    const leave = await leaveService.leaveDayFor(orgId, targetMembershipId, targetDate);
    if (leave) return { error: 'leave_day', leave };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const decided = await tx.timesheetRegularizationTicket.update({
      where: { id: ticketId },
      data: { status, decided_by: actor.id, decided_at: new Date(), decision_reason },
    });
    if (status !== 'approved') return decided;

    if (!isNewStyle) {
      await tx.timesheetEntry.update({ where: { id: ticket.timesheet_entry_id }, data: ticket.requested_change });
    } else if (ticket.timesheet_entry_id) {
      await tx.timesheetEntry.update({
        where: { id: ticket.timesheet_entry_id },
        data: { hours: ticket.target_hours, status: 'approved', approved_by: actor.id, approved_at: new Date(), decision_reason: `Regularised: ${ticket.reason}`.slice(0, 500) },
      });
    } else {
      await tx.timesheetEntry.create({
        data: {
          org_id: orgId,
          org_membership_id: targetMembershipId,
          date: ticket.date,
          account_id: ticket.account_id,
          hours: ticket.target_hours,
          billable: Boolean(ticket.account_id),
          notes: `Regularised: ${ticket.reason}`.slice(0, 1000),
          status: 'approved',
          approved_by: actor.id,
          approved_at: new Date(),
          decision_reason: 'Approved regularisation request',
        },
      });
    }
    return decided;
  });

  if (status === 'approved') await refreshRevenue(orgId, targetDate);
  await notify(prisma, {
    type: 'timesheet_regularization_decided',
    actorId: actor.id,
    recipientIds: [owner.person_id],
    context: { orgId, skipAdmins: true, status, reason: decision_reason, dateLabel: ymd(targetDate) },
  });
  return { ticket: updated };
}

// --- Manager / admin approval inbox --------------------------------------

async function approvalsScope(orgId, actor) {
  const directReports = await prisma.orgMembership.count({
    where: { org_id: orgId, manager_id: actor.org_membership_id, employment_status: { not: 'terminated' } },
  });
  return { is_approver: actor.role === 'admin' || directReports > 0, direct_reports: directReports };
}

// Pending entries + pending regularisation requests this person may decide:
// their direct reports' (or, for an admin, everyone's).
async function pendingApprovals(orgId, actor) {
  const owner = actor.role === 'admin' ? {} : { manager_id: actor.org_membership_id };
  const [entries, regularizations] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, status: 'submitted', org_membership: owner },
      orderBy: [{ date: 'desc' }, { created_at: 'asc' }],
      include: { account: { select: { id: true, name: true } }, org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
    }),
    prisma.timesheetRegularizationTicket.findMany({
      where: {
        status: 'pending',
        AND: [
          { OR: [{ org_id: orgId }, { timesheet_entry: { org_id: orgId } }] },
          { OR: [{ org_membership: owner }, { timesheet_entry: { org_membership: owner } }] },
        ],
      },
      orderBy: { created_at: 'desc' },
      include: TICKET_INCLUDE,
    }),
  ]);
  return { entries, regularizations };
}

async function myProjects(orgId, orgMembershipId) {
  const rows = await prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId },
    include: { account: { select: { id: true, name: true } } },
    orderBy: { created_at: 'asc' },
  });
  return rows.map((r) => r.account);
}

// --- Weekly auto-lock -------------------------------------------------------

// Mon-Fri of the most recently COMPLETED work week, as of `now` (IST). The
// week locks at Saturday 00:00 IST, so on any day "most recent completed" is
// the week that ended on the latest past Saturday.
function lastCompletedWeekDays(now = new Date()) {
  const ist = asIst(now);
  const daysSinceSaturday = (ist.getUTCDay() + 1) % 7;
  const saturday = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysSinceSaturday);
  return [5, 4, 3, 2, 1].map((n) => new Date(saturday - n * 86400000));
}

// Idempotent — days already locked (manually or by an earlier run) are left alone.
async function lockCompletedWeek(orgId, now = new Date()) {
  const days = lastCompletedWeekDays(now);
  const existing = await prisma.timesheetLock.findMany({ where: { org_id: orgId, date: { in: days } }, select: { date: true } });
  const have = new Set(existing.map((l) => ymd(l.date)));
  const toCreate = days.filter((d) => !have.has(ymd(d)));
  if (toCreate.length) {
    await prisma.timesheetLock.createMany({ data: toCreate.map((date) => ({ org_id: orgId, date, is_auto: true })) });
  }
  return { locked: toCreate.map(ymd), already_locked: have.size };
}

// Admin/Superadmin monitoring hub: status counters (logged today, missing,
// pending approvals, overtime hours) plus a per-member utilization grid
// (month-to-date hours + per-project allocation %) for a department (or the
// whole org). Read-only aggregation over the same TimesheetEntry rows the
// rest of this module already writes — no separate tracking table.
async function teamOverview(orgId, { department_id, date, month, year } = {}) {
  const day = date || new Date();
  const dayOnly = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const rangeMonth = month || dayOnly.getUTCMonth() + 1;
  const rangeYear = year || dayOnly.getUTCFullYear();
  const from = new Date(Date.UTC(rangeYear, rangeMonth - 1, 1));
  const to = new Date(Date.UTC(rangeYear, rangeMonth, 1));

  const members = await prisma.orgMembership.findMany({
    where: {
      org_id: orgId,
      employment_status: { not: 'terminated' },
      ...(department_id ? { person: { department_id } } : {}),
    },
    select: { id: true, person: { select: { id: true, name: true, department: { select: { name: true } } } } },
  });
  const memberIds = members.map((m) => m.id);

  const [todayEntries, monthEntries, pendingEntries, pendingTickets] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, org_membership_id: { in: memberIds }, date: dayOnly },
      select: { org_membership_id: true },
    }),
    prisma.timesheetEntry.findMany({
      where: { org_id: orgId, org_membership_id: { in: memberIds }, date: { gte: from, lt: to } },
      select: { org_membership_id: true, hours: true, is_holiday_overtime: true, account: { select: { name: true } } },
    }),
    prisma.timesheetEntry.count({ where: { org_id: orgId, org_membership_id: { in: memberIds }, status: 'submitted' } }),
    prisma.timesheetRegularizationTicket.count({
      where: { status: 'pending', timesheet_entry: { org_id: orgId, org_membership_id: { in: memberIds } } },
    }),
  ]);

  const loggedTodayIds = new Set(todayEntries.map((e) => e.org_membership_id));
  const overtimeHours = monthEntries
    .filter((e) => e.is_holiday_overtime)
    .reduce((sum, e) => sum + Number(e.hours), 0);

  const byMember = new Map(memberIds.map((id) => [id, { hours: 0, byProject: new Map() }]));
  for (const e of monthEntries) {
    const bucket = byMember.get(e.org_membership_id);
    if (!bucket) continue;
    bucket.hours += Number(e.hours);
    const name = e.account?.name || 'Unassigned';
    bucket.byProject.set(name, (bucket.byProject.get(name) || 0) + Number(e.hours));
  }

  const grid = members.map((m) => {
    const bucket = byMember.get(m.id) || { hours: 0, byProject: new Map() };
    const monthHours = Math.round(bucket.hours * 100) / 100;
    const allocation = Array.from(bucket.byProject.entries())
      .map(([name, hours]) => ({
        name,
        hours: Math.round(hours * 100) / 100,
        pct: monthHours > 0 ? Math.round((hours / monthHours) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.hours - a.hours);
    return {
      org_membership_id: m.id,
      name: m.person.name,
      department: m.person.department?.name || null,
      logged_today: loggedTodayIds.has(m.id),
      month_hours: monthHours,
      allocation,
    };
  });

  return {
    summary: {
      total_members: members.length,
      logged_today: loggedTodayIds.size,
      missing_today: members.length - loggedTodayIds.size,
      pending_approvals: pendingEntries + pendingTickets,
      overtime_hours: Math.round(overtimeHours * 100) / 100,
    },
    members: grid,
  };
}

module.exports = {
  isLocked,
  createEntry,
  listMine,
  listTeam,
  monthlyGrouped,
  updateEntry,
  decideEntry,
  lockDay,
  listLocks,
  createTicket,
  createRegularizationRequest,
  listTickets,
  listMyTickets,
  decideTicket,
  approvalsScope,
  pendingApprovals,
  myProjects,
  lastCompletedWeekDays,
  lockCompletedWeek,
  teamOverview,
};
