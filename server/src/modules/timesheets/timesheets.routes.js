const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./timesheets.service');
const workHours = require('./workHours.service');
const prisma = require('../../config/db');
const { todayIst } = require('../../lib/istDate');
const { LEAVE_DAY_MESSAGE } = require('../leave/leave.service');
const { buildMonthlyWorkbook } = require('./timesheets.export');
const {
  projectDayQuerySchema,
  projectTeamQuerySchema,
  dashboardQuerySchema,
  monthQuerySchema,
  lockMonthSchema,
  reopenMonthSchema,
  approvalPolicySchema,
  createOvertimeTicketSchema,
  decideOvertimeTicketSchema,
  listOvertimeTicketsQuerySchema,
  adminUpdateOvertimeTicketSchema,
  createEntrySchema,
  updateEntrySchema,
  decideEntrySchema,
  lockDaySchema,
  adminUpdateEntrySchema,
  adminDeleteEntrySchema,
  bulkDeleteEntriesSchema,
  adminCreateEntrySchema,
  importEntriesSchema,
  bulkApproveSchema,
  decideOvertimeSchema,
  weekQuerySchema,
  hoursQuerySchema,
  listQuerySchema,
  lockMonthQuerySchema,
  overviewQuerySchema,
  createTicketSchema,
  decideTicketSchema,
  createRegularizationRequestSchema,
} = require('./timesheets.validation');

const tickets = require('./overtimeTickets.service');

const dashboard = require('./dashboard.service');
const monthLocks = require('./monthLocks.service');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

const ENTRY_ERRORS = {
  day_locked: [409, 'That day is locked (weekly auto-lock) — submit a Timesheet Regularisation request instead'],
  project_required: [422, 'Select a project — timesheet entries are project time, logged against one of your assigned projects'],
  project_not_assigned: [403, "You aren't allocated to that project on that date — ask your admin to assign you to it (or extend your allocation)"],
  not_approver: [403, "You can only decide timesheets for people who report to you"],
  own_entry: [403, "You can't approve your own timesheet"],
  future_date: [422, "You can't log or regularise a future date"],
  not_locked: [422, "That day isn't locked — log it directly on your timesheet"],
  duplicate_pending: [409, 'You already have a pending regularisation request for that date and project'],
  account_not_found: [404, 'Account not found'],
  requirement_not_found: [404, 'Requirement not found for that account'],
  exceeds_day_hours: [422, 'Total hours logged for that day would exceed 24'],
  not_found: [404, 'Timesheet entry not found'],
  manager_approval_disabled: [403, 'Manager approval is switched off for this company - an admin decides timesheets and overtime'],
  awaiting_admin: [409, 'Already approved by the manager - it now waits for the admin, who gives the final approval'],
  already_decided: [409, 'Entry has already been approved or rejected — approved and rejected timesheets are final; ask for a regularisation'],
  member_not_found: [404, 'Employee not found'],
  not_team_member: [403, 'You can only view timesheets of people who report to you'],
  tickets_not_applicable: [422, 'Overtime tickets are for people paid from attendance. Your overtime comes from your timesheet hours (or you are a vendor resource: log overtime on your timesheet)'],
  exceeds_ticket_hours: [422, 'Overtime tickets for one day cannot add up to more than 12 hours'],
  own_ticket: [403, "You can't approve your own overtime ticket"],
  overtime_requires_ticket: [422, 'Your overtime is raised as a ticket (Time & Attendance > OT Tickets) and approved by your manager - it is not logged on the timesheet'],
};

function failFor(res, error, result) {
  if (error === 'leave_day') return fail(res, 422, LEAVE_DAY_MESSAGE(result.leave));
  if (error === 'half_day_capacity') return fail(res, 422, `You're on approved ${result.leave_type} half-day leave on that date — only ${result.capacity}h can be logged for work that day (${result.total}h requested)`);
  const mapped = ENTRY_ERRORS[error];
  return mapped ? fail(res, mapped[0], mapped[1]) : fail(res, 500, 'Unexpected error');
}

router.post(
  '/entries',
  asyncHandler(async (req, res) => {
    const body = createEntrySchema.parse(req.body);
    const result = await service.createEntry(req.user.org_id, req.user.org_membership_id, body, req.user.id);
    if (result.error) return failFor(res, result.error, result);
    return created(res, result.entry);
  })
);

router.get(
  '/entries/me',
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.omit({ org_membership_id: true }).parse(req.query);
    const result = await service.listMine(req.user.org_membership_id, query);
    return ok(res, result.data, { pagination: result.pagination });
  })
);

router.get(
  '/entries',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const result = await service.listTeam(req.user.org_id, query);
    return ok(res, result.data, { pagination: result.pagination, totals: result.totals });
  })
);

// Own project timesheet (daily log + Excel). Any employee. An admin may pass
// org_membership_id to open someone else's log.

router.get(
  '/my-log',
  asyncHandler(async (req, res) => {
    const { month, year, org_membership_id } = monthQuerySchema.parse(req.query);
    // Only an admin may pull someone else's log (the monitoring hub's drill-down) —
    // everyone else always gets their own, same rule as /export/excel.
    const targetMembershipId = req.user.role === 'admin' && org_membership_id ? org_membership_id : req.user.org_membership_id;
    const days = await service.monthlyGrouped(req.user.org_id, targetMembershipId, year, month);
    return ok(res, days);
  })
);

// --- Admin/Superadmin monitoring hub. ---

router.get(
  '/overview',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { department_id, exclude_department_id, month, year } = overviewQuerySchema.parse(req.query);
    const overview = await service.teamOverview(req.user.org_id, { department_id, exclude_department_id, month, year });
    return ok(res, overview);
  })
);

router.get(
  '/export/excel',
  asyncHandler(async (req, res) => {
    const { month, year, org_membership_id } = monthQuerySchema.parse(req.query);
    // Only an admin may export someone else's log — everyone else always gets their own.
    const targetMembershipId = req.user.role === 'admin' && org_membership_id ? org_membership_id : req.user.org_membership_id;
    const result = await buildMonthlyWorkbook(req.user.org_id, targetMembershipId, month, year);
    if (result.error) return fail(res, 404, 'Org membership not found');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="timesheet-${year}-${String(month).padStart(2, '0')}.xlsx"`);
    await result.workbook.xlsx.write(res);
    return res.end();
  })
);

router.patch(
  '/entries/:id',
  asyncHandler(async (req, res) => {
    const body = updateEntrySchema.parse(req.body);
    const result = await service.updateEntry(req.user.org_id, req.user.org_membership_id, req.params.id, body);
    if (result.error) return failFor(res, result.error, result);
    return ok(res, result.entry);
  })
);

// Admin correction / removal of any entry — any status, locked day or not.
// `flagged` counts locked finance calculations the change marked as affected
// (recalculate them in Live Analytics → Billing & sales, then re-invoice).
router.patch(
  '/entries/:id/admin',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = adminUpdateEntrySchema.parse(req.body);
    const result = await service.adminUpdateEntry(req.user.org_id, req.user.id, req.params.id, body);
    if (result.error) return failFor(res, result.error, result);
    return ok(res, { entry: result.entry, flagged: result.flagged });
  })
);

// Admin: delete any entry with a reason. Anyone else: their own entry, only
// while pending and before the week locks (enforced in the service).
// Bulk delete from the Timesheet Dashboard: only the listed logs; an admin must give a reason.
router.post(
  '/entries/bulk-delete',
  asyncHandler(async (req, res) => {
    const body = bulkDeleteEntriesSchema.parse(req.body);
    if (req.user.role === 'admin' && !body.reason) return fail(res, 422, 'A reason is required to delete logs');
    return ok(res, await service.bulkDeleteEntries(req.user.org_id, req.user, body));
  })
);

router.delete(
  '/entries/:id',
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') {
      const result = await service.deleteOwnEntry(req.user.org_id, req.user.org_membership_id, req.params.id);
      if (result.error) return failFor(res, result.error, result);
      return ok(res, { deleted: true });
    }
    const body = adminDeleteEntrySchema.parse(req.body || {});
    const result = await service.adminDeleteEntry(req.user.org_id, req.user.id, req.params.id, body);
    if (result.error) return failFor(res, result.error, result);
    return ok(res, { deleted: true, flagged: result.flagged });
  })
);

router.post(
  '/entries/admin',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const body = adminCreateEntrySchema.parse(req.body);
    const result = await service.adminCreateEntry(req.user.org_id, req.user.id, body);
    if (result.error) return failFor(res, result.error, result);
    return created(res, { entry: result.entry, flagged: result.flagged });
  })
);

// Admin bulk upload (CSV) of past entries. dry_run validates only; otherwise
// the sheet is applied only when no row has an error.
router.post(
  '/entries/admin/import',
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await service.importEntries(req.user.org_id, req.user.id, importEntriesSchema.parse(req.body))))
);

// Overtime decision — the employee's reporting manager or an admin.
router.post(
  '/overtime/:id/decision',
  asyncHandler(async (req, res) => {
    const body = decideOvertimeSchema.parse(req.body);
    const result = await service.decideOvertime(req.user.org_id, req.params.id, req.user, body);
    if (result.error) return failFor(res, result.error, result);
    return ok(res, result.overtime, result.awaiting_admin ? { awaiting_admin: true } : undefined);
  })
);

// Whose hours the caller may read: their own; a manager their direct
// reports; an admin anyone in the org.
async function hoursTarget(req, requested) {
  const own = req.user.org_membership_id;
  if (!requested || requested === own) return { id: own };
  const member = await prisma.orgMembership.findFirst({ where: { id: requested, org_id: req.user.org_id }, select: { id: true, manager_id: true } });
  if (!member) return { error: 'member_not_found' };
  if (req.user.role !== 'admin' && member.manager_id !== own) return { error: 'not_team_member' };
  return { id: member.id };
}

// Weekly timesheet (Sunday -> Saturday): expected / logged / approved /
// pending / OT per day, all computed on the server.
router.get(
  '/week',
  asyncHandler(async (req, res) => {
    const { date, org_membership_id } = weekQuerySchema.parse(req.query);
    const target = await hoursTarget(req, org_membership_id);
    if (target.error) return failFor(res, target.error);
    return ok(res, await workHours.weekView(req.user.org_id, target.id, date || todayIst()));
  })
);

// Approval chain settings (Employee -> Manager (optional) -> Admin (mandatory)).
router.get(
  '/approval-policy',
  asyncHandler(async (req, res) => ok(res, await service.approvalPolicy(req.user.org_id)))
);
router.patch(
  '/approval-policy',
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await service.updateApprovalPolicy(req.user.org_id, approvalPolicySchema.parse(req.body))))
);

// Timesheet Dashboard: every timesheet of a month the caller may view (own / direct reports / all for admin).
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => ok(res, await dashboard.monthList(req.user.org_id, req.user, dashboardQuerySchema.parse(req.query))))
);

// One person's month as a calendar (logged hours, attendance, leave, lock, approval, OT per day).
router.get(
  '/dashboard/calendar',
  asyncHandler(async (req, res) => {
    const { year, month, org_membership_id } = dashboardQuerySchema.parse(req.query);
    const target = await hoursTarget(req, org_membership_id);
    if (target.error) return failFor(res, target.error);
    return ok(res, await dashboard.monthCalendar(req.user.org_id, target.id, { year, month }));
  })
);

router.get(
  '/hours',
  asyncHandler(async (req, res) => {
    const { from, to, org_membership_id } = hoursQuerySchema.parse(req.query);
    const target = await hoursTarget(req, org_membership_id);
    if (target.error) return failFor(res, target.error);
    return ok(res, await workHours.daySummaries(req.user.org_id, target.id, from, to));
  })
);

// Decided by the employee's reporting manager (or any admin) — authorisation
// lives in the service, since it depends on the entry's owner.
router.post(
  '/entries/:id/decision',
  asyncHandler(async (req, res) => {
    const body = decideEntrySchema.parse(req.body);
    const result = await service.decideEntry(req.user.org_id, req.params.id, req.user, body);
    if (result.error) return failFor(res, result.error, result);
    return ok(res, result.entry, result.awaiting_admin ? { awaiting_admin: true } : undefined);
  })
);

router.post(
  '/entries/:id/regularization-tickets',
  asyncHandler(async (req, res) => {
    const body = createTicketSchema.parse(req.body);
    const result = await service.createTicket(req.user.org_id, req.params.id, req.user.id, body);
    if (result.error === 'not_found') return fail(res, 404, 'Timesheet entry not found');
    if (result.error === 'not_locked') return fail(res, 422, "That day isn't locked — edit the entry directly instead");
    return created(res, result.ticket);
  })
);

router.get(
  '/regularization-tickets',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const status = req.query.status;
    const rows = await service.listTickets(req.user.org_id, { status });
    return ok(res, rows);
  })
);

router.post(
  '/regularization-tickets/:id/decision',
  asyncHandler(async (req, res) => {
    const body = decideTicketSchema.parse(req.body);
    const result = await service.decideTicket(req.user.org_id, req.params.id, req.user, body);
    if (result.error === 'not_found') return fail(res, 404, 'Ticket not found');
    if (result.error === 'already_decided') return fail(res, 409, 'Ticket has already been decided');
    if (result.error === 'exceeds_day_hours') return fail(res, 422, 'Approving would push that day over 24 total hours across projects');
    if (result.error) return failFor(res, result.error, result);
    return ok(res, result.ticket, result.awaiting_admin ? { awaiting_admin: true } : undefined);
  })
);

// --- Timesheet Regularisation (locked-week corrections) & approval inbox. ---

router.post(
  '/regularization-requests',
  asyncHandler(async (req, res) => {
    const body = createRegularizationRequestSchema.parse(req.body);
    const result = await service.createRegularizationRequest(req.user.org_id, req.user.org_membership_id, req.user.id, body);
    if (result.error) return failFor(res, result.error, result);
    return created(res, result.ticket);
  })
);

router.get(
  '/regularization-requests/mine',
  asyncHandler(async (req, res) => ok(res, await service.listMyTickets(req.user.org_id, req.user.org_membership_id)))
);

router.get(
  '/approvals/scope',
  asyncHandler(async (req, res) => ok(res, await service.approvalsScope(req.user.org_id, req.user)))
);

router.get(
  '/approvals/pending',
  asyncHandler(async (req, res) => ok(res, await service.pendingApprovals(req.user.org_id, req.user)))
);

// "Approve all" — each item is checked exactly as a single approval.
router.post(
  '/approvals/bulk',
  asyncHandler(async (req, res) => ok(res, await service.bulkApprove(req.user.org_id, req.user, bulkApproveSchema.parse(req.body))))
);

// --- Overtime tickets: the employee raises, the manager / admin decides (attendance-paid people) ---
router.get(
  '/overtime-tickets',
  asyncHandler(async (req, res) => {
    const result = await tickets.listTickets(req.user.org_id, req.user, listOvertimeTicketsQuerySchema.parse(req.query));
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);

router.post(
  '/overtime-tickets',
  asyncHandler(async (req, res) => {
    const result = await tickets.createTicket(req.user.org_id, req.user.org_membership_id, createOvertimeTicketSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return created(res, result.ticket);
  })
);

// The audit history of one ticket: submission, approvals, rejections, edits, with who and when.
router.get(
  '/overtime-tickets/:id/history',
  asyncHandler(async (req, res) => {
    const result = await tickets.ticketHistory(req.user.org_id, req.user, req.params.id);
    if (result.error === 'not_found') return fail(res, 404, 'Ticket not found');
    if (result.error) return failFor(res, result.error);
    return ok(res, result);
  })
);

router.post(
  '/overtime-tickets/:id/decision',
  asyncHandler(async (req, res) => {
    const result = await tickets.decideTicket(req.user.org_id, req.params.id, req.user, decideOvertimeTicketSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.ticket, result.awaiting_admin ? { awaiting_admin: true } : undefined);
  })
);

router.post(
  '/overtime-tickets/:id/cancel',
  asyncHandler(async (req, res) => {
    const result = await tickets.cancelTicket(req.user.org_id, req.user.org_membership_id, req.params.id);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.ticket);
  })
);

router.patch(
  '/overtime-tickets/:id/admin',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await tickets.adminUpdateTicket(req.user.org_id, req.user, req.params.id, adminUpdateOvertimeTicketSchema.parse(req.body));
    if (result.error) return failFor(res, result.error);
    return ok(res, result.ticket);
  })
);

router.delete(
  '/overtime-tickets/:id',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await tickets.adminDeleteTicket(req.user.org_id, req.user, req.params.id, adminDeleteEntrySchema.parse(req.body || {}));
    if (result.error) return failFor(res, result.error);
    return ok(res, { deleted: true });
  })
);

// The project's day: what the team has logged (informational; there is no hour cap).
router.get(
  '/project-day',
  asyncHandler(async (req, res) => {
    const query = projectDayQuerySchema.parse(req.query);
    const result = await service.getProjectDay(req.user.org_id, req.user.org_membership_id, query);
    if (result.error) return failFor(res, result.error);
    return ok(res, result.day);
  })
);

// A project's team timesheet for a month - members, who logged, per-member / date-wise / total hours.
// Only people allocated to the project (and admins) may open it.
router.get(
  '/project-team',
  asyncHandler(async (req, res) => {
    const query = projectTeamQuerySchema.parse(req.query);
    const result = await service.getProjectTeam(req.user.org_id, req.user, query);
    if (result.error === 'account_not_found') return fail(res, 404, 'Project not found');
    if (result.error) return failFor(res, result.error);
    return ok(res, result.team);
  })
);

// Projects the caller may open in Project Team for a month (admin: all projects).
router.get(
  '/project-team/projects',
  asyncHandler(async (req, res) => {
    const { year, month } = projectTeamQuerySchema.pick({ year: true, month: true }).parse(req.query);
    return ok(res, await service.listTeamProjects(req.user.org_id, req.user, { year, month }));
  })
);

// Projects the caller is allocated to — the IT timesheet's project dropdown.
router.get(
  '/my-projects',
  asyncHandler(async (req, res) => ok(res, await service.myProjects(req.user.org_id, req.user.org_membership_id)))
);

router.post(
  '/locks',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { date } = lockDaySchema.parse(req.body);
    const result = await service.lockDay(req.user.org_id, date, req.user.id);
    if (result.error === 'already_locked') return fail(res, 409, 'That day is already locked');
    return created(res, result.lock);
  })
);

// Unlock a day so it can be logged / changed normally again.
router.delete(
  '/locks/:date',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { date } = lockDaySchema.parse({ date: req.params.date });
    const result = await service.unlockDay(req.user.org_id, date, req.user.id, req.body?.reason || null);
    if (result.error === 'not_locked') return fail(res, 404, 'That day is not locked');
    return ok(res, { unlocked: true });
  })
);

// Stage 1 - timesheet lock, per employee and month (bulk). Previous month is due by the 5th of the next.
router.get(
  '/locks/month-status',
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await monthLocks.status(req.user.org_id, lockMonthQuerySchema.parse(req.query))))
);
router.post(
  '/locks/month',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const result = await monthLocks.lockMonth(req.user.org_id, req.user, lockMonthSchema.parse(req.body));
    if (result.error === 'future_month') return fail(res, 422, 'A month that has not started cannot be locked');
    if (result.error === 'nobody_selected') return fail(res, 422, 'Nobody to lock - select employees or choose all with entries');
    return ok(res, result);
  })
);
router.post(
  '/locks/month/reopen',
  authorize('admin'),
  asyncHandler(async (req, res) => ok(res, await monthLocks.reopenMonth(req.user.org_id, req.user, reopenMonthSchema.parse(req.body))))
);

router.get(
  '/locks',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const rows = await service.listLocks(req.user.org_id);
    return ok(res, rows);
  })
);

module.exports = router;
