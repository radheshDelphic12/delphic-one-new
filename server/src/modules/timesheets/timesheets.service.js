const prisma = require('../../config/db');
const logger = require('../../config/logger');
const calendarsService = require('../calendars/calendars.service');
const leaveService = require('../leave/leave.service');
const { computeDayRevenue } = require('../billing/billing.service');
const { projectListWhere } = require('../../lib/projectScope');
const { notify } = require('../../lib/notifications');
const { asIst, todayIst } = require('../../lib/istDate');
const { detectFinanceChange } = require('../../lib/financeChanges');
const workHours = require('./workHours.service');
const projectDayService = require('./projectDay.service');
const monthLocks = require('./monthLocks.service');
const lockAudit = require('../calculations/lockAudit.service');
const overtimeTickets = require('./overtimeTickets.service');

const ymd = (date) => date.toISOString().slice(0, 10);

// A timesheet's project as people know it: the Finance project name when one
// is set (older client rows renamed into projects keep the client's own name
// in `name`), else the account name. Every response below goes through this,
// so no screen shows "Nlineaxis" for the "Objective Eye" project.
const ACCOUNT_REF = { select: { id: true, name: true, project_name: true } };
function labelAccount(account) {
  if (!account) return account;
  const { project_name: projectName, ...rest } = account;
  return { ...rest, name: projectName || account.name };
}
const labelEntry = (row) => (row ? { ...row, account: labelAccount(row.account) } : row);
const labelTicket = (row) => (row ? { ...row, account: labelAccount(row.account), timesheet_entry: labelEntry(row.timesheet_entry) } : row);

// IT staff and vendor resources (contractors) log against a fixed set of
// assigned projects only; everyone else logs plain Date/Hours/Notes with no
// project (see createEntry). One timesheet model and one approval flow for
// both — a contractor is an OrgMembership like any employee.
async function isItMember(orgMembershipId) {
  const m = await prisma.orgMembership.findUnique({
    where: { id: orgMembershipId },
    select: { worker_type: true, person: { select: { department: { select: { name: true } } } } },
  });
  return m?.worker_type === 'contractor' || m?.person?.department?.name?.toLowerCase() === 'it';
}

// Allocations are effective-dated: hours can only go on a project for a day
// the person was allocated to it (start/end inclusive, null = open).
async function isAssignedToProject(orgId, orgMembershipId, accountId, date) {
  const row = await prisma.projectMemberAssignment.findFirst({
    where: {
      org_id: orgId,
      org_membership_id: orgMembershipId,
      account_id: accountId,
      ...(date ? { AND: [{ OR: [{ start_date: null }, { start_date: { lte: date } }] }, { OR: [{ end_date: null }, { end_date: { gte: date } }] }] } : {}),
    },
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
    select: { hours: true, overtime_hours: true },
  });
  return rows.reduce((sum, e) => sum + Number(e.hours) + Number(e.overtime_hours || 0), 0);
}

// Approved leave vs the hours a day would hold after this write. Full-day
// leave (or AM + PM halves) blocks the day; a half day caps work at what the
// leave leaves free (shift - 4.5h). Returns a service error object or null.
async function leaveBlock(orgId, orgMembershipId, date, totalHours) {
  const leave = await leaveService.leaveDayFor(orgId, orgMembershipId, date);
  if (leave) return { error: 'leave_day', leave };
  const cap = await leaveService.workCapacityFor(orgId, orgMembershipId, date);
  if (cap && totalHours > cap.capacity + 1e-9) return { error: 'half_day_capacity', ...cap, total: totalHours };
  return null;
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

// A day is locked org-wide (weekly auto-lock / admin day lock) or, for one employee, when their whole month is locked.
async function isLocked(orgId, date, orgMembershipId = null) {
  const lock = await prisma.timesheetLock.findUnique({ where: { org_id_date: { org_id: orgId, date } } });
  if (lock) return true;
  return orgMembershipId ? monthLocks.isMemberMonthLocked(orgMembershipId, date) : false;
}

async function createEntry(orgId, orgMembershipId, { date, account_id, requirement_id, hours, overtime_hours = 0, billable, notes }, actorUserId = null) {
  if (await isLocked(orgId, date, orgMembershipId)) return { error: 'day_locked' };
  // Attendance-paid people: overtime is a ticket approved by the manager, never timesheet hours.
  if (overtime_hours > 0 && (await overtimeTickets.usesTickets(orgMembershipId))) return { error: 'overtime_requires_ticket' };

  // Approved Leave Day = no timesheet, no project hours.
  const leave = await leaveService.leaveDayFor(orgId, orgMembershipId, date);
  if (leave) return { error: 'leave_day', leave };

  const it = await isItMember(orgMembershipId);
  if (it && !account_id) return { error: 'project_required' };

  let account = null;
  if (account_id) {
    account = await prisma.account.findFirst({ where: { id: account_id, org_id: orgId } });
    if (!account) return { error: 'account_not_found' };
    // The person allocated to the project, or a team mate of someone allocated, may log on it.
    if (it && !(await projectDayService.canLogOnProject(orgId, orgMembershipId, account_id, date))) return { error: 'project_not_assigned' };
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
  const dayTotal = (await otherHoursOnDay(orgMembershipId, date)) + hours + overtime_hours;
  if (dayTotal > 24) return { error: 'exceeds_day_hours' };
  const blocked = await leaveBlock(orgId, orgMembershipId, date, dayTotal);
  if (blocked) return blocked;
  // No project-level hour cap: people log the hours they actually worked on their allocated projects.

  const alreadyPendingToday = await prisma.timesheetEntry.count({ where: { org_membership_id: orgMembershipId, date, status: 'submitted' } });

  const entry = await prisma.timesheetEntry.create({
    data: {
      org_id: orgId,
      org_membership_id: orgMembershipId,
      date,
      account_id: account_id || null,
      requirement_id,
      hours,
      // Overtime only means something against a project (it's billed per
      // project, and only where the project allows it).
      overtime_hours: account_id ? overtime_hours : 0,
      // A no-project entry is general time — never billable, so it can't
      // leak into revenue / project cost / budget.
      billable: account_id ? billable : false,
      notes,
      is_holiday_overtime: Boolean(holiday),
      holiday_label: holiday ? `${holiday.label}, ${holiday.calendar_name}` : null,
    },
  });

  await workHours.syncDayOvertime(orgId, orgMembershipId, date);

  // Route to the reporting manager — one ping per employee per day, not per row.
  if (alreadyPendingToday === 0) {
    const person = await prisma.orgMembership.findUnique({ where: { id: orgMembershipId }, select: { person: { select: { name: true } } } });
    await notifyManager(orgId, orgMembershipId, 'timesheet_submitted', actorUserId, {
      employeeName: person?.person?.name, hours, dateLabel: ymd(date), accountName: account ? account.project_name || account.name : undefined,
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
      include: { account: ACCOUNT_REF, requirement: { select: { id: true, title: true } } },
    }),
    prisma.timesheetEntry.count({ where }),
  ]);
  return { data: data.map(labelEntry), pagination: { page, limit, total } };
}

// Person filter for the admin views: in one department, or outside one
// (people with no department count as outside). Legacy User.department_id.
function departmentWhere(department_id, exclude_department_id) {
  if (department_id) return { department_id };
  if (exclude_department_id) return { OR: [{ department_id: null }, { department_id: { not: exclude_department_id } }] };
  return null;
}

async function listTeam(orgId, { from, to, org_membership_id, account_id, status, department_id, exclude_department_id, page, limit }) {
  const person = departmentWhere(department_id, exclude_department_id);
  const date = dateRangeWhere({ from, to });
  const where = {
    org_id: orgId,
    ...(org_membership_id ? { org_membership_id } : {}),
    ...(account_id ? { account_id } : {}),
    ...(status ? { status } : {}),
    ...(date ? { date } : {}),
    // Legacy User.department_id (same field GET /users/me already returns),
    // not OrgMembership.department_id — see requireItDepartment's own note.
    ...(person ? { org_membership: { person } } : {}),
  };
  const [data, total, sums] = await Promise.all([
    prisma.timesheetEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        org_membership: { select: { id: true, person: { select: { id: true, name: true } } } },
        account: ACCOUNT_REF,
        requirement: { select: { id: true, title: true } },
      },
    }),
    prisma.timesheetEntry.count({ where }),
    prisma.timesheetEntry.aggregate({ where, _sum: { hours: true, overtime_hours: true } }),
  ]);
  // Hours across every page of the filtered set (employee / project / week / status).
  const totals = { hours: Math.round(Number(sums._sum.hours || 0) * 100) / 100, overtime_hours: Math.round(Number(sums._sum.overtime_hours || 0) * 100) / 100 };
  return { data: data.map(labelEntry), pagination: { page, limit, total }, totals };
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
    include: { account: { select: { id: true, name: true, project_name: true, project_code: true } }, approver: { select: { id: true, name: true } } },
  });

  const byDate = new Map();
  for (const row of rows) {
    const key = row.date.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, { date: key, total_hours: 0, entries: [] });
    const day = byDate.get(key);
    day.total_hours += Number(row.hours) + Number(row.overtime_hours || 0);
    day.entries.push({
      id: row.id,
      account: labelAccount(row.account),
      hours: Number(row.hours),
      overtime_hours: Number(row.overtime_hours || 0),
      billable: row.billable,
      notes: row.notes,
      status: row.status,
      approved_by: row.approver,
      approved_at: row.approved_at,
      decision_reason: row.decision_reason,
      is_holiday_overtime: row.is_holiday_overtime,
      holiday_label: row.holiday_label,
    });
  }
  // Overtime = logged (non-rejected) hours beyond the day's shift on the
  // employee's calendar (workHours.loggedOvertime), whether or not it was
  // typed into the OT field.
  const overtime = (await workHours.loggedOvertime(orgId, [orgMembershipId], from, new Date(to.getTime() - 86400000))).get(orgMembershipId) || new Map();
  for (const day of byDate.values()) {
    day.total_hours = Math.round(day.total_hours * 100) / 100;
    const ot = overtime.get(day.date);
    day.expected_hours = ot ? ot.expected : null;
    day.ot_hours = ot ? ot.ot : 0;
  }
  return Array.from(byDate.values());
}

// Owner-only, and only while still 'submitted' (not yet decided) and the
// day isn't locked — a locked/decided entry can only change via a
// regularization ticket.
async function updateEntry(orgId, orgMembershipId, entryId, patch) {
  const existing = await prisma.timesheetEntry.findFirst({ where: { id: entryId, org_id: orgId, org_membership_id: orgMembershipId } });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'submitted') return { error: 'already_decided' };
  if (await isLocked(orgId, existing.date, existing.org_membership_id)) return { error: 'day_locked' };
  if (patch.overtime_hours > 0 && (await overtimeTickets.usesTickets(orgMembershipId))) return { error: 'overtime_requires_ticket' };

  if (patch.hours !== undefined || patch.overtime_hours !== undefined) {
    const hours = patch.hours !== undefined ? Number(patch.hours) : Number(existing.hours);
    const overtime = patch.overtime_hours !== undefined ? Number(patch.overtime_hours) : Number(existing.overtime_hours || 0);
    const dayTotal = (await otherHoursOnDay(orgMembershipId, existing.date, entryId)) + hours + overtime;
    if (dayTotal > 24) return { error: 'exceeds_day_hours' };
    const cap = await leaveService.workCapacityFor(orgId, orgMembershipId, existing.date);
    if (cap && dayTotal > cap.capacity + 1e-9) return { error: 'half_day_capacity', ...cap, total: dayTotal };
  }

  const entry = await prisma.timesheetEntry.update({ where: { id: entryId }, data: patch });
  await workHours.syncDayOvertime(orgId, orgMembershipId, existing.date);
  return { entry };
}

// Employee: remove their own entry — only while it's pending and its week
// isn't locked. Approved / rejected / locked entries are final for them.
async function deleteOwnEntry(orgId, orgMembershipId, entryId) {
  const existing = await prisma.timesheetEntry.findFirst({ where: { id: entryId, org_id: orgId, org_membership_id: orgMembershipId } });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'submitted') return { error: 'already_decided' };
  if (await isLocked(orgId, existing.date, existing.org_membership_id)) return { error: 'day_locked' };
  await prisma.timesheetEntry.delete({ where: { id: entryId } });
  await workHours.syncDayOvertime(orgId, orgMembershipId, existing.date);
  return { deleted: true };
}

// --- Admin corrections: any entry, any status, locked day or not. Revenue is
//     recomputed and a finance change is raised, so a locked billing month
//     shows "Historical Calculation Affected" and can be recalculated and
//     re-invoiced. Returns how many locked calculations were flagged. ---

const snapshotOf = (e) => ({
  status: e.status,
  hours: Number(e.hours),
  overtime_hours: Number(e.overtime_hours || 0),
  account_id: e.account_id,
  billable: e.billable,
  notes: e.notes,
});

async function adminUpdateEntry(orgId, adminUserId, entryId, { reason, ...patch }) {
  const existing = await prisma.timesheetEntry.findFirst({ where: { id: entryId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  if (patch.account_id) {
    const account = await prisma.account.findFirst({ where: { id: patch.account_id, org_id: orgId }, select: { id: true } });
    if (!account) return { error: 'account_not_found' };
  }
  if (patch.hours !== undefined || patch.overtime_hours !== undefined) {
    const hours = patch.hours !== undefined ? Number(patch.hours) : Number(existing.hours);
    const overtime = patch.overtime_hours !== undefined ? Number(patch.overtime_hours) : Number(existing.overtime_hours || 0);
    const dayTotal = (await otherHoursOnDay(existing.org_membership_id, existing.date, entryId)) + hours + overtime;
    if (dayTotal > 24) return { error: 'exceeds_day_hours' };
    const cap = await leaveService.workCapacityFor(orgId, existing.org_membership_id, existing.date);
    if (cap && dayTotal > cap.capacity + 1e-9) return { error: 'half_day_capacity', ...cap, total: dayTotal };
  }
  const data = { ...patch };
  if (data.account_id === null) { data.billable = false; data.overtime_hours = 0; }
  // Admin can also approve / reject (or re-open) any entry, locked or not.
  if (data.status && data.status !== existing.status) {
    Object.assign(data, data.status === 'submitted'
      ? { approved_by: null, approved_at: null, decision_reason: null }
      : { approved_by: adminUserId, approved_at: new Date(), decision_reason: `Admin: ${reason}`.slice(0, 500) });
  }
  const entry = await prisma.timesheetEntry.update({ where: { id: entryId }, data });
  await refreshRevenue(orgId, existing.date);
  await workHours.syncDayOvertime(orgId, existing.org_membership_id, existing.date);
  const change = await detectFinanceChange(orgId, {
    source_type: 'timesheet',
    source_id: entryId,
    date: existing.date,
    org_membership_id: existing.org_membership_id,
    account_id: entry.account_id || existing.account_id,
    changed_by: adminUserId,
    description: `Timesheet entry corrected by admin: ${reason}`,
    old_value: snapshotOf(existing),
    new_value: snapshotOf(entry),
  });
  return { entry: labelEntry({ ...entry, account: await accountRef(entry.account_id) }), flagged: change?.flagged || 0 };
}

async function adminDeleteEntry(orgId, adminUserId, entryId, { reason }) {
  const existing = await prisma.timesheetEntry.findFirst({ where: { id: entryId, org_id: orgId } });
  if (!existing) return { error: 'not_found' };
  await prisma.timesheetEntry.delete({ where: { id: entryId } });
  await refreshRevenue(orgId, existing.date);
  await workHours.syncDayOvertime(orgId, existing.org_membership_id, existing.date);
  const change = await detectFinanceChange(orgId, {
    source_type: 'timesheet',
    source_id: entryId,
    date: existing.date,
    org_membership_id: existing.org_membership_id,
    account_id: existing.account_id,
    changed_by: adminUserId,
    description: `Timesheet entry deleted by admin: ${reason}`,
    old_value: snapshotOf(existing),
    new_value: null,
  });
  return { deleted: true, flagged: change?.flagged || 0 };
}

// Delete several logs at once (Timesheet Dashboard). Each id goes through the same rule as a single delete -
// an admin deletes any entry with a reason (locked billing is flagged); anyone else only their own pending
// entries on an open day. Only the listed ids are touched; the result says which ones could not be deleted.
async function bulkDeleteEntries(orgId, user, { ids, reason }) {
  const unique = [...new Set(ids)];
  const deleted = [];
  const failed = [];
  for (const id of unique) {
    const result = user.role === 'admin'
      ? await adminDeleteEntry(orgId, user.id, id, { reason })
      : await deleteOwnEntry(orgId, user.org_membership_id, id);
    if (result.error) failed.push({ id, error: result.error });
    else deleted.push(id);
  }
  return { deleted, failed };
}

async function accountRef(accountId) {
  return accountId ? prisma.account.findUnique({ where: { id: accountId }, ...ACCOUNT_REF }) : null;
}

async function unlockDay(orgId, date, adminUserId = null, reason = null) {
  const lock = await prisma.timesheetLock.findUnique({ where: { org_id_date: { org_id: orgId, date } } });
  if (!lock) return { error: 'not_locked' };
  await prisma.timesheetLock.delete({ where: { id: lock.id } });
  if (adminUserId) {
    await lockAudit.record(prisma, orgId, { stage: 'timesheet', action: 'unlock', actor_id: adminUserId, period_month: date.getUTCMonth() + 1, period_year: date.getUTCFullYear(), previous_status: 'locked', new_status: 'open', change: `Day ${ymd(date)} unlocked for everyone`, reason });
  }
  return { unlocked: true };
}

// The reporting manager decides their own direct reports' entries; admins can
// decide anyone's. Nobody (but an admin) approves their own hours. A rejection
// always carries the manager's reason (enforced in the validation schema).
// Every timesheet / overtime / regularisation approval step is on the audit trail (stage 'timesheet').
async function auditDecision(orgId, actor, target, action, previous, next, change, reason) {
  const date = target.date ? new Date(target.date) : null;
  await lockAudit.record(prisma, orgId, {
    stage: 'timesheet',
    action,
    actor_id: actor.id,
    org_membership_id: target.org_membership_id || null,
    account_id: target.account_id || null,
    period_month: date ? date.getUTCMonth() + 1 : null,
    period_year: date ? date.getUTCFullYear() : null,
    previous_status: previous,
    new_status: next,
    change,
    reason: reason || null,
  });
}

// The org's approval chain settings (see Org.timesheet_manager_approval / timesheet_admin_approval).
async function approvalPolicy(orgId) {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { timesheet_manager_approval: true, timesheet_admin_approval: true } });
  return { timesheet_manager_approval: org?.timesheet_manager_approval !== false, timesheet_admin_approval: org?.timesheet_admin_approval !== false };
}

async function updateApprovalPolicy(orgId, patch) {
  const org = await prisma.org.update({ where: { id: orgId }, data: patch, select: { timesheet_manager_approval: true, timesheet_admin_approval: true } });
  return org;
}

async function decideEntry(orgId, entryId, actor, { status, reason }) {
  const existing = await prisma.timesheetEntry.findFirst({
    where: { id: entryId, org_id: orgId },
    include: { org_membership: { select: { id: true, manager_id: true, person_id: true } } },
  });
  if (!existing) return { error: 'not_found' };
  if (existing.status !== 'submitted') return { error: 'already_decided' };
  if (!canDecideFor(actor, existing.org_membership)) return { error: 'not_approver' };
  if (existing.org_membership_id === actor.org_membership_id && actor.role !== 'admin') return { error: 'own_entry' };

  // Approval chain: Employee -> Manager (optional) -> Admin (mandatory). A manager's approval is only the
  // first step when the org requires admin approval; the entry is final (pay, billing) once an admin approves.
  const isAdmin = actor.role === 'admin';
  const policy = await approvalPolicy(orgId);
  if (!isAdmin && !policy.timesheet_manager_approval) return { error: 'manager_approval_disabled' };
  if (!isAdmin && existing.manager_approved_at) return { error: 'awaiting_admin' };
  if (!isAdmin && status === 'approved' && policy.timesheet_admin_approval) {
    const stepped = await prisma.timesheetEntry.update({
      where: { id: entryId },
      data: { manager_approved_by: actor.id, manager_approved_at: new Date(), decision_reason: reason },
    });
    await auditDecision(orgId, actor, existing, 'manager_approve', 'submitted', 'manager_approved', `Timesheet entry approved by the manager, waiting for the admin (${Number(existing.hours)}h)`, reason);
    await notify(prisma, {
      type: 'timesheet_entry_decided',
      actorId: actor.id,
      recipientIds: [existing.org_membership.person_id],
      context: { orgId, skipAdmins: true, status: 'approved by your manager, waiting for admin', reason, hours: Number(existing.hours), dateLabel: ymd(existing.date) },
    });
    return { entry: stepped, awaiting_admin: true };
  }

  const entry = await prisma.timesheetEntry.update({
    where: { id: entryId },
    data: { status, approved_by: actor.id, approved_at: new Date(), decision_reason: reason },
  });
  if (status === 'approved') await refreshRevenue(orgId, existing.date);
  // A rejected entry's hours no longer count toward the day's overtime.
  await workHours.syncDayOvertime(orgId, existing.org_membership_id, existing.date);
  const hoursLabel = `${Number(existing.hours)}h${Number(existing.overtime_hours || 0) ? ` + ${Number(existing.overtime_hours)}h overtime` : ''}`;
  await auditDecision(orgId, actor, existing, status === 'rejected' ? 'reject' : 'approve', 'submitted', status, `Timesheet entry ${status} (${hoursLabel})`, reason);
  await detectFinanceChange(orgId, {
    source_type: 'timesheet',
    source_id: entryId,
    date: existing.date,
    org_membership_id: existing.org_membership_id,
    account_id: existing.account_id,
    changed_by: actor.id,
    description: `Timesheet entry ${status} (${hoursLabel})`,
    old_value: { status: existing.status, hours: Number(existing.hours), overtime_hours: Number(existing.overtime_hours || 0) },
    new_value: { status, hours: Number(existing.hours), overtime_hours: Number(existing.overtime_hours || 0) },
  });
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
  await lockAudit.record(prisma, orgId, { stage: 'timesheet', action: 'lock', actor_id: adminUserId, period_month: date.getUTCMonth() + 1, period_year: date.getUTCFullYear(), previous_status: 'open', new_status: 'locked', change: `Day ${ymd(date)} locked for everyone` });
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
    if (it && !(await isAssignedToProject(orgId, orgMembershipId, account_id, date))) return { error: 'project_not_assigned' };
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
    employeeName: person?.person?.name, hours, dateLabel: ymd(date), reason, accountName: account ? account.project_name || account.name : undefined,
  });
  return { ticket };
}

const TICKET_INCLUDE = {
  timesheet_entry: { include: { account: ACCOUNT_REF } },
  account: ACCOUNT_REF,
  requester: { select: { id: true, name: true } },
  org_membership: { select: { id: true, person: { select: { id: true, name: true } } } },
};

async function listTickets(orgId, { status } = {}) {
  const rows = await prisma.timesheetRegularizationTicket.findMany({
    where: { status, OR: [{ org_id: orgId }, { timesheet_entry: { org_id: orgId } }] },
    orderBy: { created_at: 'desc' },
    include: TICKET_INCLUDE,
  });
  return rows.map(labelTicket);
}

async function listMyTickets(orgId, orgMembershipId) {
  const rows = await prisma.timesheetRegularizationTicket.findMany({
    where: { OR: [{ org_membership_id: orgMembershipId }, { timesheet_entry: { org_membership_id: orgMembershipId } }] },
    orderBy: { created_at: 'desc' },
    include: TICKET_INCLUDE,
  });
  return rows.map(labelTicket);
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
  // Employee -> Manager (optional) -> Admin (mandatory): a manager's approval is only the first step.
  const isAdmin = actor.role === 'admin';
  const policy = await approvalPolicy(orgId);
  if (!isAdmin && !policy.timesheet_manager_approval) return { error: 'manager_approval_disabled' };
  if (!isAdmin && ticket.manager_approved_at) return { error: 'awaiting_admin' };
  if (!isAdmin && status === 'approved' && policy.timesheet_admin_approval) {
    const stepped = await prisma.timesheetRegularizationTicket.update({ where: { id: ticketId }, data: { manager_approved_by: actor.id, manager_approved_at: new Date(), decision_reason } });
    await auditDecision(orgId, actor, { org_membership_id: owner.id, date: ticket.date || ticket.timesheet_entry?.date }, 'manager_approve', 'pending', 'manager_approved', 'Regularisation approved by the manager, waiting for the admin', decision_reason);
    return { ticket: stepped, awaiting_admin: true };
  }

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
    if (requestedHours !== undefined) {
      const cap = await leaveService.workCapacityFor(orgId, targetMembershipId, targetDate);
      const others = await otherHoursOnDay(targetMembershipId, targetDate, ticket.timesheet_entry_id || undefined);
      if (cap && others + Number(requestedHours) > cap.capacity + 1e-9) return { error: 'half_day_capacity', ...cap, total: others + Number(requestedHours) };
    }
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

  if (status === 'approved') {
    await refreshRevenue(orgId, targetDate);
    await workHours.syncDayOvertime(orgId, targetMembershipId, targetDate);
    const entryBefore = ticket.timesheet_entry;
    await detectFinanceChange(orgId, {
      source_type: 'timesheet',
      source_id: ticket.id,
      date: targetDate,
      org_membership_id: targetMembershipId,
      account_id: isNewStyle ? ticket.account_id : entryBefore?.account_id || null,
      changed_by: actor.id,
      description: `Timesheet regularisation approved: ${ticket.reason}`.slice(0, 500),
      old_value: entryBefore ? { hours: Number(entryBefore.hours), status: entryBefore.status } : { hours: 0, status: 'none' },
      new_value: isNewStyle ? { hours: Number(ticket.target_hours), status: 'approved' } : ticket.requested_change,
    });
  }
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
  const policy = await approvalPolicy(orgId);
  const managerOnly = actor.role !== 'admin';
  const [entries, regularizations] = await Promise.all([
    managerOnly && !policy.timesheet_manager_approval ? [] : prisma.timesheetEntry.findMany({
      where: { org_id: orgId, status: 'submitted', org_membership: owner, ...(managerOnly ? { manager_approved_at: null } : {}) },
      orderBy: [{ date: 'desc' }, { created_at: 'asc' }],
      include: { account: ACCOUNT_REF, org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
    }),
    managerOnly && !policy.timesheet_manager_approval ? [] : prisma.timesheetRegularizationTicket.findMany({
      where: {
        status: 'pending',
        ...(managerOnly ? { manager_approved_at: null } : {}),
        AND: [
          { OR: [{ org_id: orgId }, { timesheet_entry: { org_id: orgId } }] },
          { OR: [{ org_membership: owner }, { timesheet_entry: { org_membership: owner } }] },
        ],
      },
      orderBy: { created_at: 'desc' },
      include: TICKET_INCLUDE,
    }),
  ]);
  const overtime = managerOnly && !policy.timesheet_manager_approval ? [] : await prisma.timesheetDayOvertime.findMany({
    where: { org_id: orgId, status: 'pending', org_membership: owner, ...(managerOnly ? { manager_approved_at: null } : {}) },
    orderBy: { date: 'desc' },
    include: { org_membership: { select: { id: true, person: { select: { id: true, name: true } } } } },
  });
  const lockedDates = new Set((await prisma.timesheetLock.findMany({
    where: { org_id: orgId, date: { in: [...new Set(entries.map((e) => ymd(e.date)))].map((d) => new Date(d)) } },
    select: { date: true },
  })).map((l) => ymd(l.date)));
  return {
    // admin_review: the week locked and the manager didn't decide within the
    // grace period — an admin should now take it.
    entries: entries.map((e) => ({ ...labelEntry(e), admin_review: lockedDates.has(ymd(e.date)) && workHours.needsAdminReview(e.date) })),
    regularizations: regularizations.map(labelTicket),
    overtime: overtime.map((o) => ({ ...o, hours: Number(o.hours) })),
  };
}

// Projects the caller can log time on: allocations still open, upcoming, or
// ended within the last 45 days (late entries for a finished allocation are
// still allowed — createEntry checks the entry's own date against the span).
async function myProjects(orgId, orgMembershipId) {
  const since = new Date(todayIst().getTime() - 45 * 86400000);
  const rows = await prisma.projectMemberAssignment.findMany({
    where: { org_id: orgId, org_membership_id: orgMembershipId, OR: [{ end_date: null }, { end_date: { gte: since } }] },
    include: { account: { select: { id: true, name: true, project_name: true } } },
    orderBy: [{ start_date: 'asc' }, { created_at: 'asc' }],
  });
  const byProject = new Map();
  for (const r of rows) {
    const cur = byProject.get(r.account.id);
    const ymdOr = (d) => (d ? d.toISOString().slice(0, 10) : null);
    // Several spans on one project: widest window (null = open).
    byProject.set(r.account.id, {
      id: r.account.id,
      name: r.account.project_name || r.account.name,
      allocated_from: cur ? (cur.allocated_from && r.start_date ? [cur.allocated_from, ymdOr(r.start_date)].sort()[0] : null) : ymdOr(r.start_date),
      allocated_to: cur ? (cur.allocated_to && r.end_date ? [cur.allocated_to, ymdOr(r.end_date)].sort()[1] : null) : ymdOr(r.end_date),
    });
  }
  const mine = [...byProject.values()];
  // Projects a team mate is allocated to can be logged on too (client / project timesheet).
  const shared = await projectDayService.teamProjects(orgId, orgMembershipId, todayIst(), since, new Set(mine.map((p) => p.id)));
  return [...mine, ...shared];
}

// Projects whose team timesheet the caller may open for a month: every project for an admin, otherwise
// the projects the caller was allocated to at any point in that month (so an ended allocation still shows).
async function listTeamProjects(orgId, user, { year, month }) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  const label = (a) => ({ id: a.id, name: a.project_name || a.name });
  if (user.role === 'admin') {
    const accounts = await prisma.account.findMany({ where: projectListWhere(orgId), select: { id: true, name: true, project_name: true }, orderBy: { name: 'asc' } });
    return accounts.map(label);
  }
  const rows = await prisma.projectMemberAssignment.findMany({
    where: {
      org_id: orgId,
      org_membership_id: user.org_membership_id,
      AND: [{ OR: [{ start_date: null }, { start_date: { lte: to } }] }, { OR: [{ end_date: null }, { end_date: { gte: from } }] }],
    },
    select: { account: { select: { id: true, name: true, project_name: true } } },
  });
  const byId = new Map(rows.map((r) => [r.account.id, label(r.account)]));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Project team timesheet for a month. Only people allocated to the project (and admins) may see it.
async function getProjectTeam(orgId, user, { account_id, year, month }) {
  const account = await prisma.account.findFirst({ where: { id: account_id, org_id: orgId }, select: { id: true, name: true, project_name: true } });
  if (!account) return { error: 'account_not_found' };
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  if (user.role !== 'admin' && !(await projectDayService.isAssignedToProject(orgId, user.org_membership_id, account_id, from, to))) return { error: 'project_not_assigned' };
  return { team: { ...(await projectDayService.projectTeamTimesheet(orgId, account_id, from, to)), project: account.project_name || account.name } };
}

// What the team has logged on one project day (informational; there is no cap).
async function getProjectDay(orgId, orgMembershipId, { account_id, date }) {
  const account = await prisma.account.findFirst({ where: { id: account_id, org_id: orgId }, select: { id: true, name: true, project_name: true } });
  if (!account) return { error: 'account_not_found' };
  return { day: { ...(await projectDayService.projectDay(orgId, account_id, date, { orgMembershipId })), project: account.project_name || account.name } };
}

// --- Weekly auto-lock -------------------------------------------------------

// Sunday -> Saturday of the most recently COMPLETED week, as of `now` (IST).
// A week closes at the end of Saturday and locks when the next Sunday starts
// (00:00 IST) — all seven days, since clients may work weekends.
function lastCompletedWeekDays(now = new Date()) {
  const ist = asIst(now);
  const thisSunday = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - ist.getUTCDay());
  return [7, 6, 5, 4, 3, 2, 1].map((n) => new Date(thisSunday - n * 86400000));
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
async function teamOverview(orgId, { department_id, exclude_department_id, date, month, year } = {}) {
  const person = departmentWhere(department_id, exclude_department_id);
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
      ...(person ? { person } : {}),
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
      select: { org_membership_id: true, hours: true, overtime_hours: true, is_holiday_overtime: true, account: { select: { name: true, project_name: true } } },
    }),
    prisma.timesheetEntry.count({ where: { org_id: orgId, org_membership_id: { in: memberIds }, status: 'submitted' } }),
    prisma.timesheetRegularizationTicket.count({
      where: { status: 'pending', timesheet_entry: { org_id: orgId, org_membership_id: { in: memberIds } } },
    }),
  ]);

  const loggedTodayIds = new Set(todayEntries.map((e) => e.org_membership_id));
  // Overtime = each day's logged hours beyond the employee's shift (0 expected
  // on a weekend / company holiday), the same rule payroll uses — not only
  // what was typed into the OT field.
  const overtimeByMember = await workHours.loggedOvertime(orgId, [...new Set(monthEntries.map((e) => e.org_membership_id))], from, new Date(to.getTime() - 86400000));
  const memberOt = (id) => [...(overtimeByMember.get(id)?.values() || [])].reduce((s, d) => s + d.ot, 0);
  const overtimeHours = memberIds.reduce((s, id) => s + memberOt(id), 0);

  const byMember = new Map(memberIds.map((id) => [id, { hours: 0, byProject: new Map() }]));
  for (const e of monthEntries) {
    const bucket = byMember.get(e.org_membership_id);
    if (!bucket) continue;
    const logged = Number(e.hours) + Number(e.overtime_hours || 0);
    bucket.hours += logged;
    const name = e.account ? e.account.project_name || e.account.name : 'Unassigned';
    bucket.byProject.set(name, (bucket.byProject.get(name) || 0) + logged);
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
      overtime_hours: Math.round(memberOt(m.id) * 100) / 100,
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

// Manager (direct reports) or admin decides a day's overtime: approved (paid
// as OT), rejected (not paid), or comp_off (time off in lieu instead of pay).
async function decideOvertime(orgId, overtimeId, actor, { status, reason }) {
  const row = await prisma.timesheetDayOvertime.findFirst({
    where: { id: overtimeId, org_id: orgId },
    include: { org_membership: { select: { id: true, manager_id: true, person_id: true } } },
  });
  if (!row) return { error: 'not_found' };
  if (!canDecideFor(actor, row.org_membership)) return { error: 'not_approver' };
  if (row.org_membership_id === actor.org_membership_id && actor.role !== 'admin') return { error: 'own_entry' };
  // A manager decides once; an admin may revise a decision.
  if (row.status !== 'pending' && actor.role !== 'admin') return { error: 'already_decided' };
  // Employee -> Manager (optional) -> Admin (mandatory): a manager's approval is only the first step.
  const isAdmin = actor.role === 'admin';
  const policy = await approvalPolicy(orgId);
  if (!isAdmin && !policy.timesheet_manager_approval) return { error: 'manager_approval_disabled' };
  if (!isAdmin && row.manager_approved_at) return { error: 'awaiting_admin' };
  if (!isAdmin && status !== 'rejected' && policy.timesheet_admin_approval) {
    const stepped = await prisma.timesheetDayOvertime.update({ where: { id: overtimeId }, data: { manager_approved_by: actor.id, manager_approved_at: new Date(), decision_reason: reason || null } });
    await auditDecision(orgId, actor, row, 'manager_approve', 'pending', 'manager_approved', `Overtime ${Number(row.hours)}h approved by the manager, waiting for the admin`, reason);
    return { overtime: { ...stepped, hours: Number(stepped.hours) }, awaiting_admin: true };
  }
  const overtime = await prisma.timesheetDayOvertime.update({
    where: { id: overtimeId },
    data: { status, decided_by: actor.id, decided_at: new Date(), decision_reason: reason || null },
  });
  await detectFinanceChange(orgId, {
    source_type: 'timesheet',
    source_id: overtimeId,
    date: row.date,
    org_membership_id: row.org_membership_id,
    account_id: null,
    changed_by: actor.id,
    description: `Overtime ${status.replace('_', ' ')} (${Number(row.hours)}h)`,
    old_value: { overtime_status: row.status, hours: Number(row.hours) },
    new_value: { overtime_status: status, hours: Number(row.hours) },
  });
  await auditDecision(orgId, actor, row, status === 'rejected' ? 'reject' : 'approve', row.status, status, `Overtime ${Number(row.hours)}h ${status.replace('_', ' ')}`, reason);
  return { overtime: { ...overtime, hours: Number(overtime.hours) } };
}

// Admin: add an entry for any employee on any date (locked week included),
// with a reason — it can go straight in as approved.
async function adminCreateEntry(orgId, adminUserId, { org_membership_id, reason, status = 'approved', ...body }) {
  const member = await prisma.orgMembership.findFirst({ where: { id: org_membership_id, org_id: orgId }, select: { id: true } });
  if (!member) return { error: 'member_not_found' };
  if (body.account_id) {
    const account = await prisma.account.findFirst({ where: { id: body.account_id, org_id: orgId }, select: { id: true } });
    if (!account) return { error: 'account_not_found' };
  }
  const dayTotal = (await otherHoursOnDay(org_membership_id, body.date)) + body.hours + (body.overtime_hours || 0);
  if (dayTotal > 24) return { error: 'exceeds_day_hours' };
  const blocked = await leaveBlock(orgId, org_membership_id, body.date, dayTotal);
  if (blocked) return blocked;
  const entry = await prisma.timesheetEntry.create({
    data: {
      org_id: orgId,
      org_membership_id,
      date: body.date,
      account_id: body.account_id || null,
      hours: body.hours,
      overtime_hours: body.account_id ? body.overtime_hours || 0 : 0,
      billable: body.account_id ? body.billable !== false : false,
      notes: body.notes || null,
      status,
      ...(status === 'approved' ? { approved_by: adminUserId, approved_at: new Date(), decision_reason: `Added by admin: ${reason}`.slice(0, 500) } : {}),
    },
  });
  await refreshRevenue(orgId, body.date);
  await workHours.syncDayOvertime(orgId, org_membership_id, body.date);
  const change = await detectFinanceChange(orgId, {
    source_type: 'timesheet',
    source_id: entry.id,
    date: body.date,
    org_membership_id,
    account_id: entry.account_id,
    changed_by: adminUserId,
    description: `Timesheet entry added by admin: ${reason}`,
    old_value: null,
    new_value: snapshotOf(entry),
  });
  return { entry, flagged: change?.flagged || 0 };
}

// Admin bulk upload of past timesheet entries (CSV). Employees are matched by
// employee code or email; the project by project code or name (blank =
// general, non-project time). Every row is checked first and nothing is
// written if any row has an error, so a sheet is applied all-or-nothing and
// can simply be fixed and re-uploaded. Rows go in as approved, like
// adminCreateEntry, with the upload's reason.
async function importEntries(orgId, adminUserId, { rows, reason, dry_run }) {
  const [memberships, projects] = await Promise.all([
    prisma.orgMembership.findMany({ where: { org_id: orgId }, select: { id: true, employee_code: true, joined_at: true, person: { select: { email: true } } } }),
    prisma.account.findMany({ where: { org_id: orgId, type: 'client' }, select: { id: true, name: true, project_name: true, project_code: true } }),
  ]);
  const memberByKey = new Map();
  for (const m of memberships) {
    if (m.employee_code) memberByKey.set(m.employee_code.trim().toLowerCase(), m);
    if (m.person?.email) memberByKey.set(m.person.email.trim().toLowerCase(), m);
  }
  const projectByKey = new Map();
  for (const p of projects) {
    for (const key of [p.project_code, p.project_name, p.name]) {
      if (key && !projectByKey.has(key.trim().toLowerCase())) projectByKey.set(key.trim().toLowerCase(), p);
    }
  }

  const today = todayIst();
  const errors = [];
  const valid = [];
  const dayTotals = new Map();
  let skipped = 0;
  for (const [index, row] of rows.entries()) {
    const line = index + 2; // Row 1 of the sheet is the header.
    if (!row.employee && !row.date && !row.hours) { skipped += 1; continue; }
    const fail = (message) => errors.push({ row: line, employee: row.employee, date: row.date, message });
    const member = memberByKey.get(row.employee.toLowerCase());
    if (!member) { fail('Employee not found — use their employee code or email'); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || Number.isNaN(new Date(`${row.date}T00:00:00.000Z`).getTime())) { fail('Date must be YYYY-MM-DD'); continue; }
    const date = new Date(`${row.date}T00:00:00.000Z`);
    if (date > today) { fail('Date is in the future'); continue; }
    if (member.joined_at && row.date < ymd(member.joined_at)) { fail('Date is before the employee joined'); continue; }
    const hours = Number(row.hours);
    const overtime = row.overtime_hours === '' ? 0 : Number(row.overtime_hours);
    if (!(hours > 0) || hours > 24) { fail('Hours must be a number above 0 and at most 24'); continue; }
    if (!(overtime >= 0) || overtime > 24) { fail('Overtime hours must be a number from 0 to 24'); continue; }
    let project = null;
    if (row.project) {
      project = projectByKey.get(row.project.toLowerCase());
      if (!project) { fail(`Project "${row.project}" not found — use its project code or name`); continue; }
    }
    if (await leaveService.leaveDayFor(orgId, member.id, date)) { fail('Employee is on approved leave that day'); continue; }
    const key = `${member.id}|${row.date}`;
    if (!dayTotals.has(key)) dayTotals.set(key, await otherHoursOnDay(member.id, date));
    dayTotals.set(key, dayTotals.get(key) + hours + (project ? overtime : 0));
    if (dayTotals.get(key) > 24) { fail('More than 24 hours logged for this employee on this date'); continue; }
    const halfCap = await leaveService.workCapacityFor(orgId, member.id, date);
    if (halfCap && dayTotals.get(key) > halfCap.capacity + 1e-9) { fail(`Approved half-day leave that day - only ${halfCap.capacity}h can be logged for work`); continue; }
    const billable = row.billable === '' ? Boolean(project) : /^(y|yes|true|1)$/i.test(row.billable);
    valid.push({
      org_membership_id: member.id,
      date,
      account_id: project?.id || null,
      hours,
      overtime_hours: project ? overtime : 0,
      billable: Boolean(project) && billable,
      notes: row.notes || null,
      status: 'approved',
      reason,
    });
  }

  const summary = { total: rows.length, skipped, errors, created: valid.length, applied: false };
  if (dry_run || errors.length) return summary;
  let flagged = 0;
  for (const entry of valid) {
    const result = await adminCreateEntry(orgId, adminUserId, entry);
    flagged += result.flagged || 0;
  }
  return { ...summary, applied: true, flagged };
}

// Approve all / multi approve-reject in the approval inbox: each item goes
// through its own decision (same permission and state checks as one click),
// in order — regularisations, then entries, then overtime. Items that can't
// be decided (already decided, not the caller's report, over 24h…) are
// listed, not fatal. `approved` counts the items decided either way.
async function bulkApprove(orgId, actor, { status = 'approved', reason, entries = [], overtime = [], regularizations = [] }) {
  const failed = [];
  let approved = 0;
  const run = async (kind, ids, decide) => {
    for (const id of ids) {
      const result = await decide(id);
      if (result?.error) failed.push({ kind, id, error: result.error });
      else approved += 1;
    }
  };
  await run('regularization', regularizations, (id) => decideTicket(orgId, id, actor, { status, decision_reason: reason }));
  await run('entry', entries, (id) => decideEntry(orgId, id, actor, { status, reason }));
  await run('overtime', overtime, (id) => decideOvertime(orgId, id, actor, { status, reason }));
  return { status, approved, failed };
}

module.exports = {
  getProjectDay,
  getProjectTeam,
  bulkApprove,
  importEntries,
  deleteOwnEntry,
  decideOvertime,
  adminCreateEntry,
  adminUpdateEntry,
  adminDeleteEntry,
  unlockDay,
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
  approvalPolicy,
  updateApprovalPolicy,
  pendingApprovals,
  myProjects,
  listTeamProjects,
  bulkDeleteEntries,
  lastCompletedWeekDays,
  lockCompletedWeek,
  teamOverview,
};
