const express = require('express');
const { authenticate, authorize, requireOrgMembership } = require('../../middleware/auth');
const requireItDepartment = require('../../middleware/requireItDepartment');
const { ok, created, fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./timesheets.service');
const { LEAVE_DAY_MESSAGE } = require('../leave/leave.service');
const { buildMonthlyWorkbook } = require('./timesheets.export');
const {
  createEntrySchema,
  updateEntrySchema,
  decideEntrySchema,
  lockDaySchema,
  listQuerySchema,
  monthQuerySchema,
  overviewQuerySchema,
  createTicketSchema,
  decideTicketSchema,
  createRegularizationRequestSchema,
} = require('./timesheets.validation');

const router = express.Router();
router.use(authenticate, requireOrgMembership);

const ENTRY_ERRORS = {
  day_locked: [409, 'That day is locked (weekly auto-lock) — submit a Timesheet Regularisation request instead'],
  project_required: [422, 'Select a project — IT timesheet entries must be logged against one of your assigned projects'],
  project_not_assigned: [403, "That project isn't assigned to you — ask your admin to assign you to it"],
  not_approver: [403, "You can only decide timesheets for people who report to you"],
  own_entry: [403, "You can't approve your own timesheet"],
  future_date: [422, "You can't log or regularise a future date"],
  not_locked: [422, "That day isn't locked — log it directly on your timesheet"],
  duplicate_pending: [409, 'You already have a pending regularisation request for that date and project'],
  account_not_found: [404, 'Account not found'],
  requirement_not_found: [404, 'Requirement not found for that account'],
  exceeds_day_hours: [422, 'Total hours logged for that day would exceed 24'],
  not_found: [404, 'Timesheet entry not found'],
  already_decided: [409, 'Entry has already been approved or rejected'],
};

function failFor(res, error, result) {
  if (error === 'leave_day') return fail(res, 422, LEAVE_DAY_MESSAGE(result.leave));
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
    return ok(res, result.data, { pagination: result.pagination });
  })
);

// --- IT itemized timesheet view (module-tagged daily log + Excel export). ---
//     Restricted to the IT department (admins bypass) — the underlying
//     entries above stay open org-wide for every department's billing use.

router.get(
  '/my-log',
  requireItDepartment,
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
    const { department_id, month, year } = overviewQuerySchema.parse(req.query);
    const overview = await service.teamOverview(req.user.org_id, { department_id, month, year });
    return ok(res, overview);
  })
);

router.get(
  '/export/excel',
  requireItDepartment,
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

// Decided by the employee's reporting manager (or any admin) — authorisation
// lives in the service, since it depends on the entry's owner.
router.post(
  '/entries/:id/decision',
  asyncHandler(async (req, res) => {
    const body = decideEntrySchema.parse(req.body);
    const result = await service.decideEntry(req.user.org_id, req.params.id, req.user, body);
    if (result.error) return failFor(res, result.error, result);
    return ok(res, result.entry);
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
    return ok(res, result.ticket);
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

router.get(
  '/locks',
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const rows = await service.listLocks(req.user.org_id);
    return ok(res, rows);
  })
);

module.exports = router;
